# 08 — Drive write + ledger

**What to build:** `FinalDestination`: пофайловий запис **лише прийнятого** файла в папку заявки в тестовому Drive; ledger `drive_file_id` у submission; повторний запис після технічного збою не створює дублікатів. `TemporaryStorage` у TB-0 не реалізується (контракт лише; файл — у пам'яті процесу).

**Blocked by:** 03, 07

**Status:** ready-for-agent

- [ ] Прийнятий файл з'являється в папці заявки в тестовому Drive
- [ ] Відхилений файл ніколи не потрапляє в Drive
- [ ] `drive_file_id` записано в submission (ledger)
- [ ] Retry після змодельованого збою не створює дублікатів (ідемпотентність, Architecture §6)
- [ ] Файл пише backend з обмеженим доступом до root folder тестового Drive
