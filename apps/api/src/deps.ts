import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createMockAssessmentProvider } from "./assessment/mock.js";
import { createPgApplicationRepo } from "./applications/repo.js";
import { createApplicationService, type ApplicationService } from "./applications/service.js";
import { loadConfig } from "./config.js";
import { createDriveClient } from "./drive/client.js";
import { createPgSubmissionRepo } from "./submissions/repo.js";
import { createSubmissionService, type SubmissionService } from "./submissions/service.js";

export interface AppDeps {
  applications: ApplicationService;
  submissions: SubmissionService;
}

// Дефолтні залежності з оточення. Pool підключається ліниво — /healthz працює без Postgres.
export function createDefaultDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  const config = loadConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);
  const applicationRepo = createPgApplicationRepo(db);
  const drive = createDriveClient({ credentialsFile: config.driveCredentialsFile });
  return {
    applications: createApplicationService({
      repo: applicationRepo,
      drive,
      testFolderId: config.driveTestFolderId,
      appBaseUrl: config.appBaseUrl,
    }),
    submissions: createSubmissionService({
      applications: applicationRepo,
      submissions: createPgSubmissionRepo(db),
      // Assessment у TB-0 — мок; Phase 1 підмінить hosted vision-провайдером
      // без змін ядра (контракт AssessmentProvider, Architecture §5).
      assessment: createMockAssessmentProvider(),
    }),
  };
}
