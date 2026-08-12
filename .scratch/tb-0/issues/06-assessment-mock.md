# 06 — Assessment mock

**What to build:** контракт `AssessmentProvider` і мок-реалізація: детермінований прийом/відхилення за простим правилом, результат у тому самому форматі, що й реальний виклик (accepted/rejected, причина, recognized fields, confidence), зберігається в assessment JSON сабмішна. Реальний hosted vision-виклик — Phase 1 (провайдер уже перевірено поза системою).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Контракт `AssessmentProvider` відповідає Architecture §5
- [ ] Мок детермінований: той самий файл → той самий результат
- [ ] Результат у форматі реального виклику, зберігається в assessment JSON submission
- [ ] Стан submission: «перевіряється» → «прийнято» / «потрібно перезавантажити»
- [ ] Межа контракту не змінюється — Phase 1 підмінить мок реальним провайдером без змін ядра
