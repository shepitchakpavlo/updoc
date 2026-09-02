// .env (секрети сервісного акаунта та перевизначення дефолтів) — поза репо, див. .env.example.
import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
