import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { applicationFolderName } from "../../src/applications/service.js";
import { BOOKLET_SLOTS } from "../../src/checklist.js";
import type { DriveClient } from "../../src/drive/client.js";
import { ensureSamples, makeTooSmallFile, type SampleFile } from "./samples.js";

// Наскрізний прогін тикета 09: API-скрипт проходить увесь ланцюжок TB-0
// (заявка → лінк → upload → мок-assessment → policy → Drive) через публічні
// ендпоінти, а результат перевіряє тим самим сервісним акаунтом (той самий
// обмежений доступ, що в API): прийнятий файл з'являється в папці заявки,
// відхилений — ніколи (причина — feedback API), повторний upload того самого
// файла (retry після технічного збою з погляду клієнта) не створює дублікатів:
// ідемпотентний запис перевикористовує id файла (ledger, тикет 08).
// Сценарій логує лише синтетичні значення: токен і лінк у логи не потрапляють.

export interface SliceEnv {
  /** база API-сервера (наприклад, http://localhost:3000) */
  apiBaseUrl: string;
  /** інжектується для тестів (in-process Fastify); у прогоні — глобальний fetch */
  fetchImpl: typeof fetch;
  /** клієнт тестового Drive (той самий сервісний акаунт, що в API) */
  drive: DriveClient;
  testFolderId: string;
  /** каталог зразків (поза репо) */
  samplesDir: string;
  /** синтетичні ПІБ і компанія — без реальних персональних даних */
  fullName: string;
  company: string;
  log?: (line: string) => void;
}

export interface SliceStep {
  name: string;
  ok: boolean;
  /** деталі успіху або причина невдачі (без PII) */
  detail?: string;
}

export interface SliceResult {
  ok: boolean;
  steps: SliceStep[];
}

export interface SpaPreparation {
  link: string;
  token: string;
  folderName: string;
  /** кількість прибраних старих папок попередніх прогонів */
  staleRemoved: number;
  samples: SampleFile[];
}

