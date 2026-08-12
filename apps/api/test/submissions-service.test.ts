import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMockAssessmentProvider, SLOT_MARKER } from "../src/assessment/mock.js";
import type { AssessmentProvider, AssessmentResult } from "../src/assessment/provider.js";
import type { Application, ApplicationRepo } from "../src/applications/repo.js";
import type { BookletSlot } from "../src/checklist.js";
import type { CreateFileInput, DriveClient } from "../src/drive/client.js";
import {
  createDriveFinalDestination,
  type FinalDestination,
  type FinalDestinationWriteInput,
} from "../src/drive/final-destination.js";
import {
  FileTooLargeError,
  UnsupportedFormatError,
} from "../src/preflight/index.js";
import type { NewSubmission, SubmissionListItem, SubmissionRepo } from "../src/submissions/repo.js";
import {
  InvalidSlotError,
  UnknownTokenError,
  createSubmissionService,
  type SubmissionService,
} from "../src/submissions/service.js";
import { makePdf } from "./helpers/pdf.js";

// Seam: service + fake repos + fake AssessmentProvider (тикет 04, 06, 07).
// Контракт: upload за токеном валідує слот, проганяє preflight, рахує sha256,
// фіксує стан «перевіряється» і виконує assessment; рішення приймає policy
// (тикет 07) над нормалізованим результатом — стан → «прийнято» або
// «потрібно перезавантажити», feedback — причина policy. Повторне
// завантаження — заміна (upsert).

// Результати фейк-провайдера — незалежні літерали, не переобчислені кодом.
const ACCEPTED_FIELDS = {
  fullName: { value: "Тестовий Працівник", confidence: 0.97 },
  documentNumber: { value: "AA000000", confidence: 0.95 },
  birthDate: { value: "1990-01-01", confidence: 0.96 },
};

// Прийнятий результат, що відповідає слоту завантаження (policy прийме його).
function acceptedAssessment(slot: BookletSlot): AssessmentResult {
  return {
    accepted: true,
    reason: null,
    recognizedSlot: slot,
    recognizedFields: ACCEPTED_FIELDS,
    confidence: 0.96,
  };
}

const REJECTED_ASSESSMENT: AssessmentResult = {
  accepted: false,
  reason: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
  recognizedSlot: null,
  recognizedFields: {},
  confidence: 0,
};

const APP_ID = "app-1";
const MAX_20MB = 20 * 1024 * 1024;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG = Buffer.concat([PNG_SIG, Buffer.from([0x01, 0x02, 0x03])]);
// sha256("\x89PNG\r\n\x1a\nhello") — незалежне значення, обчислено поза кодом.
const PNG_HELLO = Buffer.concat([PNG_SIG, Buffer.from("hello")]);
const PNG_HELLO_SHA256 = "0e8754cfeb908584f7a2f2ccd08e37fda8d3d540cbaf2e16ac559c7ea59a7151";

function makeAppRow(): Application {
  return {
    id: APP_ID,
    company: "ТОВ Приклад",
    fullName: "Іваненко Іван Іванович",
    tokenHash: "known-token-hash",
    folderId: "folder-1",
    createdAt: new Date(),
  };
}

// Рядки для listByApplicationId: з applicationId, щоб фейк міг фільтрувати
// за заявкою; назовні (інтерфейс repo) applicationId не входить.
interface FakeSubmissionRow extends SubmissionListItem {
  applicationId: string;
}

interface FakeSubmissionRepo extends SubmissionRepo {
  upserts: NewSubmission[];
  rows: FakeSubmissionRow[];
}

function fakeSubmissionRepo(): FakeSubmissionRepo {
  const upserts: NewSubmission[] = [];
  const rows: FakeSubmissionRow[] = [];
  return {
    upserts,
    rows,
    async upsert(row) {
      upserts.push(row);
    },
    async listByApplicationId(applicationId) {
      return rows
        .filter((row) => row.applicationId === applicationId)
        .map(({ applicationId: _applicationId, ...rest }) => rest);
    },
  };
}

function fakeAssessment(result: AssessmentResult): AssessmentProvider {
  return { async assess() { return result; } };
}

