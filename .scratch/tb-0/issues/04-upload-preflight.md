# 04 — Upload + preflight

**What to build:** завантаження файла на слот за токеном заявки: multipart + preflight (декодування, розмір ≤20MB, MIME за magic bytes, кількість сторінок PDF), файл тримається в пам'яті процесу (`TemporaryStorage` — лише контракт), створюється submission зі станом.

**Blocked by:** 03

**Status:** resolved

- [x] Upload на слот за токеном створює submission (слот, checksum, стан «очікується»/«перевіряється»)
- [x] Формати поза JPG/PNG/HEIC/PDF відкидаються на preflight
- [x] Файл понад 20MB відкидається
- [x] MIME визначається за magic bytes, а не за розширенням
- [x] Для PDF відома кількість сторінок
- [x] Жодних файлів і PII у логах

## Answer

Реалізовано (apps/api):

- `POST /applications/upload` — multipart (`slot` + `file`) за токеном у заголовку `x-access-token` → `201 { slot, checksum, status: "pending", mimeType, pageCount }`. Ім'я файла й content-type part-а не читаються й не логуються: MIME — лише за magic bytes (`src/preflight/detect.ts`), до сервісу доходять тільки токен, слот і байти.
- Preflight (`src/preflight/`): розмір ≤20MB (понад → `413 file_too_large`), формати JPG/PNG/HEIC/PDF за сигнатурами (HEIC — ISO BMFF `ftyp` + бренди `heic/heix/hevc/hevx`; родові `mif1/msf1` і AVIF відкидаються), сторінки PDF — повний розбір через pdf-lib (пошкоджений PDF → `400 invalid_pdf`).
- Submission: upsert на унікальному `(application_id, slot)` — повторне завантаження замінює, `assessment`/`drive_file_id` скидаються (вони належать старому файлу); стан `pending` (тикет 06 переведе в «перевіряється»).
- Файл у пам'яті процесу; `TemporaryStorage` — лише контракт `put/read/delete` у `src/storage.ts` (реалізація — Phase 1).
- Помилки — спільний `ApiError` (`src/errors.ts`, код + HTTP-статус), повідомлення українською без PII; `bodyLimit` Fastify 21MB як запобіжник пам'яті, ліміт файла — лише в preflight.

Контракт для тикета 05 (SPA): форма шле multipart із полем `slot` і файлом, токен у заголовку; фідбек — `error`/`statusCode` тіла відповіді (`file_too_large` 413, `unsupported_format`/`invalid_pdf`/`invalid_slot` 400, `not_found` 404).

Верифікація: 53 тести (preflight/service/routes — node:test + tsx, seam-и: fake repo/service), `make typecheck` і `make build` чисті. Додано залежності: `@fastify/multipart`, `pdf-lib` (обидві pure JS).
