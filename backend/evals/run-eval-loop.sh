#!/usr/bin/env bash
# Run eval cases one-by-one in separate Node processes.
# This avoids the silent-death bug when running all cases in a single process.
#
# Usage: bash evals/run-eval-loop.sh [delay_seconds]

set -euo pipefail
cd "$(dirname "$0")/.."

DELAY=${1:-10}
LOG="/tmp/eval-post-chunking.log"
RESULTS="/tmp/eval-results.jsonl"

# Extract case IDs
CASES=$(node -e "
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('evals/fixtures/eval-set.json','utf8'));
  d.cases.forEach(c => console.log(c.id));
")

TOTAL=$(echo "$CASES" | wc -l)
echo "🧪 MALIKA Eval Runner (loop mode) — $TOTAL cases, delay=${DELAY}s" | tee "$LOG"
echo "Started: $(date -Iseconds)" | tee -a "$LOG"
echo "────────────────────────────────────────────────────────────" | tee -a "$LOG"

# Truncate results file
> "$RESULTS"

PASS=0
FAIL=0
IDX=0

for ID in $CASES; do
  IDX=$((IDX + 1))
  echo -n "[$IDX/$TOTAL] $ID: " | tee -a "$LOG"

  # Run single case, capture output
  OUTPUT=$(EVAL_DELAY_MS=0 node evals/run-eval.js --id="$ID" --verbose 2>&1) || true

  # Extract the result line (contains ✅ or ❌ or ⚠️)
  RESULT_LINE=$(echo "$OUTPUT" | grep -E '✅|❌|⚠️' | head -1 || echo "NO RESULT")

  if echo "$RESULT_LINE" | grep -q '✅'; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi

  # Print result (strip the "[1/1] id:" prefix since we have our own)
  CLEAN=$(echo "$RESULT_LINE" | sed 's/\[1\/1\] [^ ]* //')
  echo "$CLEAN" | tee -a "$LOG"

  # Print verbose details (lines starting with ↳)
  echo "$OUTPUT" | grep '↳' | tee -a "$LOG" || true

  # Save full output as JSON line
  echo "{\"id\":\"$ID\",\"output\":$(echo "$OUTPUT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')}" >> "$RESULTS"

  # Delay between cases (skip after last)
  if [ "$IDX" -lt "$TOTAL" ]; then
    sleep "$DELAY"
  fi
done

echo "" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════════" | tee -a "$LOG"
echo "📊 RESULTS: $PASS passed, $FAIL failed out of $TOTAL" | tee -a "$LOG"
echo "Finished: $(date -Iseconds)" | tee -a "$LOG"
echo "Log: $LOG"
echo "Results: $RESULTS"
