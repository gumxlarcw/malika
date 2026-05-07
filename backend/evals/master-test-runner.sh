#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# MALIKA Master Test Runner v1.0
# Unified test suite: Backend Jest + Frontend Unit + Chat Accuracy/Overlap/Deep
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./master-test-runner.sh                    # Run ALL tests
#   ./master-test-runner.sh --unit             # Backend Jest + Frontend unit only
#   ./master-test-runner.sh --chat             # All chat tests (accuracy+overlap+deep)
#   ./master-test-runner.sh --chat --quick     # Fast subset (greeting+default+edge)
#   ./master-test-runner.sh --chat --cat=overlap   # Single category
#   ./master-test-runner.sh --chat --tag=core      # Filter by tag
#   ./master-test-runner.sh --chat --id=G01,D01    # Run specific test IDs
#   ./master-test-runner.sh --chat --skip-deep     # Skip deep mode (slow) tests
#   ./master-test-runner.sh --chat --model=deep    # Force all tests to use gpt-5-mini
#   ./master-test-runner.sh --chat --model=flash   # Force all tests to use gpt-4.1
#   ./master-test-runner.sh --jest             # Backend Jest only
#   ./master-test-runner.sh --frontend         # Frontend tests only
#
# Environment:
#   API_URL          Backend API (default: http://localhost:5000)
#   PWA_URL          Frontend PWA (default: http://localhost:6060)
#   CHAT_TIMEOUT     Max seconds per chat test (default: 300)
#   PARALLEL         Number of parallel chat tests (default: 1)
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
FIXTURES="$SCRIPT_DIR/fixtures/master-test-cases.json"
PARSER="$SCRIPT_DIR/parse-sse-result.py"

# ── Config ────────────────────────────────────────────────────────────────────
API_URL="${API_URL:-http://localhost:5000}"
PWA_URL="${PWA_URL:-http://localhost:6060}"
CHAT_TIMEOUT="${CHAT_TIMEOUT:-300}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
RESULTS_DIR="/tmp/malika_master_tests_${TIMESTAMP}"
mkdir -p "$RESULTS_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ── Parse Arguments ───────────────────────────────────────────────────────────
RUN_JEST=false; RUN_FRONTEND=false; RUN_CHAT=false
CHAT_CAT=""; CHAT_TAG=""; CHAT_IDS=""; QUICK=false; SKIP_DEEP=false
MODEL_OVERRIDE=""; MODEL_LABEL="auto"
RUN_ALL=true

for arg in "$@"; do
  case "$arg" in
    --unit)        RUN_JEST=true; RUN_FRONTEND=true; RUN_ALL=false ;;
    --jest)        RUN_JEST=true; RUN_ALL=false ;;
    --frontend)    RUN_FRONTEND=true; RUN_ALL=false ;;
    --chat)        RUN_CHAT=true; RUN_ALL=false ;;
    --quick)       QUICK=true ;;
    --skip-deep)   SKIP_DEEP=true ;;
    --cat=*)       CHAT_CAT="${arg#--cat=}" ;;
    --tag=*)       CHAT_TAG="${arg#--tag=}" ;;
    --id=*)        CHAT_IDS="${arg#--id=}" ;;
    --model=deep)  MODEL_OVERRIDE="gpt-5-mini"; MODEL_LABEL="deep (gpt-5-mini)" ;;
    --model=flash) MODEL_OVERRIDE="gpt-4.1"; MODEL_LABEL="flash (gpt-4.1)" ;;
    --model=*)     echo "Unknown model: ${arg#--model=}. Use --model=deep or --model=flash"; exit 1 ;;
  esac
done

if $RUN_ALL; then
  RUN_JEST=true; RUN_FRONTEND=true; RUN_CHAT=true
fi

# ── Counters ──────────────────────────────────────────────────────────────────
TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SKIP=0; TOTAL_TESTS=0
SECTION_RESULTS=()

