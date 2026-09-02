import { createSign, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// Google Drive через сервісний акаунт (тикет 03): JWT (RS256) → access token →
// REST Drive API v3. Ключ акаунта — JSON поза репо (GOOGLE_APPLICATION_CREDENTIALS).
// Мінімальний scope drive.file: лише файли/папки, створені або відкриті додатком.

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Файл у Drive з іменем і MD5 вмісту (для ідемпотентного запису, тикет 08). */
export interface DriveFileInfo {
  id: string;
  name: string;
  /** hex MD5 вмісту (рахують самі сервери Drive); null — для Google-документів, тут не бувають */
  md5Checksum: string | null;
}

export interface CreateFileInput {
  name: string;
  parentId: string;
  mimeType: string;
  data: Buffer;
}

export interface DriveClient {
  /** id усіх невидалених папок з таким ім'ям у батьківському каталозі */
  findFoldersByName(name: string, parentId: string): Promise<string[]>;
  createFolder(name: string, parentId: string): Promise<string>;
  deleteFolder(folderId: string): Promise<void>;
  /** усі невидалені файли папки (id, ім'я, MD5 вмісту) */
  listFilesInFolder(parentId: string): Promise<DriveFileInfo[]>;
  /** створює файл із вмістом у папці (media upload) */
  createFile(input: CreateFileInput): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
}

export interface DriveClientOptions {
  /** шлях до JSON-ключа сервісного акаунта (поза репо) */
  credentialsFile: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
// Media upload — окремий host Google Drive API (тикет 08).
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_S = 3600;
const TOKEN_LEEWAY_MS = 60_000;

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

function makeJwt(key: ServiceAccountKey, tokenUri: string, iat: number): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iss: key.client_email,
        scope: DRIVE_SCOPE,
        aud: tokenUri,
        iat,
        exp: iat + TOKEN_LIFETIME_S,
      }),
    ),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = base64url(signer.sign(key.private_key));
  return `${header}.${payload}.${signature}`;
}

// Екранування значення в q-параметрі Drive API (лапки і слеші).
function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function createDriveClient(opts: DriveClientOptions): DriveClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let accessToken: string | null = null;
  let tokenExpiresAt = 0;

  function loadKey(): ServiceAccountKey {
    let raw: string;
    try {
      raw = readFileSync(opts.credentialsFile, "utf8");
    } catch {
      throw new Error(
        `Google Drive: не вдалося прочитати ${opts.credentialsFile}; задайте GOOGLE_APPLICATION_CREDENTIALS`,
      );
    }
    let key: ServiceAccountKey;
    try {
      key = JSON.parse(raw) as ServiceAccountKey;
    } catch {
      throw new Error("Google Drive: файл ключів не є валідним JSON");
    }
    if (!key.client_email || !key.private_key) {
      throw new Error("Google Drive: у файлі ключів бракує client_email або private_key");
    }
    return key;
  }

  async function getAccessToken(): Promise<string> {
    if (accessToken !== null && now() < tokenExpiresAt) {
      return accessToken;
    }
    const key = loadKey();
    const tokenUri = key.token_uri ?? DEFAULT_TOKEN_URI;
    const jwt = makeJwt(key, tokenUri, Math.floor(now() / 1000));
    const res = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google Drive: обмін токена не вдався (${res.status})`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error("Google Drive: відповідь обміну токена без access_token");
    }
    accessToken = data.access_token;
    tokenExpiresAt = now() + (data.expires_in ?? TOKEN_LIFETIME_S) * 1000 - TOKEN_LEEWAY_MS;
    return accessToken;
  }

  async function driveFetch(
    method: string,
    path: string,
    body?: unknown,
    media?: { base: string; contentType: string; body: Buffer },
  ): Promise<Response> {
    const token = await getAccessToken();
    const res = await fetchImpl(`${media?.base ?? DRIVE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined || media !== undefined
          ? { "content-type": media?.contentType ?? "application/json" }
          : {}),
      },
      body: media !== undefined ? media.body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Повідомлення без тіла відповіді й без шляху запиту (у q може бути ім'я папки =
    // ПІБ — Компанія): у логах не має бути PII (Architecture §5).
    if (!res.ok) {
      throw new Error(`Google Drive: запит ${method} не вдався (${res.status})`);
    }
    return res;
  }

  return {
    async findFoldersByName(name, parentId) {
      const q = `name='${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed=false`;
      const res = await driveFetch("GET", `/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=10`);
      const data = (await res.json()) as { files?: Array<{ id: string }> };
      return data.files?.map((file) => file.id) ?? [];
    },
    async createFolder(name, parentId) {
      const res = await driveFetch("POST", "/files?fields=id", {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      });
      const data = (await res.json()) as { id?: string };
      if (!data.id) {
        throw new Error("Google Drive: створення папки не повернуло id");
      }
      return data.id;
    },
    async deleteFolder(folderId) {
      await driveFetch("DELETE", `/files/${folderId}`);
    },
    async listFilesInFolder(parentId) {
      const q = `'${escapeQuery(parentId)}' in parents and trashed=false`;
      const res = await driveFetch(
        "GET",
        `/files?q=${encodeURIComponent(q)}&fields=files(id,name,md5Checksum)&pageSize=100`,
      );
      const data = (await res.json()) as {
        files?: Array<{ id: string; name: string; md5Checksum?: string | null }>;
      };
      return data.files?.map((file) => ({ id: file.id, name: file.name, md5Checksum: file.md5Checksum ?? null })) ?? [];
    },
    async createFile({ name, parentId, mimeType, data }) {
      // Media upload: metadata JSON + сирі байти файла в одному multipart/related
      // тілі. Ім'я файла — слот + розширення (PII-безпека, тикет 08).
      const boundary = `updoc-${randomBytes(16).toString("hex")}`;
      const metadata = Buffer.from(JSON.stringify({ name, mimeType, parents: [parentId] }));
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`),
        metadata,
        Buffer.from(`\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await driveFetch("POST", "/files?uploadType=multipart&fields=id", undefined, {
        base: DRIVE_UPLOAD_API,
        contentType: `multipart/related; boundary=${boundary}`,
        body,
      });
      const created = (await res.json()) as { id?: string };
      if (!created.id) {
        throw new Error("Google Drive: створення файла не повернуло id");
      }
      return created.id;
    },
    async deleteFile(fileId) {
      await driveFetch("DELETE", `/files/${fileId}`);
    },
  };
}
