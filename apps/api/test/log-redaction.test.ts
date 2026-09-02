import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

// GATE 1 (PII, AGENTS.md): токен доступу подорожує в URL-шляху (/a/:token,
// /f/:token) — логер має ред.актити req.url/req.headers/res, щоб сирий токен
// ніколи не з'явився в логах. Перевірка на реальному inject-запиті з токеном.
function captureLogger() {
  const logs: string[] = [];
  const logger = {
    level: "info",
    redact: { paths: ["req.url", "req.headers", "res"], censor: "[REDACTED]" },
    stream: { write: (chunk: string) => logs.push(chunk) },
  };
  return { logs, logger };
}

test("logger redacts token-bearing URL from request logs", async () => {
  const { logs, logger } = captureLogger();
  const app = buildApp({ logger });

  const res = await app.inject({ method: "GET", url: "/a/supersecrettoken123" });
  assert.equal(res.statusCode, 404); // невідомий токен — 404, але запит логується

  const all = logs.join("\n");
  assert.ok(!all.includes("supersecrettoken123"), "сирий токен не має бути в логах");
  assert.ok(all.includes("[REDACTED]"), "ред.акція має бути позначена в логах");
  await app.close();
});

test("logger redacts token in upload URL too", async () => {
  const { logs, logger } = captureLogger();
  const app = buildApp({ logger });

  const res = await app.inject({ method: "GET", url: "/f/anothersecret456" });
  assert.equal(res.statusCode, 404);

  const all = logs.join("\n");
  assert.ok(!all.includes("anothersecret456"), "сирий токен не має бути в логах");
  assert.ok(all.includes("[REDACTED]"));
  await app.close();
});