// Фейк FinalDestination (тикет 08): записує виклики й повертає фіксований id
// ledger — реальну ідемпотентність перевіряють тести final-destination.test.ts.
interface FakeFinalDestination extends FinalDestination {
  writes: FinalDestinationWriteInput[];
}

function fakeFinalDestination(): FakeFinalDestination {
  const writes: FinalDestinationWriteInput[] = [];
  return {
    writes,
    async writeFile(input) {
      writes.push(input);
      return "drive-file-1";
    },
  };
}

function makeService(overrides: {
  applications?: ApplicationRepo;
  submissions?: FakeSubmissionRepo;
  /** дефолт — фейк із прийнятим результатом, що відповідає слоту; мок підставляється окремим тестом */
  assessment?: AssessmentProvider;
  /** дефолт — фейк, що повертає "drive-file-1" */
  finalDestination?: FinalDestination;
} = {}): SubmissionService & { submissions: FakeSubmissionRepo; finalDestination: FakeFinalDestination } {
  const submissions = overrides.submissions ?? fakeSubmissionRepo();
  const finalDestination =
    (overrides.finalDestination as FakeFinalDestination | undefined) ?? fakeFinalDestination();
  const applications: ApplicationRepo =
    overrides.applications ?? {
      async insert() {},
      async findByTokenHash() {
        return makeAppRow();
      },
    };
  const service = createSubmissionService({
    applications,
    submissions,
    assessment: overrides.assessment ?? fakeAssessment(acceptedAssessment("1-2")),
    finalDestination,
  });
  return Object.assign(service, { submissions, finalDestination });
}

test("upload: стан «перевіряється» → «прийнято», assessment зберігається в submission", async () => {
  const service = makeService();
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.deepEqual(result, {
    slot: "1-2",
    checksum: PNG_HELLO_SHA256,
    status: "accepted",
    mimeType: "image/png",
    pageCount: null,
    feedback: null,
  });
  assert.equal(service.submissions.upserts.length, 2, "спершу «перевіряється», потім фінальний стан");
  const [checking, final] = service.submissions.upserts;
  assert.ok(checking && final);
  for (const stored of [checking, final]) {
    assert.deepEqual(
      { applicationId: stored.applicationId, slot: stored.slot, checksum: stored.checksum },
      { applicationId: APP_ID, slot: "1-2", checksum: PNG_HELLO_SHA256 },
    );
  }
  assert.equal(checking.status, "checking", "файл спершу фіксується у стані «перевіряється»");
  assert.equal(checking.assessment, null, "під час перевірки старого assessment немає");
  assert.equal(checking.driveFileId, null, "новий файл — без старого ledger");
  assert.equal(final.status, "accepted", "після assessment — «прийнято»");
  assert.deepEqual(final.assessment, acceptedAssessment("1-2"), "результат у форматі реального виклику");
  assert.equal(final.driveFileId, "drive-file-1", "ledger: id файла після запису в Drive");
});

test("відхилений файл: стан «потрібно перезавантажити», причина — feedback у відповіді", async () => {
  const service = makeService({ assessment: fakeAssessment(REJECTED_ASSESSMENT) });
  const result = await service.uploadSlot({ token: "raw-token", slot: "11-12", file: PNG_HELLO });
  assert.equal(result.status, "needs_reupload");
  assert.equal(result.feedback, REJECTED_ASSESSMENT.reason);
  const final = service.submissions.upserts[1];
  assert.ok(final);
  assert.equal(final.status, "needs_reupload");
  assert.deepEqual(final.assessment, REJECTED_ASSESSMENT);
});

test("збій провайдера: технічна помилка, файл лишається у стані «перевіряється»", async () => {
  const service = makeService({
    assessment: {
      async assess() {
        throw new Error("hosted vision недоступний");
      },
    },
  });
  await assert.rejects(
    service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO }),
    /hosted vision недоступний/,
  );
  assert.equal(service.submissions.upserts.length, 1);
  assert.equal(service.submissions.upserts[0]?.status, "checking", "збій ≠ reject: стан чекає retry (Architecture §6)");
});

