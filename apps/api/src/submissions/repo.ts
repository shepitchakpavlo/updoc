import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { submissions } from "../db/schema.js";

export type NewSubmission = typeof submissions.$inferInsert;
export type Submission = typeof submissions.$inferSelect;

export interface SubmissionRepo {
  /**
   * Створює submission або замінює попередній файл слота (Architecture §4:
   * один файл на слот, історії версій немає). При заміні скидаються
   * assessment і drive_file_id — вони належать старому файлу.
   */
  upsert(row: NewSubmission): Promise<void>;
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
  };
}
