// Схема БД TB-0 (тикет 02): applications і submissions.
// Слоти політики — константа коду, не таблиця; expires_at / storage_key навмисно
// не додаються — прийдуть у Phase 1 зі своїми можливостями.
import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Стани submission (Architecture §4):
// очікується → перевіряється → прийнято | потрібно перезавантажити.
export const submissionStatus = pgEnum("submission_status", [
  "pending", // очікується
  "checking", // перевіряється
  "accepted", // прийнято
  "needs_reupload", // потрібно перезавантажити
]);
export type SubmissionStatus = (typeof submissionStatus.enumValues)[number];

// Формат assessment JSON — за контрактом AssessmentProvider (Architecture §5):
// accepted/rejected, причина, recognized fields, confidence.
export interface RecognizedField {
  value: string;
  confidence: number;
}

export interface AssessmentResult {
  accepted: boolean;
  reason: string | null;
  recognizedFields: Record<string, RecognizedField>;
  confidence: number;
}

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company: varchar("company", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(), // ПІБ
    tokenHash: varchar("token_hash", { length: 64 }).notNull(), // sha256 hex — незворотний; сирий токен у БД не зберігається
    folderId: varchar("folder_id", { length: 255 }).notNull(), // папка «ПІБ — Компанія» у Drive
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("applications_token_hash_unique").on(table.tokenHash)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    slot: varchar("slot", { length: 16 }).notNull(), // слот чекліста (книжечка: 1-2, 11-12, 13-14, 15-16)
    checksum: varchar("checksum", { length: 64 }).notNull(), // sha256 hex файла
    status: submissionStatus("status").notNull().default("pending"),
    assessment: jsonb("assessment").$type<AssessmentResult>(), // null, поки assessment не виконано
    driveFileId: varchar("drive_file_id", { length: 255 }), // ledger: id файла після запису в Drive
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Один файл на слот (Architecture §4): повторне завантаження замінює, історії версій немає.
    uniqueIndex("submissions_application_slot_unique").on(table.applicationId, table.slot),
  ],
);
