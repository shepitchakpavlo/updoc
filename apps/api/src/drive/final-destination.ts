import { createHash } from "node:crypto";
import type { BookletSlot } from "../checklist.js";
import type { SupportedMime } from "../preflight/index.js";
import type { DriveClient } from "./client.js";

// Контракт FinalDestination (Architecture §5): ідемпотентний запис прийнятого
// файла в папку заявки у Shared Drive. Повторний запис того самого файла
// (retry після технічного збою — ledger не зберігся, відповідь загубилась)
// не створює дублікатів: файл пізнається в папці за іменем слота і MD5 вмісту
// (MD5 рахують сервери Drive), його id перевикористовується. Заміна файла
// слота (повторне завантаження іншого файла, зокрема іншого формату) видаляє
// стару версію — Architecture §4: один файл на слот, історії версій немає.
// Конкурентні записи того самого слота всередині процесу (подвійний сабміт
// форми, паралельний retry) серіалізуються: Drive не має умовного створення,
// find-then-create не атомарний. Між процесами (Phase 1, кілька інстансів)
// ідемпотентність забезпечуватиме стан «помилка Drive» + retry з панелі
// (Architecture §7).

export interface FinalDestinationWriteInput {
  /** папка заявки в тестовому Drive (applications.folder_id) */
  folderId: string;
  slot: BookletSlot;
  mimeType: SupportedMime;
  /** байти прийнятого файла (у пам'яті процесу; TemporaryStorage — контракт, Phase 1) */
  data: Buffer;
}

export interface FinalDestination {
  /**
   * Запис прийнятого файла слота в папку заявки. Повертає id файла в Drive
   * (ledger submission.drive_file_id). Ідемпотентний: повторний виклик із
   * тим самим вмістом не створює дублікат.
   */
  writeFile(input: FinalDestinationWriteInput): Promise<string>;
}

export interface FinalDestinationDeps {
  drive: DriveClient;
}

// Розширення імені файла за MIME (ім'я — слот + розширення, без PII).
const MIME_TO_EXT: Record<SupportedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function createDriveFinalDestination(deps: FinalDestinationDeps): FinalDestination {
  // Черга записів на (folderId, slot): наступний запис чекає на попередній,
  // тож паралельні виклики того самого слота бачать результат один одного.
  const inflight = new Map<string, Promise<string>>();

  async function write(input: FinalDestinationWriteInput): Promise<string> {
    const { folderId, slot, mimeType, data } = input;
    // Файли слота в папці: ім'я = `слот.розширення`, тому шукаємо всі файли
    // з префіксом слота — заміна формату (JPG→PDF) має прибрати стару версію.
    const name = `${slot}.${MIME_TO_EXT[mimeType]}`;
    const md5 = createHash("md5").update(data).digest("hex");
    const slotFiles = (await deps.drive.listFilesInFolder(folderId)).filter((file) =>
      file.name.startsWith(`${slot}.`),
    );
    const match = slotFiles.find((file) => file.md5Checksum === md5);
    // Файл уже в папці — це той самий вміст: перевикористовуємо його id,
    // дублікат не створюється. Інакше спершу створюємо новий, потім прибираємо
    // старі версії слота — create-first: збій прибирання не має втратити
    // щойно записаний файл. Прибирання бест-еффорт (Architecture §4: історії
    // версій немає; збій видалення не має перетворювати успішний запис на
    // помилку — наступний запис слота дочистить).
    const fileId = match ? match.id : await deps.drive.createFile({ name, parentId: folderId, mimeType, data });
    await Promise.all(
      slotFiles
        .filter((file) => file.id !== fileId)
        .map((file) => deps.drive.deleteFile(file.id).catch(() => undefined)),
    );
    return fileId;
  }

  return {
    async writeFile(input) {
      const key = `${input.folderId}:${input.slot}`;
      const previous = inflight.get(key) ?? Promise.resolve(undefined);
      // Збій попереднього запису не блокує наступний: retry після помилки
      // Drive має виконати запис наново, а не успадкувати чужу помилку.
      const run = previous.catch(() => undefined).then(() => write(input));
      inflight.set(key, run);
      void run.then(
        () => {
          if (inflight.get(key) === run) {
            inflight.delete(key);
          }
        },
        () => {
          if (inflight.get(key) === run) {
            inflight.delete(key);
          }
        },
      );
      return run;
    },
  };
}
