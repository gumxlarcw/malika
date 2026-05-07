#!/bin/bash
# Refresh BPS rich metadata + embeddings incrementally.
# Designed to run from cron — only refreshes what's actually stale, never
# blocks on transient failures, logs to a file.
#
# Recommended cron entry (run nightly at 02:00 server time):
#   0 2 * * * /var/www/html/project-data-strategis/backend/scripts/refresh-bps-metadata.sh
#
# Stale criteria:
#   --stale-days=7   — re-fetch metadata for sources older than 7 days
#                     (also covers brand-new sources that were never fetched)
#   --stale          — for embeddings: re-embed rows whose flat_text changed
#                     after their stored embedding (and any NULL embeddings)

set -euo pipefail

cd "$(dirname "$0")/.."

LOG_DIR="/var/log/openclaw"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/bps-metadata-refresh.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }

log "─── BPS metadata refresh START ───"

# 1. Refresh metadata that's stale (>7 days) or missing
log "Step 1: metadata backfill (--stale-days=7)"
if node scripts/backfill-bps-metadata.js --stale-days=7 >>"$LOG_FILE" 2>&1; then
  log "  ✓ metadata backfill ok"
else
  EXIT=$?
  log "  ⚠ metadata backfill exited with $EXIT (some sources may have failed; non-fatal)"
fi

# 2. Generate embeddings for any newly populated rows + stale ones
log "Step 2: embedding backfill (--stale)"
if node scripts/backfill-bps-embeddings.js --stale >>"$LOG_FILE" 2>&1; then
  log "  ✓ embedding backfill ok"
else
  EXIT=$?
  log "  ⚠ embedding backfill exited with $EXIT (non-fatal)"
fi

log "─── BPS metadata refresh DONE ───"
log ""
