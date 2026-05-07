#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/var/www/html/project-data-strategis"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_NAME="public-pwa"
PORT="6060"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install pm2 first (npm i -g pm2)." >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "ERROR: frontend dir not found: $FRONTEND_DIR" >&2
  exit 1
fi

cd "$FRONTEND_DIR"

echo "[1/4] Stopping PM2 app (if exists): $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 stop "$APP_NAME" >/dev/null
else
  echo "- $APP_NAME not registered in PM2 yet; will start after build"
fi

echo "[2/4] Building Next.js (this updates .next/*)"
npm run build

echo "[3/4] Starting/restarting PM2 app: $APP_NAME on :$PORT"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 start "$APP_NAME" >/dev/null
else
  pm2 start node_modules/.bin/next --name "$APP_NAME" -- start -p "$PORT" >/dev/null
fi

echo "[4/4] Quick health checks (with retry)"

health_url_root="http://127.0.0.1:${PORT}/"
health_url_manifest="http://127.0.0.1:${PORT}/manifest.webmanifest"

wait_for_http_200() {
  local url="$1"
  local attempts="${2:-30}"
  local delay_sec="${3:-1}"

  for ((i=1; i<=attempts; i++)); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
    if [[ "$code" == "200" ]]; then
      echo "$code"
      return 0
    fi
    sleep "$delay_sec"
  done

  echo "$code"
  return 1
}

code_root=$(wait_for_http_200 "$health_url_root" 30 1 || true)
code_manifest=$(wait_for_http_200 "$health_url_manifest" 30 1 || true)

echo "- GET / => ${code_root}"
echo "- GET /manifest.webmanifest => ${code_manifest}"

if [[ "$code_root" != "200" || "$code_manifest" != "200" ]]; then
  echo "WARN: health checks failed. Check: pm2 logs ${APP_NAME}" >&2
fi

echo "DONE. If the browser still requests old chunks, do a hard refresh or purge Cloudflare cache for malika.bpsmalut.com."