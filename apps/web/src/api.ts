// Типовий клієнт публічних ендпоінтів форми (тикет 05). Токен заявки — лише
// в заголовку x-access-token, не в URL (Architecture §5: токени не потрапляють
// у логи запитів). Відносні шляхи: у dev їх проксіює Vite на API (:3000),
// у проді SPA сервиться тим самим origin.
//
// Контракт нижче дублює типи API (монорепо без спільного пакета типів):
// SubmissionStatus — джерело правди apps/api/src/db/schema.ts (pgEnum
// submission_status), тіло помилок { error, message } — apps/api/src/errors.ts.
// Зміна енума/форми помилок в API має синхронно оновлюватись тут.

export type SubmissionStatus = "pending" | "checking" | "accepted" | "needs_reupload";

export interface ApplicationView {
  company: string;
  fullName: string;
  checklist: string[];
}

export interface SubmissionView {
  slot: string;
  status: SubmissionStatus;
  feedback: string | null;
}

export interface SubmissionsView {
  submissions: SubmissionView[];
}

export interface UploadResult {
  slot: string;
  checksum: string;
  status: SubmissionStatus;
  mimeType: string;
  pageCount: number | null;
  /** причина відхилення (feedback для працівника); null, коли прийнято (тикет 06) */
  feedback: string | null;
}

// Помилка API з тіла відповіді: { error, message } (спільний контракт тикетів 03–05).
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UpDocApi {
  getAccess(token: string): Promise<ApplicationView>;
  getSubmissions(token: string): Promise<SubmissionsView>;
  uploadFile(token: string, slot: string, file: File): Promise<UploadResult>;
}

// fetchImpl інжектується лише для тестів (seam: система-межа; mocking.md).
export function createApi(fetchImpl: typeof fetch = fetch): UpDocApi {
  async function request(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetchImpl(path, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      throw new ApiError(
        res.status,
        body?.error ?? "unknown_error",
        body?.message ?? `Помилка сервера (${res.status})`,
      );
    }
    return res.json();
  }

  function headers(token: string): Record<string, string> {
    return { "x-access-token": token };
  }

  return {
    async getAccess(token) {
      return (await request("/applications/access", { headers: headers(token) })) as ApplicationView;
    },
    async getSubmissions(token) {
      return (await request("/applications/submissions", { headers: headers(token) })) as SubmissionsView;
    },
    async uploadFile(token, slot, file) {
      const form = new FormData();
      form.append("slot", slot);
      form.append("file", file);
      return (await request("/applications/upload", {
        method: "POST",
        headers: headers(token),
        body: form,
      })) as UploadResult;
    },
  };
}
