# UpDoc — інструкції для агентів

## Проєкт

- **Продукт:** збір і перевірка HR-документів нових працівників: заявка → мобільна форма за унікальним посиланням → AI-assessment → пофайловий запис у Google Drive Shared Drive.
- **Нотатки проєкту (Obsidian):** `~/Documents/Pavlo-obs/Projects/UpDoc/` — коренева: `UpDoc product.md`; плани: `Phases/Implementation Roadmap — UpDoc.md`, `Phases/TB-0 — Tracer Bullet.md`. Перед роботою над кодом — звірятися з TB-0.
- **Репозиторій:** https://github.com/shepitchakpavlo/updoc (private). Локальний клон: ця директорія.

## Стан (2026-08-12)

- **Фаза:** TB-0 (tracer bullet) — наскрізний зріз: заявка → лінк → React+Vite форма → upload/preflight → мок-assessment (за контрактом `AssessmentProvider`) → policy-gate → пофайловий запис у Drive з ledger.
- **Свідомо поза TB-0:** реальний hosted vision-виклик (провайдер перевірено поза системою; інтеграція — Phase 1), R2/MinIO, деплой на Render, OAuth, панель оператора, Uppy, IBAN, expiry, retention.
- **Стек:** TypeScript monorepo — `apps/api` (Fastify + Drizzle), `apps/web` (React + Vite), Postgres у `docker-compose` (dev — MinIO як S3-емулятор), `Makefile` (`make dev` — одна команда).

## Правила

- **Агент-зручність:** усе в репо; після bootstrap жодних кроків поза git. Міграції БД — через `drizzle-kit`.
- **PII-безпека:** жодних токенів, файлів і значень персональних даних у логах, комітах і звітах. Тестові файли з реальними документами — поза репо.
- **Контракти архітектури стабільні:** `AssessmentProvider`, `TemporaryStorage`, `FinalDestination` — межі не змінюються без оновлення `Tech/Architecture — UpDoc MVP.md`.
- Зміни в нотатках проєкту (Obsidian) — лише після узгодження з користувачем.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
