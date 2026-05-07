#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=""
OUT_DIR="$ROOT_DIR/backups/db"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_REMOTE_METHOD="${BACKUP_REMOTE_METHOD:-rsync}"

print_usage() {
  echo "Usage: $0 [--env-file path] [--out-dir path]"
  echo "Environment variables: DB_NAME, DB_USER, DB_PASS, DB_HOST"
  echo "Optional: BACKUP_REMOTE (e.g., user@host:/path or s3://bucket/path), BACKUP_REMOTE_METHOD=rsync|scp|aws"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
 done

if [ -n "$ENV_FILE" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "Env file not found: $ENV_FILE"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASS:?DB_PASS is required}"
: "${DB_HOST:=localhost}"

if ! command -v mysqldump >/dev/null 2>&1; then
  echo "mysqldump not found in PATH"
  exit 1
fi

mkdir -p "$OUT_DIR"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
FILE="$OUT_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  | gzip > "$FILE"

echo "Backup saved to $FILE"

if [ -n "$BACKUP_REMOTE" ]; then
  case "$BACKUP_REMOTE_METHOD" in
    rsync)
      if command -v rsync >/dev/null 2>&1; then
        rsync -av "$FILE" "$BACKUP_REMOTE"
        echo "Backup synced via rsync to $BACKUP_REMOTE"
      else
        echo "rsync not found; skipping remote sync"
      fi
      ;;
    scp)
      if command -v scp >/dev/null 2>&1; then
        scp "$FILE" "$BACKUP_REMOTE"
        echo "Backup synced via scp to $BACKUP_REMOTE"
      else
        echo "scp not found; skipping remote sync"
      fi
      ;;
    aws)
      if command -v aws >/dev/null 2>&1; then
        aws s3 cp "$FILE" "$BACKUP_REMOTE"
        echo "Backup synced via aws to $BACKUP_REMOTE"
      else
        echo "aws CLI not found; skipping remote sync"
      fi
      ;;
    *)
      echo "Unknown BACKUP_REMOTE_METHOD: $BACKUP_REMOTE_METHOD"
      ;;
  esac
fi
