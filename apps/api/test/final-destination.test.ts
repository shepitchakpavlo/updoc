import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { BookletSlot } from "../src/checklist.js";
import type { SupportedMime } from "../src/preflight/index.js";
import { createDriveFinalDestination, type FinalDestination } from "../src/drive/final-destination.js";
import type { CreateFileInput, DriveClient, DriveFileInfo } from "../src/drive/client.js";

// Seam: FinalDestination + фейк DriveClient (тикет 08). Контракт (Architecture
// §5): ідемпотентний запис прийнятого файла в папку заявки — повторний запис
// того самого файла (retry після збою ledger/відповіді) не створює дублікатів;
// заміна файла слота прибирає стару версію (Architecture §4: історії версій
// немає). Ім'я файла — слот + розширення (PII-безпека).

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG = Buffer.concat([PNG_SIG, Buffer.from("hello")]);
// md5("\x89PNG\r\n\x1a\nhello") — незалежне значення, обчислено поза кодом.
const PNG_MD5 = "430f6c1039fa71d5bf7f1e717dfb5f63";
const PNG_V2 = Buffer.concat([PNG_SIG, Buffer.from("world")]);

// Фейк, що поводиться як Drive: зберігає файли (ім'я + папка) і рахує MD5
// вмісту при створенні; повторний createFile з тим самим іменем не видаляє
// старий — це семантика Drive, з якою працює ідемпотентний запис.
interface FakeDrive extends DriveClient {
  files: Array<{ id: string; name: string; parentId: string; md5Checksum: string | null }>;
  created: CreateFileInput[];
  deleted: string[];
}

function fakeDrive(initial: Array<{ id: string; name: string; md5Checksum: string | null }> = []): FakeDrive {
  let nextId = 0;
  const files: FakeDrive["files"] = initial.map((f) => ({ ...f, parentId: "folder-1" }));
  const created: CreateFileInput[] = [];
  const deleted: string[] = [];
  return {
    files,
    created,
    deleted,
    async findFoldersByName() {
      return [];
    },
    async createFolder() {
      return "folder-1";
    },
    async deleteFolder() {},
    async listFilesInFolder(parentId) {
      return files
        .filter((f) => f.parentId === parentId)
        .map(({ id, name, md5Checksum }) => ({ id, name, md5Checksum } satisfies DriveFileInfo));
    },
    async createFile(input) {
      created.push(input);
      const id = `file-${++nextId}`;
      files.push({
        id,
        name: input.name,
        parentId: input.parentId,
        md5Checksum: createHash("md5").update(input.data).digest("hex"),
      });
      return id;
    },
    async deleteFile(fileId) {
      deleted.push(fileId);
      const index = files.findIndex((f) => f.id === fileId);
      if (index >= 0) {
        files.splice(index, 1);
      }
    },
  };
}

function makeDestination(drive: DriveClient): FinalDestination {
  return createDriveFinalDestination({ drive });
}

test("writeFile створює файл слота в папці заявки й повертає його id", async () => {
  const drive = fakeDrive();
  const id = await makeDestination(drive).writeFile({
    folderId: "folder-1",
    slot: "1-2" as BookletSlot,
    mimeType: "image/png",
    data: PNG,
  });
  assert.equal(id, "file-1");
  assert.deepEqual(drive.created, [
    { name: "1-2.png", parentId: "folder-1", mimeType: "image/png", data: PNG },
  ]);
  assert.deepEqual(drive.deleted, []);
});

test("ім'я файла — слот із розширенням за MIME (jpg/pdf/heic)", async () => {
  const names: Record<string, { mimeType: SupportedMime; name: string }> = {
    "11-12": { mimeType: "application/pdf", name: "11-12.pdf" },
    "13-14": { mimeType: "image/jpeg", name: "13-14.jpg" },
    "15-16": { mimeType: "image/heic", name: "15-16.heic" },
  };
  for (const [slot, { mimeType, name }] of Object.entries(names)) {
    const drive = fakeDrive();
    await makeDestination(drive).writeFile({
      folderId: "folder-1",
      slot: slot as BookletSlot,
      mimeType,
      data: PNG,
    });
    assert.equal(drive.created[0]?.name, name, slot);
  }
});

test("повторний запис того самого файла перевикористовує id — дублікат не створюється", async () => {
  const drive = fakeDrive();
  const destination = makeDestination(drive);
  const first = await destination.writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "image/png",
    data: PNG,
  });
  // Retry після збою (наприклад, ledger не зберігся): той самий файл знову.
  const second = await destination.writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "image/png",
    data: PNG,
  });
  assert.equal(second, first, "той самий файл у Drive — той самий id");
  assert.equal(drive.created.length, 1, "createFile викликаний лише раз");
  assert.deepEqual(drive.deleted, []);
  assert.equal(drive.files.length, 1);
});

