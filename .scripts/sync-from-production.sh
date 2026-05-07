#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# .scripts/sync-from-production.sh
#
# Sync edits dari production → GitHub-tracked working copy (this repo).
#
# Located in `.scripts/` (NOT `scripts/`) so production rsync won't touch it.
#
# Production:    /var/www/html/project-data-strategis/    (live, PM2 reads)
# GitHub copy:   /var/www/html/.worktrees/malika-fresh/   (this repo)
#
# Workflow:
#   1. Edit files di production (test with PM2 reload)
#   2. Run this script → rsync changes ke GitHub copy
#   3. Review:    git status / git diff
#   4. Commit:    git add -A && git commit -m '...'
#   5. Push:      git push origin main
#
# Excluded: secrets (.env*), build artifacts, backups, local archive tables,
# editor-local files (.vscode/), and this script's own directory.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROD="/var/www/html/project-data-strategis"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$PROD" ]; then
  echo "ERROR: production path not found: $PROD" >&2
  exit 1
fi

if [ ! -d "$HERE/.git" ]; then
  echo "ERROR: $HERE is not a git repo (run from malika-fresh worktree)" >&2
  exit 1
fi

echo "→ Syncing $PROD → $HERE"
echo

rsync -a --delete \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='dist/' \
  --exclude='build/' \
  --exclude='.git/' \
  --exclude='.git' \
  --exclude='.scripts/' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.development.local' \
  --exclude='.env.test.local' \
  --exclude='.env.production' \
  --exclude='.env.production.local' \
  --exclude='*.backup' \
  --exclude='*.bak' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='.vscode/' \
  --exclude='.idea/' \
  --exclude='_archive_*' \
  --exclude='backups/' \
  --exclude='coverage/' \
  --exclude='.turbo/' \
  --exclude='.swc/' \
  "$PROD/" "$HERE/"

echo "→ rsync done"
echo
cd "$HERE"

echo "→ Status vs HEAD:"
STATUS=$(git status --short)
if [ -z "$STATUS" ]; then
  echo "  (no changes — production matches GitHub HEAD)"
  exit 0
fi
echo "$STATUS"
echo
git diff --stat HEAD 2>&1 | tail -3

echo
echo "→ Sanity check: secrets in working tree"
LEAKS=$(git grep -lE 'AIzaSy[A-Za-z0-9_-]{30,}|sk-ant-oat[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}' 2>/dev/null || true)
if [ -n "$LEAKS" ]; then
  echo "  ⚠ SECRETS DETECTED in:"
  echo "$LEAKS" | sed 's/^/    /'
  echo "  STOP — sanitize before commit."
  exit 2
else
  echo "  ✓ no secrets"
fi

echo
echo "Next steps:"
echo "  git diff                                  # review changes"
echo "  git add -A && git commit -m 'feat: ...'   # commit"
echo "  git push                                  # push to GitHub"
