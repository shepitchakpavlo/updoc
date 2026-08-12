import Fastify, { type FastifyServerOptions } from "fastify";
import { createDefaultDeps, type AppDeps } from "./deps.js";
import { applicationRoutes } from "./routes/applications.js";
import { healthRoutes } from "./routes/health.js";

export function buildApp(opts: FastifyServerOptions = {}, deps: AppDeps = createDefaultDeps()) {
  const app = Fastify(opts);
  app.register(healthRoutes);
  app.register(applicationRoutes(deps.applications));
  return app;
}
