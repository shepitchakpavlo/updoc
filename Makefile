COMPOSE := docker compose

.PHONY: dev up down db-generate db-migrate typecheck test build

# Одна команда: інфраструктура (Postgres + MinIO) + міграції + dev-сервери API і web.
dev: up db-migrate
	npm run dev

# docker compose піднімає сервіси; --wait чекає на healthy Postgres.
up:
	$(COMPOSE) up -d --wait

down:
	$(COMPOSE) down

# Міграції БД — через drizzle-kit.
db-generate:
	npm run db:generate

db-migrate:
	npm run db:migrate

typecheck:
	npm run typecheck

test:
	npm run test

build:
	npm run build
