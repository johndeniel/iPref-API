Hello World

# iPref API

NestJS + TypeScript API.

## Prerequisites

- Node >= 20 (`nvm use`)
- npm

## Setup

```bash
nvm use
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

## Scripts

- `npm run build` — production build (`dist/`)
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, type-checked)
- `npm run format` / `npm run format:check` — Prettier
- `npm test` — unit tests (Vitest)
- `npm run test:e2e` — e2e tests

## Tooling

- TypeScript strict, ESM (`nodenext`)
- ESLint v9 flat + `typescript-eslint` + `eslint-config-prettier`
- Prettier (`singleQuote`, `printWidth: 100`, `lf`)
- Husky pre-commit → `lint-staged` (ESLint + Prettier on staged files)

## Structure

```
src/
  main.ts            # bootstrap + Swagger at /api-docs
  app.module.ts
  health/
    health.controller.ts  # GET /health
test/
```
