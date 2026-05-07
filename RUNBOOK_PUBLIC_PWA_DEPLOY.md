# Runbook: Deploy Public PWA (malika.bpsmalut.com)

## Problem this prevents
If you run `next build` while `next start` is still running, the server can end up serving HTML that references **old chunk filenames** under `/_next/static/*`.
Those files may no longer exist in `.next/static/…`, causing browsers to fail loading CSS/JS chunks (often seen as **500** + “Failed to load chunk”).

## Correct deploy sequence (safe)
Use **stop → build → start**.

### Recommended (script)
From the server:

- `bash /var/www/html/project-data-strategis/scripts/deploy-public-pwa.sh`

This:
- stops the PM2 app `public-pwa`
- runs `npm run build` in `frontend/`
- starts `public-pwa` again on port `6060`
- runs quick local health checks

### Manual (if needed)
- `pm2 stop public-pwa`
- `cd /var/www/html/project-data-strategis/frontend && npm run build`
- `pm2 start public-pwa`

## After deploy
If users still see old chunks in DevTools Network:
- Do a hard refresh (`Ctrl+F5`).
- If still stuck, **purge Cloudflare cache** for `malika.bpsmalut.com` (at least `/`), because cached HTML can keep pointing to old chunk filenames.

## Verify
- `curl -I http://localhost:6060/`
- `curl -I http://localhost:6060/_next/static/chunks/turbopack-6f0012ab8f6ed4a6.js`
- `pm2 logs public-pwa --lines 100`

## Notes about routing
Your `cloudflared` config routes:
- `malika.bpsmalut.com` → `http://localhost:6060`
So Apache virtual hosts do not affect `/_next/static/*` for this domain.
