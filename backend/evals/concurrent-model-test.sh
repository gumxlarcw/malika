#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# MALIKA Concurrent Model Tester v1.0
# Fires BOTH Flash (gpt-4.1) and Deep (gpt-5-mini) simultaneously per test case
# to test concurrent user load + compare latency & accuracy side by side.
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./concurrent-model-test.sh                    # All 81 tests, both models in parallel
#   ./concurrent-model-test.sh --quick            # Quick subset (~25 tests)
#   ./concurrent-model-test.sh --cat=overlap      # Specific category
#   ./concurrent-model-test.sh --tag=reconciler   # Filter by tag
#   ./concurrent-model-test.sh --id=G01,D01,OV01  # Specific test IDs
#   ./concurrent-model-test.sh --skip-deep-cat    # Skip deep category (cat=deep)
#
# Each test case spawns 2 curl requests concurrently (flash + deep),
# waits for both, then compares results side by side.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures/master-test-cases.json"
EVALUATOR="$SCRIPT_DIR/evaluate-chat-result.py"

# ── Config ────────────────────────────────────────────────────────────────────
API_URL="${API_URL:-http://localhost:5000}"
CHAT_TIMEOUT="${CHAT_TIMEOUT:-300}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
RESULTS_DIR="/tmp/malika_concurrent_${TIMESTAMP}"
mkdir -p "$RESULTS_DIR/flash" "$RESULTS_DIR/deep"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; MAGENTA='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ── Parse Arguments ───────────────────────────────────────────────────────────
CHAT_CAT=""; CHAT_TAG=""; CHAT_IDS=""; QUICK=false; SKIP_DEEP_CAT=false

for arg in "$@"; do
  case "$arg" in
    --quick)          QUICK=true ;;
    --skip-deep-cat)  SKIP_DEEP_CAT=true ;;
    --cat=*)          CHAT_CAT="${arg#--cat=}" ;;
    --tag=*)          CHAT_TAG="${arg#--tag=}" ;;
    --id=*)           CHAT_IDS="${arg#--id=}" ;;
    --help|-h)
      echo "Usage: $0 [--quick] [--cat=<cat>] [--tag=<tag>] [--id=ID1,ID2] [--skip-deep-cat]"
      exit 0 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo -e "║  ${BOLD}MALIKA Concurrent Model Test v1.0${NC}                                  ║"
echo -e "║  ${DIM}Flash (gpt-4.1) vs Deep (gpt-5-mini) — PARALLEL per query${NC}        ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S')                                                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${DIM}API:${NC}     $API_URL"
echo -e "  ${DIM}Timeout:${NC} ${CHAT_TIMEOUT}s"
echo -e "  ${DIM}Results:${NC} $RESULTS_DIR"
echo ""

# ── Health Check ──────────────────────────────────────────────────────────────
HC=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")
if [ "$HC" = "000" ]; then
  echo -e "  ${RED}✗${NC} Backend not reachable at $API_URL"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Backend healthy"
echo ""

# ── Build Test Case List ──────────────────────────────────────────────────────
CASES_FILE="$RESULTS_DIR/_cases.tsv"
python3 << PYEOF > "$CASES_FILE"
import json

cases = json.load(open('$FIXTURES'))['cases']
cat_filter = '$CHAT_CAT'
tag_filter = '$CHAT_TAG'
id_filter  = '$CHAT_IDS'
quick      = $( $QUICK && echo "True" || echo "False" )
skip_deep  = $( $SKIP_DEEP_CAT && echo "True" || echo "False" )

id_set = set(id_filter.split(',')) if id_filter else set()

for c in cases:
    if id_set and c['id'] not in id_set: continue
    if cat_filter and c['cat'] != cat_filter: continue
    if tag_filter and tag_filter not in c.get('tags', []): continue
    if quick and c['cat'] not in ('greeting', 'chitchat', 'default', 'edge', 'edge-oos'): continue
    if skip_deep and c['cat'] == 'deep': continue
    exp = c.get('expect','') or ''
    nt  = c.get('not','') or ''
    print(f"{c['id']}\t{c['cat']}\t{c['query']}\t{exp}\t{nt}")
PYEOF

