// Слоти чекліста TB-0 — фіксовані на книжечці (спека: 1–2, 11–12, 13–14, 15–16).
// Константа коду, не таблиця (Architecture §4); розширення — Phase 1 (вибір типу документа).
export const BOOKLET_SLOTS = ["1-2", "11-12", "13-14", "15-16"] as const;

export type BookletSlot = (typeof BOOKLET_SLOTS)[number];
