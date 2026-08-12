// Контракт AssessmentProvider (Architecture §5): один hosted vision-виклик —
// оцінка якості, відповідності слоту і розпізнавання полів. Результат — у
// форматі реального виклику: accepted/rejected, причина, recognized fields,
// confidence. Ядро залежить лише від цього інтерфейсу; конкретний провайдер
// (мок у TB-0, hosted vision у Phase 1) підставляється в deps.ts.

export interface RecognizedField {
  value: string;
  confidence: number;
}

export interface AssessmentResult {
  accepted: boolean;
  /** причина відхилення — готовий feedback для працівника; null, коли прийнято */
  reason: string | null;
  recognizedFields: Record<string, RecognizedField>;
  confidence: number;
}

export interface AssessmentProvider {
  /** Один hosted vision-виклик: файл → рішення, причина, поля, confidence. */
  assess(file: Buffer): Promise<AssessmentResult>;
}
