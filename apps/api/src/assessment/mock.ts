import type { AssessmentProvider, AssessmentResult } from "./provider.js";

// Мок AssessmentProvider (тикет 06): детермінований прийом/відхилення за
// простим правилом — файл менше MIN_READABLE_SIZE вважається нечитабельним
// і відхиляється, решта приймається. Той самий файл → той самий результат.
// Формат результату — як у реального hosted vision-виклику (Phase 1 підмінить
// цю реалізацію без змін ядра).

/** Мінімальний «читабельний» розмір файла — stand-in порога якості розпізнавання. */
export const MIN_READABLE_SIZE = 4 * 1024; // 4KB

// Результат для прийнятого файла: критичні поля (ПІБ, номер документа, дата
// народження — ті, що перевіряє policy, тикет 07) з високим confidence.
// Значення синтетичні: мок нічого не розпізнає, реальних даних не створює.
const ACCEPTED: AssessmentResult = {
  accepted: true,
  reason: null,
  recognizedFields: {
    fullName: { value: "Тестовий Працівник", confidence: 0.97 },
    documentNumber: { value: "AA000000", confidence: 0.95 },
    birthDate: { value: "1990-01-01", confidence: 0.96 },
  },
  confidence: 0.96,
};

// Результат для відхиленого файла: причина — готовий feedback, полів немає,
// confidence 0 (невпевнений результат policy не приймає, Architecture §6).
const REJECTED: AssessmentResult = {
  accepted: false,
  reason: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
  recognizedFields: {},
  confidence: 0,
};

export function createMockAssessmentProvider(): AssessmentProvider {
  return {
    async assess(file) {
      return file.length >= MIN_READABLE_SIZE ? ACCEPTED : REJECTED;
    },
  };
}
