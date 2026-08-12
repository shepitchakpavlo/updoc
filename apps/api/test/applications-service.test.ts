import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKLET_SLOTS } from "../src/checklist.js";
import { hashToken } from "../src/tokens.js";
import {
  FolderExistsError,
  createApplicationService,
  type ApplicationService,
} from "../src/applications/service.js";
import type { DriveClient } from "../src/drive/client.js";
import type { ApplicationRepo, NewApplication } from "../src/applications/repo.js";

// Seam: service + fake repo / fake drive. Контракт тикета 03:
// у БД — лише hash токена, папка «ПІБ — Компанія» у тестовій папці Drive,
// існуюча папка — hard error без суфіксів, GET віддає компанію/ПІБ/чекліст.

const TEST_FOLDER_ID = "test-folder-1";
const APP_BASE_URL = "http://localhost:5173";

interface FakeRepo extends ApplicationRepo {
  rows: NewApplication[];
}

interface FakeDrive extends DriveClient {
  created: Array<{ name: string; parentId: string }>;
}

function makeService(overrides: {
  repo?: ApplicationRepo;
  drive?: DriveClient;
} = {}): ApplicationService & { repo: FakeRepo; drive: FakeDrive } {
  const repo = (overrides.repo ?? fakeRepo()) as FakeRepo;
  const drive = (overrides.drive ?? fakeDrive()) as FakeDrive;
  return Object.assign(
    createApplicationService({ repo, drive, testFolderId: TEST_FOLDER_ID, appBaseUrl: APP_BASE_URL }),
    { repo, drive },
  );
}

function fakeRepo(): FakeRepo {
  const rows: NewApplication[] = [];
  return {
    rows,
    async insert(row) {
      rows.push(row);
    },
    async findByTokenHash(tokenHash) {
      const row = rows.find((r) => r.tokenHash === tokenHash);
      return row ? { id: "app-1", createdAt: new Date(), ...row } : null;
    },
  };
}

function fakeDrive(): FakeDrive {
  const created: Array<{ name: string; parentId: string }> = [];
  return {
    created,
    async findFoldersByName() {
      return [];
    },
    async createFolder(name, parentId) {
      created.push({ name, parentId });
      return "folder-1";
    },
    async deleteFolder() {},
  };
}

test("створення заявки зберігає в БД лише hash токена, а не сирий токен", async () => {
  const service = makeService();
  const { link } = await service.createApplication({ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" });
  const rawToken = link.split("/a/")[1];
  assert.ok(rawToken, "лінк має містити токен після /a/");
  assert.equal(service.repo.rows.length, 1);
  const stored = service.repo.rows[0];
  assert.ok(stored);
  assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(stored.tokenHash, hashToken(rawToken));
  assert.notEqual(stored.tokenHash, rawToken);
});

test("повернутий лінк містить той самий токен, hash якого збережено", async () => {
  const service = makeService();
  const { link } = await service.createApplication({
    company: "ТОВ Приклад",
    fullName: "Іваненко Іван Іванович",
  });
  const rawToken = link.split("/a/")[1];
  assert.ok(rawToken, "лінк має містити токен після /a/");
  const stored = service.repo.rows[0];
  assert.ok(stored);
  assert.equal(stored.tokenHash, hashToken(rawToken));
});

test("папка «ПІБ — Компанія» створюється у тестовій папці Drive", async () => {
  const service = makeService();
  await service.createApplication({ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" });
  assert.deepEqual(service.drive.created, [
    { name: "Іваненко Іван Іванович — ТОВ Приклад", parentId: TEST_FOLDER_ID },
  ]);
});

test("існуюча папка для іншої заявки — hard error, папка не створюється і не уточнюється", async () => {
  const drive: DriveClient = {
    async findFoldersByName() {
      return ["existing-folder"];
    },
    async createFolder() {
      throw new Error("createFolder не мав викликатись");
    },
    async deleteFolder() {},
  };
  const service = makeService({ drive });
  await assert.rejects(
    service.createApplication({ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" }),
    FolderExistsError,
  );
});

test("конкурентна заявка з тією самою папкою — hard error, щойно створена папка видаляється", async () => {
  let findCalls = 0;
  const drive: DriveClient = {
    async findFoldersByName() {
      findCalls++;
      // Перший виклик — до створення: папки немає; повторний — конкурент уже створив свою.
      return findCalls === 1 ? [] : ["folder-1", "folder-2"];
    },
    async createFolder() {
      return "folder-1";
    },
    async deleteFolder() {},
  };
  let deleted: string | null = null;
  const trackingDrive: DriveClient = {
    ...drive,
    async deleteFolder(folderId) {
      deleted = folderId;
    },
  };
  const repo: ApplicationRepo = {
    async insert() {
      throw new Error("insert не мав викликатись");
    },
    async findByTokenHash() {
      return null;
    },
  };
  const service = makeService({ repo, drive: trackingDrive });
  await assert.rejects(
    service.createApplication({ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" }),
    FolderExistsError,
  );
  assert.equal(deleted, "folder-1");
});

test("збій запису в БД видаляє щойно створену папку (бест-еффорт)", async () => {
  let deleted: string | null = null;
  const drive: DriveClient = {
    async findFoldersByName() {
      return [];
    },
    async createFolder() {
      return "folder-1";
    },
    async deleteFolder(folderId) {
      deleted = folderId;
    },
  };
  const repo: ApplicationRepo = {
    async insert() {
      throw new Error("db down");
    },
    async findByTokenHash() {
      return null;
    },
  };
  const service = makeService({ repo, drive });
  await assert.rejects(
    service.createApplication({ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" }),
    /db down/,
  );
  assert.equal(deleted, "folder-1");
});

test("GET за токеном шукає за hash і віддає компанію, ПІБ і чекліст", async () => {
  const service = makeService();
  await service.repo.insert({
    company: "ТОВ Приклад",
    fullName: "Іваненко Іван Іванович",
    tokenHash: hashToken("raw-token"),
    folderId: "folder-1",
  });
  const view = await service.getApplicationByToken("raw-token");
  assert.deepEqual(view, {
    company: "ТОВ Приклад",
    fullName: "Іваненко Іван Іванович",
    checklist: [...BOOKLET_SLOTS],
  });
});

test("невідомий токен — null (route віддає 404)", async () => {
  const service = makeService();
  assert.equal(await service.getApplicationByToken("unknown"), null);
});
