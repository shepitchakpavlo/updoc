# 06 — Assessment mock

**What to build:** контракт `AssessmentProvider` і мок-реалізація: детермінований прийом/відхилення за простим правилом, результат у тому самому форматі, що й реальний виклик (accepted/rejected, причина, recognized fields, confidence), зберігається в assessment JSON сабмішна. Реальний hosted vision-виклик — Phase 1 (провайдер уже перевірено поза системою).

**Blocked by:** 04

**Status:** resolved

- [x] Контракт `AssessmentProvider` відповідає Architecture §5
- [x] Мок детермінований: той самий файл → той самий результат
- [x] Результат у форматі реального виклику, зберігається в assessment JSON submission
- [x] Стан submission: «перевіряється» → «прийнято» / «потрібно перезавантажити»
- [x] Межа контракту не змінюється — Phase 1 підмінить мок реальним провайдером без змін ядра

## Answer

Реалізовано (apps/api + apps/web):

- Контракт `apps/api/src/assessment/provider.ts`: `AssessmentProvider.assess(file: Buffer): Promise<AssessmentResult>` — один hosted vision-виклик (Architecture §5); `AssessmentResult`/`RecognizedField` перенесено сюди з `db/schema.ts` (JSONB-колонка `submissions.assessment` типується тим самим контрактом, типів у schema не дубльовано).
- Мок `apps/api/src/assessment/mock.ts`: просте детерміноване правило — файл ≥ 4KB читабельний (приймається), менший відхиляється з причиною-feedback; результат у форматі реального виклику: прийнятий — критичні поля (ПІБ, номер документа, дата народження) з високим confidence (синтетичні значення, PII не створюється); відхилений — причина, порожні поля, confidence 0. Phase 1 підмінить `createMockAssessmentProvider()` у `deps.ts` на hosted vision без змін ядра.
- `uploadSlot`: preflight → upsert у стані «перевіряється» (старий assessment/ledger скинуто) → `assessment.assess(file)` → upsert у «прийнято» / «потрібно перезавантажити» з результатом в assessment JSON; збій провайдера — технічна помилка, файл лишається «перевіряється» (не reject, Architecture §6). Відповідь upload тепер містить `feedback` (причина відхилення) — SPA показує її одразу після завантаження.

Верифікація: 67 API-тестів (node:test + tsx; нові: 5 контрактних тестів мока + 4 тести потоку в service) і 17 web-тестів (vitest) — усі зелені; `make typecheck` і `make build` чисті. Селф-рев'ю за skills (code-review, дві осі — Standards/Spec): порушень стандартів і критеріїв тикета немає. Міграцій БД не було (тільки типи). Довготривалі сервіси не запускалися.
