#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MALIKA A/B Comparison Test: Full vs Balanced Sub-Agent Modes
# Date: 2026-02-17
#
# Runs the same queries with subAgentMode=full (all sub-agents use gpt-4.1)
# and subAgentMode=balanced (tiered: TRIVIAL=nano, MODERATE=mini, HEAVY=4.1)
# then compares accuracy and latency between the two modes.
#
# Usage: bash evals/ab-comparison-test.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

API="http://localhost:5000"
RESULTS_DIR="/tmp/malika_ab_test"
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR/full" "$RESULTS_DIR/balanced"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Test Definitions ─────────────────────────────────────────────────────
# Format: ID|Category|Query|ExpectPattern
# Selecting 20 representative tests across all categories
declare -a TESTS=(
  # Greetings (2)
  "G01|Greeting|halo|halo|hai|selamat|malika|bantu"
  "G04|Chitchat|siapa kamu|malika|asisten|bps|statistik"
  # Default behavior (3)
  "D01|Default-Geo|berapa angka kemiskinan|maluku utara|malut|provinsi"
  "D04|Default-Latest|data kemiskinan|202[4-6]|terbaru|terakhir|terkini"
  "D07|Default-Latest|data pdrb|pdrb|produk domestik|202[4-6]"
  # Specific period (2)
  "P01|Period-Year|kemiskinan tahun 2023|2023"
  "P02|Period-Month|inflasi desember 2024|desember|december|12.*2024|2024"
  # Specific geo (2)
  "GE01|Geo-Kota|kemiskinan di kota ternate|ternate"
  "GE02|Geo-Kab|pengangguran halmahera utara|halmahera utara|halut"
  # Statistical (3)
  "S01|Stat|berapa persen penduduk miskin di maluku utara|persen|%|miskin|kemiskinan"
  "S03|Stat|berapa indeks pembangunan manusia maluku utara|ipm|indeks pembangunan"
  "S04|Stat|berapa inflasi maluku utara|inflasi|persen|%|ihk"
  # Knowledge base (2)
  "K02|KB|brs kemiskinan|brs|kemiskinan|miskin|berita"
  "K07|KB|ada publikasi tentang ketenagakerjaan|publikasi|ketenagakerjaan|tenaga kerja"
  # EXIM (1)
  "E01|EXIM|data ekspor maluku utara|ekspor|export|dolar|usd|ton"
  # Analytical (2)
  "C01|Analytical|bandingkan kemiskinan kota ternate dan halmahera utara|ternate|halmahera utara|banding|perbandingan|lebih"
  "C03|Analytical|kabupaten mana yang paling miskin di maluku utara|kabupaten|miskin|kemiskinan|paling|tertinggi"
  # Edge cases (2)
  "X01|Edge|kemsikinan malku utara|kemiskinan|miskin|maluku utara"
  "X05|Edge-OOS|siapa presiden indonesia|malika|bps|statistik|maaf|tidak|bantu"
  # Deep mode (1)
  "DM01|Deep|analisis mendalam kemiskinan maluku utara dari berbagai dimensi|kemiskinan|maluku utara|dimensi|analisis"
)

