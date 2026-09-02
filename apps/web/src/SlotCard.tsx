import type { ChangeEvent } from "react";
import type { SubmissionStatus } from "./api";
import { SLOT_STATUS_LABELS } from "./status";

export interface SlotCardProps {
  slot: string;
  status: SubmissionStatus;
  feedback: string | null;
  busy: boolean;
  onFile(file: File): void;
}

// Один слот чекліста (тикет 05): мітка, стан, вибір одного файла; повторне
// завантаження замінює попередній файл (Architecture §4). Фідбек від API —
// причина, коли файл треба перезавантажити, або помилка upload.
export function SlotCard({ slot, status, feedback, busy, onFile }: SlotCardProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Скидаємо value, щоб повторний вибір того самого файла теж спрацював (change).
    input.value = "";
    if (file !== undefined) {
      onFile(file);
    }
  }

  // Дефіс у ключі слота (1-2) — у мітці типографічне тире (1–2).
  const label = slot.replace("-", "–");

  return (
    <section aria-label={`Слоти ${label}`}>
      <h2>Слоти {label}</h2>
      <span role="status">{SLOT_STATUS_LABELS[status]}</span>
      <input type="file" accept=".jpg,.jpeg,.png,.heic,.pdf" disabled={busy} onChange={handleChange} />
      {busy ? <p>Завантаження…</p> : null}
      {feedback !== null ? <p role="alert">{feedback}</p> : null}
    </section>
  );
}
