<!-- ═══════ ALWAYS FOLLOW — auto-loaded every session via @import ═══════ -->
@.claude/rules/code-style.md
@.claude/rules/testing.md
@.claude/rules/api-conventions.md
<!-- deploy skill auto-loads on demand; see "Claude Code config in this repo" below -->
<!-- ════════════════════════════════════════════════════════════════════ -->

# MALIKA — Project-specific Claude Code instructions

This file is auto-loaded by Claude Code at the start of every session in `/var/www/html/project-data-strategis/`.

## Single source of truth (2026-05-09 onward)

**This directory IS the GitHub-tracked repo.** No worktree, no rsync.

```
/var/www/html/project-data-strategis/        ← live + git-tracked
└── .git/  → origin = git@github.com:gumxlarcw/malika.git, branch main
```

**Workflow:** edit → `git add` → `git commit` → `git push origin main`.
PRs via GitHub UI for review. Branch from main, push, open PR there.

If you hit `fatal: detected dubious ownership` on first git op as root (dir owner is `www-data`):
```bash
git config --global --add safe.directory /var/www/html/project-data-strategis
```

## What gets auto-loaded each session

1. **This file** (`CLAUDE.md`) — always-on instructions
2. **Auto-memory index** at `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — facts about the project carried across sessions
3. **SessionStart hook** at `.claude/hooks/session-start.sh` — runs `git fetch origin main` and emits current branch/uncommitted/recent-commits state into the model's session context

So before any work, you already know: latest origin/main commits, current branch, uncommitted file count, where memory lives.

## Workspace docs (read when editing the corresponding area)

- `docs/workspace/backend.md` — backend API: routes, controllers, models, services
- `docs/workspace/frontend.md` — frontend PWA: pages, components, hooks
- `docs/workspace/admin.md` — admin panel: pages, components, state
- `docs/workspace/chat-pipeline.md` — chat streaming SSE, tiers, LLM proxy
- `docs/workspace/ai-llm.md` — AI/LLM models, proxy, API keys
- `docs/workspace/database.md` — database models, tables, migrations, retrieval_chunks
- `docs/workspace/infra.md` — PM2, CI/CD, deployment

Update Change Log in the relevant file after significant changes.

## Other doc subfolders

- `docs/archive/` — frozen historical docs (checkpoints, completed audits — read for audit trail, not for active reference)
- `docs/runbook/` — step-by-step ops guides (read before performing the operation)
- `docs/reference/` — technical reference + schema specs (read on demand for the relevant area)

## Architecture quick-ref

- **3 PM2 apps**: pds-backend (:5000), pds-admin (:5050), pds-frontend (:6060)
- **LLM proxy**: malika-llm-proxy (:3031) — live at `/opt/malika-llm-proxy/{src/index.js,.env}`
- **Cloudflare Tunnel**: `malika.bpsmalut.com` (PWA), `api-malika.bpsmalut.com` (API + admin)
- **DB**: MariaDB 11.8 — `project_data_strategis` (primary, 32 tables) + `data_bps` (replica, 320+ tables)
- **Embeddings**: Self-hosted `Xenova/multilingual-e5-base` @ 768d via `@xenova/transformers` — see `services/bpsMetadata/embedding.service.js`
- **Retrieval**: Native `VECTOR(768)` cosine HNSW in `retrieval_chunks` table — see `services/ai/retrieval.service.js`. Flag: `USE_UNIFIED_RETRIEVAL=true` in `.env`.

## Always-on rules (per global CLAUDE.md + project preference)

- Always backup before edit: `cp {file} {file}.backup`
- Read the file first before editing
- Backend reload (`.js` changes): `pm2 reload pds-backend --update-env`
- **Admin / frontend reload (`.tsx`/`.ts` changes) requires a build first**: `pm2 reload` alone does NOT rebuild — PM2 just re-execs the existing `.next` bundle. The full sequence:
  - Admin: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`
  - PWA: `cd frontend && npm run build && pm2 reload pds-frontend --update-env`
  - Skipping the build means your edits silently don't ship. Confirmed bug-bait 2026-05-11 (admin pagination + flag-route).
- **No `Co-Authored-By` trailer in commits** (project preference)
- Stage only files you intend to commit (`git add <path>`, never `-A` — there are unrelated changes from other dev sessions)

## When in doubt

- Check `docs/workspace/<area>.md` for area-specific rules
- Check `/root/.claude/projects/-var-www-html/memory/MEMORY.md` for project history & decisions
- Check `git log --oneline -20` to see recent direction
- Phase A–F audit fix plan: `docs/superpowers/plans/2026-05-08-db-audit-fixes.md`

## Commands (per sub-project)

npm + Node 20 everywhere. Run inside the sub-project directory.

| step | `backend/` (Jest) | `backend/admin/` (Vitest) | `frontend/` (Playwright) |
|---|---|---|---|
| install | `npm ci` | `npm ci` | `npm ci --legacy-peer-deps` |
| dev | `node server.js` | `npm run dev` | `npm run dev` |
| build | — | `npm run build` | `npm run build` |
| test | `npm test` | `npm test` | `npx playwright test` |
| lint | `npm run lint` | `npm run lint` | `npm run lint` |

Reload after changes: backend → `pm2 reload pds-backend --update-env`; admin/PWA → **build first**, then `pm2 reload pds-admin`/`pds-frontend --update-env` (see the deploy skill).

## Claude Code config in this repo

- **Rules** (`.claude/rules/`): `code-style`, `testing`, `api-conventions` — @-imported at the top of this file, so always on.
- **Commands** (`.claude/commands/`): `/review` (diff vs `main` against the rules), `/fix-issue <n|desc>` (TDD fix). Use these for repeatable tasks.
- **Agents** (`.claude/agents/`): `code-reviewer`, `security-auditor` — delegate review/security passes to these (isolated context).
- **Skill** (`.claude/skills/deploy/`): deploy/reload workflow; loads on demand when you deploy.
- **Local-only** (gitignored): `CLAUDE.local.md` (personal notes) and `.claude/settings.local.json` (local permission state).
