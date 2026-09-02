import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { applications, submissions, submissionStatus } from "../src/db/schema.js";

// Контракт схеми (тикет 02): колонки, стани й формат assessment JSON,
// на які спираються тикети 03–08. Очікувані значення — зі спеки TB-0.

test("стани submission покривають очікується / перевіряється / прийнято / потрібно перезавантажити", () => {
  assert.deepEqual(submissionStatus.enumValues, [
    "pending",
    "checking",
    "accepted",
    "needs_reupload",
  ]);
});

test("applications має компанію, ПІБ, token_hash, folder_id і жодної колонки сирого токена", () => {
  const cols = getTableColumns(applications);
  assert.deepEqual(
    Object.keys(cols).sort(),
    ["company", "createdAt", "folderId", "fullName", "id", "tokenHash"].sort(),
  );
  assert.equal(cols.tokenHash.name, "token_hash");
  assert.equal(cols.tokenHash.notNull, true);
  // sha256 hex — незворотний хеш; сирий токен у БД не зберігається (тикет 03 зберігатиме лише hash).
  assert.equal(cols.tokenHash.getSQLType(), "varchar(64)");
});

test("submissions має слот, checksum, стан, assessment JSON і drive_file_id", () => {
  const cols = getTableColumns(submissions);
  assert.deepEqual(
    Object.keys(cols).sort(),
    [
      "applicationId",
      "assessment",
      "checksum",
      "createdAt",
      "driveFileId",
      "id",
      "slot",
      "status",
    ].sort(),
  );
});

test("assessment — структуроване JSONB-поле у форматі AssessmentProvider", () => {
  const cols = getTableColumns(submissions);
  assert.equal(cols.assessment.getSQLType(), "jsonb");
  assert.equal(cols.assessment.notNull, false);
});

test("status — enum-колонка з дефолтом «очікується»", () => {
  const cols = getTableColumns(submissions);
  assert.equal(cols.status.getSQLType(), "submission_status");
  assert.equal(cols.status.notNull, true);
  assert.equal(cols.status.default, "pending");
});