TOTAL_TESTS=${#TESTS[@]}

# ── Test Runner Function ─────────────────────────────────────────────────

run_single_test() {
  local TEST_DEF="$1"
  local MODE="$2"   # full or balanced
  local RUN_NUM="$3"

  # Parse test definition (ID|Category|Query|Pattern)
  local TEST_ID CATEGORY QUERY EXPECT_PATTERN
  TEST_ID=$(echo "$TEST_DEF" | cut -d'|' -f1)
  CATEGORY=$(echo "$TEST_DEF" | cut -d'|' -f2)
  QUERY=$(echo "$TEST_DEF" | cut -d'|' -f3)
  EXPECT_PATTERN=$(echo "$TEST_DEF" | cut -d'|' -f4-)

  local OWNER="ab_${MODE}_${TEST_ID}_r${RUN_NUM}"
  local ENCODED
  ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")

  # Create thread
  local TID
  TID=$(curl -s -X POST "$API/chat/threads" \
    -H 'Content-Type: application/json' \
    -H "x-malika-uid: $OWNER" \
    -d '{}' 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['thread']['id'])" 2>/dev/null)

  if [ -z "$TID" ] || [ "$TID" = "None" ]; then
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|thread_fail|0|0" >> "$RESULTS_DIR/$MODE/results.log"
    return
  fi

  local OUTFILE="$RESULTS_DIR/$MODE/${TEST_ID}.txt"
  local START_NS=$(date +%s%N)

  # Build URL with subAgentMode
  local URL="$API/chat/threads/$TID/stream?text=$ENCODED&subAgentMode=$MODE"

  # Deep mode tests use gpt-5-mini model
  if [ "$CATEGORY" = "Deep" ]; then
    URL="$URL&model=gpt-5-mini"
  fi

  curl -s -N "$URL" \
    -H 'Accept: text/event-stream' \
    -H "x-malika-uid: $OWNER" \
    --max-time 180 > "$OUTFILE" 2>&1

  local END_NS=$(date +%s%N)
  local LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

  # Parse response
  local PARSE_RESULT
  PARSE_RESULT=$(python3 << PYEOF
import re, json
data = open('$OUTFILE').read()
m = re.search(r'event:\s*done\ndata:\s*(.+)', data)
if m:
    try:
        d = json.loads(m.group(1))
        ft = d.get('full_text', '')
        pipe_ms = d.get('metadata', {}).get('pipeline_ms', {}).get('total', '?')
        print(f'OK|{len(ft)}|{pipe_ms}|{ft}')
    except:
        print(f'PARSE_ERR|0|?|')
else:
    print(f'NO_DONE|0|?|')
PYEOF
)

  local STATUS=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f1)
  local TEXT_LEN=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f2)
  local PIPE_MS=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f3)
  local FULL_TEXT=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f4-)
  local LAT_S=$(python3 -c "print(f'{$LATENCY_MS/1000:.1f}')")

  if [ "$STATUS" != "OK" ] || [ "${TEXT_LEN:-0}" -lt 5 ]; then
    echo -e "  ${RED}✗${NC} [$MODE] $TEST_ID $CATEGORY: $STATUS (${LAT_S}s)"
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|$STATUS|${LAT_S}|$TEXT_LEN|$PIPE_MS" >> "$RESULTS_DIR/$MODE/results.log"
    return
  fi

  # Pattern matching
  local MATCH=1
  if [ -n "$EXPECT_PATTERN" ]; then
    echo "$FULL_TEXT" | grep -qiP "$EXPECT_PATTERN" || MATCH=0
  fi

  if [ $MATCH -eq 1 ]; then
    echo -e "  ${GREEN}✓${NC} [$MODE] $TEST_ID $CATEGORY: ${LAT_S}s (pipe=${PIPE_MS}ms)"
    echo "PASS|$TEST_ID|$CATEGORY|$QUERY|ok|${LAT_S}|$TEXT_LEN|$PIPE_MS" >> "$RESULTS_DIR/$MODE/results.log"
  else
    echo -e "  ${YELLOW}△${NC} [$MODE] $TEST_ID $CATEGORY: Pattern mismatch (${LAT_S}s)"
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|pattern_mismatch|${LAT_S}|$TEXT_LEN|$PIPE_MS" >> "$RESULTS_DIR/$MODE/results.log"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  ${BOLD}MALIKA A/B Comparison: Full vs Balanced Sub-Agent Modes${NC}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Tests: $TOTAL_TESTS queries × 2 modes = $((TOTAL_TESTS * 2)) total requests"
echo ""
echo "  Mode A (full):     All sub-agents use gpt-4.1"
echo "  Mode B (balanced): TRIVIAL=nano, MODERATE=mini, HEAVY=gpt-4.1"
echo "════════════════════════════════════════════════════════════════════════"

# Init log files
> "$RESULTS_DIR/full/results.log"
> "$RESULTS_DIR/balanced/results.log"

# ── Run Mode A: FULL ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ MODE A: FULL (all sub-agents → gpt-4.1) ━━━${NC}"
echo ""
FULL_START=$(date +%s)

for i in "${!TESTS[@]}"; do
  run_single_test "${TESTS[$i]}" "full" "1"
done

FULL_END=$(date +%s)
FULL_ELAPSED=$((FULL_END - FULL_START))
echo ""
echo -e "  Mode A total wall time: ${BOLD}${FULL_ELAPSED}s${NC}"

# ── Run Mode B: BALANCED ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ MODE B: BALANCED (tiered sub-agents) ━━━${NC}"
echo ""
BAL_START=$(date +%s)

for i in "${!TESTS[@]}"; do
  run_single_test "${TESTS[$i]}" "balanced" "1"
done

BAL_END=$(date +%s)
BAL_ELAPSED=$((BAL_END - BAL_START))
echo ""
echo -e "  Mode B total wall time: ${BOLD}${BAL_ELAPSED}s${NC}"

# ═══════════════════════════════════════════════════════════════════════════
# COMPARISON SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  ${BOLD}A/B COMPARISON RESULTS${NC}"
echo "════════════════════════════════════════════════════════════════════════"

python3 << 'PYEOF'
import os

def load_results(path):
    results = {}
    if not os.path.exists(path):
        return results
    for line in open(path):
        parts = line.strip().split('|')
        if len(parts) >= 8:
            status, tid, cat, query, reason, lat_s, tlen, pipe_ms = parts[:8]
            results[tid] = {
                'status': status,
                'category': cat,
                'query': query,
                'reason': reason,
                'latency_s': float(lat_s) if lat_s != '?' else 999,
                'text_len': int(tlen),
                'pipe_ms': int(pipe_ms) if pipe_ms not in ('?', '') else 0,
            }
    return results

