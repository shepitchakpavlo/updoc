import type { AssessmentResult } from "../assessment/provider.js";
import type { BookletSlot } from "../checklist.js";

// Policy-gate (тикет 07): рішення над нормалізованим результатом assessment.
// Чистий модуль: знає лише контракт AssessmentResult (Architecture §5) і
// очікуваний слот — не знає про конкретного провайдера (мок чи hosted vision
// у Phase 1). Правило (Architecture §6): приймається лише читабельний файл
// відповідного слота, у якому критичні поля розпізнані з достатнім
// confidence; невпевнений результат не приймається. Кожен reject повертає
// зрозумілу причину — готовий feedback для працівника (Architecture §2).

/** Мінімальний confidence критичного поля («достатній confidence», §6). */
export const MIN_FIELD_CONFIDENCE = 0.9;

/** Мінімальний загальний confidence результату; нижче — «невпевнений», не приймається (§6). */
export const MIN_RESULT_CONFIDENCE = 0.9;

// Критичні поля (Architecture §6): ключ у recognizedFields + людська назва
// для фідбека. Решта полів — best-effort, у гейт не входять.
export const CRITICAL_FIELDS = [
  { key: "fullName", label: "ПІБ" },
  { key: "documentNumber", label: "номер документа" },
  { key: "birthDate", label: "дата народження" },
] as const;

export interface PolicyDecision {
  accepted: boolean;
  /** причина відхилення — готовий feedback для працівника; null, коли прийнято */
  reason: string | null;
}

// Страховка, якщо провайдер відхилив без причини (контракт обіцяє причину,
// але рішення policy має бути зрозумілим за будь-якого результату).
const UNKNOWN_REJECT_REASON = "Файл не прийнято — перезавантажте документ, будь ласка";

export function decidePolicy(expectedSlot: BookletSlot, result: AssessmentResult): PolicyDecision {
  // Провайдер уже відхилив (наприклад, нечитабельний файл): його причина —
  // найточніший feedback, передаємо як є.
  if (!result.accepted) {
    return { accepted: false, reason: result.reason ?? UNKNOWN_REJECT_REASON };
  }
  // Відповідність слоту: розпізнаний слот має збігатися з очікуваним
  // («читабельний файл відповідного слота», §6); null — документ не розпізнано.
  if (result.recognizedSlot !== expectedSlot) {
    return {
      accepted: false,
      reason: `Файл не відповідає слоту «${expectedSlot}» — перезавантажте документ для цього слота, будь ласка`,
    };
  }
  // Architecture §6: невпевнений результат не приймається.
  if (result.confidence < MIN_RESULT_CONFIDENCE) {
    return {
      accepted: false,
      reason: "Розпізнавання недостатньо впевнене — перезавантажте документ, будь ласка",
    };
  }
  // Критичні поля: кожне має бути розпізнане (непорожнє значення) з достатнім
  // confidence; причину формуємо з людських назв усіх слабких полів.
  const weakFields = CRITICAL_FIELDS.filter(({ key }) => {
    const field = result.recognizedFields[key];
    return field === undefined || field.value.trim().length === 0 || field.confidence < MIN_FIELD_CONFIDENCE;
  });
  if (weakFields.length > 0) {
    return {
      accepted: false,
      reason: `Не вдалося впевнено розпізнати: ${weakFields.map((field) => field.label).join(", ")} — перезавантажте документ, будь ласка`,
    };
  }
  return { accepted: true, reason: null };
}
