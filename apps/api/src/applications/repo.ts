import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { applications } from "../db/schema.js";

export type NewApplication = typeof applications.$inferInsert;
export type Application = typeof applications.$inferSelect;

export interface ApplicationRepo {
  insert(row: NewApplication): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Application | null>;
}

export function createPgApplicationRepo(db: NodePgDatabase): ApplicationRepo {
  return {
    async insert(row) {
      await db.insert(applications).values(row);
    },
    async findByTokenHash(tokenHash) {
      const rows = await db
        .select()
        .from(applications)
        .where(eq(applications.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
