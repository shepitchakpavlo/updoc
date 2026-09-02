import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createMockAssessmentProvider } from "../src/assessment/mock.js";
import type { Application, ApplicationRepo } from "../src/applications/repo.js";
import { createApplicationService } from "../src/applications/service.js";
import { buildApp } from "../src/app.js";
import type { CreateFileInput, DriveClient, DriveFileInfo } from "../src/drive/client.js";
import { createDriveFinalDestination } from "../src/drive/final-destination.js";
import type { Submission } from "../src/submissions/repo.js";
import type { SubmissionRepo } from "../src/submissions/repo.js";
import { createSubmissionService } from "../src/submissions/service.js";
import { defaultSamplesDir } from "../scripts/e2e/samples.js";
import { runSlice, tokenFromLink, prepareSpa, type SliceEnv } from "../scripts/e2e/slice.js";

// Seam: наскрізний прогін тикета 09 — справжні сервіси (preflight, мок-assessment,
// policy, FinalDestination) + фейк-репозиторії і фейк-Drive; HTTP-шар сценарію
// ганяється через in-process Fastify (fetch-адаптер над app.inject). Той самий
// фейк-Drive слугує і «справжнім Drive» для сервісів, і ціллю перевірок
// сценарію — як у живому прогоні (той самий сервісний акаунт).
// Контракт DoD: прийнятий файл з'являється в папці заявки, відхилений — ніколи
// (з поясненням), повторний запис не створює дублікатів (ledger).

const FULL_NAME = "Працівник E2E";
const COMPANY = "ТОВ E2E";
const FOLDER_NAME = `${FULL_NAME} — ${COMPANY}`;
const TEST_FOLDER_ID = "test-folder";

interface MemoryDrive extends DriveClient {
  files: Array<{ id: string; name: string; parentId: string; md5Checksum: string | null }>;
  folders: Array<{ id: string; name: string; parentId: string }>;
  created: number;
  deletedFolders: string[];
}

function memoryDrive(): MemoryDrive {
  const files: MemoryDrive["files"] = [];
  const folders: MemoryDrive["folders"] = [];
  let nextId = 0;
  const drive: MemoryDrive = {
    files,
    folders,
    created: 0,
    deletedFolders: [],
    async findFoldersByName(name, parentId) {
      return folders.filter((f) => f.parentId === parentId && f.name === name).map((f) => f.id);
    },
    async createFolder(name, parentId) {
      const id = `folder-${++nextId}`;
      folders.push({ id, name, parentId });
      return id;
    },
    async deleteFolder(id) {
      drive.deletedFolders.push(id);
      const index = folders.findIndex((f) => f.id === id);
      if (index >= 0) {
        folders.splice(index, 1);
      }
    },
    async listFilesInFolder(parentId) {
      return files
        .filter((f) => f.parentId === parentId)
        .map(({ id, name, md5Checksum }) => ({ id, name, md5Checksum } satisfies DriveFileInfo));
    },
    async createFile(input: CreateFileInput) {
      drive.created++;
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
      const index = files.findIndex((f) => f.id === fileId);
      if (index >= 0) {
        files.splice(index, 1);
      }
    },
  };
  return drive;
}

interface StoredSubmission extends Submission {
  applicationId: string;
}

function memorySubmissionRepo(): SubmissionRepo & { rows: StoredSubmission[] } {
  const rows: StoredSubmission[] = [];
  return {
    rows,
    async upsert(row) {
      const index = rows.findIndex((r) => r.applicationId === row.applicationId && r.slot === row.slot);
      const stored: StoredSubmission = {
        id: row.id ?? `submission-${rows.length + 1}`,
        applicationId: row.applicationId,
        slot: row.slot,
        checksum: row.checksum,
        status: row.status ?? "pending",
        assessment: row.assessment ?? null,
        driveFileId: row.driveFileId ?? null,
        createdAt: row.createdAt ?? new Date(),
      };
      if (index >= 0) {
        rows[index] = stored;
      } else {
        rows.push(stored);
      }
    },
    async listByApplicationId(applicationId) {
      return rows
        .filter((r) => r.applicationId === applicationId)
        .map(({ slot, status, assessment }) => ({ slot, status, assessment }));
    },
  };
}

function memoryApplicationRepo(): ApplicationRepo & { rows: Application[] } {
  const rows: Application[] = [];
  return {
    rows,
    async insert(row) {
      rows.push({
        id: row.id ?? `application-${rows.length + 1}`,
        company: row.company,
        fullName: row.fullName,
        tokenHash: row.tokenHash,
        folderId: row.folderId,
        createdAt: row.createdAt ?? new Date(),
      });
    },
    async findByTokenHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash) ?? null;
    },
  };
}

// fetch-адаптер над in-process Fastify: сценарій бачить звичайний HTTP,
// маршрути — звичайні запити (той самий multipart-розбір, що в прогоні).
function fetchFromApp(app: FastifyInstance): typeof fetch {
  return async (url, init) => {
    const target = new URL(String(url));
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: `${target.pathname}${target.search}`,
      headers: init?.headers as Record<string, string> | undefined,
      payload: init?.body as Buffer | string | undefined,
    });
    return new Response(res.rawPayload, { status: res.statusCode });
  };
}

interface TestRig {
  app: FastifyInstance;
  drive: MemoryDrive;
  appRepo: ApplicationRepo & { rows: Application[] };
  subRepo: SubmissionRepo & { rows: StoredSubmission[] };
  samplesDir: string;
}

