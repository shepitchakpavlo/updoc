import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookletSlot } from "../src/checklist.js";
import { buildApp } from "../src/app.js";
import { FolderExistsError, type ApplicationService } from "../src/applications/service.js";
import type { SubmissionService } from "../src/submissions/service.js";

// Публічний контракт тикета 03 на рівні HTTP (seam: routes + fake service):
// POST /applications створює заявку і повертає лінк; GET за токеном віддає
// компанію, ПІБ і чекліст; невідомий токен — 404; існуюча папка — hard error 409.

// Незалежне значення зі спеки TB-0 (книжечка: слоти 1–2, 11–12, 13–14, 15–16).
const CHECKLIST: BookletSlot[] = ["1-2", "11-12", "13-14", "15-16"];

// Upload — контракт тикета 04 (test/upload-routes.test.ts); тут лише заглушка.
function stubSubmissions(): SubmissionService {
  return {
    async uploadSlot() {
      throw new Error("uploadSlot не очікувався в тестах тикета 03");
    },
    async listByToken() {
      throw new Error("listByToken не очікувався в тестах тикета 03");
    },
  };
}

function fakeService(): ApplicationService & { created: Array<{ company: string; fullName: string }> } {
  const created: Array<{ company: string; fullName: string }> = [];
  return {
    created,
    async createApplication(input) {
      created.push(input);
      return { link: "http://localhost:5173/a/abc123" };
    },
    async getApplicationByToken(token) {
      if (token === "abc123") {
        return { company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович", checklist: CHECKLIST };
      }
      return null;
    },
  };
}

test("POST /applications створює заявку і повертає лінк", async () => {
  const service = fakeService();
  const app = buildApp({}, { applications: service, submissions: stubSubmissions() });
  const res = await app.inject({
    method: "POST",
    url: "/applications",
    payload: { company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), { link: "http://localhost:5173/a/abc123" });
  assert.deepEqual(service.created, [{ company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" }]);
  await app.close();
});

test("POST /applications із невалідним тілом відхиляється (400)", async () => {
  const service = fakeService();
  const app = buildApp({}, { applications: service, submissions: stubSubmissions() });
  for (const payload of [
    {},
    { company: "ТОВ Приклад" },
    { company: "ТОВ Приклад", fullName: "" },
    { company: "", fullName: "Іваненко Іван Іванович" },
  ]) {
    const res = await app.inject({ method: "POST", url: "/applications", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(service.created.length, 0);
  await app.close();
});

test("POST /applications при існуючій папці — hard error 409 без суфіксів", async () => {
  const app = buildApp({}, {
    applications: {
      async createApplication() {
        throw new FolderExistsError();
      },
      async getApplicationByToken() {
        return null;
      },
    },
    submissions: stubSubmissions(),
  });
  const res = await app.inject({
    method: "POST",
    url: "/applications",
    payload: { company: "ТОВ Приклад", fullName: "Іваненко Іван Іванович" },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "folder_exists");
  await app.close();
});

test("GET /applications/access за токеном віддає компанію, ПІБ і чекліст", async () => {
  const app = buildApp({}, { applications: fakeService(), submissions: stubSubmissions() });
  const res = await app.inject({
    method: "GET",
    url: "/applications/access",
    headers: { "x-access-token": "abc123" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    company: "ТОВ Приклад",
    fullName: "Іваненко Іван Іванович",
    checklist: CHECKLIST,
  });
  await app.close();
});

test("GET /applications/access з невідомим токеном — 404", async () => {
  const app = buildApp({}, { applications: fakeService(), submissions: stubSubmissions() });
  for (const headers of [{ "x-access-token": "unknown-token" }, {}]) {
    const res = await app.inject({ method: "GET", url: "/applications/access", headers });
    assert.equal(res.statusCode, 404, JSON.stringify(headers));
  }
  await app.close();
});
