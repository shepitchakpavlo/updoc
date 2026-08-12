# TB-0 — Tracer Bullet: спека

Конденсована копія «TB-0 — Tracer Bullet.md» (canonical: `~/Documents/Pavlo-obs/Projects/UpDoc/Phases/TB-0 — Tracer Bullet.md`). Перед роботою над кодом — звірятися з canonical і `Tech/Architecture — UpDoc MVP.md`.

## Мета

Перший постріл через усі компоненти: заявка → лінк → форма → upload → preflight → assessment (мок) → policy → пофайловий запис у Drive. Ланцюжок без зовнішніх залежностей: hosted vision перевірено поза системою, assessment замокано, реальний виклик — Phase 1.

## Входить

- Scaffold: monorepo TS, `apps/api` (Fastify + Drizzle), `apps/web` (React + Vite), Postgres у docker-compose, `make dev`, AGENTS.md
- SPA: мінімальна форма працівника; чекліст фіксований на книжечці (слоти 1–2, 11–12, 13–14, 15–16)
- Схема: `applications` (компанія, ПІБ, token_hash, folder_id) + `submissions` (слот, checksum, стан, assessment JSON, drive_file_id). Слоти політики — константа коду. `expires_at`/`storage_key` — Phase 1
- Створення заявки простим шляхом (ендпоінт або скрипт): папка `ПІБ — Компанія` у Drive одразу, токен випадковий (у БД лише hash)
- Upload: multipart + preflight (декодування, розмір, MIME за magic bytes, сторінки PDF); файл у пам'яті процесу; `TemporaryStorage` — лише контракт
- `AssessmentProvider`: мок за контрактом — детермінований прийом/відхилення; результат у форматі реального виклику
- Policy: gate на 3 критичні поля + відповідність слоту; reasons → feedback
- `FinalDestination`: пофайловий запис у папку заявки з ledger (drive_file_id)
- Перший прогін — API-скриптом; SPA — smoke (один ручний прохід)
- Тестовий Drive: сервісний акаунт Павла, тестова папка (не Shared Drive клієнтки)
- Локальний зріз (docker-compose); деплой — Phase 1

## Не входить (TB-0)

Реальний hosted vision-виклик, регресійний корпус, R2/MinIO і реалізація `TemporaryStorage`, деплой на Render, OAuth, панель оператора, Uppy, IBAN, вибір типу документа в UI, expiry/cleanup, retention, сповіщення, polish UI.

## Стабільні контракти (Architecture §5)

- `AssessmentProvider` — один hosted vision-виклик: `accepted/rejected`, причина, recognized fields, confidence
- `TemporaryStorage` — `put/read/delete` до запису в Drive (в TB-0 не реалізується)
- `FinalDestination` — ідемпотентний запис файла в папку заявки у Shared Drive

Межі не змінюються без оновлення Architecture.

## DoD — гейт у Phase 1

- Наскрізний ланцюжок працює локально: заявка → лінк → форма → upload → мок-assessment → пофайловий запис у Drive
- Ручний прохід SPA: прийнятий файл з'являється в тестовій папці Drive; відхилений — ніколи, з поясненням
- Повторний запис після технічного збою не створює дублікатів (ledger)
- План Phase 1 підтверджено; невирішених зовнішніх залежностей немає

## Правила

- PII-безпека: жодних токенів/файлів/PII у логах, комітах, звітах; тестові файли з реальними документами — поза репо; секрети сервісного акаунта — поза репо
- Міграції БД — через drizzle-kit
- Зміни в нотатках Obsidian — лише після узгодження з користувачем
