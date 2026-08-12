import type { BookletSlot } from "../checklist.js";

// Контракт AssessmentProvider (Architecture §5): один hosted vision-виклик —
// оцінка якості, відповідності слоту і розпізнавання полів. Результат — у
// форматі реального виклику: accepted/rejected, причина, розпізнаний слот,
// recognized fields, confidence. Ядро залежить лише від цього інтерфейсу;
// конкретний провайдер (мок у TB-0, hosted vision у Phase 1) підставляється
// в deps.ts. Рішення над результатом приймає policy (тикет 07) — провайдер
// лише повертає те, що «побачив» у файлі.

export interface RecognizedField {
  value: string;
  confidence: number;
}

export interface AssessmentResult {
  accepted: boolean;
  /** причина відхилення — готовий feedback для працівника; null, коли прийнято */
  reason: string | null;
  /**
   * Слот, який провайдер розпізнав у файлі (Architecture §6: відповідність
   * слота — частина оцінки; перевіряє її policy); null, коли документ
   * не розпізнано.
   */
  recognizedSlot: BookletSlot | null;
  recognizedFields: Record<string, RecognizedField>;
  confidence: number;
}

export interface AssessmentProvider {
  /** Один hosted vision-виклик: файл → рішення, причина, слот, поля, confidence. */
  assess(file: Buffer): Promise<AssessmentResult>;
}
