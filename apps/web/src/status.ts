import type { SubmissionStatus } from "./api";

// Мітки станів слота для UI (тикет 05): очікується / перевіряється /
// прийнято / потрібно перезавантажити (Architecture §4).
export const SLOT_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: "Очікується",
  checking: "Перевіряється",
  accepted: "Прийнято",
  needs_reupload: "Потрібно перезавантажити",
};
