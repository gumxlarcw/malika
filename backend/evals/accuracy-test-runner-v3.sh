#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MALIKA Chat Accuracy & Latency Test Runner v3 (fixed parsing)
# Date: 2026-02-16
# ─────────────────────────────────────────────────────────────────────────────

API="http://localhost:5000"
OWNER_PREFIX="at3"
RESULTS_DIR="/tmp/malika_accuracy_tests_v3"
mkdir -p "$RESULTS_DIR"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
PASS=0; FAIL=0; TOTAL=0
RESULTS_LOG="$RESULTS_DIR/results.log"
> "$RESULTS_LOG"

run_test() {
  local TEST_ID="$1" CATEGORY="$2" QUERY="$3"
  local EXPECT_PATTERN="$4" MUST_NOT_PATTERN="$5" MODEL="${6:-}"

  TOTAL=$((TOTAL + 1))
  local OWNER="${OWNER_PREFIX}_${TEST_ID}"
  local ENCODED
  ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")

  local TID
  TID=$(curl -s -X POST "$API/chat/threads" \
    -H 'Content-Type: application/json' \
    -H "x-malika-uid: $OWNER" \
    -d '{}' 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['thread']['id'])" 2>/dev/null)

  if [ -z "$TID" ] || [ "$TID" = "None" ]; then
    echo -e "  ${RED}✗${NC} [$TEST_ID] $CATEGORY: Thread creation failed"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|thread_fail|0|0" >> "$RESULTS_LOG"
    return
  fi

  local OUTFILE="$RESULTS_DIR/${TEST_ID}.txt"
  local START_NS=$(date +%s%N)

  local URL="$API/chat/threads/$TID/stream?text=$ENCODED"
  [ -n "$MODEL" ] && URL="$URL&model=$MODEL"

  curl -s -N "$URL" \
    -H 'Accept: text/event-stream' \
    -H "x-malika-uid: $OWNER" \
    --max-time 180 > "$OUTFILE" 2>&1

  local END_NS=$(date +%s%N)
  local LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

  # Parse with Python — handles nested JSON properly
  local PARSE_RESULT
  PARSE_RESULT=$(python3 << PYEOF
import re, json
data = open('$OUTFILE').read()
# Find "event: done\ndata: {....}" — grab everything after "data: " until next double-newline
m = re.search(r'event:\s*done\ndata:\s*(.+)', data)
if m:
    try:
        d = json.loads(m.group(1))
        ft = d.get('full_text', '').replace('\n', ' ').replace('\r', '')
        meta = json.dumps(d.get('metadata', {}))
        print(f'OK|{len(ft)}|{meta}|{ft}')
    except:
        print(f'PARSE_ERR|0|{{}}|')
else:
    print(f'NO_DONE|0|{{}}|')
PYEOF
)

  local STATUS=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f1)
  local TEXT_LEN=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f2)
  local META_JSON=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f3)
  local FULL_TEXT=$(echo "$PARSE_RESULT" | head -1 | cut -d'|' -f4-)
  local LAT_S=$(python3 -c "print(f'{$LATENCY_MS/1000:.1f}')")

  # Extract pipeline latency from metadata
  local PIPE_MS=$(python3 -c "
import json
m = json.loads('$META_JSON') if '$META_JSON' != '{}' else {}
print(m.get('pipeline_ms',{}).get('total','?'))
" 2>/dev/null)

  if [ "$STATUS" != "OK" ] || [ "${TEXT_LEN:-0}" -lt 5 ]; then
    echo -e "  ${RED}✗${NC} [$TEST_ID] $CATEGORY: $STATUS (${LAT_S}s, len=${TEXT_LEN:-0})"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|$STATUS|${LAT_S}|${TEXT_LEN:-0}" >> "$RESULTS_LOG"
    return
  fi

  # Pattern matching
  local MATCH=1 MUST_NOT=0
  if [ -n "$EXPECT_PATTERN" ]; then
    echo "$FULL_TEXT" | grep -qiP "$EXPECT_PATTERN" || MATCH=0
  fi
  if [ -n "$MUST_NOT_PATTERN" ]; then
    echo "$FULL_TEXT" | grep -qiP "$MUST_NOT_PATTERN" && MUST_NOT=1
  fi

  if [ $MATCH -eq 1 ] && [ $MUST_NOT -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} [$TEST_ID] $CATEGORY: ${LAT_S}s (${TEXT_LEN} ch, pipe=${PIPE_MS}ms)"
    PASS=$((PASS + 1))
    echo "PASS|$TEST_ID|$CATEGORY|$QUERY|ok|${LAT_S}|$TEXT_LEN" >> "$RESULTS_LOG"
  else
    local REASON=""
    [ $MATCH -eq 0 ] && REASON="expected_missing"
    [ $MUST_NOT -eq 1 ] && REASON="${REASON}+must_not_found"
    echo -e "  ${YELLOW}△${NC} [$TEST_ID] $CATEGORY: Pattern mismatch (${LAT_S}s, ${TEXT_LEN} ch)"
    echo -e "      Expected: ${EXPECT_PATTERN:0:80}"
    echo -e "      Got: ${FULL_TEXT:0:120}"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|$REASON|${LAT_S}|$TEXT_LEN" >> "$RESULTS_LOG"
  fi
}

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  ${BOLD}MALIKA Chat Accuracy & Latency Test Suite v3${NC}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 1: GREETINGS & CHITCHAT (6 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 1. Greetings & Chitchat${NC}"
run_test "G01" "Greeting" "halo" "halo|hai|selamat|malika|bantu"
run_test "G02" "Greeting" "selamat pagi" "pagi|selamat|malika|bantu"
run_test "G03" "Greeting" "hi malika" "hai|halo|malika|bantu"
run_test "G04" "Chitchat" "siapa kamu" "malika|asisten|bps|statistik"
run_test "G05" "Chitchat" "apa yang bisa kamu lakukan" "data|statistik|informasi|bantu|cari"
run_test "G06" "Chitchat" "terima kasih" "sama-sama|terima kasih|senang|bantu"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 2: DEFAULT BEHAVIOR — Latest + Maluku Utara (7 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 2. Default Behavior (Latest Period + Maluku Utara)${NC}"
run_test "D01" "Default-Geo" "berapa angka kemiskinan" "maluku utara|malut|provinsi"
run_test "D02" "Default-Geo" "data pengangguran" "maluku utara|malut|provinsi"
run_test "D03" "Default-Geo" "inflasi bulan ini" "maluku utara|malut|ternate|provinsi"
run_test "D04" "Default-Latest" "data kemiskinan" "202[4-6]|terbaru|terakhir|terkini"
run_test "D05" "Default-Latest" "angka ipm" "202[4-6]|terbaru|terakhir|terkini|ipm"
run_test "D06" "Default-Geo" "berapa jumlah penduduk" "maluku utara|malut|provinsi"
run_test "D07" "Default-Latest" "data pdrb" "pdrb|produk domestik|202[4-6]"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 3: SPECIFIC PERIOD (5 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 3. Specific Period Queries${NC}"
run_test "P01" "Period-Year" "kemiskinan tahun 2023" "2023"
run_test "P02" "Period-Month" "inflasi desember 2024" "desember|december|12.*2024|2024"
run_test "P03" "Period-Quarter" "pdrb triwulan 3 2024" "triwulan|kuartal|q3|tw.?3|2024"
run_test "P04" "Period-Year" "pengangguran 2024" "2024"
run_test "P05" "Period-Semester" "pertumbuhan ekonomi semester 1 2025" "semester|2025|pertumbuhan"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 4: SPECIFIC GEO (5 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 4. Specific Geo Queries${NC}"
run_test "GE01" "Geo-Kota" "kemiskinan di kota ternate" "ternate"
run_test "GE02" "Geo-Kab" "pengangguran halmahera utara" "halmahera utara|halut"
run_test "GE03" "Geo-Kota" "inflasi kota tidore" "tidore"
run_test "GE04" "Geo-Kab" "jumlah penduduk kepulauan sula" "sula|kepulauan sula"
run_test "GE05" "Geo-Kab" "ipm pulau morotai" "morotai"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 5: STATISTICAL DATA (8 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 5. Statistical Data Queries${NC}"
run_test "S01" "Stat" "berapa persen penduduk miskin di maluku utara" "persen|%|miskin|kemiskinan"
run_test "S02" "Stat" "tingkat pengangguran terbuka maluku utara" "persen|%|pengangguran|tpt"
run_test "S03" "Stat" "berapa indeks pembangunan manusia maluku utara" "ipm|indeks pembangunan"
run_test "S04" "Stat" "berapa inflasi maluku utara" "inflasi|persen|%|ihk"
run_test "S05" "Stat" "pertumbuhan ekonomi maluku utara" "pdrb|pertumbuhan|ekonomi|persen|%"
run_test "S06" "Stat" "berapa jumlah penduduk maluku utara 2024" "penduduk|jiwa|juta|ribu|2024"
run_test "S07" "Stat" "gini ratio maluku utara" "gini|ketimpangan|rasio"
run_test "S08" "Stat" "upah minimum maluku utara" "upah|umr|ump|minimum"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 6: KNOWLEDGE BASE — BRS & Publikasi (7 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 6. Knowledge Base — BRS & Publikasi${NC}"
run_test "K01" "KB" "berita statistik terbaru" "brs|berita|statistik|resmi"
run_test "K02" "KB" "brs kemiskinan" "brs|kemiskinan|miskin|berita"
run_test "K03" "KB" "publikasi maluku utara" "publikasi|maluku utara"
run_test "K04" "KB" "brs inflasi terbaru" "brs|inflasi|ihk|harga"
run_test "K05" "KB" "kabar terbaru dari bps malut" "brs|berita|statistik|terbaru|data"
run_test "K06" "KB" "berita resmi statistik tentang ekspor" "brs|ekspor|berita resmi"
run_test "K07" "KB" "ada publikasi tentang ketenagakerjaan" "publikasi|ketenagakerjaan|tenaga kerja"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 7: EXIM (3 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 7. EXIM Queries${NC}"
run_test "E01" "EXIM" "data ekspor maluku utara" "ekspor|export|dolar|usd|ton"
run_test "E02" "EXIM" "impor maluku utara 2024" "impor|import|2024"
run_test "E03" "EXIM" "neraca perdagangan maluku utara" "neraca|perdagangan|ekspor|impor|surplus|defisit"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 8: COMPLEX ANALYTICAL (5 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 8. Complex Analytical Queries${NC}"
run_test "C01" "Analytical" "bandingkan kemiskinan kota ternate dan halmahera utara" "ternate|halmahera utara|banding|perbandingan|lebih"
run_test "C02" "Analytical" "bagaimana tren kemiskinan maluku utara 5 tahun terakhir" "tren|trend|turun|naik|202[0-9]|tahun"
run_test "C03" "Analytical" "kabupaten mana yang paling miskin di maluku utara" "kabupaten|miskin|kemiskinan|paling|tertinggi"
run_test "C04" "Analytical" "hubungan antara kemiskinan dan pengangguran di maluku utara" "kemiskinan|pengangguran|hubungan|korelasi"
run_test "C05" "Analytical" "mengapa inflasi maluku utara tinggi" "inflasi|maluku utara|penyebab|faktor|karena|tinggi"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 9: EDGE CASES (7 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 9. Edge Cases & Robustness${NC}"
run_test "X01" "Edge" "kemsikinan malku utara" "kemiskinan|miskin|maluku utara"
run_test "X02" "Edge" "tpt halut" "pengangguran|tpt|halmahera utara|halut"
run_test "X03" "Edge" "brp org miskin di malut" "miskin|kemiskinan|maluku utara|malut"
run_test "X04" "Edge" "data kependudukan 2024 halbar" "penduduk|kependudukan|halmahera barat|halbar|2024"
run_test "X05" "Edge-OOS" "siapa presiden indonesia" "malika|bps|statistik|maaf|tidak|bantu"
run_test "X06" "Edge" "data" "statistik|data|bantu|informasi|malika|kategori"
run_test "X07" "Edge" "penduduk halut dan halsel" "halmahera utara|halmahera selatan|halut|halsel|penduduk"

# ═══════════════════════════════════════════════════════════════════════════
# CAT 10: DEEP MODE (3 tests)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ 10. Deep Mode (gpt-5-mini)${NC}"
run_test "DM01" "Deep" "analisis mendalam kemiskinan maluku utara dari berbagai dimensi" "kemiskinan|maluku utara|dimensi|analisis" "" "gpt-5-mini"
run_test "DM02" "Deep" "bandingkan secara detail ipm semua kabupaten kota di maluku utara" "ipm|kabupaten|kota|banding|perbandingan" "" "gpt-5-mini"
run_test "DM03" "Deep" "evaluasi perkembangan ekonomi maluku utara 2020 sampai 2025" "ekonomi|pdrb|202[0-5]|perkembangan|pertumbuhan" "" "gpt-5-mini"


# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  ${BOLD}RESULTS SUMMARY${NC}"
echo "════════════════════════════════════════════════════════════════════════"
RATE=$(python3 -c "print(f'{$PASS/$TOTAL*100:.1f}%')" 2>/dev/null || echo "N/A")
echo -e "  Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC} | Rate: ${BOLD}$RATE${NC}"
echo ""

echo "── Latency by Category ──────────────────────────────────────────────"
python3 << 'PYEOF'
import re
lines = open('/tmp/malika_accuracy_tests_v3/results.log').readlines()
cats = {}
total_ms = 0; count = 0
for line in lines:
    parts = line.strip().split('|')
    if len(parts) >= 7:
        status, tid, cat, query, reason, lat_s, tlen = parts[:7]
        try: ms = float(lat_s) * 1000
        except: continue
        if cat not in cats: cats[cat] = {'times': [], 'pass': 0, 'fail': 0}
        cats[cat]['times'].append(ms)
        cats[cat]['pass' if status == 'PASS' else 'fail'] += 1
        total_ms += ms; count += 1

print(f"  {'Category':<16s} {'Avg':>6s} {'Min':>6s} {'Max':>6s} {'Pass':>7s}")
print(f"  {'─'*16} {'─'*6} {'─'*6} {'─'*6} {'─'*7}")
for cat in sorted(cats.keys()):
    d = cats[cat]
    avg = sum(d['times'])/len(d['times']); mx = max(d['times']); mn = min(d['times'])
    t = d['pass']+d['fail']
    print(f"  {cat:<16s} {avg/1000:5.1f}s {mn/1000:5.1f}s {mx/1000:5.1f}s {d['pass']}/{t}")
if count > 0:
    print(f"  {'─'*16} {'─'*6} {'─'*6} {'─'*6} {'─'*7}")
    print(f"  {'OVERALL':<16s} {total_ms/count/1000:5.1f}s  total={total_ms/1000:.0f}s")
PYEOF
echo ""

FAIL_COUNT=$(grep -c "^FAIL" "$RESULTS_DIR/results.log" 2>/dev/null || echo "0")
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "── Failed Tests ─────────────────────────────────────────────────────"
  python3 << 'PYEOF2'
lines = open('/tmp/malika_accuracy_tests_v3/results.log').readlines()
for line in lines:
    p = line.strip().split('|')
    if p[0] == 'FAIL':
        print(f"  [{p[1]}] {p[2]}: \"{p[3]}\" → {p[4]} ({p[5]}s, {p[6]}ch)")
PYEOF2
  echo ""
fi

echo "Files: $RESULTS_DIR/*.txt"
echo "════════════════════════════════════════════════════════════════════════"
