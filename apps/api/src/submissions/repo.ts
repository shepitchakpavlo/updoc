import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AssessmentResult } from "../assessment/provider.js";
import type { SubmissionStatus } from "../db/schema.js";
import { submissions } from "../db/schema.js";

export type NewSubmission = typeof submissions.$inferInsert;
export type Submission = typeof submissions.$inferSelect;

// Рядок для SPA-форми (тикет 05): стан слота і assessment для фідбека.
export interface SubmissionListItem {
  slot: string;
  status: SubmissionStatus;
  assessment: AssessmentResult | null;
}

export interface SubmissionRepo {
  /**
   * Створює submission або замінює попередній файл слота (Architecture §4:
   * один файл на слот, історії версій немає). При заміні скидаються
   * assessment і drive_file_id — вони належать старому файлу.
   */
  upsert(row: NewSubmission): Promise<void>;
  /** Усі submissions заявки (стан і фідбек для форми). */
  listByApplicationId(applicationId: string): Promise<SubmissionListItem[]>;
}

export function createPgSubmissionRepo(db: NodePgDatabase): SubmissionRepo {
  return {
    async upsert(row) {
      await db
        .insert(submissions)
        .values(row)
        .onConflictDoUpdate({
          target: [submissions.applicationId, submissions.slot],
          set: {
            checksum: row.checksum,
            status: row.status,
            assessment: row.assessment ?? null,
            driveFileId: row.driveFileId ?? null,
          },
        });
    },
    async listByApplicationId(applicationId) {
      return db
        .select({
          slot: submissions.slot,
          status: submissions.status,
          assessment: submissions.assessment,
        })
        .from(submissions)
        .where(eq(submissions.applicationId, applicationId));
    },
  };
}
