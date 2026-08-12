# 08 — Drive write + ledger

**What to build:** `FinalDestination`: пофайловий запис **лише прийнятого** файла в папку заявки в тестовому Drive; ledger `drive_file_id` у submission; повторний запис після технічного збою не створює дублікатів. `TemporaryStorage` у TB-0 не реалізується (контракт лише; файл — у пам'яті процесу).

**Blocked by:** 03, 07

**Status:** resolved

- [x] Прийнятий файл з'являється в папці заявки в тестовому Drive
- [x] Відхилений файл ніколи не потрапляє в Drive
- [x] `drive_file_id` записано в submission (ledger)
- [x] Retry після змодельованого збою не створює дублікатів (ідемпотентність, Architecture §6)
- [x] Файл пише backend з обмеженим доступом до root folder тестового Drive

## Answer

Реалізовано (apps/api; web не змінювався — контракт відповіді той самий):

- **Контракт `FinalDestination`** (`src/drive/final-destination.ts`, Architecture §5): `writeFile({ folderId, slot, mimeType, data }) → id файла`. Реалізація `createDriveFinalDestination` — ідемпотентний запис у папку заявки: файли слота в папці шукаються за префіксом імені (`слот.`), пізнавання — за MD5 вмісту (рахують сервери Drive, зіставляємо з локальним md5 байтів). Той самий вміст → перевикористання наявного id, `createFile` не викликається (retry після збою ledger/відповіді не створює дублікатів). Заміна файла слота (зокрема іншим форматом — JPG→PDF) створює новий і прибирає стару версію — Architecture §4: один файл на слот, історії версій немає; прибирання бест-еффорт і create-first (збій видалення не втрачає щойно записаний файл; наступний запис слота дочистить). Конкурентні записи того самого слота всередині процесу (подвійний сабміт, паралельний retry) серіалізуються замком на `(folderId, slot)` — Drive не має умовного створення, find-then-create не атомарний; збій попереднього запису не блокує наступний. Міжпроцесова ідемпотентність — Phase 1 (стан «помилка Drive» + retry з панелі, Architecture §7).
- **DriveClient розширено** (`src/drive/client.ts`): `listFilesInFolder` (id+ім'я+md5Checksum, q лише по папці заявки), `createFile` (media upload `uploadType=multipart` на окремий host; multipart/related: metadata JSON + байти; ім'я — `слот.розширення`, без PII), `deleteFile`; auth/формат помилок — спільні через `driveFetch`.
- **Сервіс** (`submissions/service.ts`): після рішення policy лише при `accepted` викликається `finalDestination.writeFile({ folderId: application.folderId, ... })`; повернутий id — у фінальний upsert як `drive_file_id` (ledger). Відхилений/іншого слота файл — `needs_reupload` без жодного запису в Drive. Збій запису в Drive — технічна помилка, не reject: файл лишається у «перевіряється» для безпечного retry (Architecture §6). `deps.ts` — `createDriveFinalDestination({ drive })`.
- **Обмежений доступ (критерій 5):** той самий сервісний акаунт зі scope `drive.file` (тикет 03); усі файлові операції йдуть лише в папку заявки під тестовою папкою (`folder_id` із БД, записів поза нею немає); імена файлів без PII, PII не потрапляє в логи. Живий Drive-виклик із реальними секретами — наскрізний прогін тикета 09.

Верифікація: 108 API-тестів (node:test + tsx; нові: 3 тести drive-client на файлові операції + 9 тестів FinalDestination + 5 тестів потоку Drive в сервісі, зокрема retry після змодельованого збою ledger через реальний FinalDestination над in-memory Drive) і 17 web-тестів (vitest) — усі зелені; `make typecheck` і `make build` чисті. Селф-рев'ю за skills (code-review, дві осі — Standards/Spec): виправлено знахідку Spec (заміна формату лишала стару версію — тепер префіксний пошук слота) і гонку find-then-create (замок + тести); зауваження-судження Standards враховано (спільний auth/помилки через `driveFetch`, єдине прибирання версій, змістовні імена). Міграцій БД не було (колонка `drive_file_id` вже в схемі тикета 02). Нотатки Obsidian не змінювалися; зміни Architecture не потрібні — §4/§5/§6 реалізовано як є. Довготривалі сервіси не запускалися.
