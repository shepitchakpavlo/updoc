# updoc

UpDoc — збір і перевірка HR-документів нових працівників: заявка → мобільна форма за посиланням → AI-assessment → пофайловий запис у Google Drive.

## Локальний запуск

```sh
npm install
make dev
```

`make dev` — одна команда: Postgres + MinIO (docker compose, `--wait` до healthy), міграції drizzle-kit, dev-сервери API (`http://localhost:3000`, health — `GET /healthz`) і web (`http://localhost:5173`).

Інші цілі Makefile: `make typecheck | test | build | db-generate | db-migrate | down`.

## Наскрізний прогін (тикет 09)

За запущеного `make dev` і секретів Drive у `.env` (`GOOGLE_DRIVE_TEST_FOLDER_ID`,
`GOOGLE_APPLICATION_CREDENTIALS`):

```sh
npm run e2e -w @updoc/api            # весь ланцюжок: заявка → лінк → upload →
                                     # мок-assessment → policy → Drive (з перевіркою)
npm run e2e -w @updoc/api -- --spa   # підготовка ручного SPA-проходу: лінк + зразки
```

Тестові файли-зразки генеруються в `os.tmpdir()/updoc-e2e-samples` — поза репо,
ніколи не комітяться. Деталі — `--help` сценарію.
