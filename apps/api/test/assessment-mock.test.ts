import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKLET_SLOTS } from "../src/checklist.js";
import {
  MISSING_FIELDS_MODIFIER,
  SLOT_MARKER,
  UNCERTAIN_MODIFIER,
  MIN_READABLE_SIZE,
  createMockAssessmentProvider,
} from "../src/assessment/mock.js";

// Seam: мок AssessmentProvider (тикети 06, 07). Контракт Architecture §5 — один
// hosted vision-виклик: accepted/rejected, причина, розпізнаний слот,
// recognized fields, confidence. Мок-правило просте і детерміноване:
//   1) файл < MIN_READABLE_SIZE — нечитабельний, відхиляється з причиною;
//   2) інакше мок «розпізнає» у вмісті файла маркер
//      `mock:slot=<слот>[;<модифікатор>]` (підрядок у байтах; <слот> — один із
//      слотів чекліста):
//      - маркера немає або слот невідомий — файл не схожий на сторінки
//        книжечки, відхиляється;
//      - маркер є — приймається: recognizedSlot = <слот>, критичні поля
//        з високим confidence (значення синтетичні — мок нічого не розпізнає);
//      - модифікатор `uncertain` — поля і загальний confidence низькі
//        (невпевнений результат policy не приймає, Architecture §6);
//      - модифікатор `missing-fields` — частина критичних полів не розпізнана.
// Той самий файл завжди дає той самий результат.

const provider = createMockAssessmentProvider();

function fileWith(marker: string, size = MIN_READABLE_SIZE): Buffer {
  // Маркер у вмісті файла (після "signature"): preflight бачить лише magic
  // bytes, вміст мок читає підрядком — формат файла неважливий. Рядок маркера
  // завершується переносом, щоб заповнювач не потрапив у «розпізнаний» рядок.
  const markerLine = `${marker}\n`;
  return Buffer.concat([
    Buffer.from("SIG"),
    Buffer.from(markerLine),
    Buffer.alloc(Math.max(0, size - 3 - markerLine.length), 0xab),
  ]);
}

// Очікувані значення — незалежні літерали контракту (не переобчислені кодом):
// формат результату реального виклику, як його поверне hosted vision у Phase 1.
const ACCEPTED_SLOT_1_2 = {
  accepted: true,
  reason: null,
  recognizedSlot: "1-2",
  recognizedFields: {
    fullName: { value: "Тестовий Працівник", confidence: 0.97 },
    documentNumber: { value: "AA000000", confidence: 0.95 },
    birthDate: { value: "1990-01-01", confidence: 0.96 },
  },
  confidence: 0.96,
} as const;

const REJECTED_RESULT = {
  accepted: false,
  reason: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
  recognizedSlot: null,
  recognizedFields: {},
  confidence: 0,
} as const;

test("читабельний файл із маркером слота приймається: причина null, слот, критичні поля, confidence", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}1-2`));
  assert.deepEqual(result, ACCEPTED_SLOT_1_2);
});

test("межа: файл рівно мінімального розміру з маркером приймається", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}11-12`));
  assert.equal(result.accepted, true);
  assert.equal(result.recognizedSlot, "11-12");
  assert.equal(result.reason, null);
});

test("розпізнаний слот береться з маркера: кожен слот чекліста розпізнається", async () => {
  for (const slot of BOOKLET_SLOTS) {
    const result = await provider.assess(fileWith(`${SLOT_MARKER}${slot}`));
    assert.equal(result.accepted, true, slot);
    assert.equal(result.recognizedSlot, slot, slot);
  }
});

test("замалий файл відхиляється: зрозуміла причина (feedback), без полів і слота", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}1-2`, MIN_READABLE_SIZE - 1));
  assert.deepEqual(result, REJECTED_RESULT);
  assert.ok(result.reason && result.reason.length > 0, "причина — готовий feedback для працівника");
});

test("читабельний файл без маркера відхиляється: не схожий на сторінки книжечки", async () => {
  const result = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE, 0xab));
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /книжечк/);
});

test("читабельний файл із невідомим слотом у маркері відхиляється", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}3-4`));
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /книжечк/);
});

test("модифікатор uncertain: низький confidence — policy відхилить як невпевнений", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}1-2;${UNCERTAIN_MODIFIER}`));
  assert.equal(result.accepted, true, "провайдер «бачить» документ, але невпевнено");
  assert.equal(result.recognizedSlot, "1-2");
  assert.ok(result.confidence < 0.9, "загальний confidence нижче порога policy");
  for (const field of Object.values(result.recognizedFields)) {
    assert.ok(field.confidence < 0.9, "поля теж невпевнені");
  }
});

test("модифікатор missing-fields: частина критичних полів не розпізнана", async () => {
  const result = await provider.assess(fileWith(`${SLOT_MARKER}13-14;${MISSING_FIELDS_MODIFIER}`));
  assert.equal(result.accepted, true);
  assert.equal(result.recognizedSlot, "13-14");
  assert.ok(result.recognizedFields.fullName, "ПІБ розпізнано");
  assert.equal(result.recognizedFields.birthDate, undefined, "дата народження відсутня");
});

test("детермінованість: той самий файл → той самий результат", async () => {
  const file = fileWith(`${SLOT_MARKER}15-16`);
  assert.deepEqual(await provider.assess(file), await provider.assess(file));
});

test("різний вміст — різні результати: правило залежить від розпізнаного вмісту", async () => {
  const accepted = await provider.assess(fileWith(`${SLOT_MARKER}1-2`));
  const rejected = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE * 2, 0xab));
  assert.equal(accepted.accepted, true);
  assert.equal(rejected.accepted, false);
});