full = load_results('/tmp/malika_ab_test/full/results.log')
bal = load_results('/tmp/malika_ab_test/balanced/results.log')

all_ids = sorted(set(full.keys()) | set(bal.keys()))

print()
print(f"  {'ID':<6s} {'Category':<14s} {'Full':>8s} {'Balanced':>10s} {'Diff':>8s} {'Accuracy':>10s}")
print(f"  {'─'*6} {'─'*14} {'─'*8} {'─'*10} {'─'*8} {'─'*10}")

full_pass = 0; bal_pass = 0
full_total_s = 0; bal_total_s = 0
full_count = 0; bal_count = 0
accuracy_changes = {'improved': 0, 'regressed': 0, 'same': 0}

for tid in all_ids:
    f = full.get(tid, {})
    b = bal.get(tid, {})
    cat = f.get('category', b.get('category', '?'))

    f_lat = f.get('latency_s', 999)
    b_lat = b.get('latency_s', 999)
    f_status = f.get('status', 'N/A')
    b_status = b.get('status', 'N/A')

    if f_lat < 900: full_total_s += f_lat; full_count += 1
    if b_lat < 900: bal_total_s += b_lat; bal_count += 1
    if f_status == 'PASS': full_pass += 1
    if b_status == 'PASS': bal_pass += 1

    diff = b_lat - f_lat if (f_lat < 900 and b_lat < 900) else 0
    diff_str = f"{diff:+.1f}s" if diff != 0 else "  0.0s"

    # Accuracy comparison
    acc = "same"
    if f_status == 'PASS' and b_status != 'PASS':
        acc = "REGRESSED"
        accuracy_changes['regressed'] += 1
    elif f_status != 'PASS' and b_status == 'PASS':
        acc = "IMPROVED"
        accuracy_changes['improved'] += 1
    else:
        accuracy_changes['same'] += 1

    f_disp = f"{f_lat:.1f}s" if f_lat < 900 else "FAIL"
    b_disp = f"{b_lat:.1f}s" if b_lat < 900 else "FAIL"

    acc_color = ""
    if acc == "REGRESSED": acc_color = "⚠️"
    elif acc == "IMPROVED": acc_color = "✅"

    print(f"  {tid:<6s} {cat:<14s} {f_disp:>8s} {b_disp:>10s} {diff_str:>8s} {acc_color}{acc}")

# Summary
print()
print(f"  ───────────────────────────────────────────────────────────────")
n = len(all_ids)
f_rate = f"{full_pass}/{n}" if n > 0 else "0/0"
b_rate = f"{bal_pass}/{n}" if n > 0 else "0/0"
f_avg = full_total_s / full_count if full_count > 0 else 0
b_avg = bal_total_s / bal_count if bal_count > 0 else 0
speedup = ((f_avg - b_avg) / f_avg * 100) if f_avg > 0 else 0

print()
print(f"  ACCURACY")
print(f"    Full:     {f_rate} pass ({full_pass/n*100:.1f}%)" if n > 0 else "    Full:     N/A")
print(f"    Balanced: {b_rate} pass ({bal_pass/n*100:.1f}%)" if n > 0 else "    Balanced: N/A")
print(f"    Changes:  {accuracy_changes['improved']} improved, {accuracy_changes['regressed']} regressed, {accuracy_changes['same']} same")
print()
print(f"  LATENCY")
print(f"    Full avg:     {f_avg:.1f}s (total {full_total_s:.0f}s)")
print(f"    Balanced avg: {b_avg:.1f}s (total {bal_total_s:.0f}s)")
print(f"    Speedup:      {speedup:+.1f}%  ({'faster' if speedup > 0 else 'slower'})")
print()

# Verdict
if accuracy_changes['regressed'] == 0 and speedup > 10:
    print(f"  ✅ VERDICT: Balanced mode is {speedup:.0f}% faster with NO accuracy regressions!")
elif accuracy_changes['regressed'] == 0 and speedup > 0:
    print(f"  ✅ VERDICT: Balanced mode is {speedup:.0f}% faster with no accuracy regressions")
elif accuracy_changes['regressed'] > 0 and speedup > 20:
    print(f"  ⚠️ VERDICT: Balanced mode is {speedup:.0f}% faster but has {accuracy_changes['regressed']} accuracy regression(s)")
elif accuracy_changes['regressed'] > 0:
    print(f"  ❌ VERDICT: Balanced mode has {accuracy_changes['regressed']} regression(s) — needs investigation")
else:
    print(f"  ℹ️ VERDICT: Similar performance between modes")

print()

PYEOF

echo "════════════════════════════════════════════════════════════════════════"
echo "  Full wall time:     ${FULL_ELAPSED}s"
echo "  Balanced wall time: ${BAL_ELAPSED}s"
echo "  Results: $RESULTS_DIR/"
echo "════════════════════════════════════════════════════════════════════════"
