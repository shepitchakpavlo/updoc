import { createHash } from "node:crypto";
import { BOOKLET_SLOTS, type BookletSlot } from "../checklist.js";
import type { ApplicationRepo } from "../applications/repo.js";
import type { SubmissionStatus } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { preflight, type SupportedMime } from "../preflight/index.js";
import { hashToken } from "../tokens.js";
import type { SubmissionRepo } from "./repo.js";

// Upload файла на слот за токеном заявки (тикет 04): токен → заявка,
// слот із чекліста, preflight (розмір/MIME/сторінки PDF), sha256, submission
// зі станом pending. Файл тримається в пам'яті процесу — TemporaryStorage
// лише контракт (Phase 1 реалізує зберігання).

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
}

export interface SubmissionService {
  uploadSlot(input: UploadSlotInput): Promise<UploadResult>;
}

export interface SubmissionServiceDeps {
  applications: ApplicationRepo;
  submissions: SubmissionRepo;
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
      // Upload завжди повертає файл у стан «очікується»: assessment ще не виконано
      // (тикет 06 переведе у «перевіряється»); заміна файла скидає старий результат.
      const status: SubmissionStatus = "pending";
      const checksum = createHash("sha256").update(file).digest("hex");
      await deps.submissions.upsert({
        applicationId: application.id,
        slot,
        checksum,
        status,
        assessment: null,
        driveFileId: null,
      });
      return { slot: slot as BookletSlot, checksum, status, ...result };
    },
  };
}