test("повторний запис пізнає вже наявний файл за MD5 (незалежний літерал)", async () => {
  const drive = fakeDrive([{ id: "existing-1", name: "1-2.png", md5Checksum: PNG_MD5 }]);
  const id = await makeDestination(drive).writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "image/png",
    data: PNG,
  });
  assert.equal(id, "existing-1");
  assert.equal(drive.created.length, 0, "файл уже в папці — створення не потрібне");
  assert.deepEqual(drive.deleted, []);
});

test("новий файл слота замінює старий: створюється і старий видаляється", async () => {
  const drive = fakeDrive([{ id: "old-1", name: "1-2.png", md5Checksum: PNG_MD5 }]);
  const id = await makeDestination(drive).writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "image/png",
    data: PNG_V2,
  });
  assert.equal(id, "file-1", "новий файл створено");
  assert.deepEqual(drive.created.map((c) => c.name), ["1-2.png"]);
  assert.deepEqual(drive.deleted, ["old-1"], "стара версія слота видалена (Architecture §4)");
  assert.equal(drive.files.length, 1, "у папці лишається один файл слота");
});

test("кілька файлів з іменем слота: збіг за MD5 перевикористовується, решта прибираються", async () => {
  const drive = fakeDrive([
    { id: "orphan-1", name: "1-2.png", md5Checksum: "00000000000000000000000000000000" },
    { id: "match-1", name: "1-2.png", md5Checksum: PNG_MD5 },
    { id: "orphan-2", name: "1-2.png", md5Checksum: "11111111111111111111111111111111" },
  ]);
  const id = await makeDestination(drive).writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "image/png",
    data: PNG,
  });
  assert.equal(id, "match-1");
  assert.equal(drive.created.length, 0);
  assert.deepEqual(new Set(drive.deleted), new Set(["orphan-1", "orphan-2"]));
  assert.equal(drive.files.length, 1);
});

test("збій створення файла — помилка без змін у папці", async () => {
  const drive = fakeDrive();
  drive.createFile = async () => {
    throw new Error("Google Drive: запит POST не вдався (500)");
  };
  await assert.rejects(
    makeDestination(drive).writeFile({
      folderId: "folder-1",
      slot: "1-2",
      mimeType: "image/png",
      data: PNG,
    }),
    /не вдався/,
  );
  assert.equal(drive.deleted.length, 0, "старий файл не видаляється при збої створення нового");
});

test("заміна файла слота іншим форматом прибирає стару версію (один файл на слот)", async () => {
  const drive = fakeDrive([{ id: "old-png", name: "1-2.png", md5Checksum: PNG_MD5 }]);
  const id = await makeDestination(drive).writeFile({
    folderId: "folder-1",
    slot: "1-2",
    mimeType: "application/pdf",
    data: PNG_V2,
  });
  assert.equal(id, "file-1");
  assert.deepEqual(drive.created.map((c) => c.name), ["1-2.pdf"], "новий файл — новий формат");
  assert.deepEqual(drive.deleted, ["old-png"], "стара версія іншого формату видалена");
  assert.equal(drive.files.length, 1, "у папці лишається один файл слота");
});

test("конкурентні записи того самого слота не створюють дублікатів", async () => {
  const drive = fakeDrive();
  const destination = makeDestination(drive);
  const [first, second] = await Promise.all([
    destination.writeFile({ folderId: "folder-1", slot: "1-2", mimeType: "image/png", data: PNG }),
    destination.writeFile({ folderId: "folder-1", slot: "1-2", mimeType: "image/png", data: PNG }),
  ]);
  assert.equal(first, second, "обидва записи отримують id того самого файла");
  assert.equal(drive.created.length, 1, "createFile викликаний лише раз");
  assert.equal(drive.files.length, 1);
});

test("конкурентний запис не блокується збоєм попереднього (retry виконується наново)", async () => {
  const drive = fakeDrive();
  const originalCreate = drive.createFile;
  let fail = true;
  drive.createFile = async (input) => {
    if (fail) {
      fail = false;
      throw new Error("Google Drive: запит POST не вдався (500)");
    }
    return originalCreate(input);
  };
  const destination = makeDestination(drive);
  const [first, second] = await Promise.allSettled([
    destination.writeFile({ folderId: "folder-1", slot: "1-2", mimeType: "image/png", data: PNG }),
    destination.writeFile({ folderId: "folder-1", slot: "1-2", mimeType: "image/png", data: PNG }),
  ]);
  assert.equal(first.status, "rejected", "перший запис упав");
  assert.equal(second.status, "fulfilled", "наступний запис виконується наново, без успадкування помилки");
  assert.equal(second.status === "fulfilled" ? second.value : "", "file-1");
  assert.equal(drive.files.length, 1);
});
