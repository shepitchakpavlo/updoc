import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api";

// Seam: клієнт + fake fetch (система-межа; mocking.md). Контракт тикета 05:
// токен іде лише в заголовку x-access-token (не в URL — Architecture §5),
// upload — multipart (слот + файл), помилки API — ApiError із message сервера.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ACCESS_BODY = {
  company: "ТОВ Приклад",
  fullName: "Іваненко Іван Іванович",
  checklist: ["1-2", "11-12", "13-14", "15-16"],
};

describe("createApi.getAccess", () => {
  it("шле токен у заголовку x-access-token і парсить дані заявки", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, ACCESS_BODY);
    });
    const api = createApi(fetchImpl as typeof fetch);

    const view = await api.getAccess("abc123");

    expect(captured?.headers).toEqual({ "x-access-token": "abc123" });
    expect(view).toEqual(ACCESS_BODY);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("невідомий токен — ApiError із message сервера", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { error: "not_found", message: "Заявку не знайдено" }));
    const api = createApi(fetchImpl as typeof fetch);

    await expect(api.getAccess("nope")).rejects.toMatchObject({
      name: "ApiError",
      statusCode: 404,
      code: "not_found",
      message: "Заявку не знайдено",
    });
  });
});

describe("createApi.getSubmissions", () => {
  it("віддає стан і фідбек слотів", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        submissions: [{ slot: "1-2", status: "needs_reupload", feedback: "Номер документа не впізнано" }],
      }),
    );
    const api = createApi(fetchImpl as typeof fetch);

    const view = await api.getSubmissions("abc123");

    expect(view.submissions).toEqual([
      { slot: "1-2", status: "needs_reupload", feedback: "Номер документа не впізнано" },
    ]);
  });
});

describe("createApi.uploadFile", () => {
  it("шле multipart: слот і файл, токен у заголовку; повертає результат upload", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init;
      return jsonResponse(201, {
        slot: "1-2",
        checksum: "ab".repeat(32),
        status: "pending",
        mimeType: "image/png",
        pageCount: null,
      });
    });
    const api = createApi(fetchImpl as typeof fetch);
    const file = new File(["байти"], "scan.png");

    const result = await api.uploadFile("abc123", "1-2", file);

    expect(captured?.method).toBe("POST");
    expect(captured?.headers).toEqual({ "x-access-token": "abc123" });
    const form = captured?.body as FormData;
    expect(form.get("slot")).toBe("1-2");
    expect(form.get("file")).toBe(file);
    expect(result).toEqual({
      slot: "1-2",
      checksum: "ab".repeat(32),
      status: "pending",
      mimeType: "image/png",
      pageCount: null,
    });
  });

  it("відхилений preflight — ApiError із message сервера", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: "unsupported_format", message: "Формат не підтримується: JPG, PNG, HEIC, PDF" }),
    );
    const api = createApi(fetchImpl as typeof fetch);

    await expect(api.uploadFile("abc123", "1-2", new File(["x"], "a.txt"))).rejects.toBeInstanceOf(ApiError);
    await expect(api.uploadFile("abc123", "1-2", new File(["x"], "a.txt"))).rejects.toMatchObject({
      code: "unsupported_format",
      message: "Формат не підтримується: JPG, PNG, HEIC, PDF",
    });
  });

  it("відповідь без JSON-тіла помилки — ApiError із дефолтним повідомленням", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const api = createApi(fetchImpl as typeof fetch);

    await expect(api.uploadFile("abc123", "1-2", new File(["x"], "a.png"))).rejects.toMatchObject({
      statusCode: 500,
      message: "Помилка сервера (500)",
    });
  });
});
