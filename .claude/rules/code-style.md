# Code Style

Conventions for MALIKA. Three sub-projects, two languages — match the local style of the file you're editing first; these are the defaults when starting fresh.

## Backend — `backend/` (Node.js, CommonJS)

- **Module system:** CommonJS (`require` / `module.exports`). Do NOT introduce ESM `import` in `backend/` — the runtime entry is `node server.js`.
- **Runtime:** Node 20 (matches CI). Express 5.
- **Layout:** `src/` split into `routes/`, `controllers/`, `models/` (Sequelize), `services/`, `middleware/`, `scripts/`.
- **Service naming:** `services/<area>/<name>.service.js` (e.g. `services/ai/retrieval.service.js`, `services/bpsMetadata/embedding.service.js`). Keep one responsibility per service module.
- **Async:** `async/await`, not raw `.then()` chains. Always handle rejections — let errors bubble to the Express error middleware rather than swallowing them.
- **Config & secrets:** read from `process.env` (via `dotenv`). NEVER hardcode credentials — CI `secret-scan` blocks keys matching `AIzaSy…`, `sk-ant-…`, `sk-proj-…`, `gh[ops]_…`. Secrets live only in `.env` (gitignored).
- **DB access:** go through Sequelize models / services. Parameterize any raw query — never string-concatenate user input.

## Frontend & Admin — `frontend/`, `backend/admin/` (TypeScript + Next.js 16, React 19)

- **TypeScript:** strict. No `any` unless justified with a short comment. Prefer precise types and discriminated unions over loose objects.
- **Components:** function components + hooks. App Router under `src/app/`. Co-locate route-private pieces in `_components/` (see `frontend/src/app/(admin)/data/_components/`).
- **Imports:** use the `@/` path alias for intra-app imports; relative paths only for siblings. Group external → alias → relative.
- **Styling:** Tailwind CSS v4 utility classes. Avoid inline `style={}` except for dynamic values.
- **State (admin):** Zustand stores + TanStack Query for server state. Don't duplicate server state into local `useState`.
- **Exports:** named exports for components/util; default export only where Next requires it (pages/layouts).

## Cross-cutting

- **Indentation:** 2 spaces, everywhere. No tabs.
- **Linting is the source of truth.** There is no Prettier config — ESLint decides formatting (`eslint-config-next` for the two Next apps; `backend/eslint.config.js`, flat config, for the backend). All three sub-projects define `npm run lint`, but CI only *runs* it for the backend — the `admin` and `frontend` jobs gate on `npx tsc --noEmit` and `npm run build` instead, so run their lint yourself. In `frontend/` it exits non-zero by design: the remaining React Compiler errors are deliberate SSR patterns and naive fixes break hydration.
- **Backend lint posture.** Correctness rules (`no-undef`, `no-unreachable`, `no-dupe-keys`, …) are **errors** and gate CI; they currently sit at 0. Accumulated cruft that predates linting (`no-unused-vars`, `no-useless-escape`, `no-empty`, …) is reported as **warnings** — ~92 of them, tracked as debt, not a licence to add more. Burn them down and promote each rule back to `error`. Under flat config `--ext` is obsolete — file selection lives in `files`/`ignores` inside `eslint.config.js`. The old CI fallback `eslint src --ext .js` never linted anything, not because of that flag but because the backend had neither an ESLint config nor the dependency installed until 2026-08-18.
- **Edits:** back up before editing (`cp {file} {file}.backup` — gitignored), read the whole file/section first, keep diffs minimal.
- **Comments:** explain *why*, not *what*. Don't reference the current task or PR in code comments.
- **Commits:** no `Co-Authored-By` trailer (project preference). Stage explicit paths (`git add <path>`), never `git add -A`.
