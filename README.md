# iPref API

NestJS + TypeScript API.

## Prerequisites

- npm

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

- Health: `GET http://localhost:3000/health` → `{ "status": "ok" }`
  ```bash
  curl -s http://localhost:3000/health
  ```
- Swagger UI: `http://localhost:3000/api-docs`

## Migrations (Drizzle)

```bash
npm run db:generate   # generate migration from schema changes
npm run db:migrate    # apply migrations to the database
npm run db:studio     # open Drizzle Studio (DB browser)
```

## Scripts

- `npm run build` — production build (`dist/`)
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, type-checked)
- `npm run format` / `npm run format:check` — Prettier
- `npm test` — unit tests (Vitest)
- `npm run test:e2e` — e2e tests
- `npm run start` / `npm run start:debug` / `npm run start:prod` — run server
- `npm run db:generate` / `db:migrate` / `db:studio` — Drizzle migrations

## Tooling

- TypeScript strict, ESM (`nodenext`)
- ESLint v9 flat + `typescript-eslint` + `eslint-config-prettier`
- Prettier (`singleQuote`, `printWidth: 100`, `lf`)
- Husky pre-commit → `lint-staged` (ESLint + Prettier on staged files)

## Structure

```
src/
  main.ts                     # bootstrap: CORS, ValidationPipe, Swagger
  app.module.ts               # middleware order: logging, then idempotency
  auth/                       # Neon Auth JWT verification, guard
  common/                     # logging, Zod pipe, paginated DTO, http helpers
  config/                     # Joi env schema
  database/                   # pg pool, Drizzle, IPv4-first egress, /health/db
  health/                     # GET /health
  idempotency/                # Idempotency-Key middleware + key store
  personal-information/       # profile CRUD, first-touch provisioning
test/                         # e2e
docs/                         # auth + module docs
```