function makeRig(seedStaleFolder: boolean): TestRig {
  const drive = memoryDrive();
  if (seedStaleFolder) {
    drive.folders.push({ id: "folder-0", name: FOLDER_NAME, parentId: TEST_FOLDER_ID });
  }
  const appRepo = memoryApplicationRepo();
  const subRepo = memorySubmissionRepo();
  const app = buildApp(
    {},
    {
      applications: createApplicationService({
        repo: appRepo,
        drive,
        testFolderId: TEST_FOLDER_ID,
        appBaseUrl: "http://localhost:5173",
      }),
      submissions: createSubmissionService({
        applications: appRepo,
        submissions: subRepo,
        assessment: createMockAssessmentProvider(),
        finalDestination: createDriveFinalDestination({ drive }),
      }),
    },
  );
  const samplesDir = mkdtempSync(join(tmpdir(), "updoc-e2e-slice-test-"));
  after(() => rmSync(samplesDir, { recursive: true, force: true }));
  after(() => app.close());
  return { app, drive, appRepo, subRepo, samplesDir };
}

function makeEnv(rig: TestRig, overrides: Partial<SliceEnv> = {}): SliceEnv {
  return {
    apiBaseUrl: "http://api.test",
    fetchImpl: fetchFromApp(rig.app),
    drive: rig.drive,
    testFolderId: TEST_FOLDER_ID,
    samplesDir: rig.samplesDir,
    fullName: FULL_NAME,
    company: COMPANY,
    ...overrides,
  };
}

test("tokenFromLink: витягує токен із лінка /a/{token}; сміття — null", () => {
  assert.equal(tokenFromLink("http://localhost:5173/a/abc_123-xyz"), "abc_123-xyz");
  assert.equal(tokenFromLink("http://localhost:5173/a/"), null);
  assert.equal(tokenFromLink("http://localhost:5173"), null);
});

test("runSlice: весь ланцюжок проходить; прийняті — у Drive, відхилені — ніколи; retry без дублікатів", async () => {
  const rig = makeRig(true);
  const result = await runSlice(makeEnv(rig));
  assert.equal(result.ok, true, JSON.stringify(result.steps));
  assert.ok(result.steps.length >= 8, "ланцюжок складається з кроків");
  for (const step of result.steps) {
    assert.equal(step.ok, true, step.name);
  }

  // Лише два прийняті файли створені в Drive: повторний upload (retry після
  // технічного збою з погляду клієнта) перевикористав той самий файл.
  assert.equal(rig.drive.created, 2, "дублікатів немає: 3 upload-и, 2 файли");
  // Стара папка попереднього прогону прибрана, папка цього прогону — теж.
  assert.deepEqual(rig.drive.deletedFolders, ["folder-0", "folder-1"]);

  // Ledger: прийняті слоти — з drive_file_id реальних файлів у Drive (по одному
  // на слот); відхилений — без жодного запису.
  const bySlot = Object.fromEntries(rig.subRepo.rows.map((r) => [r.slot, r]));
  const driveFileIds = new Set(rig.drive.files.map((f) => f.id));
  const acceptedPngId = bySlot["1-2"]?.driveFileId;
  const acceptedPdfId = bySlot["11-12"]?.driveFileId;
  assert.equal(bySlot["1-2"]?.status, "accepted");
  assert.ok(typeof acceptedPngId === "string" && driveFileIds.has(acceptedPngId), "ledger 1-2 — id файла в Drive");
  assert.equal(bySlot["11-12"]?.status, "accepted");
  assert.ok(typeof acceptedPdfId === "string" && driveFileIds.has(acceptedPdfId), "ledger 11-12 — id файла в Drive");
  assert.notEqual(acceptedPngId, acceptedPdfId, "кожен слот — свій файл");
  assert.equal(bySlot["13-14"]?.status, "needs_reupload");
  assert.equal(bySlot["13-14"]?.driveFileId, null);
  assert.match(bySlot["13-14"]?.assessment?.reason ?? "", /замалий/);
});

test("runSlice: API недоступний — результат з помилкою, без падіння процесу", async () => {
  const rig = makeRig(false);
  const result = await runSlice(
    makeEnv(rig, {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => !s.ok), "крок із недоступним API позначений невдалим");
});

test("prepareSpa: заявка створена, папка лишається для ручного проходу, зразки готові", async () => {
  const rig = makeRig(false);
  const prep = await prepareSpa(makeEnv(rig));
  assert.equal(prep.token, tokenFromLink(prep.link));
  assert.match(prep.link, /^http:\/\/localhost:5173\/a\/[^/]+$/);
  assert.equal(rig.drive.folders.length, 1, "папка заявки створена і не прибирається");
  assert.deepEqual(rig.drive.deletedFolders, []);
  assert.equal(rig.drive.files.length, 0, "ручний прохід починає з порожньої папки");
  assert.equal(rig.appRepo.rows.length, 1);
  assert.deepEqual(
    readdirSync(rig.samplesDir).sort(),
    ["accepted-1-2.png", "accepted-11-12.pdf", "rejected-wrong-slot.png"],
  );
});

test("defaultSamplesDir — каталог у тимчасовій директорії (поза репо)", () => {
  assert.equal(defaultSamplesDir(), join(tmpdir(), "updoc-e2e-samples"));
});
