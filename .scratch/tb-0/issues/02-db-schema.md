# 02 — DB schema

**What to build:** мінімальна схема БД для заявок і сабмішнів: `applications` (компанія, ПІБ, token_hash, folder_id) і `submissions` (слот, checksum, стан, assessment JSON, drive_file_id). Слоти політики — константа коду, не таблиця. Поля `expires_at` і `storage_key` навмисно не додаються (прийдуть у Phase 1 зі своїми можливостями).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Міграція через drizzle-kit створює `applications` і `submissions`
- [ ] `token_hash` — незворотний хеш; сирий токен у БД не зберігається
- [ ] Стан submission покриває: очікується / перевіряється / прийнято / потрібно перезавантажити
- [ ] assessment JSON — структуроване поле (формат за контрактом `AssessmentProvider`)
- [ ] Міграція ідемпотентна для дев-середовища (перезапуск docker-compose не ламається)
