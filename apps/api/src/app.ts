import multipart from "@fastify/multipart";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import { createDefaultDeps, type AppDeps } from "./deps.js";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB } from "./preflight/index.js";
import { applicationRoutes } from "./routes/applications.js";
import { healthRoutes } from "./routes/health.js";

// Ліміт тіла multipart-запиту: файл ≤20MB (preflight — єдиний суддя розміру
// файла) + службові байти multipart-обгортки. Це лише запобіжник пам'яті.
const BODY_LIMIT = MAX_FILE_SIZE + 1024 * 1024;

export function buildApp(opts: FastifyServerOptions = {}, deps: AppDeps = createDefaultDeps()) {
  const app = Fastify({ ...opts, bodyLimit: opts.bodyLimit ?? BODY_LIMIT });
  app.register(multipart);
  // Multipart-ліміти (перевищення bodyLimit або fileSize) теж віддаємо єдиним
  // контрактом 413 file_too_large, щоб клієнт не залежав від внутрішніх кодів.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.code === "FST_REQ_FILE_TOO_LARGE" || err.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ error: "file_too_large", message: `Файл понад ${MAX_FILE_SIZE_MB}MB` });
    }
    return reply.send(err);
  });
  // PII-gate: дефолтний 404-хендлер Fastify логує `Route GET:/a/<token> not
  // found` — сирий токен у msg, ред.акція полів його не покриває. Свій хендлер:
  // без URL у логах взагалі (перевірено test/log-redaction.test.ts).
  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ error: "not_found" });
  });
  app.register(healthRoutes);
  app.register(applicationRoutes(deps.applications, deps.submissions));
  return app;
}