test("реальний мок через сервіс: файл із маркером слота → «прийнято», замалий → «потрібно перезавантажити»", async () => {
  const service = makeService({ assessment: createMockAssessmentProvider() });
  const largePng = Buffer.concat([
    PNG_SIG,
    Buffer.from(`${SLOT_MARKER}1-2\n`),
    Buffer.alloc(4096, 0x01),
  ]);
  const accepted = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: largePng });
  assert.equal(accepted.status, "accepted");
  const rejected = await service.uploadSlot({ token: "raw-token", slot: "11-12", file: PNG_HELLO });
  assert.equal(rejected.status, "needs_reupload");
  assert.ok(rejected.feedback && rejected.feedback.length > 0);
  const rejectedFinal = service.submissions.upserts[3];
  assert.ok(rejectedFinal);
  assert.deepEqual(rejectedFinal.assessment, {
    accepted: false,
    reason: rejected.feedback,
    recognizedSlot: null,
    recognizedFields: {},
    confidence: 0,
  });
});

test("невідомий токен — UnknownTokenError, submission не створюється", async () => {
  const service = makeService({
    applications: {
      async insert() {},
      async findByTokenHash() {
        return null;
      },
    },
  });
  await assert.rejects(
    service.uploadSlot({ token: "unknown", slot: "1-2", file: PNG }),
    UnknownTokenError,
  );
  assert.equal(service.submissions.upserts.length, 0);
});

test("слот поза чеклістом — InvalidSlotError, submission не створюється", async () => {
  const service = makeService();
  for (const slot of ["3", "1", "12-13", "1-2-3", ""]) {
    await assert.rejects(
      service.uploadSlot({ token: "raw-token", slot, file: PNG }),
      InvalidSlotError,
      slot,
    );
  }
  assert.equal(service.submissions.upserts.length, 0);
});

test("файл понад 20MB — FileTooLargeError, submission не створюється", async () => {
  const service = makeService();
  await assert.rejects(
    service.uploadSlot({ token: "raw-token", slot: "1-2", file: Buffer.alloc(MAX_20MB + 1) }),
    FileTooLargeError,
  );
  assert.equal(service.submissions.upserts.length, 0);
});

test("непідтримуваний формат — UnsupportedFormatError, submission не створюється", async () => {
  const service = makeService();
  await assert.rejects(
    service.uploadSlot({ token: "raw-token", slot: "1-2", file: Buffer.from("текст") }),
    UnsupportedFormatError,
  );
  assert.equal(service.submissions.upserts.length, 0);
});

test("PDF: результат містить кількість сторінок", async () => {
  const service = makeService({ assessment: fakeAssessment(acceptedAssessment("11-12")) });
  const result = await service.uploadSlot({ token: "raw-token", slot: "11-12", file: await makePdf(3) });
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.pageCount, 3);
  assert.equal(result.status, "accepted", "файл відповідного слота проходить policy");
});

test("повторне завантаження на слот замінює попереднє (upsert)", async () => {
  const service = makeService();
  const first = Buffer.concat([PNG_SIG, Buffer.from("one")]);
  const second = Buffer.concat([PNG_SIG, Buffer.from("two")]);
  await service.uploadSlot({ token: "raw-token", slot: "1-2", file: first });
  await service.uploadSlot({ token: "raw-token", slot: "1-2", file: second });
  assert.equal(service.submissions.upserts.length, 4, "по два записи на upload: перевіряється + фінал");
  const firstFinal = service.submissions.upserts[1];
  const secondFinal = service.submissions.upserts[3];
  assert.ok(firstFinal && secondFinal);
  assert.match(firstFinal.checksum, /^[0-9a-f]{64}$/);
  assert.notEqual(firstFinal.checksum, secondFinal.checksum);
  assert.equal(secondFinal.status, "accepted", "новий файл проходить assessment наново");
  assert.deepEqual(secondFinal.assessment, acceptedAssessment("1-2"), "старий assessment замінено новим");
});

// Контракт тикета 05 для SPA: стан і фідбек слотів за токеном, у порядку
// чекліста; невідомий токен — null (route віддає 404).

test("listByToken: невідомий токен — null", async () => {
  const service = makeService({
    applications: {
      async insert() {},
      async findByTokenHash() {
        return null;
      },
    },
  });
  assert.equal(await service.listByToken("unknown"), null);
});

