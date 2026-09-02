// .env (секрети сервісного акаунта та перевизначення дефолтів) — поза репо, див. .env.example.
import "dotenv/config";
import { buildApp } from "./app.js";

// PII-gate: токен доступу подорожує в URL-шляху роутів (/a/:token),
// тому logger обов'язково ред.актить req.url/req.headers/res — сирий
// токен ніколи не потрапляє в логи (перевірено test/log-redaction.test.ts).
const app = buildApp({
  logger: {
    level: "info",
    redact: { paths: ["req.url", "req.headers", "res"], censor: "[REDACTED]" },
  },
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
