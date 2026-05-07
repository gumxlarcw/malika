#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_BACKEND_INSTALL=false
SKIP_ADMIN=false
SKIP_FRONTEND=false
DRY_RUN=false

print_usage() {
  echo "Usage: $0 [--skip-backend-install] [--skip-admin] [--skip-frontend] [--dry-run]"
}

for arg in "$@"; do
  case "$arg" in
    --skip-backend-install)
      SKIP_BACKEND_INSTALL=true
      ;;
    --skip-admin)
      SKIP_ADMIN=true
      ;;
    --skip-frontend)
      SKIP_FRONTEND=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      print_usage
      exit 1
      ;;
  esac
  shift || true
 done

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

echo "== Build All (root: $ROOT_DIR) =="

if [ "$SKIP_BACKEND_INSTALL" = false ]; then
  echo "== Backend deps =="
  run_cmd "cd \"$ROOT_DIR/backend\" && npm install"
else
  echo "== Backend deps skipped =="
fi

if [ "$SKIP_ADMIN" = false ]; then
  echo "== Admin deps + build =="
  run_cmd "cd \"$ROOT_DIR/backend/admin\" && npm install"
  run_cmd "cd \"$ROOT_DIR/backend/admin\" && npm run build"
else
  echo "== Admin build skipped =="
fi

if [ "$SKIP_FRONTEND" = false ]; then
  echo "== Frontend deps + build =="
  run_cmd "cd \"$ROOT_DIR/frontend\" && npm install"
  run_cmd "cd \"$ROOT_DIR/frontend\" && npm run build"
else
  echo "== Frontend build skipped =="
fi

echo "== Build complete =="
