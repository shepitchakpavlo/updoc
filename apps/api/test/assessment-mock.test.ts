import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_READABLE_SIZE, createMockAssessmentProvider } from "../src/assessment/mock.js";

// Seam: мок AssessmentProvider (тикет 06). Контракт Architecture §5 — один
// hosted vision-виклик: accepted/rejected, причина, recognized fields,
// confidence. Мок-правило просте і детерміноване: файл ≥ MIN_READABLE_SIZE
// вважається читабельним (приймається), менший — відхиляється з причиною.
// Той самий файл завжди дає той самий результат.

const provider = createMockAssessmentProvider();

// Очікувані значення — незалежні літерали контракту (не переобчислені кодом):
// формат результату реального виклику, як його поверне hosted vision у Phase 1.
const ACCEPTED_RESULT = {
  accepted: true,
  reason: null,
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
  recognizedFields: {},
  confidence: 0,
} as const;

test("читабельний файл (≥ мінімального розміру) приймається: причина null, критичні поля, confidence", async () => {
  const result = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE, 0xab));
  assert.deepEqual(result, ACCEPTED_RESULT);
});

test("межа: файл рівно мінімального розміру приймається", async () => {
  const result = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE));
  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
});

test("замалий файл відхиляється: зрозуміла причина (feedback), без розпізнаних полів", async () => {
  const result = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE - 1));
  assert.deepEqual(result, REJECTED_RESULT);
  assert.ok(result.reason && result.reason.length > 0, "причина — готовий feedback для працівника");
});

test("детермінованість: той самий файл → той самий результат", async () => {
  const file = Buffer.from("однаковий вміст файла для двох викликів");
  assert.deepEqual(await provider.assess(file), await provider.assess(file));
});

test("різні файли: результат залежить лише від розміру — правило просте і стабільне", async () => {
  const small = await provider.assess(Buffer.alloc(100));
  const large = await provider.assess(Buffer.alloc(MIN_READABLE_SIZE * 2));
  assert.equal(small.accepted, false);
  assert.equal(large.accepted, true);
});
