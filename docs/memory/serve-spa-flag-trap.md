---
name: serve -s flag is SPA fallback, not directory-serve
description: npm `serve` package gotcha — the `-s`/`--single` flag enables SPA fallback (rewrites unknown paths to top-level index.html), breaking multi-page sites
type: feedback
originSessionId: ef9cc7b3-9340-4e3c-bcf1-b5c996e12875
---
When using the npm `serve` package (or `pm2 serve`) for a multi-page static site, DO NOT include the `-s` / `--single` flag. It enables SPA mode and rewrites any unresolved path to the top-level `index.html`, silently hiding real 404s and breaking sub-page routing.

Concrete symptom: `/pekppp/` returns the same body as `/` (same file size in `curl -w %{size_download}`), and curl -I returns 200 for deliberately non-existent paths like `/nonexistent-path`.

**Why:** `-s` is misleadingly named — looks like "serve" but stands for "single-page". The correct multi-page invocation is plain `serve <path> -l <port>`.

**How to apply:** For any multi-page static hosting (knowledge bases, documentation sites, mixed pages), use `serve . -l PORT --no-clipboard`. Reserve `-s` strictly for actual SPAs (React Router without hash, Vue Router history mode, etc.) that need the fallback.

**Detection:** After deploying a static site with PM2+serve, verify with `curl -w "size=%{size_download}"` against a subdirectory index AND a deliberately-wrong path — if both return the same size as `/`, SPA fallback is wrongly active.

**Incident context (2026-04-22):** Hit this on the knowledge.bpsmalut.com project. Plan specified `serve -s .` thinking it meant "serve directory `.`". All subagent smoke tests passed (HTTP 200) but content was wrong — the hub page was being served at every route. Fix: drop the `-s` flag, `pm2 delete` + `pm2 start` to pick up new ecosystem args.