CASE_COUNT=$(wc -l < "$CASES_FILE")
echo -e "  Running ${BOLD}$CASE_COUNT${NC} tests × 2 models = ${BOLD}$((CASE_COUNT * 2))${NC} total requests (concurrent pairs)"
echo ""

# ── CSV Headers ───────────────────────────────────────────────────────────────
TIMING_FLASH="$RESULTS_DIR/timing-flash.csv"
TIMING_DEEP="$RESULTS_DIR/timing-deep.csv"
COMPARISON="$RESULTS_DIR/comparison.csv"

HDR="status|id|cat|query|latency_s|text_len|model|total_ms|reconciler_ms|stream_ms|tokens_in|tokens_out"
echo "$HDR" > "$TIMING_FLASH"
echo "$HDR" > "$TIMING_DEEP"
echo "id|cat|query|flash_status|flash_lat|flash_ms|flash_ch|flash_tok|deep_status|deep_lat|deep_ms|deep_ch|deep_tok|winner|delta_s" > "$COMPARISON"

# ── Run function for one model ────────────────────────────────────────────────
# Runs curl + evaluate in one shot, writes result to a temp file
run_one_model() {
  local TEST_ID="$1" QUERY="$2" EXPECT_PAT="$3" MUST_NOT_PAT="$4" MODEL="$5" LABEL="$6" RESULT_FILE="$7"
  
  local OWNER="concurrent_${TIMESTAMP}_${LABEL}"
  
  # Create thread with retry (up to 3 attempts, 5s between)
  local TID="" ATTEMPT=0
  while [ $ATTEMPT -lt 3 ]; do
    ATTEMPT=$((ATTEMPT + 1))
    TID=$(curl -s --connect-timeout 10 -X POST "$API_URL/chat/threads" \
      -H 'Content-Type: application/json' \
      -H "x-malika-uid: $OWNER" \
      -d '{}' 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['thread']['id'])" 2>/dev/null || echo "")
    
    if [ -n "$TID" ] && [ "$TID" != "None" ]; then
      break
    fi
    [ $ATTEMPT -lt 3 ] && sleep 5
  done
  
  if [ -z "$TID" ] || [ "$TID" = "None" ]; then
    echo "0|FAIL|0|?|0|0|0|0|0|thread_fail|" > "$RESULT_FILE"
    return
  fi
  
  # Build URL
  local ENCODED
  ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")
  local URL="$API_URL/chat/threads/$TID/stream?text=$ENCODED&model=$MODEL"
  
  local OUTFILE="${RESULT_FILE%.verdict}.sse"
  local START_NS
  START_NS=$(date +%s%N)
  
  curl -s -N "$URL" \
    -H 'Accept: text/event-stream' \
    -H "x-malika-uid: $OWNER" \
    --max-time "$CHAT_TIMEOUT" > "$OUTFILE" 2>&1
  
  local END_NS
  END_NS=$(date +%s%N)
  local WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
  
  # Evaluate
  local VERDICT
  VERDICT=$(python3 "$EVALUATOR" "$OUTFILE" "$WALL_MS" "$EXPECT_PAT" "$MUST_NOT_PAT" 2>/dev/null || echo "ERR|0|?|0|0|0|0|0|parse_error|")
  echo "${WALL_MS:-0}|${VERDICT}" > "$RESULT_FILE"
}

export -f run_one_model
export API_URL CHAT_TIMEOUT TIMESTAMP EVALUATOR

