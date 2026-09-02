import { BOOKLET_SLOTS, type BookletSlot } from "../checklist.js";
import type { AssessmentProvider, AssessmentResult } from "./provider.js";

// Мок AssessmentProvider (тикети 06, 07): детермінований прийом/відхилення.
// Правило (той самий файл → той самий результат):
//   1) файл < MIN_READABLE_SIZE — нечитабельний, відхиляється з причиною;
//   2) інакше мок «розпізнає» у вмісті файла маркер
//      `mock:slot=<слот>[;<модифікатор>]` (підрядок у байтах; <слот> — один із
//      слотів чекліста):
//      - маркера немає або слот невідомий — файл не схожий на сторінки
//        книжечки, відхиляється;
//      - маркер є — приймається: recognizedSlot = <слот>, критичні поля
//        з високим confidence;
//      - модифікатор `uncertain` — поля і загальний confidence низькі
//        (невпевнений результат policy не приймає, Architecture §6);
//      - модифікатор `missing-fields` — частина критичних полів не розпізнана.
// Формат результату — як у реального hosted vision-виклику (Phase 1 підмінить
// цю реалізацію без змін ядра); рішення над результатом приймає policy.

/** Мінімальний «читабельний» розмір файла — stand-in порога якості розпізнавання. */
export const MIN_READABLE_SIZE = 4 * 1024; // 4KB

/** Маркер у вмісті файла: `mock:slot=<слот>[;<модифікатор>]`. */
export const SLOT_MARKER = "mock:slot=";
export const UNCERTAIN_MODIFIER = "uncertain";
export const MISSING_FIELDS_MODIFIER = "missing-fields";

const SMALL_FILE_REASON = "Файл замалий для розпізнавання — перезавантажте документ, будь ласка";
const NOT_BOOKLET_REASON = "Файл не схожий на сторінки книжечки — перезавантажте документ, будь ласка";

// Результат для прийнятого файла: критичні поля (ПІБ, номер документа, дата
// народження — ті, що перевіряє policy, тикет 07) з високим confidence.
// Значення синтетичні: мок нічого не розпізнає, реальних даних не створює.
function acceptedResult(slot: BookletSlot): AssessmentResult {
  return {
    accepted: true,
    reason: null,
    recognizedSlot: slot,
    recognizedFields: {
      fullName: { value: "Тестовий Працівник", confidence: 0.97 },
      documentNumber: { value: "AA000000", confidence: 0.95 },
      birthDate: { value: "1990-01-01", confidence: 0.96 },
    },
    confidence: 0.96,
  };
}

// Невпевнений результат: провайдер «бачить» документ, але confidence низький —
// policy відхилить його (Architecture §6: невпевнений результат не приймається).
function uncertainResult(slot: BookletSlot): AssessmentResult {
  return {
    accepted: true,
    reason: null,
    recognizedSlot: slot,
    recognizedFields: {
      fullName: { value: "Тестовий Працівник", confidence: 0.5 },
      documentNumber: { value: "AA000000", confidence: 0.45 },
      birthDate: { value: "1990-01-01", confidence: 0.5 },
    },
    confidence: 0.5,
  };
}

// Часткове розпізнавання: частина критичних полів не розпізнана — policy
// відхилить із переліком полів у причині.
function missingFieldsResult(slot: BookletSlot): AssessmentResult {
  return {
    accepted: true,
    reason: null,
    recognizedSlot: slot,
    recognizedFields: {
      fullName: { value: "Тестовий Працівник", confidence: 0.97 },
      documentNumber: { value: "AA000000", confidence: 0.4 },
    },
    confidence: 0.96,
  };
}

// Результат для відхиленого файла: причина — готовий feedback, полів і слота
// немає, confidence 0 (невпевнений результат policy не приймає, Architecture §6).
const REJECTED: AssessmentResult = {
  accepted: false,
  reason: SMALL_FILE_REASON,
  recognizedSlot: null,
  recognizedFields: {},
  confidence: 0,
};

interface Recognition {
  slot: BookletSlot;
  uncertain: boolean;
  missingFields: boolean;
}

// «Розпізнавання» маркера у вмісті: перший `mock:slot=` у байтах, решта рядка
// до кінця/переносу — `<слот>[;<модифікатор>...]`. Невідомий слот або відсутній
// маркер — null (документ не розпізнано). Модифікатори не залежать від порядку;
// uncertain має пріоритет над missing-fields, якщо задані обидва.
function recognize(file: Buffer): Recognition | null {
  const start = file.indexOf(SLOT_MARKER);
  if (start === -1) {
    return null;
  }
  let end = file.indexOf(0x0a, start);
  if (end === -1) {
    end = file.length;
  }
  const line = file.subarray(start + SLOT_MARKER.length, end).toString("latin1").trim();
  const [slotToken, ...modifiers] = line.split(";").map((part) => part.trim());
  if (slotToken === undefined || !(BOOKLET_SLOTS as readonly string[]).includes(slotToken)) {
    return null;
  }
  return {
    slot: slotToken as BookletSlot,
    uncertain: modifiers.includes(UNCERTAIN_MODIFIER),
    missingFields: modifiers.includes(MISSING_FIELDS_MODIFIER),
  };
}

export function createMockAssessmentProvider(): AssessmentProvider {
  return {
    async assess(file) {
      if (file.length < MIN_READABLE_SIZE) {
        return REJECTED;
      }
      const recognized = recognize(file);
      if (recognized === null) {
        return { ...REJECTED, reason: NOT_BOOKLET_REASON };
      }
      if (recognized.uncertain) {
        return uncertainResult(recognized.slot);
      }
      if (recognized.missingFields) {
        return missingFieldsResult(recognized.slot);
      }
      return acceptedResult(recognized.slot);
    },
  };
}
