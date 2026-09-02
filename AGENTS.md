# UpDoc — інструкції для агентів

## Проєкт

- **Продукт:** збір і перевірка HR-документів нових працівників: заявка → мобільна форма за унікальним посиланням → AI-assessment → пофайловий запис у Google Drive Shared Drive.
- **Нотатки проєкту (Obsidian):** `~/Documents/Pavlo-obs/Projects/UpDoc/` — коренева: `UpDoc product.md`; плани: `Phases/Implementation Roadmap — UpDoc.md`, `Phases/TB-0 — Tracer Bullet.md`. Перед роботою над кодом — звірятися з TB-0.
- **Репозиторій:** https://github.com/shepitchakpavlo/updoc (public). Локальний клон: ця директорія.

## Стан (2026-08-12)

- **Фаза:** TB-0 (tracer bullet) — наскрізний зріз: заявка → лінк → React+Vite форма → upload/preflight → мок-assessment (за контрактом `AssessmentProvider`) → policy-gate → пофайловий запис у Drive з ledger.
- **Свідомо поза TB-0:** реальний hosted vision-виклик (провайдер перевірено поза системою; інтеграція — Phase 1), R2/MinIO, деплой на Render, OAuth, панель оператора, Uppy, IBAN, expiry, retention.
- **Стек:** TypeScript monorepo — `apps/api` (Fastify + Drizzle), `apps/web` (React + Vite), Postgres у `docker-compose` (dev — MinIO як S3-емулятор), `Makefile` (`make dev` — одна команда).

## Розробка

- Bootstrap: `npm install` у корені репо, далі `make dev` — одна команда: docker compose (Postgres + MinIO) → міграції drizzle-kit → dev-сервери API (`:3000`, health — `GET /healthz`) і web (`:5173`).
- Команди: `make typecheck`, `make test`, `make build`, `make db-generate`, `make db-migrate`, `make down`. Міграції БД — лише через `db-generate`/`db-migrate` (drizzle-kit).
- Дефолти працюють без `.env`: `DATABASE_URL=postgres://updoc:updoc@localhost:5432/updoc` (docker-compose.yml, drizzle.config.ts); перевизначення — `.env` (див. `.env.example`).

## Правила

- **Агент-зручність:** усе в репо; після bootstrap жодних кроків поза git. Міграції БД — через `drizzle-kit`.
- **PII-безпека:** жодних токенів, файлів і значень персональних даних у логах, комітах і звітах. Тестові файли з реальними документами — поза репо.
- **Контракти архітектури стабільні:** `AssessmentProvider`, `TemporaryStorage`, `FinalDestination` — межі не змінюються без оновлення `Tech/Architecture — UpDoc MVP.md`.
- Зміни в нотатках проєкту (Obsidian) — лише після узгодження з користувачем.

## Pre-commit gates (обов'язкові для кожного запуску агента)

Перед комітом кодової зміни ВИКОНАЙ реальними командами (глобальний шаблон — у `~/.config/opencode/rules/pre-commit-gates.md`; тут — конкретика цього проєкту):

1. **PII/логи:** сирий access token не може бути в логах. Роути мають токен у URL — Fastify logger має redact (`["req.url","req.headers","res"]`) або бути вимкненим. Перевірка: `grep -n "logger" apps/api/src/app.ts`
2. **Web-тести:** `apps/web` має хоча б один тестовий файл; root `test` скрипт запускає тести обох воркспейсів (`--workspaces`)
3. **Build:** root `build` скрипт існує і `npm run build` проходить
4. **Typecheck + тести:** `npm run typecheck` і `npm test` — обидва зелені
5. **Звіт:** при завершенні тікета напиши `.ab-gates.md` — що перевірив/виправив per gate

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
