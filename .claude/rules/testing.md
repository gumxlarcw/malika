# Testing

Each sub-project has its own runner. Run tests from inside that sub-project's directory.

## Backend — `backend/` (Jest + Supertest)

- Run: `cd backend && npm test` (`jest`).
- Test files: `*.test.js` or under `__tests__/`. Config: `backend/jest.config.js`.
- HTTP-layer tests use `supertest` against the Express app.
- CI runs `npm test -- --ci --passWithNoTests` with a throwaway DB env:
  `DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost JWT_SECRET=test-secret`
  **and `SKIP_DB_TESTS=1`** (see `.github/workflows/checks.yml`). Mirror all of it locally.
- **`SKIP_DB_TESTS=1` is not optional on a machine without a provisioned test DB.**
  Seven suites assert against live rows in the real database rather than a scratch
  schema, so they cannot pass against `testdb` — creating that database does not
  help, it only changes the error. Without the flag they fail with
  `SequelizeAccessDeniedError` and the suite looks broken when it is not. With it:
  465 passed, 19 skipped, 0 failed. Full local command:

  ```bash
  cd backend && DB_NAME=testdb DB_USER=testuser DB_PASS=testpass DB_HOST=localhost \
    JWT_SECRET=test-secret SKIP_DB_TESTS=1 npm test -- --ci --passWithNoTests
  ```

  To exercise those seven for real, point the normal `.env` at a database that has
  the live schema and data, and leave `SKIP_DB_TESTS` unset.

## Admin — `backend/admin/` (Vitest + Testing Library)

- Run: `cd backend/admin && npm test` (`vitest run`). Watch: `npm run test:watch`. UI: `npm run test:ui`.
- Stack: `vitest` + `@testing-library/react` + `jsdom`. Config: `backend/admin/vitest.config.ts`.
- Test components through their public behavior (queries, user events) — not internal state.

## Frontend (PWA) — `frontend/` (Playwright)

- Run: `cd frontend && npx playwright test` (no `test` npm script defined).
- Output: `frontend/test-results/` and `frontend/playwright-report/` (both gitignored).
- These are end-to-end browser tests — they need the app running; check the Playwright config for `webServer`/`baseURL`.

## Expectations

- **New endpoint or component → add/extend a test** in that sub-project's runner.
- CI uses `--passWithNoTests`, so an empty suite won't fail the build — that means coverage is on us, not the gate. Don't rely on CI to catch missing tests.
- For backend integration paths that touch the DB, prefer a real test DB (the CI env above) over mocking the data layer — mocked DB behavior has diverged from real Sequelize/MariaDB behavior before.
- TypeScript type-checking is part of the safety net: `npx tsc --noEmit` runs in CI for both Next apps. Run it locally before declaring a TS change done.