record_section() {
  local name="$1" pass="$2" fail="$3" skip="${4:-0}" elapsed="${5:-0}"
  SECTION_RESULTS+=("$name|$pass|$fail|$skip|$elapsed")
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_SKIP=$((TOTAL_SKIP + skip))
  TOTAL_TESTS=$((TOTAL_TESTS + pass + fail))
}

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo -e "║  ${BOLD}MALIKA Master Test Runner v1.0${NC}                                     ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S')                                                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${DIM}API:${NC} $API_URL"
echo -e "  ${DIM}PWA:${NC} $PWA_URL"
echo -e "  ${DIM}Model:${NC} $MODEL_LABEL"
echo -e "  ${DIM}Results:${NC} $RESULTS_DIR"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: BACKEND JEST TESTS
# ══════════════════════════════════════════════════════════════════════════════
if $RUN_JEST; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}PHASE 1: Backend Jest Unit Tests${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  JEST_LOG="$RESULTS_DIR/jest.log"
  JEST_START=$(date +%s)
  
  cd "$BACKEND_DIR"
  if npx jest --forceExit --no-verbose 2>&1 | tee "$JEST_LOG"; then
    JEST_EXIT=0
  else
    JEST_EXIT=${PIPESTATUS[0]}
  fi
  cd "$PROJECT_ROOT"
  
  JEST_END=$(date +%s)
  JEST_ELAPSED=$((JEST_END - JEST_START))
  
  # Parse Jest output
  JEST_SUMMARY=$(grep -E "Tests:|Test Suites:" "$JEST_LOG" | tail -2)
  JEST_SUITES_PASS=$(echo "$JEST_SUMMARY" | grep "Test Suites:" | grep -oP '\d+ passed' | grep -oP '\d+' || echo "0")
  JEST_SUITES_FAIL=$(echo "$JEST_SUMMARY" | grep "Test Suites:" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "0")
  JEST_TESTS_PASS=$(echo "$JEST_SUMMARY" | grep "Tests:" | grep -oP '\d+ passed' | grep -oP '\d+' || echo "0")
  JEST_TESTS_FAIL=$(echo "$JEST_SUMMARY" | grep "Tests:" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "0")
  
  if [ "$JEST_EXIT" -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} Jest: ${JEST_SUITES_PASS} suites, ${JEST_TESTS_PASS} tests passed (${JEST_ELAPSED}s)"
  else
    echo -e "  ${RED}✗${NC} Jest: ${JEST_TESTS_FAIL} tests failed (see $JEST_LOG)"
  fi
  echo ""
  
  record_section "Backend Jest" "${JEST_TESTS_PASS:-0}" "${JEST_TESTS_FAIL:-0}" "0" "$JEST_ELAPSED"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: FRONTEND UNIT + E2E TESTS
# ══════════════════════════════════════════════════════════════════════════════
if $RUN_FRONTEND; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}PHASE 2: Frontend Unit & E2E Tests${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  FE_LOG="$RESULTS_DIR/frontend.log"
  FE_START=$(date +%s)
  FE_PASS=0; FE_FAIL=0

  cd "$FRONTEND_DIR"
  
  # Unit tests (bpsKeyword, dataLink, geoIntent, chartDataProfiler)
  UNIT_FILES=(
    "tests/bpsKeyword.test.ts"
    "tests/dataLink.test.ts"
    "tests/geoIntent.test.ts"
    "tests/chartDataProfiler.test.ts"
  )
  
  for tf in "${UNIT_FILES[@]}"; do
    if [ -f "$tf" ]; then
      TNAME=$(basename "$tf" .test.ts)
      if npx tsx --test "$tf" >> "$FE_LOG" 2>&1; then
        echo -e "  ${GREEN}✓${NC} $TNAME"
        FE_PASS=$((FE_PASS + 1))
      else
        echo -e "  ${RED}✗${NC} $TNAME (see $FE_LOG)"
        FE_FAIL=$((FE_FAIL + 1))
      fi
    fi
  done

  # E2E tests (need PWA running)
  E2E_FILES=(
    "tests/nonEximE2E.test.ts"
    "tests/eximE2E.test.ts"
  )
  
  # Check PWA reachable
  PWA_UP=$(curl -s -o /dev/null -w "%{http_code}" "$PWA_URL" 2>/dev/null || echo "000")
  if [ "$PWA_UP" != "000" ]; then
    for tf in "${E2E_FILES[@]}"; do
      if [ -f "$tf" ]; then
        TNAME=$(basename "$tf" .test.ts)
        if PWA_BASE_URL="$PWA_URL" npx tsx --test "$tf" >> "$FE_LOG" 2>&1; then
          echo -e "  ${GREEN}✓${NC} $TNAME (E2E)"
          FE_PASS=$((FE_PASS + 1))
        else
          echo -e "  ${RED}✗${NC} $TNAME (E2E) (see $FE_LOG)"
          FE_FAIL=$((FE_FAIL + 1))
        fi
      fi
    done
  else
    echo -e "  ${YELLOW}△${NC} Skipping E2E tests — PWA not reachable at $PWA_URL"
    TOTAL_SKIP=$((TOTAL_SKIP + ${#E2E_FILES[@]}))
  fi
  
  cd "$PROJECT_ROOT"
  FE_END=$(date +%s)
  FE_ELAPSED=$((FE_END - FE_START))
  
  echo -e "  ${DIM}Frontend: ${FE_PASS} pass, ${FE_FAIL} fail (${FE_ELAPSED}s)${NC}"
  echo ""
  
  record_section "Frontend" "$FE_PASS" "$FE_FAIL" "0" "$FE_ELAPSED"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: CHAT ACCURACY / OVERLAP / DEEP TESTS
# ══════════════════════════════════════════════════════════════════════════════
if $RUN_CHAT; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}PHASE 3: Chat Accuracy Tests${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Health check
  HC=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")
  if [ "$HC" = "000" ]; then
    echo -e "  ${RED}✗${NC} Backend not reachable at $API_URL"
    record_section "Chat" "0" "1" "0" "0"
  else
    CHAT_TIMING="$RESULTS_DIR/chat-timing.csv"
    echo "status|id|cat|query|latency_s|text_len|model|total_ms|reconciler_ms|stream_ms|tokens_in|tokens_out" > "$CHAT_TIMING"
    
    CHAT_START=$(date +%s)
    OWNER="master_${TIMESTAMP}"
    
    # Build filtered test case list into a temp file (one case per line, TAB-separated: id\tcat\tquery\texpect\tnot\tmodel)
    CASES_FILE="$RESULTS_DIR/_cases.tsv"
    python3 << PYEOF > "$CASES_FILE"
import json

cases = json.load(open('$FIXTURES'))['cases']
cat_filter = '$CHAT_CAT'
tag_filter = '$CHAT_TAG'
id_filter  = '$CHAT_IDS'
quick      = $( $QUICK && echo "True" || echo "False" )
skip_deep  = $( $SKIP_DEEP && echo "True" || echo "False" )

id_set = set(id_filter.split(',')) if id_filter else set()

for c in cases:
    if id_set and c['id'] not in id_set: continue
    if cat_filter and c['cat'] != cat_filter: continue
    if tag_filter and tag_filter not in c.get('tags', []): continue
    if quick and c['cat'] not in ('greeting', 'chitchat', 'default', 'edge', 'edge-oos'): continue
    if skip_deep and c['cat'] == 'deep': continue
    exp = c.get('expect','') or ''
    nt  = c.get('not','') or ''
    mdl = c.get('model','') or ''
    print(f"{c['id']}\t{c['cat']}\t{c['query']}\t{exp}\t{nt}\t{mdl}")
PYEOF
    
    CASE_COUNT=$(wc -l < "$CASES_FILE")
    echo -e "  Running ${BOLD}$CASE_COUNT${NC} chat tests..."
    echo ""
    
    # Track category for section headers
    LAST_CAT=""
    CHAT_PASS=0; CHAT_FAIL=0; CHAT_SKIP=0
    
    # Use process substitution (not pipe) so counter vars propagate
    while IFS=$'\t' read -r TEST_ID CAT QUERY EXPECT_PAT MUST_NOT_PAT MODEL; do
      
      # Section header on category change
      if [ "$CAT" != "$LAST_CAT" ]; then
        LAST_CAT="$CAT"
        CAT_UPPER=$(echo "$CAT" | tr '[:lower:]' '[:upper:]')
        echo -e "  ${CYAN}▸ $CAT_UPPER${NC}"
      fi
      
      # Create thread
      TID=$(curl -s -X POST "$API_URL/chat/threads" \
        -H 'Content-Type: application/json' \
        -H "x-malika-uid: $OWNER" \
        -d '{}' 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['thread']['id'])" 2>/dev/null || echo "")
      
      if [ -z "$TID" ] || [ "$TID" = "None" ]; then
        echo -e "    ${RED}✗${NC} [$TEST_ID] Thread creation failed"
        echo "FAIL|$TEST_ID|$CAT|$QUERY|0|0|?|0|0|0|0|0" >> "$CHAT_TIMING"
        CHAT_FAIL=$((CHAT_FAIL + 1))
        continue
      fi
      
      # Build URL
      ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")
      URL="$API_URL/chat/threads/$TID/stream?text=$ENCODED"
      # Model override: --model=deep|flash overrides per-test model field
      EFFECTIVE_MODEL="${MODEL_OVERRIDE:-$MODEL}"
      [ -n "$EFFECTIVE_MODEL" ] && URL="$URL&model=$EFFECTIVE_MODEL"
      
      OUTFILE="$RESULTS_DIR/${TEST_ID}.sse"
      START_NS=$(date +%s%N)
      
      curl -s -N "$URL" \
        -H 'Accept: text/event-stream' \
        -H "x-malika-uid: $OWNER" \
        --max-time "$CHAT_TIMEOUT" > "$OUTFILE" 2>&1
      
      END_NS=$(date +%s%N)
      WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
      LAT_S=$(python3 -c "print(f'{$WALL_MS/1000:.1f}')")

      # Parse SSE result + evaluate pattern match in one Python call
      VERDICT=$(python3 "$SCRIPT_DIR/evaluate-chat-result.py" \
        "$OUTFILE" "$WALL_MS" "$EXPECT_PAT" "$MUST_NOT_PAT" 2>/dev/null || echo "ERR|0|?|0|0|0|0|0|parse_error|")
      
      V_STATUS=$(echo "$VERDICT" | cut -d'|' -f1)
      V_TEXTLEN=$(echo "$VERDICT" | cut -d'|' -f2)
      V_MODEL=$(echo "$VERDICT" | cut -d'|' -f3)
      V_TOTAL=$(echo "$VERDICT" | cut -d'|' -f4)
      V_RECON=$(echo "$VERDICT" | cut -d'|' -f5)
      V_STREAM=$(echo "$VERDICT" | cut -d'|' -f6)
      V_TOKIN=$(echo "$VERDICT" | cut -d'|' -f7)
      V_TOKOUT=$(echo "$VERDICT" | cut -d'|' -f8)
      V_REASON=$(echo "$VERDICT" | cut -d'|' -f9)
      V_PREVIEW=$(echo "$VERDICT" | cut -d'|' -f10-)
      
      PIPE_S=$(python3 -c "print(f'{${V_TOTAL:-0}/1000:.1f}')")
      
      if [ "$V_STATUS" = "PASS" ]; then
        RECON_NOTE=""
        if [ "${V_RECON:-0}" != "0" ] && [ "${V_RECON}" != "0.0" ]; then
          RECON_S=$(python3 -c "print(f'{float(\"${V_RECON}\")/1000:.1f}')")
          RECON_NOTE=" rec=${RECON_S}s"
        fi
        echo -e "    ${GREEN}✓${NC} [$TEST_ID] ${LAT_S}s (${V_TEXTLEN}ch pipe=${PIPE_S}s${RECON_NOTE})"
        echo "PASS|$TEST_ID|$CAT|$QUERY|${LAT_S}|$V_TEXTLEN|$V_MODEL|$V_TOTAL|$V_RECON|$V_STREAM|$V_TOKIN|$V_TOKOUT" >> "$CHAT_TIMING"
        CHAT_PASS=$((CHAT_PASS + 1))
      else
        echo -e "    ${RED}✗${NC} [$TEST_ID] $V_REASON (${LAT_S}s, ${V_TEXTLEN}ch)"
        if [ -n "$V_PREVIEW" ]; then
          echo -e "      ${DIM}Expected: ${EXPECT_PAT:0:80}${NC}"
          echo -e "      ${DIM}Got: ${V_PREVIEW:0:120}${NC}"
        fi
        echo "FAIL|$TEST_ID|$CAT|$QUERY|${LAT_S}|$V_TEXTLEN|$V_MODEL|$V_TOTAL|$V_RECON|$V_STREAM|$V_TOKIN|$V_TOKOUT" >> "$CHAT_TIMING"
        CHAT_FAIL=$((CHAT_FAIL + 1))
      fi
    done < "$CASES_FILE"
    
    CHAT_END=$(date +%s)
    CHAT_ELAPSED=$((CHAT_END - CHAT_START))
    
    echo ""
    echo -e "  ${DIM}Chat: ${CHAT_PASS} pass, ${CHAT_FAIL} fail (${CHAT_ELAPSED}s)${NC}"
    echo ""
    
    # Detailed timing report
    if [ -f "$CHAT_TIMING" ] && [ "$(wc -l < "$CHAT_TIMING")" -gt 1 ]; then
      echo "  ── Timing Report by Category ──────────────────────────────────────"
      TIMING_FILE="$CHAT_TIMING" python3 << 'PYEOF'
import csv, sys, os

timing_file = os.environ.get('TIMING_FILE', '')
if not timing_file:
    sys.exit(0)

cats = {}
total_lat = 0; count = 0

with open(timing_file) as f:
    reader = csv.reader(f, delimiter='|')
    header = next(reader)
    for row in reader:
        if len(row) < 12: continue
        status, tid, cat, query, lat_s, tlen, model, total_ms, recon_ms, stream_ms, tok_in, tok_out = row[:12]
        try:
            lat = float(lat_s)
        except:
            continue
        if cat not in cats:
            cats[cat] = {'times': [], 'pass': 0, 'fail': 0, 'recon': []}
        cats[cat]['times'].append(lat)
        cats[cat]['pass' if status == 'PASS' else 'fail'] += 1
        try:
            r = float(recon_ms)
            if r > 0: cats[cat]['recon'].append(r/1000)
        except: pass
        total_lat += lat; count += 1

print(f"  {'Category':<18s} {'Avg':>6s} {'Min':>6s} {'Max':>6s} {'Pass':>7s} {'Recon':>8s}")
print(f"  {'─'*18} {'─'*6} {'─'*6} {'─'*6} {'─'*7} {'─'*8}")
for cat in sorted(cats.keys()):
    d = cats[cat]
    avg = sum(d['times'])/len(d['times'])
    mx = max(d['times']); mn = min(d['times'])
    t = d['pass']+d['fail']
    recon_s = ''
    if d['recon']:
        recon_avg = sum(d['recon'])/len(d['recon'])
        recon_s = f'{recon_avg:.1f}s'
    print(f"  {cat:<18s} {avg:5.1f}s {mn:5.1f}s {mx:5.1f}s {d['pass']}/{t:<5} {recon_s:>8s}")
if count > 0:
    print(f"  {'─'*18} {'─'*6} {'─'*6} {'─'*6} {'─'*7} {'─'*8}")
    print(f"  {'OVERALL':<18s} {total_lat/count:5.1f}s                   total={total_lat:.0f}s")
PYEOF
      echo ""
      
      # Failed tests detail
      FAIL_COUNT=$(grep -c "^FAIL" "$CHAT_TIMING" 2>/dev/null || true)
      FAIL_COUNT=${FAIL_COUNT:-0}
      if [ "$FAIL_COUNT" -gt 0 ]; then
        echo "  ── Failed Chat Tests ──────────────────────────────────────────────"
        grep "^FAIL" "$CHAT_TIMING" | while IFS='|' read -r _ TID CAT QUERY LAT TLEN MDL REST; do
          echo -e "    ${RED}✗${NC} [$TID] $CAT: \"$QUERY\" (${LAT}s, ${TLEN}ch)"
        done
        echo ""
      fi
      
      # Reconciler report
      RECON_COUNT=$(python3 -c "
import csv
count = 0
with open('$CHAT_TIMING') as f:
    reader = csv.reader(f, delimiter='|')
    next(reader)
    for row in reader:
        if len(row) >= 9:
            try:
                r = float(row[8])
                if r > 0: count += 1
            except: pass
print(count)
" 2>/dev/null || echo "0")
      
      if [ "$RECON_COUNT" -gt 0 ]; then
        echo "  ── Reconciler Triggered ($RECON_COUNT queries) ──────────────────────"
        grep "^PASS\|^FAIL" "$CHAT_TIMING" | while IFS='|' read -r STATUS TID CAT QUERY LAT TLEN MDL TOTAL RECON REST; do
          if [ "${RECON:-0}" != "0" ] && [ "${RECON:-0}" != "0.0" ]; then
            RECON_S=$(python3 -c "print(f'{float(\"$RECON\")/1000:.1f}')")
            echo -e "    [$TID] reconciler=${RECON_S}s (total=${LAT}s)"
          fi
        done
        echo ""
      fi
    fi
    
    record_section "Chat Accuracy" "$CHAT_PASS" "$CHAT_FAIL" "$CHAT_SKIP" "$CHAT_ELAPSED"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# GRAND SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo -e "║  ${BOLD}GRAND SUMMARY${NC}                                                      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

for entry in "${SECTION_RESULTS[@]}"; do
  IFS='|' read -r NAME PASS FAIL SKIP ELAPSED <<< "$entry"
  TOTAL=$((PASS + FAIL))
  if [ "$TOTAL" -gt 0 ]; then
    RATE=$(python3 -c "print(f'{$PASS/$TOTAL*100:.1f}%')")
  else
    RATE="N/A"
  fi
  
  if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} ${NAME}: ${PASS}/${TOTAL} passed (${RATE}) [${ELAPSED}s]"
  else
    echo -e "  ${RED}✗${NC} ${NAME}: ${PASS}/${TOTAL} passed (${RATE}) [${ELAPSED}s]"
  fi
done

echo ""
GRAND_TOTAL=$((TOTAL_PASS + TOTAL_FAIL))
if [ "$GRAND_TOTAL" -gt 0 ]; then
  GRAND_RATE=$(python3 -c "print(f'{$TOTAL_PASS/$GRAND_TOTAL*100:.1f}%')")
else
  GRAND_RATE="N/A"
fi

if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}TOTAL: ${TOTAL_PASS}/${GRAND_TOTAL} passed (${GRAND_RATE})${NC}"
else
  echo -e "  ${RED}${BOLD}TOTAL: ${TOTAL_PASS}/${GRAND_TOTAL} passed (${GRAND_RATE}) — ${TOTAL_FAIL} failures${NC}"
fi

if [ "$TOTAL_SKIP" -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped: ${TOTAL_SKIP}${NC}"
fi

echo ""
echo -e "  ${DIM}Results: $RESULTS_DIR${NC}"
echo -e "  ${DIM}Timing:  $RESULTS_DIR/chat-timing.csv${NC}"
echo ""

# Exit code: non-zero if any failures
[ "$TOTAL_FAIL" -eq 0 ] && exit 0 || exit 1
