import assert from "node:assert/strict";
import { test, after } from "node:test";
import { generateKeyPairSync, verify, type KeyPairKeyObjectResult } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDriveClient, type DriveClient, type FetchLike } from "../src/drive/client.js";

// Seam: drive client + fake fetch. Контракт тикета 03:
// сервісний акаунт (JWT → access token) працює з тестовою папкою Drive:
// пошук існуючої папки, створення папки, видалення; токен кешується.

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const CLIENT_EMAIL = "test@updoc.iam.gserviceaccount.com";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type FilesCall = { method: string; url: string; headers: Record<string, string>; body: unknown };

// Виклик media upload (тикет 08): тіло — сирі байти multipart, не JSON.
type UploadCall = { method: string; url: string; headers: Record<string, string>; body: Buffer };

function makeKeyPair(): KeyPairKeyObjectResult {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function makeCredentialsFile(keyPair: KeyPairKeyObjectResult): string {
  const dir = mkdtempSync(join(tmpdir(), "updoc-drive-test-"));
  const path = join(dir, "service-account.json");
  writeFileSync(
    path,
    JSON.stringify({
      type: "service_account",
      project_id: "updoc-test",
      private_key_id: "k1",
      private_key: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }),
      client_email: CLIENT_EMAIL,
      token_uri: TOKEN_URI,
    }),
  );
  after(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

// fetch-заглушка: token endpoint перевіряє JWT (структура + підпис ключем акаунта)
// і віддає access token; далі — Drive API.
function fakeFetch(
  keyPair: KeyPairKeyObjectResult,
  records: { tokenCalls: number; filesCalls: FilesCall[]; uploadCalls: UploadCall[] },
): FetchLike {
  return async (url, init) => {
    const urlStr = typeof url === "string" ? url : url.href;
    const method = init?.method ?? "GET";
    if (urlStr === TOKEN_URI) {
      records.tokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const jwt = body.get("assertion");
      assert.ok(jwt && jwt.split(".").length === 3, "assertion — валідний JWT із 3 частин");
      const [h, p, s] = jwt.split(".");
      assert.ok(h && p && s);
      const header = JSON.parse(Buffer.from(h, "base64url").toString());
      assert.equal(header.alg, "RS256");
      const payload = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(payload.iss, CLIENT_EMAIL);
      assert.equal(payload.aud, TOKEN_URI);
      assert.equal(payload.scope, DRIVE_SCOPE);
      assert.equal(payload.iat, 1000);
      assert.equal(payload.exp, 4600);
      const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), keyPair.publicKey, Buffer.from(s, "base64url"));
      assert.ok(ok, "JWT підписано ключем сервісного акаунта (RS256)");
      return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.startsWith(DRIVE_UPLOAD_URL)) {
      records.uploadCalls.push({
        method,
        url: urlStr,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: Buffer.from(init?.body as ArrayBuffer),
      });
      return new Response(JSON.stringify({ id: "file-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.startsWith(DRIVE_FILES_URL)) {
      records.filesCalls.push({
        method,
        url: urlStr,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const status = method === "DELETE" ? 204 : 200;
      const payload = method === "POST" ? { id: "folder-1" } : { files: [] };
      return new Response(method === "DELETE" ? null : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected url: ${urlStr}`);
  };
}

function makeClient(): { client: DriveClient; records: { tokenCalls: number; filesCalls: FilesCall[]; uploadCalls: UploadCall[] } } {
  const keyPair = makeKeyPair();
  const records = { tokenCalls: 0, filesCalls: [] as FilesCall[], uploadCalls: [] as UploadCall[] };
  const client = createDriveClient({
    credentialsFile: makeCredentialsFile(keyPair),
    fetchImpl: fakeFetch(keyPair, records),
    now: () => 1_000_000,
  });
  return { client, records };
}

test("createFolder створює папку у вказаному батьківському каталозі", async () => {
  const { client, records } = makeClient();
  const id = await client.createFolder("Іваненко Іван Іванович — ТОВ Приклад", "test-folder-1");
  assert.equal(id, "folder-1");
  assert.equal(records.filesCalls.length, 1);
  const call = records.filesCalls[0];
  assert.ok(call);
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${DRIVE_FILES_URL}?fields=id`);
  assert.equal(call.headers.authorization, "Bearer access-1");
  assert.deepEqual(call.body, {
    name: "Іваненко Іван Іванович — ТОВ Приклад",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["test-folder-1"],
  });
});

test("findFoldersByName повертає id існуючих папок або порожній список", async () => {
  const { client, records } = makeClient();
  assert.deepEqual(await client.findFoldersByName("О", "test-folder-1"), []);
  const call = records.filesCalls[0];
  assert.ok(call);
  const q = new URL(call.url).searchParams.get("q");
  assert.equal(q, "name='О' and 'test-folder-1' in parents and trashed=false");
  assert.match(call.url, /fields=files\(id\)/);

  const keyPair = makeKeyPair();
  const records2 = { tokenCalls: 0, filesCalls: [] as FilesCall[] };
  const fetchImpl2: FetchLike = async (url, init) => {
    const urlStr = typeof url === "string" ? url : url.href;
    if (urlStr === TOKEN_URI) {
      return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3600 }), { status: 200 });
    }
    records2.filesCalls.push({ method: init?.method ?? "GET", url: urlStr, headers: {}, body: null });
    return new Response(JSON.stringify({ files: [{ id: "folder-x" }, { id: "folder-y" }] }), { status: 200 });
  };
  const client2 = createDriveClient({
    credentialsFile: makeCredentialsFile(keyPair),
    fetchImpl: fetchImpl2,
    now: () => 1_000_000,
  });
  assert.deepEqual(await client2.findFoldersByName("X", "p"), ["folder-x", "folder-y"]);
});

test("findFoldersByName екранує апострофи й слеші в імені папки", async () => {
  const { client, records } = makeClient();
  await client.findFoldersByName("O'Neil \\ Test", "p");
  const call = records.filesCalls[0];
  assert.ok(call);
  const q = new URL(call.url).searchParams.get("q");
  assert.equal(q, "name='O\\'Neil \\\\ Test' and 'p' in parents and trashed=false");
});

test("deleteFolder видаляє папку за id", async () => {
  const { client, records } = makeClient();
  await client.deleteFolder("folder-1");
  assert.equal(records.filesCalls.length, 1);
  const call = records.filesCalls[0];
  assert.ok(call);
  assert.equal(call.method, "DELETE");
  assert.equal(call.url, `${DRIVE_FILES_URL}/folder-1`);
});

test("access token кешується: три операції — один обмін токена", async () => {
  const { client, records } = makeClient();
  await client.createFolder("A", "p");
  await client.findFoldersByName("B", "p");
  await client.deleteFolder("c");
  assert.equal(records.tokenCalls, 1);
  assert.equal(records.filesCalls.length, 3);
});

test("без файлу ключів клієнт дає зрозумілу помилку", async () => {
  const client = createDriveClient({
    credentialsFile: "/nonexistent/service-account.json",
    fetchImpl: async () => {
      throw new Error("не мало викликатись");
    },
    now: () => 1_000_000,
  });
  await assert.rejects(client.createFolder("X", "p"), /GOOGLE_APPLICATION_CREDENTIALS/);
});

// Файлові операції (тикет 08): createFile (media upload), listFilesInFolder
// (з MD5 для ідемпотентного запису), deleteFile.

// Розбір multipart-тіла media upload: перша частина — JSON-метадані,
// друга — сирі байти файла.
function parseMultipart(body: Buffer, boundary: string): { metadata: string; data: Buffer } {
  const text = body.toString("latin1");
  const first = text.indexOf(`--${boundary}\r\n`);
  const second = text.indexOf(`--${boundary}\r\n`, first + 1);
  assert.ok(first >= 0 && second > first, "multipart містить дві частини");
  const metaStart = text.indexOf("\r\n\r\n", first) + 4;
  const metaEnd = text.indexOf(`\r\n--${boundary}\r\n`, metaStart);
  const mediaStart = text.indexOf("\r\n\r\n", second) + 4;
  const mediaEnd = text.indexOf(`\r\n--${boundary}--`, mediaStart);
  assert.ok(metaStart > 0 && metaEnd > metaStart && mediaStart > 0 && mediaEnd > mediaStart, "межі частин знайдено");
  return { metadata: text.slice(metaStart, metaEnd), data: body.subarray(mediaStart, mediaEnd) };
}

test("createFile завантажує файл у папку media upload-ом (multipart)", async () => {
  const { client, records } = makeClient();
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
  const id = await client.createFile({ name: "1-2.png", parentId: "folder-1", mimeType: "image/png", data });
  assert.equal(id, "file-1");
  assert.equal(records.uploadCalls.length, 1);
  const call = records.uploadCalls[0];
  assert.ok(call);
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`);
  assert.equal(call.headers.authorization, "Bearer access-1");
  const ct = call.headers["content-type"] ?? "";
  assert.match(ct, /^multipart\/related; boundary=updoc-[0-9a-f]{32}$/);
  const boundary = ct.split("boundary=")[1];
  assert.ok(boundary);
  const { metadata, data: media } = parseMultipart(call.body, boundary);
  assert.deepEqual(JSON.parse(metadata), {
    name: "1-2.png",
    mimeType: "image/png",
    parents: ["folder-1"],
  });
  assert.ok(media.equals(data), "байти файла передаються без змін");
});

test("listFilesInFolder повертає id, ім'я і MD5 файлів папки", async () => {
  const keyPair = makeKeyPair();
  const records = { tokenCalls: 0, filesCalls: [] as FilesCall[], uploadCalls: [] as UploadCall[] };
  const fetchImpl: FetchLike = async (url, init) => {
    const urlStr = typeof url === "string" ? url : url.href;
    if (urlStr === TOKEN_URI) {
      return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3600 }), { status: 200 });
    }
    records.filesCalls.push({
      method: init?.method ?? "GET",
      url: urlStr,
      headers: {},
      body: null,
    });
    return new Response(
      JSON.stringify({
        files: [
          { id: "file-a", name: "1-2.png", md5Checksum: "abc123" },
          { id: "file-b", name: "1-2.pdf", md5Checksum: null },
        ],
      }),
      { status: 200 },
    );
  };
  const client = createDriveClient({
    credentialsFile: makeCredentialsFile(keyPair),
    fetchImpl,
    now: () => 1_000_000,
  });
  assert.deepEqual(await client.listFilesInFolder("folder-1"), [
    { id: "file-a", name: "1-2.png", md5Checksum: "abc123" },
    { id: "file-b", name: "1-2.pdf", md5Checksum: null },
  ]);
  const call = records.filesCalls[0];
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.pathname, "/drive/v3/files");
  assert.equal(url.searchParams.get("q"), "'folder-1' in parents and trashed=false");
  assert.equal(url.searchParams.get("fields"), "files(id,name,md5Checksum)");
});

test("deleteFile видаляє файл за id", async () => {
  const { client, records } = makeClient();
  await client.deleteFile("file-1");
  assert.equal(records.filesCalls.length, 1);
  const call = records.filesCalls[0];
  assert.ok(call);
  assert.equal(call.method, "DELETE");
  assert.equal(call.url, `${DRIVE_FILES_URL}/file-1`);
});