# ── Main Loop ─────────────────────────────────────────────────────────────────
LAST_CAT=""
FLASH_PASS=0; FLASH_FAIL=0; DEEP_PASS=0; DEEP_FAIL=0
FLASH_FASTER=0; DEEP_FASTER=0; TIED=0
GLOBAL_START=$(date +%s)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}Concurrent Tests: Flash ⚡ vs Deep 🧠${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

while IFS=$'\t' read -r TEST_ID CAT QUERY EXPECT_PAT MUST_NOT_PAT; do
  
  # Section header on category change
  if [ "$CAT" != "$LAST_CAT" ]; then
    LAST_CAT="$CAT"
    CAT_UPPER=$(echo "$CAT" | tr '[:lower:]' '[:upper:]')
    echo -e "  ${CYAN}▸ $CAT_UPPER${NC}"
  fi
  
  # Temp files for results
  FLASH_RES="$RESULTS_DIR/flash/${TEST_ID}.verdict"
  DEEP_RES="$RESULTS_DIR/deep/${TEST_ID}.verdict"
  
  # Fire BOTH models concurrently
  run_one_model "$TEST_ID" "$QUERY" "$EXPECT_PAT" "$MUST_NOT_PAT" "gpt-4.1" "flash" "$FLASH_RES" &
  PID_FLASH=$!
  
  run_one_model "$TEST_ID" "$QUERY" "$EXPECT_PAT" "$MUST_NOT_PAT" "gpt-5-mini" "deep" "$DEEP_RES" &
  PID_DEEP=$!
  
  # Wait for both to finish
  wait $PID_FLASH 2>/dev/null || true
  wait $PID_DEEP 2>/dev/null || true
  
  # Parse flash result: WALL_MS|STATUS|TEXT_LEN|MODEL|TOTAL_MS|RECON|STREAM|TOKIN|TOKOUT|REASON|PREVIEW
  if [ -f "$FLASH_RES" ]; then
    F_RAW=$(cat "$FLASH_RES")
    F_WALL=$(echo "$F_RAW" | cut -d'|' -f1)
    F_STATUS=$(echo "$F_RAW" | cut -d'|' -f2)
    F_TEXTLEN=$(echo "$F_RAW" | cut -d'|' -f3)
    F_MODEL=$(echo "$F_RAW" | cut -d'|' -f4)
    F_TOTAL=$(echo "$F_RAW" | cut -d'|' -f5)
    F_RECON=$(echo "$F_RAW" | cut -d'|' -f6)
    F_STREAM=$(echo "$F_RAW" | cut -d'|' -f7)
    F_TOKIN=$(echo "$F_RAW" | cut -d'|' -f8)
    F_TOKOUT=$(echo "$F_RAW" | cut -d'|' -f9)
    F_REASON=$(echo "$F_RAW" | cut -d'|' -f10)
  else
    F_WALL=0; F_STATUS="FAIL"; F_TEXTLEN=0; F_MODEL="?"; F_TOTAL=0; F_RECON=0; F_STREAM=0; F_TOKIN=0; F_TOKOUT=0; F_REASON="no_result"
  fi
  
  # Parse deep result
  if [ -f "$DEEP_RES" ]; then
    D_RAW=$(cat "$DEEP_RES")
    D_WALL=$(echo "$D_RAW" | cut -d'|' -f1)
    D_STATUS=$(echo "$D_RAW" | cut -d'|' -f2)
    D_TEXTLEN=$(echo "$D_RAW" | cut -d'|' -f3)
    D_MODEL=$(echo "$D_RAW" | cut -d'|' -f4)
    D_TOTAL=$(echo "$D_RAW" | cut -d'|' -f5)
    D_RECON=$(echo "$D_RAW" | cut -d'|' -f6)
    D_STREAM=$(echo "$D_RAW" | cut -d'|' -f7)
    D_TOKIN=$(echo "$D_RAW" | cut -d'|' -f8)
    D_TOKOUT=$(echo "$D_RAW" | cut -d'|' -f9)
    D_REASON=$(echo "$D_RAW" | cut -d'|' -f10)
  else
    D_WALL=0; D_STATUS="FAIL"; D_TEXTLEN=0; D_MODEL="?"; D_TOTAL=0; D_RECON=0; D_STREAM=0; D_TOKIN=0; D_TOKOUT=0; D_REASON="no_result"
  fi
  
  # Sanitize numeric values (in case of parse errors)
  F_WALL=$(echo "${F_WALL}" | grep -oP '^\d+' || echo "0")
  D_WALL=$(echo "${D_WALL}" | grep -oP '^\d+' || echo "0")
  F_TOTAL=$(echo "${F_TOTAL}" | grep -oP '^\d+' || echo "0")
  D_TOTAL=$(echo "${D_TOTAL}" | grep -oP '^\d+' || echo "0")
  
  # Latency in seconds
  F_LAT=$(python3 -c "print(f'{${F_WALL:-0}/1000:.1f}')")
  D_LAT=$(python3 -c "print(f'{${D_WALL:-0}/1000:.1f}')")
  F_PIPE=$(python3 -c "print(f'{${F_TOTAL:-0}/1000:.1f}')")
  D_PIPE=$(python3 -c "print(f'{${D_TOTAL:-0}/1000:.1f}')")
  
  # Winner by latency
  DELTA_S=$(python3 -c "print(f'{abs(${F_WALL:-0}-${D_WALL:-0})/1000:.1f}')")
  if [ "${F_WALL:-0}" -lt "${D_WALL:-0}" ]; then
    WINNER="flash"
    FLASH_FASTER=$((FLASH_FASTER + 1))
  elif [ "${D_WALL:-0}" -lt "${F_WALL:-0}" ]; then
    WINNER="deep"
    DEEP_FASTER=$((DEEP_FASTER + 1))
  else
    WINNER="tie"
    TIED=$((TIED + 1))
  fi
  
  # Count pass/fail
  [ "$F_STATUS" = "PASS" ] && FLASH_PASS=$((FLASH_PASS + 1)) || FLASH_FAIL=$((FLASH_FAIL + 1))
  [ "$D_STATUS" = "PASS" ] && DEEP_PASS=$((DEEP_PASS + 1)) || DEEP_FAIL=$((DEEP_FAIL + 1))
  
  # Display result — compact format
  F_ICON=$( [ "$F_STATUS" = "PASS" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}" )
  D_ICON=$( [ "$D_STATUS" = "PASS" ] && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}" )
  
  WINNER_TAG=""
  if [ "$WINNER" = "flash" ]; then
    WINNER_TAG="${YELLOW}⚡flash -${DELTA_S}s${NC}"
  elif [ "$WINNER" = "deep" ]; then
    WINNER_TAG="${MAGENTA}🧠deep -${DELTA_S}s${NC}"
  else
    WINNER_TAG="${DIM}tie${NC}"
  fi
  
  echo -e "    [$TEST_ID] ${F_ICON}⚡${F_LAT}s(${F_TEXTLEN}ch) ${D_ICON}🧠${D_LAT}s(${D_TEXTLEN}ch) → ${WINNER_TAG}"
  
  # Show fail reasons
  if [ "$F_STATUS" != "PASS" ]; then
    echo -e "      ${DIM}Flash fail: ${F_REASON}${NC}"
  fi
  if [ "$D_STATUS" != "PASS" ]; then
    echo -e "      ${DIM}Deep fail: ${D_REASON}${NC}"
  fi
  
  # Write CSVs
  echo "PASS|$TEST_ID|$CAT|$QUERY|${F_LAT}|$F_TEXTLEN|$F_MODEL|$F_TOTAL|$F_RECON|$F_STREAM|$F_TOKIN|$F_TOKOUT" >> "$TIMING_FLASH" 2>/dev/null || true
  echo "${D_STATUS}|$TEST_ID|$CAT|$QUERY|${D_LAT}|$D_TEXTLEN|$D_MODEL|$D_TOTAL|$D_RECON|$D_STREAM|$D_TOKIN|$D_TOKOUT" >> "$TIMING_DEEP" 2>/dev/null || true
  
  # Fix: write correct flash status
  sed -i "$ s/^PASS/$F_STATUS/" "$TIMING_FLASH" 2>/dev/null || true
  
  echo "$TEST_ID|$CAT|$QUERY|$F_STATUS|$F_LAT|$F_TOTAL|$F_TEXTLEN|$F_TOKOUT|$D_STATUS|$D_LAT|$D_TOTAL|$D_TEXTLEN|$D_TOKOUT|$WINNER|$DELTA_S" >> "$COMPARISON"

  # Cooldown between test pairs to prevent backend overload (3s for data queries)
  if [ "${F_WALL:-0}" -gt 1000 ] || [ "${D_WALL:-0}" -gt 1000 ]; then
    sleep 3
  fi

done < "$CASES_FILE"

GLOBAL_END=$(date +%s)
GLOBAL_ELAPSED=$((GLOBAL_END - GLOBAL_START))

# ══════════════════════════════════════════════════════════════════════════════
# COMPARISON SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo -e "║  ${BOLD}CONCURRENT COMPARISON REPORT${NC}                                       ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

TOTAL_CASES=$((FLASH_PASS + FLASH_FAIL))
echo -e "  ${BOLD}Accuracy${NC}"
echo "  ──────────────────────────────────────────────────────────"
F_RATE=$(python3 -c "t=$TOTAL_CASES; print(f'{$FLASH_PASS/t*100:.1f}%' if t>0 else 'N/A')")
D_RATE=$(python3 -c "t=$TOTAL_CASES; print(f'{$DEEP_PASS/t*100:.1f}%' if t>0 else 'N/A')")
echo -e "  ⚡ Flash (gpt-4.1):    ${FLASH_PASS}/${TOTAL_CASES} passed (${F_RATE})"
echo -e "  🧠 Deep  (gpt-5-mini): ${DEEP_PASS}/${TOTAL_CASES} passed (${D_RATE})"

BOTH_PASS=$(python3 -c "
flash_pass = set(); deep_pass = set()
with open('$TIMING_FLASH') as f:
    for line in f.readlines()[1:]:
        parts = line.strip().split('|')
        if len(parts) > 1 and parts[0] == 'PASS': flash_pass.add(parts[1])
with open('$TIMING_DEEP') as f:
    for line in f.readlines()[1:]:
        parts = line.strip().split('|')
        if len(parts) > 1 and parts[0] == 'PASS': deep_pass.add(parts[1])
both = flash_pass & deep_pass
flash_only = flash_pass - deep_pass
deep_only = deep_pass - flash_pass
neither = set()
# we'll print the counts
print(f'{len(both)}|{len(flash_only)}|{len(deep_only)}')
" 2>/dev/null || echo "0|0|0")

BOTH_N=$(echo "$BOTH_PASS" | cut -d'|' -f1)
FLASH_ONLY_N=$(echo "$BOTH_PASS" | cut -d'|' -f2)
DEEP_ONLY_N=$(echo "$BOTH_PASS" | cut -d'|' -f3)

echo -e "  Both pass: ${BOTH_N}  |  Flash-only pass: ${FLASH_ONLY_N}  |  Deep-only pass: ${DEEP_ONLY_N}"

echo ""
echo -e "  ${BOLD}Latency${NC}"
echo "  ──────────────────────────────────────────────────────────"
echo -e "  ⚡ Flash faster: ${FLASH_FASTER} tests"
echo -e "  🧠 Deep  faster: ${DEEP_FASTER} tests"
echo -e "  = Tied:          ${TIED} tests"

# Detailed latency stats via Python
echo ""
COMP_FILE="$COMPARISON" python3 << 'PYEOF'
import csv, os, sys

comp = os.environ.get('COMP_FILE', '')
if not comp:
    sys.exit(0)

flash_times = []; deep_times = []
cats = {}

with open(comp) as f:
    reader = csv.reader(f, delimiter='|')
    header = next(reader)
    for row in reader:
        if len(row) < 15: continue
        tid, cat, query, f_st, f_lat, f_ms, f_ch, f_tok, d_st, d_lat, d_ms, d_ch, d_tok, winner, delta = row[:15]
        try:
            fl = float(f_lat); dl = float(d_lat)
        except: continue
        
        flash_times.append(fl); deep_times.append(dl)
        
        if cat not in cats:
            cats[cat] = {'flash': [], 'deep': [], 'f_pass': 0, 'f_fail': 0, 'd_pass': 0, 'd_fail': 0}
        cats[cat]['flash'].append(fl)
        cats[cat]['deep'].append(dl)
        cats[cat]['f_pass' if f_st == 'PASS' else 'f_fail'] += 1
        cats[cat]['d_pass' if d_st == 'PASS' else 'd_fail'] += 1

if not flash_times:
    print("  No data to analyze")
    sys.exit(0)

# Overall averages
f_avg = sum(flash_times)/len(flash_times)
d_avg = sum(deep_times)/len(deep_times)
f_med = sorted(flash_times)[len(flash_times)//2]
d_med = sorted(deep_times)[len(deep_times)//2]
f_p95 = sorted(flash_times)[int(len(flash_times)*0.95)]
d_p95 = sorted(deep_times)[int(len(deep_times)*0.95)]

print(f"  {'Metric':<12s} {'Flash':>8s} {'Deep':>8s} {'Delta':>8s}")
print(f"  {'─'*12} {'─'*8} {'─'*8} {'─'*8}")
print(f"  {'Average':<12s} {f_avg:7.1f}s {d_avg:7.1f}s {abs(f_avg-d_avg):7.1f}s {'⚡' if f_avg < d_avg else '🧠'}")
print(f"  {'Median':<12s} {f_med:7.1f}s {d_med:7.1f}s {abs(f_med-d_med):7.1f}s {'⚡' if f_med < d_med else '🧠'}")
print(f"  {'P95':<12s} {f_p95:7.1f}s {d_p95:7.1f}s {abs(f_p95-d_p95):7.1f}s {'⚡' if f_p95 < d_p95 else '🧠'}")
print(f"  {'Min':<12s} {min(flash_times):7.1f}s {min(deep_times):7.1f}s")
print(f"  {'Max':<12s} {max(flash_times):7.1f}s {max(deep_times):7.1f}s")
print(f"  {'Total':<12s} {sum(flash_times):7.0f}s {sum(deep_times):7.0f}s")

# Per-category breakdown
print()
print(f"  {'Category':<18s} {'⚡Avg':>6s} {'⚡P/F':>6s} {'🧠Avg':>6s} {'🧠P/F':>6s} {'Faster':>7s}")
print(f"  {'─'*18} {'─'*6} {'─'*6} {'─'*6} {'─'*6} {'─'*7}")
for cat in sorted(cats.keys()):
    d = cats[cat]
    fa = sum(d['flash'])/len(d['flash'])
    da = sum(d['deep'])/len(d['deep'])
    fp = f"{d['f_pass']}/{d['f_pass']+d['f_fail']}"
    dp = f"{d['d_pass']}/{d['d_pass']+d['d_fail']}"
    faster = '⚡' if fa < da else '🧠' if da < fa else '='
    print(f"  {cat:<18s} {fa:5.1f}s {fp:>6s} {da:5.1f}s {dp:>6s} {faster:>7s}")

# Accuracy mismatches
flash_only = []
deep_only = []
with open(comp) as f:
    reader = csv.reader(f, delimiter='|')
    next(reader)
    for row in reader:
        if len(row) < 15: continue
        tid, cat = row[0], row[1]
        f_st, d_st = row[3], row[8]
        if f_st == 'PASS' and d_st != 'PASS':
            flash_only.append((tid, cat))
        if d_st == 'PASS' and f_st != 'PASS':
            deep_only.append((tid, cat))

if flash_only or deep_only:
    print()
    print("  ── Accuracy Differences ─────────────────────────────────")
    if flash_only:
        ids = ', '.join(f"{t}({c})" for t,c in flash_only)
        print(f"  ⚡ Flash-only PASS ({len(flash_only)}): {ids}")
    if deep_only:
        ids = ', '.join(f"{t}({c})" for t,c in deep_only)
        print(f"  🧠 Deep-only PASS  ({len(deep_only)}): {ids}")
PYEOF

echo ""
echo "  ──────────────────────────────────────────────────────────"
echo -e "  ${DIM}Wall time: ${GLOBAL_ELAPSED}s (concurrent — actual request time is 2× this)${NC}"
echo -e "  ${DIM}Results: $RESULTS_DIR${NC}"
echo -e "  ${DIM}Comparison CSV: $RESULTS_DIR/comparison.csv${NC}"
echo ""

# Conclusion
echo -e "  ${BOLD}CONCLUSION:${NC}"
if [ "$FLASH_PASS" -gt "$DEEP_PASS" ]; then
  echo -e "  ⚡ Flash wins on accuracy (${FLASH_PASS} vs ${DEEP_PASS})"
elif [ "$DEEP_PASS" -gt "$FLASH_PASS" ]; then
  echo -e "  🧠 Deep wins on accuracy (${DEEP_PASS} vs ${FLASH_PASS})"
else
  echo -e "  = Accuracy tied (${FLASH_PASS} vs ${DEEP_PASS})"
fi

if [ "$FLASH_FASTER" -gt "$DEEP_FASTER" ]; then
  echo -e "  ⚡ Flash wins on latency (faster in ${FLASH_FASTER}/${TOTAL_CASES} tests)"
elif [ "$DEEP_FASTER" -gt "$FLASH_FASTER" ]; then
  echo -e "  🧠 Deep wins on latency (faster in ${DEEP_FASTER}/${TOTAL_CASES} tests)"
else
  echo -e "  = Latency tied (${FLASH_FASTER} vs ${DEEP_FASTER})"
fi
echo ""
