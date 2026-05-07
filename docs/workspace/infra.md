# Infrastructure & Deployment — Project Line

> Last updated: 2026-03-02

## PM2 Processes
| Name | Port | Script | Config |
|---|---|---|---|
| pds-backend | 5000 | backend/server.js | ecosystem.config.js |
| pds-admin | 5050 | backend/admin/.next/standalone/server.js | ecosystem.config.js |
| pds-frontend | 6060 | next start -p 6060 | ecosystem.config.js |
| malika-llm-proxy | 3031 | standalone | /opt/openclaw/malika-llm-proxy.config.js |

## Cloudflare Tunnel
```
malika.bpsmalut.com            → :6060 (Frontend)
api-malika.bpsmalut.com        → :5000 (Backend)
api-malika.bpsmalut.com/backend → :5050 (Admin)
```

## CI/CD (GitHub Actions)
- `ci.yml`: lint (3x), backend tests, admin build, frontend tests, frontend E2E, security audit (3x), quality gates
- `cd.yml`: staging (push main), production (push tag), rollback (manual)
- `dependabot.yml`: weekly, 3 dirs + GitHub Actions

## Runtime
- Node.js v25.5.0
- Backend: --max-old-space-size=2560, --expose-gc, max_memory_restart=5G
- PM2 wait_ready=true (startup 20-45s for embedding preload)

## Build Commands
```
Backend reload: pm2 reload pds-backend --update-env
Admin build:    cd backend/admin && npm run build && pm2 restart pds-admin
Frontend build: cd frontend && npm run build && pm2 restart pds-frontend
Full build:     ./scripts/build-all.sh
```

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Initial audit & documentation | - |
