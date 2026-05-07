#!/bin/bash
# Stability test: runs test-deep-document.js N times and reports per-test pass rates
# Usage: ./test-deep-document-stability.sh [RUNS] [THRESHOLD]
#   RUNS      = number of iterations (default: 3)
#   THRESHOLD = minimum pass count per run to consider stable (default: 20)

RUNS=${1:-3}
THRESHOLD=${2:-20}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_SCRIPT="$SCRIPT_DIR/test-deep-document.js"

echo "═══════════════════════════════════════════════════════════"
echo "  STABILITY TEST — $RUNS runs, threshold $THRESHOLD/21"
echo "═══════════════════════════════════════════════════════════"
echo ""

declare -a RUN_SCORES
declare -A TEST_PASS_COUNT
TOTAL_TESTS=21

for ((r=1; r<=RUNS; r++)); do
  echo "── Run $r/$RUNS ──"
  OUTPUT=$(node "$TEST_SCRIPT" 2>&1)

  # Extract pass/fail count from summary line like "RESULT: 19/21 PASSED"
  PASSED=$(echo "$OUTPUT" | grep -oP '\d+(?=/\d+ PASSED)' | tail -1)
  if [ -z "$PASSED" ]; then
    # Fallback: count PASS lines
    PASSED=$(echo "$OUTPUT" | grep -c '✅ PASS')
  fi
  RUN_SCORES+=("$PASSED")
  echo "  Score: $PASSED/$TOTAL_TESTS"

  # Track per-test results
  while IFS= read -r line; do
    # Extract test ID from lines like "── T4: ..." followed by "✅ PASS" or "❌ FAIL"
    if [[ "$line" =~ ──\ (T[0-9]+): ]]; then
      CURRENT_TEST="${BASH_REMATCH[1]}"
    fi
    if [[ "$line" =~ ✅\ PASS ]] && [ -n "$CURRENT_TEST" ]; then
      TEST_PASS_COUNT[$CURRENT_TEST]=$(( ${TEST_PASS_COUNT[$CURRENT_TEST]:-0} + 1 ))
      CURRENT_TEST=""
    fi
    if [[ "$line" =~ ❌\ FAIL ]] && [ -n "$CURRENT_TEST" ]; then
      # Ensure entry exists even for failures
      TEST_PASS_COUNT[$CURRENT_TEST]=$(( ${TEST_PASS_COUNT[$CURRENT_TEST]:-0} ))
      CURRENT_TEST=""
    fi
  done <<< "$OUTPUT"

  echo ""
done

# Summary
echo "═══════════════════════════════════════════════════════════"
echo "  STABILITY SUMMARY"
echo "═══════════════════════════════════════════════════════════"

MIN=${RUN_SCORES[0]}
MAX=${RUN_SCORES[0]}
SUM=0
for s in "${RUN_SCORES[@]}"; do
  SUM=$((SUM + s))
  ((s < MIN)) && MIN=$s
  ((s > MAX)) && MAX=$s
done
AVG=$(echo "scale=1; $SUM / $RUNS" | bc)

echo "  Runs:      $RUNS"
echo "  Min:       $MIN/$TOTAL_TESTS"
echo "  Max:       $MAX/$TOTAL_TESTS"
echo "  Avg:       $AVG/$TOTAL_TESTS"
echo "  Threshold: $THRESHOLD/$TOTAL_TESTS"
echo ""

# Per-test pass rates
echo "  Per-test pass rates:"
for t in $(echo "${!TEST_PASS_COUNT[@]}" | tr ' ' '\n' | sort -t'T' -k2 -n); do
  COUNT=${TEST_PASS_COUNT[$t]}
  PCT=$(echo "scale=0; $COUNT * 100 / $RUNS" | bc)
  STATUS="✅"
  [ "$COUNT" -lt "$RUNS" ] && STATUS="⚠️"
  echo "    $STATUS $t: $COUNT/$RUNS ($PCT%)"
done
echo ""

# Final verdict
FAILED_RUNS=0
for s in "${RUN_SCORES[@]}"; do
  ((s < THRESHOLD)) && FAILED_RUNS=$((FAILED_RUNS + 1))
done

if [ "$FAILED_RUNS" -eq 0 ]; then
  echo "  ✅ STABLE — All runs met threshold ($THRESHOLD/$TOTAL_TESTS)"
  exit 0
else
  echo "  ❌ UNSTABLE — $FAILED_RUNS/$RUNS runs below threshold ($THRESHOLD/$TOTAL_TESTS)"
  exit 1
fi
