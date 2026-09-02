import assert from "node:assert/strict";
import { test } from "node:test";
import { decidePolicy } from "../src/policy/index.js";
import type { AssessmentResult } from "../src/assessment/provider.js";

// Seam: policy-gate (тикет 07) — чиста функція над нормалізованим результатом
// assessment (контракт AssessmentResult) + очікуваним слотом. Policy не знає
// про конкретного провайдера: рішення залежить лише від форми результату.
// Правило (Architecture §6): приймається лише читабельний файл відповідного
// слота з критичними полями (ПІБ, номер документа, дата народження) і
// достатнім confidence; невпевнений результат не приймається; кожен reject
// має зрозумілу причину (feedback для працівника).

// Базовий прийнятний результат — незалежний літерал, не переобчислений кодом.
const ACCEPTED: AssessmentResult = {
  accepted: true,
  reason: null,
  recognizedSlot: "1-2",
  recognizedFields: {
    fullName: { value: "Тестовий Працівник", confidence: 0.97 },
    documentNumber: { value: "AA000000", confidence: 0.95 },
    birthDate: { value: "1990-01-01", confidence: 0.96 },
  },
  confidence: 0.96,
};

test("файл іншого слота відхиляється: причина називає очікуваний слот", () => {
  const decision = decidePolicy("1-2", { ...ACCEPTED, recognizedSlot: "11-12" });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /1-2/);
  assert.ok(decision.reason && decision.reason.length > 0, "причина — готовий feedback");
});

test("слот не розпізнано (null) — файл не приймається, причина про відповідність слоту", () => {
  const decision = decidePolicy("1-2", { ...ACCEPTED, recognizedSlot: null });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /1-2/);
});

test("прийнятний результат відповідного слота приймається без причини", () => {
  const decision = decidePolicy("1-2", ACCEPTED);
  assert.deepEqual(decision, { accepted: true, reason: null });
});

test("усі слоти чекліста проходять гейт, коли файл відповідає слоту", () => {
  for (const slot of ["1-2", "11-12", "13-14", "15-16"] as const) {
    const decision = decidePolicy(slot, { ...ACCEPTED, recognizedSlot: slot });
    assert.equal(decision.accepted, true, slot);
  }
});

test("відхилений провайдером: причина провайдера — feedback як є", () => {
  const decision = decidePolicy("1-2", {
    accepted: false,
    reason: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
    recognizedSlot: null,
    recognizedFields: {},
    confidence: 0,
  });
  assert.deepEqual(decision, {
    accepted: false,
    reason: "Файл замалий для розпізнавання — перезавантажте документ, будь ласка",
  });
});

test("відхилений провайдером без причини: загальна зрозуміла причина", () => {
  const decision = decidePolicy("1-2", { ...ACCEPTED, accepted: false, reason: null });
  assert.equal(decision.accepted, false);
  assert.ok(decision.reason && decision.reason.length > 0);
});

test("невпевнений результат відхиляється (Architecture §6): причина про впевненість", () => {
  const decision = decidePolicy("1-2", { ...ACCEPTED, confidence: 0.5 });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /впевнен/);
});

test("межа загального confidence: рівно поріг приймається", () => {
  const decision = decidePolicy("1-2", { ...ACCEPTED, confidence: 0.9 });
  assert.equal(decision.accepted, true);
});

test("критичне поле з низьким confidence: причина називає поле", () => {
  const decision = decidePolicy("1-2", {
    ...ACCEPTED,
    recognizedFields: { ...ACCEPTED.recognizedFields, documentNumber: { value: "AA000000", confidence: 0.4 } },
  });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /номер документа/);
});

test("відсутнє критичне поле: причина називає його", () => {
  const { birthDate: _birthDate, ...fieldsWithoutBirthDate } = ACCEPTED.recognizedFields;
  const decision = decidePolicy("1-2", { ...ACCEPTED, recognizedFields: fieldsWithoutBirthDate });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /дата народження/);
});

test("порожнє значення критичного поля — не розпізнано: причина називає поле", () => {
  const decision = decidePolicy("1-2", {
    ...ACCEPTED,
    recognizedFields: { ...ACCEPTED.recognizedFields, fullName: { value: "   ", confidence: 0.97 } },
  });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /ПІБ/);
});

test("кілька слабких полів: причина перелічує всі", () => {
  const decision = decidePolicy("1-2", {
    ...ACCEPTED,
    recognizedFields: { fullName: { value: "Тестовий Працівник", confidence: 0.97 } },
  });
  assert.equal(decision.accepted, false);
  assert.match(decision.reason ?? "", /номер документа/);
  assert.match(decision.reason ?? "", /дата народження/);
});

test("межа confidence поля: рівно поріг приймається", () => {
  const decision = decidePolicy("1-2", {
    ...ACCEPTED,
    recognizedFields: { ...ACCEPTED.recognizedFields, birthDate: { value: "1990-01-01", confidence: 0.9 } },
  });
  assert.equal(decision.accepted, true);
});

test("решта полів не впливає на гейт (best-effort)", () => {
  const decision = decidePolicy("1-2", {
    ...ACCEPTED,
    recognizedFields: { ...ACCEPTED.recognizedFields, additional: { value: "щось", confidence: 0.1 } },
  });
  assert.equal(decision.accepted, true);
});
