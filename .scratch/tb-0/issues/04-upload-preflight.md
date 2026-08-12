# 04 — Upload + preflight

**What to build:** завантаження файла на слот за токеном заявки: multipart + preflight (декодування, розмір ≤20MB, MIME за magic bytes, кількість сторінок PDF), файл тримається в пам'яті процесу (`TemporaryStorage` — лише контракт), створюється submission зі станом.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Upload на слот за токеном створює submission (слот, checksum, стан «очікується»/«перевіряється»)
- [ ] Формати поза JPG/PNG/HEIC/PDF відкидаються на preflight
- [ ] Файл понад 20MB відкидається
- [ ] MIME визначається за magic bytes, а не за розширенням
- [ ] Для PDF відома кількість сторінок
- [ ] Жодних файлів і PII у логах
