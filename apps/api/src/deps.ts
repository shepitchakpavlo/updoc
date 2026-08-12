import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createPgApplicationRepo } from "./applications/repo.js";
import { createApplicationService, type ApplicationService } from "./applications/service.js";
import { loadConfig } from "./config.js";
import { createDriveClient } from "./drive/client.js";

export interface AppDeps {
  applications: ApplicationService;
}

// Дефолтні залежності з оточення. Pool підключається ліниво — /healthz працює без Postgres.
export function createDefaultDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  const config = loadConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const repo = createPgApplicationRepo(drizzle(pool));
  const drive = createDriveClient({ credentialsFile: config.driveCredentialsFile });
  return {
    applications: createApplicationService({
      repo,
      drive,
      testFolderId: config.driveTestFolderId,
      appBaseUrl: config.appBaseUrl,
    }),
  };
}
