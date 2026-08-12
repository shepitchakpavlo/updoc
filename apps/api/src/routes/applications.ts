import type { FastifyPluginAsync } from "fastify";
import { FolderExistsError, type ApplicationService } from "../applications/service.js";

// Публічні ендпоінти тикета 03:
// POST /applications — оператор створює заявку (компанія + ПІБ) → лінк із токеном;
// GET /applications/access — форма за токеном (заголовок x-access-token, не URL —
//   щоб токен не потрапляв у логи запитів); невідомий/невалідний токен → 404.

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

export function applicationRoutes(service: ApplicationService): FastifyPluginAsync {
  return async (app) => {
    app.post("/applications", { schema: createApplicationSchema }, async (req, reply) => {
      const { company, fullName } = req.body as { company: string; fullName: string };
      try {
        const { link } = await service.createApplication({ company, fullName });
        return reply.code(201).send({ link });
      } catch (err) {
        if (err instanceof FolderExistsError) {
          return reply.code(409).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    app.get("/applications/access", async (req, reply) => {
      const token = req.headers["x-access-token"];
      if (typeof token !== "string" || token.length === 0) {
        return reply.code(404).send(notFound);
      }
      const view = await service.getApplicationByToken(token);
      if (view === null) {
        return reply.code(404).send(notFound);
      }
      return view;
    });
  };
}
