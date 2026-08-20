---
name: deploy
description: Use when deploying or reloading MALIKA after code changes — covers the mandatory Next.js build-before-reload sequence for pds-admin/pds-frontend, the pds-backend reload, and the push-to-main CI/CD path. Trigger on requests like "deploy", "ship this", "reload the admin/frontend/backend", or "why aren't my changes live".
---

# Deploy MALIKA

This repo IS the live, git-tracked deployment directory (`/var/www/html/project-data-strategis`). Three PM2 apps run here; the LLM proxy runs separately at `/opt/malika-llm-proxy`. See `deploy-config.md` (this folder) for environments, env vars, ports, and rollback.

## Decide the path

- **Code already on `main` and you want CI to deploy:** push to `main` → `.github/workflows/cd.yml` handles it. PRs are reviewed via the GitHub UI.
- **Reloading the running processes on this box (most common during dev):** use the PM2 sequences below.

## PM2 reload sequences (order matters)

### Backend — `.js` changes
```bash
pm2 reload pds-backend --update-env
```
Node re-execs the source directly; no build step.

### Admin — `.tsx` / `.ts` changes (`backend/admin/`)
```bash
cd backend/admin && npm run build && pm2 reload pds-admin --update-env
```

### Frontend PWA — `.tsx` / `.ts` changes (`frontend/`)
```bash
cd frontend && npm run build && pm2 reload pds-frontend --update-env
```

> **The build is mandatory for the two Next.js apps.** `pm2 reload` alone just re-execs the existing `.next` bundle — your edits silently do NOT ship without `npm run build` first. (Confirmed bug-bait 2026-05-11.)

## Verify after every deploy
1. `pm2 list` — all three apps `online`, restart count not climbing.
2. `pm2 logs <app> --lines 50` — no boot errors.
3. Hit the surface: backend `:5000`, admin `:5050`, frontend `:6060` (or the Cloudflare hostnames in `deploy-config.md`).

## If something is wrong
Roll back per `deploy-config.md` (revert the change → rebuild → reload). Do not force-push or `git reset --hard` to "fix" a bad deploy.
