import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { FolderExistsError, type ApplicationService } from "../applications/service.js";
import { ApiError } from "../errors.js";
import type { SubmissionService } from "../submissions/service.js";

// Публічні ендпоінти тикета 03 і 04:
// POST /applications — оператор створює заявку (компанія + ПІБ) → лінк із токеном;
// GET /applications/access — форма за токеном (заголовок x-access-token, не URL —
//   щоб токен не потрапляв у логи запитів); невідомий/невалідний токен → 404;
// POST /applications/upload — multipart (слот + файл) за токеном; preflight і
//   створення submission — у сервісі; тіло відповіді без імені файла (PII-безпека).

const createApplicationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["company", "fullName"],
    properties: {
      company: { type: "string", minLength: 1, maxLength: 255 },
      fullName: { type: "string", minLength: 1, maxLength: 255 },
    },
  },
} as const;

const notFound = { error: "not_found", message: "Заявку не знайдено" };

// Токен заявки — лише в заголовку x-access-token, не в URL: не потрапляє
// в логи запитів (PII-безпека). Спільний доступ для обох ендпоінтів.
function accessToken(req: FastifyRequest): string | null {
  const token = req.headers["x-access-token"];
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function applicationRoutes(
  applications: ApplicationService,
  submissions: SubmissionService,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/applications", { schema: createApplicationSchema }, async (req, reply) => {
      const { company, fullName } = req.body as { company: string; fullName: string };
      try {
        const { link } = await applications.createApplication({ company, fullName });
        return reply.code(201).send({ link });
      } catch (err) {
        if (err instanceof FolderExistsError) {
          return reply.code(409).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    app.get("/applications/access", async (req, reply) => {
      const token = accessToken(req);
      if (token === null) {
        return reply.code(404).send(notFound);
      }
      const view = await applications.getApplicationByToken(token);
      if (view === null) {
        return reply.code(404).send(notFound);
      }
      return view;
    });

    app.post("/applications/upload", async (req, reply) => {
      const token = accessToken(req);
      if (token === null) {
        return reply.code(404).send(notFound);
      }
      if (!req.isMultipart()) {
        return reply.code(415).send({ error: "invalid_upload", message: "Очікується multipart/form-data" });
      }
      // Декодуємо multipart у пам'ять процесу (TemporaryStorage — лише контракт,
      // Phase 1). Ім'я файла і content-type part-а навмисно не читаємо й не
      // логуємо: MIME визначається за magic bytes, PII не потрапляє в логи.
      let slot: string | null = null;
      const files: Buffer[] = [];
      for await (const part of req.parts()) {
        if (part.type === "file") {
          files.push(await part.toBuffer());
        } else if (part.fieldname === "slot") {
          slot = part.value as string; // текстові поля multipart завжди рядки (busboy)
        }
      }
      if (slot === null || slot.length === 0) {
        return reply.code(400).send({ error: "invalid_slot", message: "Слот не вказано" });
      }
      const file = files[0];
      if (files.length === 0 || file === undefined) {
        return reply.code(400).send({ error: "invalid_upload", message: "Файл не додано" });
      }
      if (files.length > 1) {
        return reply.code(400).send({ error: "invalid_upload", message: "Очікується один файл на слот" });
      }
      try {
        const result = await submissions.uploadSlot({ token, slot, file });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof ApiError) {
          return reply.code(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });
  };
}
