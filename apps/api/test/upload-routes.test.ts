import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKLET_SLOTS, type BookletSlot } from "../src/checklist.js";
import { buildApp } from "../src/app.js";
import type { ApplicationService } from "../src/applications/service.js";
import {
  FileTooLargeError,
  UnsupportedFormatError,
} from "../src/preflight/index.js";
import {
  InvalidSlotError,
  UnknownTokenError,
  type SubmissionService,
  type UploadSlotInput,
} from "../src/submissions/service.js";

// Публічний контракт тикета 04 на рівні HTTP (seam: routes + fake service):
// POST /applications/upload — multipart (слот + файл) за токеном у заголовку
// x-access-token; MIME визначається за байтами, ім'я файла і заявлений
// content-type до сервісу не доходять; помилки — коди із загальним тілом.

const TOKEN = "abc123";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const TEXT = Buffer.from("просто текст, не зображення");

const BOUNDARY = "----updoc-test-boundary";

interface MultipartInput {
  slot?: string;
  files?: Array<{ name: string; contentType: string; data: Buffer }>;
}

function multipart({ slot, files = [] }: MultipartInput): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  if (slot !== undefined) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="slot"\r\n\r\n${slot}\r\n`));
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

type FakeSubmissions = SubmissionService & { calls: UploadSlotInput[] };

function fakeSubmissions(): FakeSubmissions {
  const calls: UploadSlotInput[] = [];
  return {
    calls,
    async uploadSlot(input) {
      calls.push(input);
      if (input.token !== TOKEN) {
        throw new UnknownTokenError();
      }
      if (!(BOOKLET_SLOTS as readonly string[]).includes(input.slot)) {
        throw new InvalidSlotError();
      }
      return {
        slot: input.slot as BookletSlot,
        checksum: "0".repeat(64),
        status: "pending",
        mimeType: "image/png",
        pageCount: null,
        feedback: null,
      };
    },
    async listByToken() {
      return null;
    },
  };
}

function throwingSubmissions(error: Error): SubmissionService {
  return {
    async uploadSlot() {
      throw error;
    },
    async listByToken() {
      return null;
    },
  };
}

function fakeApplications(): ApplicationService {
  return {
    async createApplication() {
      return { link: "http://localhost:5173/a/abc123" };
    },
    async getApplicationByToken() {
      return null;
    },
  };
}

function build(service: SubmissionService) {
  return buildApp({}, { applications: fakeApplications(), submissions: service });
}

test("POST /applications/upload створює submission (201): слот, checksum, стан, preflight-дані", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({ slot: "1-2", files: [{ name: "scan.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), {
    slot: "1-2",
    checksum: "0".repeat(64),
    status: "pending",
    mimeType: "image/png",
    pageCount: null,
    feedback: null,
  });
  assert.deepEqual(service.calls, [{ token: TOKEN, slot: "1-2", file: PNG }]);
  await app.close();
});

test("MIME визначається за magic bytes: ім'я .txt і octet-stream не заважають", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({
    slot: "11-12",
    files: [{ name: "photo.txt", contentType: "application/octet-stream", data: JPEG }],
  });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 201);
  // До сервісу доходять лише токен, слот і байти — жодного імені чи content-type.
  assert.deepEqual(service.calls, [{ token: TOKEN, slot: "11-12", file: JPEG }]);
  await app.close();
});

test("невідомий токен — 404 not_found", async () => {
  const app = build(fakeSubmissions());
  const body = multipart({ slot: "1-2", files: [{ name: "scan.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": "unknown", ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "not_found");
  await app.close();
});

test("відсутній токен — 404, сервіс не викликається", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({ slot: "1-2", files: [{ name: "scan.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: body.headers,
    payload: body.payload,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(service.calls.length, 0);
  await app.close();
});

test("слот поза чеклістом — 400 invalid_slot", async () => {
  const app = build(throwingSubmissions(new InvalidSlotError()));
  const body = multipart({ slot: "3", files: [{ name: "scan.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_slot");
  await app.close();
});

test("непідтримуваний формат — 400 unsupported_format", async () => {
  const app = build(throwingSubmissions(new UnsupportedFormatError()));
  const body = multipart({ slot: "1-2", files: [{ name: "scan.png", contentType: "image/png", data: TEXT }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "unsupported_format");
  await app.close();
});

test("файл понад 20MB — 413 file_too_large", async () => {
  const app = build(throwingSubmissions(new FileTooLargeError()));
  const body = multipart({ slot: "1-2", files: [{ name: "big.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().error, "file_too_large");
  await app.close();
});

test("без файла — 400 invalid_upload, сервіс не викликається", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({ slot: "1-2" });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_upload");
  assert.equal(service.calls.length, 0);
  await app.close();
});

test("без слота — 400 invalid_slot, сервіс не викликається", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({ files: [{ name: "scan.png", contentType: "image/png", data: PNG }] });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_slot");
  assert.equal(service.calls.length, 0);
  await app.close();
});

test("два файли — 400 invalid_upload, сервіс не викликається", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const body = multipart({
    slot: "1-2",
    files: [
      { name: "a.png", contentType: "image/png", data: PNG },
      { name: "b.png", contentType: "image/png", data: JPEG },
    ],
  });
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, ...body.headers },
    payload: body.payload,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_upload");
  assert.equal(service.calls.length, 0);
  await app.close();
});

test("не multipart-тіло — 415, сервіс не викликається", async () => {
  const service = fakeSubmissions();
  const app = build(service);
  const res = await app.inject({
    method: "POST",
    url: "/applications/upload",
    headers: { "x-access-token": TOKEN, "content-type": "application/json" },
    payload: { slot: "1-2" },
  });
  assert.equal(res.statusCode, 415);
  assert.equal(res.json().error, "invalid_upload");
  assert.equal(service.calls.length, 0);
  await app.close();
});
