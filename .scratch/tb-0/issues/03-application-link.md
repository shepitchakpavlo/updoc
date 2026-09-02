# 03 — Application + link

**What to build:** оператор створює заявку простим шляхом (ендпоінт або скрипт, без панелі): компанія + ПІБ → випадковий токен доступу (у БД лише його hash) → папка «ПІБ — Компанія» одразу створюється в тестовому Drive → посилання за токеном віддає дані заявки для форми.

**Blocked by:** 01, 02

**Status:** resolved

- [x] Створення заявки повертає унікальний лінк із токеном
- [x] У БД зберігається лише hash токена
- [x] Папка «ПІБ — Компанія» створюється в тестовій папці Drive (сервісний акаунт Павла, тестовий Drive — не Shared Drive клієнтки)
- [x] Існуюча папка для іншої заявки → hard error без суфіксів (рішення Architecture §6)
- [x] GET за токеном віддає компанію, ПІБ і чекліст; невідомий/невалідний токен → 404
- [x] Секрети сервісного акаунта — поза репо (локальний .env / secret file)

## Answer

Реалізовано (apps/api):

- `POST /applications` — `{ company, fullName }` → `201 { link }`, де `link = {APP_BASE_URL}/a/{token}`; токен — 256 біт base64url, у БД лише sha256-hex (`token_hash`, унікальний індекс з тикета 02). Існуюча папка «ПІБ — Компанія» в тестовій папці Drive → `409 { error: "folder_exists" }` без суфіксів; повторна перевірка після створення закриває гонку конкурентних створень (дублікат видаляється, hard error). Збій запису в БД → бест-еффорт видалення щойно створеної папки.
- `GET /applications/access` — токен у заголовку `x-access-token` (не в URL — щоб не потрапляв у логи запитів) → `{ company, fullName, checklist }`; чекліст — константа `BOOKLET_SLOTS` (книжечка: 1-2, 11-12, 13-14, 15-16). Невідомий/невалідний/відсутній токен → 404.
- Drive-адаптер (`src/drive/client.ts`): сервісний акаунт (JWT RS256 → access token, scope `drive.file`, кешування), операції find/create/delete папки; помилки без PII в повідомленнях.
- Секрети: JSON-ключ акаунта поза репо; `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_DRIVE_TEST_FOLDER_ID` (і `APP_BASE_URL`) у `.env` (завантажується через dotenv) / `.env.example`.

Контракт для тикета 05 (SPA-форма): лінк `/a/{token}` має рендерити форму; дані заявки SPA бере з `GET /applications/access` із заголовком `x-access-token`.

Верифікація: 28 тестів (routes/service/drive-client/tokens — node:test + tsx, seams: fake service/repo/drive/fetch), `make typecheck` і `make build` чисті. Реальний Drive-виклик не виконувався (потрібні живі секрети; наскрізний прогін — тикет 09).
