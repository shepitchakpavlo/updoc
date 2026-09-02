/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApplicationView, type SubmissionsView, type UploadResult, type UpDocApi } from "../src/api";
import { ApplicationForm, App, tokenFromPath } from "../src/App";

// Seam: компонент + fake api (система-межа). Приймальні критерії тикета 05:
// лінк відкриває форму з даними заявки і чеклістом; кожен слот приймає один
// файл (повторне завантаження замінює); стан слота видно; фідбек від API
// показується; після upload стан оновлюється.

const ACCESS: ApplicationView = {
  company: "ТОВ Приклад",
  fullName: "Іваненко Іван Іванович",
  checklist: ["1-2", "11-12", "13-14", "15-16"],
};

function fakeApi(overrides: Partial<UpDocApi> = {}): UpDocApi {
  return {
    getAccess: vi.fn(async () => ACCESS),
    getSubmissions: vi.fn(async (): Promise<SubmissionsView> => ({ submissions: [] })),
    uploadFile: vi.fn(async (): Promise<UploadResult> => ({
      slot: "1-2",
      checksum: "ab".repeat(32),
      status: "pending",
      mimeType: "image/png",
      pageCount: null,
      feedback: null,
    })),
    ...overrides,
  };
}

function firstFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("файловий інпут не знайдено");
  }
  return input;
}

afterEach(cleanup);

describe("tokenFromPath", () => {
  it("витягує токен із лінка /a/{token}", () => {
    expect(tokenFromPath("/a/abc123")).toBe("abc123");
  });

  it("без токена в шляху — null", () => {
    expect(tokenFromPath("/")).toBeNull();
    expect(tokenFromPath("/a/")).toBeNull();
    expect(tokenFromPath("/other")).toBeNull();
    expect(tokenFromPath("/a/abc/extra")).toBeNull();
  });
});

describe("ApplicationForm", () => {
  it("показує ПІБ, компанію і чекліст із чотирма слотами у стані «Очікується»", async () => {
    render(<ApplicationForm token="abc123" api={fakeApi()} />);

    expect(await screen.findByText("Іваненко Іван Іванович")).toBeTruthy();
    expect(screen.getByText("ТОВ Приклад")).toBeTruthy();
    expect(screen.getByText("Слоти 1–2")).toBeTruthy();
    expect(screen.getByText("Слоти 11–12")).toBeTruthy();
    expect(screen.getByText("Слоти 13–14")).toBeTruthy();
    expect(screen.getByText("Слоти 15–16")).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.getAllByText("Очікується")).toHaveLength(4);
  });

  it("показує стан і фідбек слотів, що вже завантажені", async () => {
    const api = fakeApi({
      getSubmissions: vi.fn(async (): Promise<SubmissionsView> => ({
        submissions: [
          { slot: "1-2", status: "accepted", feedback: null },
          { slot: "11-12", status: "needs_reupload", feedback: "Номер документа не впізнано" },
          { slot: "13-14", status: "checking", feedback: null },
        ],
      })),
    });
    render(<ApplicationForm token="abc123" api={api} />);

    expect(await screen.findByText("Прийнято")).toBeTruthy();
    expect(screen.getByText("Потрібно перезавантажити")).toBeTruthy();
    expect(screen.getByText("Перевіряється")).toBeTruthy();
    expect(screen.getByText("Номер документа не впізнано")).toBeTruthy();
    expect(screen.getAllByText("Очікується")).toHaveLength(1); // слот 15-16
  });

  it("завантаження файла оновлює стан слота з відповіді API", async () => {
    const uploadFile = vi.fn(async (): Promise<UploadResult> => ({
      slot: "1-2",
      checksum: "cd".repeat(32),
      status: "accepted",
      mimeType: "image/png",
      pageCount: null,
      feedback: null,
    }));
    const api = fakeApi({ uploadFile });
    render(<ApplicationForm token="abc123" api={api} />);
    await screen.findAllByText("Очікується");

    fireEvent.change(firstFileInput(), { target: { files: [new File(["байти"], "scan.png")] } });

    expect(await screen.findByText("Прийнято")).toBeTruthy();
    expect(screen.getAllByText("Очікується")).toHaveLength(3); // інші слоти не змінилися
    expect(uploadFile).toHaveBeenCalledWith("abc123", "1-2", expect.any(File));
  });

  it("відхилений assessment показує причину одразу після завантаження", async () => {
    const api = fakeApi({
      uploadFile: vi.fn(async (): Promise<UploadResult> => ({
        slot: "1-2",
        checksum: "ef".repeat(32),
        status: "needs_reupload",
        mimeType: "image/png",
        pageCount: null,
        feedback: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
      })),
    });
    render(<ApplicationForm token="abc123" api={api} />);
    await screen.findAllByText("Очікується");

    fireEvent.change(firstFileInput(), { target: { files: [new File(["малий"], "scan.png")] } });

    expect(await screen.findByText("Потрібно перезавантажити")).toBeTruthy();
    expect(screen.getByText("Файл замалий для розпізнавання — перезавантажте документ, будь ласка")).toBeTruthy();
    expect(screen.getAllByText("Очікується")).toHaveLength(3);
  });

  it("помилка API при завантаженні показується як фідбек, стан не змінюється", async () => {
    const api = fakeApi({
      uploadFile: vi.fn(async () => {
        throw new ApiError(413, "file_too_large", "Файл понад 20MB");
      }),
    });
    render(<ApplicationForm token="abc123" api={api} />);
    await screen.findAllByText("Очікується");

    fireEvent.change(firstFileInput(), { target: { files: [new File(["x"], "big.png")] } });

    expect(await screen.findByText("Файл понад 20MB")).toBeTruthy();
    expect(screen.getAllByText("Очікується")).toHaveLength(4);
  });

  it("невідома заявка — повідомлення про ненайдену заявку", async () => {
    const api = fakeApi({
      getAccess: vi.fn(async () => {
        throw new ApiError(404, "not_found", "Заявку не знайдено");
      }),
    });
    render(<ApplicationForm token="nope" api={api} />);

    expect(await screen.findByText("Заявку не знайдено")).toBeTruthy();
  });

  it("збій мережі — загальне повідомлення про помилку завантаження", async () => {
    const api = fakeApi({
      getAccess: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    render(<ApplicationForm token="abc123" api={api} />);

    expect(await screen.findByText("Не вдалося завантажити форму. Спробуйте ще раз пізніше.")).toBeTruthy();
  });
});

describe("ApplicationForm з дефолтним клієнтом", () => {
  it("завантажує дані заявки один раз, без циклічних перезапитів", async () => {
    window.history.pushState({}, "", "/a/abc123");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/applications/access") {
        return jsonResponse(200, ACCESS);
      }
      return jsonResponse(200, { submissions: [] });
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      render(<App />);
      expect(await screen.findByText("Іваненко Іван Іванович")).toBeTruthy();
      expect(fetchImpl).toHaveBeenCalledTimes(2); // access + submissions
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(fetchImpl).toHaveBeenCalledTimes(2); // без повторних запитів
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
