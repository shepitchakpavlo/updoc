import assert from "node:assert/strict";
import { test } from "node:test";
import type { Application, ApplicationRepo } from "../src/applications/repo.js";
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

// Seam: service + fake repos (тикет 04). Контракт:
// upload за токеном валідує слот, проганяє preflight, рахує sha256 і створює
// submission зі станом pending; повторне завантаження — заміна (upsert).

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

function makeService(overrides: {
  applications?: ApplicationRepo;
  submissions?: FakeSubmissionRepo;
} = {}): SubmissionService & { submissions: FakeSubmissionRepo } {
  const submissions = overrides.submissions ?? fakeSubmissionRepo();
  const applications: ApplicationRepo =
    overrides.applications ?? {
      async insert() {},
      async findByTokenHash() {
        return makeAppRow();
      },
    };
  const service = createSubmissionService({ applications, submissions });
  return Object.assign(service, { submissions });
}

test("upload створює submission: слот, checksum (sha256), стан pending", async () => {
  const service = makeService();
  const result = await service.uploadSlot({ token: "raw-token", slot: "1-2", file: PNG_HELLO });
  assert.deepEqual(result, {
    slot: "1-2",
    checksum: PNG_HELLO_SHA256,
    status: "pending",
    mimeType: "image/png",
    pageCount: null,
  });
  assert.equal(service.submissions.upserts.length, 1);
  const stored = service.submissions.upserts[0];
  assert.ok(stored);
  assert.deepEqual(
    { applicationId: stored.applicationId, slot: stored.slot, checksum: stored.checksum, status: stored.status },
    { applicationId: APP_ID, slot: "1-2", checksum: PNG_HELLO_SHA256, status: "pending" },
  );
  assert.equal(stored.assessment, null, "новий файл — без старого assessment");
  assert.equal(stored.driveFileId, null, "новий файл — без старого ledger");
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
  const service = makeService();
  const result = await service.uploadSlot({ token: "raw-token", slot: "11-12", file: await makePdf(3) });
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.pageCount, 3);
});

test("повторне завантаження на слот замінює попереднє (upsert)", async () => {
  const service = makeService();
  const first = Buffer.concat([PNG_SIG, Buffer.from("one")]);
  const second = Buffer.concat([PNG_SIG, Buffer.from("two")]);
  await service.uploadSlot({ token: "raw-token", slot: "1-2", file: first });
  await service.uploadSlot({ token: "raw-token", slot: "1-2", file: second });
  assert.equal(service.submissions.upserts.length, 2);
  const [storedFirst, storedSecond] = service.submissions.upserts;
  assert.ok(storedFirst && storedSecond);
  assert.match(storedFirst.checksum, /^[0-9a-f]{64}$/);
  assert.notEqual(storedFirst.checksum, storedSecond.checksum);
  assert.equal(storedSecond.status, "pending", "після заміни файл знову очікує assessment");
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
        recognizedFields: {},
        confidence: 0.4,
      },
    },
    {
      applicationId: APP_ID,
      slot: "11-12",
      status: "accepted",
      assessment: { accepted: true, reason: "причина, яку не треба показувати", recognizedFields: {}, confidence: 0.9 },
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
