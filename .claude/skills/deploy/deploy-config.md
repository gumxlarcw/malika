# Deploy Config

Reference for the `deploy` skill. No secret *values* live here — only the names of the env vars and where they live.

## Environment

Single production environment: this box. The working directory is both the live app and the git remote checkout (`origin = gumxlarcw/malika`, branch `main`). There is no separate staging dir.

| Process | Manager | Port | Source dir | Build needed? |
|---|---|---|---|---|
| `pds-backend` | PM2 | 5000 | `backend/` | no (`node server.js`) |
| `pds-admin` | PM2 | 5050 | `backend/admin/` | **yes** (`npm run build`) |
| `pds-frontend` | PM2 | 6060 | `frontend/` | **yes** (`npm run build`) |
| `malika-llm-proxy` | PM2 | 3031 | `/opt/malika-llm-proxy/` | no |

PM2 app definitions: `ecosystem.config.js` (repo root). Public hostnames via Cloudflare Tunnel: `malika.bpsmalut.com` (PWA), `api-malika.bpsmalut.com` (API + admin).

## Required env vars (live only in gitignored `.env` files)

- **backend/.env:** `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` (primary `project_data_strategis`; replica `data_bps`), `JWT_SECRET`, web-push VAPID keys (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`), `USE_UNIFIED_RETRIEVAL`, LLM proxy URL.
- **frontend/.env(.local):** `NEXT_PUBLIC_API_URL`, public VAPID key.
- **admin** (`backend/admin/.env*`): `NEXT_PUBLIC_API_URL`.
- **/opt/malika-llm-proxy/.env:** upstream model provider API keys.

`.env*` files are gitignored and must never be committed (CI `secret-scan` + "verify .env not tracked" both block this).

## Rollback

1. Identify the bad change: `git log --oneline -10`.
2. Revert it: `git revert <sha>` (preferred — keeps history) — do **not** `git reset --hard` on this shared tree.
3. Rebuild the affected Next app(s): `npm run build` in `backend/admin/` and/or `frontend/`.
4. Reload: `pm2 reload <app> --update-env`.
5. Verify per the SKILL's checklist. Pre-change file backups (`*.backup`) and tarballs under `backups/` are scratch fallbacks only.