test("listByToken: стан слотів у порядку чекліста; фідбек — лише для needs_reupload", async () => {
  const submissions = fakeSubmissionRepo();
  submissions.rows.push(
    // Поза порядком чекліста і для іншої заявки — має бути відфільтровано/впорядковано.
    { applicationId: APP_ID, slot: "15-16", status: "accepted", assessment: null },
    {
      applicationId: APP_ID,
      slot: "1-2",
      status: "needs_reupload",
      assessment: {
        accepted: false,
        reason: "Номер документа не впізнано",
        recognizedSlot: null,
        recognizedFields: {},
        confidence: 0.4,
      },
    },
    {
      applicationId: APP_ID,
      slot: "11-12",
      status: "accepted",
      assessment: {
        accepted: true,
        reason: "причина, яку не треба показувати",
        recognizedSlot: "11-12",
        recognizedFields: {},
        confidence: 0.9,
      },
    },
    { applicationId: "other-app", slot: "13-14", status: "accepted", assessment: null },
  );
  const service = makeService({ submissions });
  const views = await service.listByToken("raw-token");
  assert.deepEqual(views, [
    { slot: "1-2", status: "needs_reupload", feedback: "Номер документа не впізнано" },
    { slot: "11-12", status: "accepted", feedback: null },
    { slot: "15-16", status: "accepted", feedback: null },
  ]);
});

test("listByToken: без submissions — порожній список, не null", async () => {
  const service = makeService();
  assert.deepEqual(await service.listByToken("raw-token"), []);
});

// Policy-gate (тикет 07) на рівні сервісу: рішення приймає policy над
// нормалізованим результатом — не сам провайдер. Кожен reject — зі
// зрозумілою причиною (feedback); невпевнений результат не приймається
// (Architecture §6).

test("файл іншого слота: policy відхиляє з причиною про слот; assessment зберігається як є", async () => {
  const service = makeService({ assessment: fakeAssessment(acceptedAssessment("11-12")) });
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "needs_reupload");
  assert.match(result.feedback ?? "", /не відповідає слоту/);
  assert.match(result.feedback ?? "", /1-2/);
  const final = service.submissions.upserts[1];
  assert.ok(final);
  assert.equal(final.status, "needs_reupload");
  assert.deepEqual(final.assessment, acceptedAssessment("11-12"), "у БД — нормалізований результат, не рішення");
});

test("невпевнений результат: policy відхиляє (Architecture §6), причина про впевненість", async () => {
  const service = makeService({
    assessment: fakeAssessment({ ...acceptedAssessment("1-2"), confidence: 0.5 }),
  });
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "needs_reupload");
  assert.match(result.feedback ?? "", /впевнен/);
  const final = service.submissions.upserts[1];
  assert.ok(final);
  assert.equal(final.status, "needs_reupload");
  assert.deepEqual(final.assessment, { ...acceptedAssessment("1-2"), confidence: 0.5 });
});

test("критичне поле без достатнього confidence: policy відхиляє, причина називає поле", async () => {
  const service = makeService({
    assessment: fakeAssessment({
      ...acceptedAssessment("1-2"),
      recognizedFields: { ...ACCEPTED_FIELDS, documentNumber: { value: "AA000000", confidence: 0.4 } },
    }),
  });
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "needs_reupload");
  assert.match(result.feedback ?? "", /номер документа/);
});

test("listByToken: feedback для needs_reupload переобчислюється policy зі збереженого результату", async () => {
  const submissions = fakeSubmissionRepo();
  submissions.rows.push({
    applicationId: APP_ID,
    slot: "1-2",
    status: "needs_reupload",
    assessment: { ...acceptedAssessment("13-14"), reason: "причина провайдера, яку замінює policy" },
  });
  const service = makeService({ submissions });
  const views = await service.listByToken("raw-token");
  assert.deepEqual(views, [
    { slot: "1-2", status: "needs_reupload", feedback: "Файл не відповідає слоту «1-2» — перезавантажте документ для цього слота, будь ласка" },
  ]);
});

// FinalDestination (тикет 08) на рівні сервісу: прийнятий файл записується в
// папку заявки (ledger drive_file_id), відхилений — ніколи; збій запису —
// технічна помилка, не reject; повторний upload після збою ledger не
// створює дублікатів (ідемпотентність, Architecture §6).

