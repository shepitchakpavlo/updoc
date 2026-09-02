import { createHash } from "node:crypto";
import type { AssessmentProvider } from "../assessment/provider.js";
import { BOOKLET_SLOTS, type BookletSlot } from "../checklist.js";
import type { ApplicationRepo } from "../applications/repo.js";
import type { SubmissionStatus } from "../db/schema.js";
import type { FinalDestination } from "../drive/final-destination.js";
import { ApiError } from "../errors.js";
import { decidePolicy } from "../policy/index.js";
import { preflight, type SupportedMime } from "../preflight/index.js";
import { hashToken } from "../tokens.js";
import type { SubmissionListItem, SubmissionRepo } from "./repo.js";

// Upload файла на слот за токеном заявки (тикети 04, 06, 07): токен → заявка,
// слот із чекліста, preflight (розмір/MIME/сторінки PDF), sha256, submission
// у стані «перевіряється» → assessment (контракт AssessmentProvider) →
// рішення policy (тикет 07) → «прийнято» / «потрібно перезавантажити».
// Файл тримається в пам'яті процесу — TemporaryStorage лише контракт
// (Phase 1 реалізує зберігання).

export class UnknownTokenError extends ApiError {
  constructor() {
    super("not_found", 404, "Заявку не знайдено");
  }
}

export class InvalidSlotError extends ApiError {
  constructor() {
    super("invalid_slot", 400, "Слот не належить чеклісту книжечки");
  }
}

export interface UploadSlotInput {
  token: string;
  slot: string;
  /** байти файла (multipart декодовано у пам'ять процесу) */
  file: Buffer;
}

export interface UploadResult {
  slot: BookletSlot;
  checksum: string;
  status: SubmissionStatus;
  mimeType: SupportedMime;
  pageCount: number | null;
  /** причина відхилення (feedback для працівника); null, коли прийнято */
  feedback: string | null;
}

// Стан слота для SPA-форми (тикет 05): feedback — зрозуміла причина для
// працівника, коли файл треба перезавантажити (Architecture §2: кожен reject
// має feedback; причини policy з'являться в assessment тикетами 06/07).
export interface SubmissionView {
  slot: BookletSlot;
  status: SubmissionStatus;
  feedback: string | null;
}

export interface SubmissionService {
  uploadSlot(input: UploadSlotInput): Promise<UploadResult>;
  /** Стан і фідбек усіх слотів заявки в порядку чекліста; null — невідомий токен. */
  listByToken(token: string): Promise<SubmissionView[] | null>;
}

export interface SubmissionServiceDeps {
  applications: ApplicationRepo;
  submissions: SubmissionRepo;
  /** Контракт Architecture §5; у TB-0 — мок, Phase 1 підставить hosted vision. */
  assessment: AssessmentProvider;
  /** Контракт Architecture §5: ідемпотентний запис прийнятого файла в папку заявки (тикет 08). */
  finalDestination: FinalDestination;
}

export function createSubmissionService(deps: SubmissionServiceDeps): SubmissionService {
  return {
    async uploadSlot({ token, slot, file }) {
      if (!(BOOKLET_SLOTS as readonly string[]).includes(slot)) {
        throw new InvalidSlotError();
      }
      const application = await deps.applications.findByTokenHash(hashToken(token));
      if (!application) {
        throw new UnknownTokenError();
      }
      const result = await preflight(file);
      const checksum = createHash("sha256").update(file).digest("hex");
      // Файл прийнято в обробку: стан «перевіряється», старий assessment і
      // ledger скинуті (заміна файла — нове рішення). При збої провайдера
      // файл лишається у «перевіряється» — технічна помилка, не reject
      // (Architecture §6: один retry у Phase 1).
      await deps.submissions.upsert({
        applicationId: application.id,
        slot,
        checksum,
        status: "checking",
        assessment: null,
        driveFileId: null,
      });
      const assessment = await deps.assessment.assess(file);
      // Рішення приймає policy (тикет 07) над нормалізованим результатом —
      // не сам провайдер: відповідність слота, загальна впевненість і критичні
      // поля (Architecture §6). Причина policy — feedback для працівника;
      // результат зберігається в assessment JSON у форматі реального виклику.
      const decision = decidePolicy(slot as BookletSlot, assessment);
      // Тикет 08: у Drive записується лише прийнятий файл (Architecture §4),
      // id — ledger submission.drive_file_id. Запис ідемпотентний (Architecture
      // §5): retry після технічного збою (ledger не зберігся) не створює
      // дублікатів. Збій запису — технічна помилка, не reject: файл лишається
      // у «перевіряється» для безпечного retry (Architecture §6).
      let status: SubmissionStatus;
      let driveFileId: string | null = null;
      if (decision.accepted) {
        driveFileId = await deps.finalDestination.writeFile({
          folderId: application.folderId,
          slot: slot as BookletSlot,
          mimeType: result.mimeType,
          data: file,
        });
        status = "accepted";
      } else {
        status = "needs_reupload";
      }
      await deps.submissions.upsert({
        applicationId: application.id,
        slot,
        checksum,
        status,
        assessment,
        driveFileId,
      });
      return {
        slot: slot as BookletSlot,
        checksum,
        status,
        feedback: decision.reason,
        ...result,
      };
    },
    async listByToken(token) {
      const application = await deps.applications.findByTokenHash(hashToken(token));
      if (!application) {
        return null;
      }
      const rows = await deps.submissions.listByApplicationId(application.id);
      const bySlot: Record<string, SubmissionListItem> = Object.fromEntries(
        rows.map((row) => [row.slot, row]),
      );
      const views: SubmissionView[] = [];
      for (const slot of BOOKLET_SLOTS) {
        const row = bySlot[slot];
        if (!row) {
          continue;
        }
        views.push({
          slot,
          status: row.status,
          // Причину показуємо лише тоді, коли файл відхилено: прийнятий/той, що
          // перевіряється, не потребує дії працівника. Рішення policy
          // детерміноване над збереженим нормалізованим результатом (тикет 07):
          // фідбек переобчислюємо, щоб policy лишалася єдиним власником рішень.
          feedback:
            row.status === "needs_reupload"
              ? (row.assessment ? decidePolicy(row.slot as BookletSlot, row.assessment).reason : null)
              : null,
        });
      }
      return views;
    },
  };
}