// Токен заявки — сегмент лінка /a/{token} (тикет 03). Лінк у лог не
// друкується: токен у ньому.
export function tokenFromLink(link: string): string | null {
  const match = /\/a\/([^/]+)$/.exec(link);
  return match?.[1] ?? null;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

interface AccessView {
  company: string;
  fullName: string;
  checklist: string[];
}

interface SubmissionView {
  slot: string;
  status: string;
  feedback: string | null;
}

interface UploadView {
  slot: string;
  checksum: string;
  status: string;
  mimeType: string;
  pageCount: number | null;
  feedback: string | null;
}

interface ApiClient {
  createApplication(company: string, fullName: string): Promise<{ link: string }>;
  getAccess(token: string): Promise<AccessView>;
  getSubmissions(token: string): Promise<{ submissions: SubmissionView[] }>;
  uploadFile(
    token: string,
    slot: string,
    filename: string,
    contentType: string,
    data: Buffer,
  ): Promise<UploadView>;
}

// Фіксований boundary: один запит на файл, детермінованість для тестів.
const BOUNDARY = "----updoc-e2e-boundary";

function multipartBody(slot: string, filename: string, contentType: string, data: Buffer): Buffer {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="slot"\r\n\r\n` +
      `${slot}\r\n` +
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    "latin1",
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, "latin1");
  return Buffer.concat([head, data, tail]);
}

function createApiClient(apiBaseUrl: string, fetchImpl: typeof fetch): ApiClient {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(`${apiBaseUrl}${path}`, init);
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    if (!res.ok) {
      throw new HttpError(
        res.status,
        body?.error ?? "http_error",
        body?.message ?? `HTTP ${res.status}`,
      );
    }
    return body as T;
  }

  function headers(token: string): Record<string, string> {
    return { "x-access-token": token };
  }

  return {
    async createApplication(company, fullName) {
      return request("/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company, fullName }),
      });
    },
    async getAccess(token) {
      return request("/applications/access", { headers: headers(token) });
    },
    async getSubmissions(token) {
      return request("/applications/submissions", { headers: headers(token) });
    },
    async uploadFile(token, slot, filename, contentType, data) {
      return request("/applications/upload", {
        method: "POST",
        headers: { ...headers(token), "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: multipartBody(slot, filename, contentType, data),
      });
    },
  };
}

// Крок, що обриває прогін: записаний у steps, результат — ok=false.
class StepAbort extends Error {
  constructor(name: string, detail: string) {
    super(detail);
    this.name = name;
  }
}

async function removeStaleFolders(
  drive: DriveClient,
  testFolderId: string,
  name: string,
): Promise<number> {
  const ids = await drive.findFoldersByName(name, testFolderId);
  for (const id of ids) {
    await drive.deleteFolder(id);
  }
  return ids.length;
}

function localMd5(data: Buffer): string {
  return createHash("md5").update(data).digest("hex");
}

export async function runSlice(env: SliceEnv): Promise<SliceResult> {
  const steps: SliceStep[] = [];
  const log = env.log ?? (() => {});
  const record = (name: string, ok: boolean, detail?: string): void => {
    steps.push({ name, ok, detail });
    log(`${ok ? "OK " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const check = (ok: boolean, name: string, detail?: string): void => {
    if (!ok) {
      throw new StepAbort(name, detail ?? "перевірка не пройшла");
    }
    record(name, true, detail);
  };
  const finish = (ok: boolean): SliceResult => ({ ok, steps });

  const api = createApiClient(env.apiBaseUrl, env.fetchImpl);
  const name = applicationFolderName(env.fullName, env.company);

  try {
    // 1. Зразки — поза репо, синтетичний вміст без PII.
    const samples = await ensureSamples(env.samplesDir);
    check(samples.length === 3, "Тестові зразки підготовлені (3 файли, поза репо)", env.samplesDir);
    const acceptedPng = samples.find((s) => s.name === "accepted-1-2.png");
    const acceptedPdf = samples.find((s) => s.name === "accepted-11-12.pdf");
    const rejectedSample = samples.find((s) => s.name === "rejected-wrong-slot.png");
    if (acceptedPng === undefined || acceptedPdf === undefined || rejectedSample === undefined) {
      throw new StepAbort("Набір зразків повний (PNG, PDF, відхилений)", "зразок відсутній");
    }
    record("Набір зразків повний (PNG, PDF, відхилений)", true);

    // 2. Стара папка попереднього прогону не має блокувати новий (folder_exists — hard error).
    const stale = await removeStaleFolders(env.drive, env.testFolderId, name);
    record("Стара папка заявки прибрана", true, stale === 0 ? "не було" : `знайдено: ${stale}`);

    // 3. Заявка → лінк → токен.
    const { link } = await api.createApplication(env.company, env.fullName);
    const token = tokenFromLink(link);
    if (token === null) {
      throw new StepAbort("Заявку створено через API, токен витягнуто з лінка", "у лінку немає токена");
    }
    record("Заявку створено через API, токен витягнуто з лінка", true);

    // 4. Папка «ПІБ — Компанія» створена в тестовому Drive (рівно одна).
    const folderIds = await env.drive.findFoldersByName(name, env.testFolderId);
    const folderId = folderIds[0];
    if (folderId === undefined || folderIds.length !== 1) {
      throw new StepAbort("Папка заявки знайдена в тестовому Drive", `знайдено: ${folderIds.length}`);
    }
    record("Папка заявки знайдена в тестовому Drive", true, folderId);

    // 5. Форма за токеном бачить заявку з чеклістом.
    const access = await api.getAccess(token);
    check(
      access.company === env.company &&
        access.fullName === env.fullName &&
        access.checklist.length === BOOKLET_SLOTS.length &&
        BOOKLET_SLOTS.every((slot) => access.checklist.includes(slot)),
      "Доступ за токеном: компанія, ПІБ, чекліст книжечки",
    );

    // 6. До завантажень слотів немає.
    const initial = await api.getSubmissions(token);
    check(initial.submissions.length === 0, "Список слотів порожній до завантажень");

    // 7. Відхилений зразок (маркер іншого слота) — needs_reupload із причиною policy.
    const rejected = await api.uploadFile(token, rejectedSample.slot, rejectedSample.name, "image/png", readSample(rejectedSample));
    check(
      rejected.status === "needs_reupload" && (rejected.feedback ?? "").includes("не відповідає слоту"),
      "Відхилений файл не прийнято, причина є",
      rejected.feedback ?? "без причини",
    );

    // 8. Замалий файл — needs_reupload із причиною провайдера.
    const small = await api.uploadFile(token, "13-14", "too-small.png", "image/png", makeTooSmallFile());
    check(
      small.status === "needs_reupload" && (small.feedback ?? "").includes("замалий"),
      "Замалий файл не прийнято, причина є",
      small.feedback ?? "без причини",
    );

    // 9. Відхилені файли ніколи не потрапляють у Drive (Architecture §4).
    const before = await env.drive.listFilesInFolder(folderId);
    check(before.length === 0, "У папці заявки ще немає файлів (відхилені не пишуться)", `файлів: ${before.length}`);

    // 10–11. Прийняті файли записуються в папку заявки.
    const pngData = readSample(acceptedPng);
    const pngUpload = await api.uploadFile(token, acceptedPng.slot, acceptedPng.name, "image/png", pngData);
    check(
      pngUpload.status === "accepted" && pngUpload.mimeType === "image/png",
      "Прийнятий PNG записано в папку заявки",
      pngUpload.status,
    );
    const pdfData = readSample(acceptedPdf);
    const pdfUpload = await api.uploadFile(token, acceptedPdf.slot, acceptedPdf.name, "application/pdf", pdfData);
    check(
      pdfUpload.status === "accepted" &&
        pdfUpload.mimeType === "application/pdf" &&
        (pdfUpload.pageCount ?? 0) >= 1,
      "Прийнятий PDF записано в папку заявки",
      `сторінок: ${pdfUpload.pageCount ?? "?"}`,
    );

    // 12. У папці рівно два файли з іменами слотів і MD5 зразків.
    const files = await env.drive.listFilesInFolder(folderId);
    const pngFile = files.find((f) => f.name === "1-2.png");
    const pdfFile = files.find((f) => f.name === "11-12.pdf");
    check(
      files.length === 2 && pngFile !== undefined && pdfFile !== undefined,
      "У папці рівно два файли слотів",
      files.map((f) => f.name).join(", "),
    );
    check(
      pngFile?.md5Checksum === localMd5(pngData) && pdfFile?.md5Checksum === localMd5(pdfData),
      "MD5 файлів у Drive збігаються зі зразками",
    );

    // 13. Retry після технічного збою (клієнт не знає, що перший upload пройшов):
    //     той самий файл — без дубліката, той самий id (ідемпотентний запис, тикет 08).
    const retry = await api.uploadFile(token, acceptedPng.slot, acceptedPng.name, "image/png", pngData);
    check(retry.status === "accepted", "Повторний upload того самого файла прийнято");
    const after = await env.drive.listFilesInFolder(folderId);
    const pngAfter = after.find((f) => f.name === "1-2.png");
    check(
      after.length === 2 && pngAfter !== undefined && pngAfter.id === pngFile?.id,
      "Повторний upload без дубліката: той самий id файла",
      pngAfter?.id,
    );

    // 14. Фінальний стан слотів через API: прийняті + відхилений із поясненням.
    const final = await api.getSubmissions(token);
    const finalBySlot = Object.fromEntries(final.submissions.map((s) => [s.slot, s]));
    check(
      finalBySlot["1-2"]?.status === "accepted" &&
        finalBySlot["11-12"]?.status === "accepted" &&
        finalBySlot["13-14"]?.status === "needs_reupload" &&
        (finalBySlot["13-14"]?.feedback?.length ?? 0) > 0 &&
        final.submissions.length === 3,
      "Фінальний стан слотів через API",
      final.submissions.map((s) => `${s.slot}:${s.status}`).join(", "),
    );

    // Бест-еффорт: папку прогону прибираємо, щоб не засмічувати тестовий Drive.
    await env.drive.deleteFolder(folderId).catch(() => {
      log(`WARN не вдалося прибрати папку ${folderId} — наступний прогін прибере її сам`);
    });
    return finish(true);
  } catch (err) {
    if (err instanceof StepAbort) {
      record(err.name, false, err.message);
    } else {
      record(
        "Неочікувана помилка",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
    return finish(false);
  }
}

function readSample(sample: SampleFile | undefined): Buffer {
  if (sample === undefined) {
    throw new Error("зразок відсутній");
  }
  return readFileSync(sample.path);
}

/** SPA-режим (ручний прохід): заявка + лінк + зразки; папка лишається для людини. */
export async function prepareSpa(env: SliceEnv): Promise<SpaPreparation> {
  const samples = await ensureSamples(env.samplesDir);
  const name = applicationFolderName(env.fullName, env.company);
  const staleRemoved = await removeStaleFolders(env.drive, env.testFolderId, name);
  const api = createApiClient(env.apiBaseUrl, env.fetchImpl);
  const { link } = await api.createApplication(env.company, env.fullName);
  const token = tokenFromLink(link);
  if (token === null) {
    throw new Error("Лінк заявки без токена — перевірте APP_BASE_URL");
  }
  return { link, token, folderName: name, staleRemoved, samples };
}