test("прийнятий файл записується в папку заявки; id — у ledger submission", async () => {
  const service = makeService();
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "accepted");
  assert.deepEqual(service.finalDestination.writes, [
    { folderId: "folder-1", slot: "1-2", mimeType: "image/png", data: PNG_HELLO },
  ], "запис — у папку заявки (folder_id із БД), зі слотом і байтами файла");
  const final = service.submissions.upserts[1];
  assert.ok(final);
  assert.equal(final.driveFileId, "drive-file-1", "ledger записано в submission");
});

test("відхилений файл ніколи не записується в Drive", async () => {
  const service = makeService({ assessment: fakeAssessment(REJECTED_ASSESSMENT) });
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "needs_reupload");
  assert.equal(service.finalDestination.writes.length, 0, "writeFile не викликається для відхиленого файла");
  const final = service.submissions.upserts[1];
  assert.ok(final);
  assert.equal(final.driveFileId, null);
});

test("файл іншого слота (policy-reject): у Drive не записується", async () => {
  const service = makeService({ assessment: fakeAssessment(acceptedAssessment("11-12")) });
  await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(service.finalDestination.writes.length, 0);
});

test("збій запису в Drive: технічна помилка, файл лишається у стані «перевіряється»", async () => {
  const failingDestination: FakeFinalDestination = {
    writes: [],
    async writeFile() {
      throw new Error("Google Drive: запит POST не вдався (500)");
    },
  };
  const service = makeService({ finalDestination: failingDestination });
  await assert.rejects(
    service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO }),
    /не вдався/,
  );
  assert.equal(service.submissions.upserts.length, 1, "фінальний стан не записується");
  assert.equal(service.submissions.upserts[0]?.status, "checking", "збій Drive ≠ reject: стан чекає retry (Architecture §6)");
});

// In-memory Drive для тесту ідемпотентності: зберігає файли й рахує MD5
// вмісту (як справжній Drive) — retry після збою ledger проходить через
// реальний FinalDestination і не створює другого файла.
function fakeDriveInMemory(): DriveClient & { created: number } {
  const files: Array<{ id: string; name: string; parentId: string; md5Checksum: string | null }> = [];
  let nextId = 0;
  return {
    created: 0,
    async findFoldersByName() {
      return [];
    },
    async createFolder() {
      return "folder-1";
    },
    async deleteFolder() {},
    async listFilesInFolder(parentId) {
      return files
        .filter((file) => file.parentId === parentId)
        .map(({ id, name, md5Checksum }) => ({ id, name, md5Checksum }));
    },
    async createFile(input: CreateFileInput) {
      this.created++;
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
      const index = files.findIndex((file) => file.id === fileId);
      if (index >= 0) {
        files.splice(index, 1);
      }
    },
  };
}

test("retry після збою ledger: той самий файл, у Drive — один файл, ledger — той самий id", async () => {
  const submissions = fakeSubmissionRepo();
  const drive = fakeDriveInMemory();
  let upsertCount = 0;
  const ledgerWithFailure = {
    ...submissions,
    async upsert(row: NewSubmission) {
      upsertCount++;
      submissions.upserts.push(row);
      if (upsertCount === 2) {
        // Змодельований збій: файл уже записано в Drive, але ledger не зберігся.
        throw new Error("ledger недоступний");
      }
    },
  };
  const service = createSubmissionService({
    applications: {
      async insert() {},
      async findByTokenHash() {
        return makeAppRow();
      },
    },
    submissions: ledgerWithFailure,
    assessment: fakeAssessment(acceptedAssessment("1-2")),
    finalDestination: createDriveFinalDestination({ drive }),
  });
  await assert.rejects(
    service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO }),
    /ledger недоступний/,
  );
  assert.equal(drive.created, 1, "перший запис створив файл");
  // Retry того самого файла після збою.
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.equal(result.status, "accepted");
  assert.equal(drive.created, 1, "дублікат не створюється: файл пізнано за іменем і MD5");
  const final = submissions.upserts[3];
  assert.ok(final);
  assert.equal(final.driveFileId, "file-1", "ledger — id того самого файла");
  assert.equal(final.checksum, PNG_HELLO_SHA256);
});
