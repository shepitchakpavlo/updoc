import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import type { ApplicationService } from "../src/applications/service.js";
import type { SubmissionService, SubmissionView } from "../src/submissions/service.js";

// Публічний контракт тикета 05 на рівні HTTP (seam: routes + fake service):
// GET /applications/submissions за токеном у заголовку x-access-token віддає
// стан і фідбек слотів для SPA-форми; невідомий/відсутній токен — 404.

const TOKEN = "abc123";

const VIEWS: SubmissionView[] = [
  { slot: "1-2", status: "accepted", feedback: null },
  { slot: "11-12", status: "needs_reupload", feedback: "Номер документа не впізнано" },
];

function fakeSubmissions(calls: string[] = []): SubmissionService {
  return {
    async uploadSlot() {
      throw new Error("uploadSlot не очікувався в тестах тикета 05");
    },
    async listByToken(token) {
      calls.push(token);
      return token === TOKEN ? VIEWS : null;
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

test("GET /applications/submissions за токеном віддає стан і фідбек слотів", async () => {
  const app = build(fakeSubmissions());
  const res = await app.inject({
    method: "GET",
    url: "/applications/submissions",
    headers: { "x-access-token": TOKEN },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { submissions: VIEWS });
  await app.close();
});

test("GET /applications/submissions з невідомим токеном — 404 not_found", async () => {
  const app = build(fakeSubmissions());
  const res = await app.inject({
    method: "GET",
    url: "/applications/submissions",
    headers: { "x-access-token": "unknown-token" },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "not_found");
  await app.close();
});

test("GET /applications/submissions без токена — 404, сервіс не викликається", async () => {
  const calls: string[] = [];
  const app = build(fakeSubmissions(calls));
  const res = await app.inject({ method: "GET", url: "/applications/submissions" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "not_found");
  assert.deepEqual(calls, []);
  await app.close();
});
