# 01 — Repo scaffold

**What to build:** з нуля до `make dev`: TypeScript monorepo, в якому API (Fastify) і web (React + Vite) піднімаються однією командою разом із Postgres (docker-compose), drizzle-kit підключено, API відповідає на health-check. Фундамент, на якому стоять усі інші тікети.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `make dev` піднімає API, web і Postgres однією командою
- [ ] `/healthz` на API відповідає 200
- [ ] React+Vite dev-сервер відкриває порожню сторінку
- [ ] docker-compose: Postgres + MinIO (S3-емулятор для Phase 1)
- [ ] drizzle-kit підключено (config; порожня міграція застосовується)
- [ ] Makefile, docker-compose і AGENTS.md у репо актуальні; після bootstrap жодних кроків поза git
