# updoc

UpDoc — збір і перевірка HR-документів нових працівників: заявка → мобільна форма за посиланням → AI-assessment → пофайловий запис у Google Drive.

## Локальний запуск

```sh
npm install
make dev
```

`make dev` — одна команда: Postgres + MinIO (docker compose, `--wait` до healthy), міграції drizzle-kit, dev-сервери API (`http://localhost:3000`, health — `GET /healthz`) і web (`http://localhost:5173`).

Інші цілі Makefile: `make typecheck | test | build | db-generate | db-migrate | down`.
