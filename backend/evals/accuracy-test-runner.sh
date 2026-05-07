#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MALIKA Chat Accuracy & Latency Test Runner
# Date: 2026-02-16
# Coverage: Greetings → Chitchat → Defaults → Statistical → Knowledge → Deep
# ─────────────────────────────────────────────────────────────────────────────

API="http://localhost:5000"
UID_PREFIX="acctest"
RESULTS_DIR="/tmp/malika_accuracy_tests"
mkdir -p "$RESULTS_DIR"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
TOTAL=0
RESULTS_LOG="$RESULTS_DIR/results.log"
> "$RESULTS_LOG"

run_test() {
  local TEST_ID="$1"
  local CATEGORY="$2"
  local QUERY="$3"
  local EXPECT_PATTERN="$4"    # grep -iP pattern to validate response
  local MUST_NOT_PATTERN="$5"  # pattern that MUST NOT appear (optional)
  local MODE="${6:-flash}"     # flash or deep

  TOTAL=$((TOTAL + 1))
  local UID="${UID_PREFIX}_${TEST_ID}"
  local ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

  # Create thread
  local TID=$(curl -s -X POST "$API/chat/threads" \
    -H 'Content-Type: application/json' \
    -H "x-malika-uid: $UID" \
    -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin)['thread']['id'])" 2>/dev/null)

  if [ -z "$TID" ] || [ "$TID" = "None" ]; then
    echo -e "  ${RED}✗${NC} [$TEST_ID] $CATEGORY: Failed to create thread"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|thread_creation_failed|0s" >> "$RESULTS_LOG"
    return
  fi

  # Stream request with timing
  local OUTFILE="$RESULTS_DIR/${TEST_ID}.txt"
  local START_TIME=$(date +%s%N)

  local MODE_PARAM=""
  if [ "$MODE" = "deep" ]; then
    MODE_PARAM="&mode=deep"
  fi

  curl -s -N "$API/chat/threads/$TID/stream?text=$ENCODED$MODE_PARAM" \
    -H 'Accept: text/event-stream' \
    -H "x-malika-uid: $UID" \
    --max-time 120 > "$OUTFILE" 2>&1

  local END_TIME=$(date +%s%N)
  local LATENCY_MS=$(( (END_TIME - START_TIME) / 1000000 ))
  local LATENCY_S=$(python3 -c "print(f'{$LATENCY_MS/1000:.1f}s')")

  # Parse response
  local FULL_TEXT=$(python3 -c "
import re, json, sys
data = open('$OUTFILE').read()
done = re.search(r'event:\s*done\ndata:\s*(\{.*?\})\n', data)
if done:
    d = json.loads(done.group(1))
    print(d.get('full_text', ''))
else:
    print('')
" 2>/dev/null)

  local HAS_ERROR=$(grep -c "event: error" "$OUTFILE" 2>/dev/null || echo "0")
  local TEXT_LEN=${#FULL_TEXT}

  # Check for errors
  if [ "$HAS_ERROR" -gt 0 ] || [ "$TEXT_LEN" -lt 5 ]; then
    echo -e "  ${RED}✗${NC} [$TEST_ID] $CATEGORY: ERROR or empty response (${LATENCY_S}, len=$TEXT_LEN)"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|error_or_empty|$LATENCY_S" >> "$RESULTS_LOG"
    return
  fi

  # Validate expected pattern
  local MATCH=1
  if [ -n "$EXPECT_PATTERN" ]; then
    echo "$FULL_TEXT" | grep -qiP "$EXPECT_PATTERN"
    if [ $? -ne 0 ]; then
      MATCH=0
    fi
  fi

  # Validate must-not pattern
  local MUST_NOT_MATCH=0
  if [ -n "$MUST_NOT_PATTERN" ]; then
    echo "$FULL_TEXT" | grep -qiP "$MUST_NOT_PATTERN"
    if [ $? -eq 0 ]; then
      MUST_NOT_MATCH=1
    fi
  fi

  if [ $MATCH -eq 1 ] && [ $MUST_NOT_MATCH -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} [$TEST_ID] $CATEGORY: ${LATENCY_S} (${TEXT_LEN} chars)"
    PASS=$((PASS + 1))
    echo "PASS|$TEST_ID|$CATEGORY|$QUERY|ok|$LATENCY_S|$TEXT_LEN" >> "$RESULTS_LOG"
  else
    local REASON=""
    if [ $MATCH -eq 0 ]; then
      REASON="expected_pattern_missing: $EXPECT_PATTERN"
    fi
    if [ $MUST_NOT_MATCH -eq 1 ]; then
      REASON="$REASON must_not_pattern_found: $MUST_NOT_PATTERN"
    fi
    echo -e "  ${YELLOW}△${NC} [$TEST_ID] $CATEGORY: Pattern mismatch (${LATENCY_S}, ${TEXT_LEN} chars)"
    echo -e "      Expected: $EXPECT_PATTERN"
    echo -e "      Preview: ${FULL_TEXT:0:200}"
    FAIL=$((FAIL + 1))
    echo "FAIL|$TEST_ID|$CATEGORY|$QUERY|$REASON|$LATENCY_S|$TEXT_LEN" >> "$RESULTS_LOG"
  fi
}

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  MALIKA Chat Accuracy & Latency Test Suite"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 1: GREETINGS & CHITCHAT
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 1: Greetings & Chitchat${NC}"

run_test "G01" "Greeting" \
  "halo" \
  "halo|hai|selamat|malika|bantu" ""

run_test "G02" "Greeting" \
  "selamat pagi" \
  "pagi|selamat|malika|bantu" ""

run_test "G03" "Greeting" \
  "hi malika" \
  "hai|halo|malika|bantu" ""

run_test "G04" "Chitchat" \
  "siapa kamu" \
  "malika|asisten|bps|statistik|maluku utara" ""

run_test "G05" "Chitchat" \
  "apa yang bisa kamu lakukan" \
  "data|statistik|informasi|bantu|cari" ""

run_test "G06" "Chitchat" \
  "terima kasih" \
  "sama-sama|terima kasih|senang|bantu" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 2: DEFAULT BEHAVIOR (Latest + Maluku Utara)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 2: Default Behavior (Latest Period + Maluku Utara by default)${NC}"

run_test "D01" "Default-Geo" \
  "berapa angka kemiskinan" \
  "maluku utara|malut|provinsi" ""

run_test "D02" "Default-Geo" \
  "data pengangguran" \
  "maluku utara|malut|provinsi" ""

run_test "D03" "Default-Geo" \
  "inflasi bulan ini" \
  "maluku utara|malut|ternate|provinsi" ""

run_test "D04" "Default-Latest" \
  "data kemiskinan" \
  "202[4-9]|terbaru|terakhir|terkini" ""

run_test "D05" "Default-Latest" \
  "angka ipm" \
  "202[4-9]|terbaru|terakhir|terkini|ipm" ""

run_test "D06" "Default-Geo" \
  "berapa jumlah penduduk" \
  "maluku utara|malut|provinsi" ""

run_test "D07" "Default-Latest" \
  "data pdrb" \
  "pdrb|produk domestik|202[4-9]" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 3: SPECIFIC PERIOD QUERIES
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 3: Specific Period Queries${NC}"

run_test "P01" "Period-Year" \
  "kemiskinan tahun 2023" \
  "2023" ""

run_test "P02" "Period-MonthYear" \
  "inflasi desember 2024" \
  "desember|december|12.*2024|2024" ""

run_test "P03" "Period-Quarter" \
  "pdrb triwulan 3 2024" \
  "triwulan|kuartal|q3|tw.?3|2024" ""

run_test "P04" "Period-Year" \
  "pengangguran 2024" \
  "2024" ""

run_test "P05" "Period-Year" \
  "ekspor 2025" \
  "2025|ekspor" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 4: SPECIFIC GEO QUERIES
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 4: Specific Geo Queries${NC}"

run_test "GE01" "Geo-Kota" \
  "kemiskinan di kota ternate" \
  "ternate" ""

run_test "GE02" "Geo-Kabupaten" \
  "pengangguran halmahera utara" \
  "halmahera utara|halut" ""

run_test "GE03" "Geo-Kota" \
  "inflasi kota tidore" \
  "tidore" ""

run_test "GE04" "Geo-Kabupaten" \
  "jumlah penduduk kepulauan sula" \
  "sula|kepulauan sula" ""

run_test "GE05" "Geo-Kabupaten" \
  "ipm pulau morotai" \
  "morotai" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 5: STATISTICAL DATA QUERIES
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 5: Statistical Data Queries${NC}"

run_test "S01" "Stat-Kemiskinan" \
  "berapa persen penduduk miskin di maluku utara" \
  "persen|%|miskin|kemiskinan" ""

run_test "S02" "Stat-TPT" \
  "tingkat pengangguran terbuka maluku utara" \
  "persen|%|pengangguran|tpt" ""

run_test "S03" "Stat-IPM" \
  "berapa indeks pembangunan manusia maluku utara" \
  "ipm|indeks pembangunan" ""

run_test "S04" "Stat-Inflasi" \
  "berapa inflasi maluku utara" \
  "inflasi|persen|%|ihk" ""

run_test "S05" "Stat-PDRB" \
  "pertumbuhan ekonomi maluku utara" \
  "pdrb|pertumbuhan|ekonomi|persen|%" ""

run_test "S06" "Stat-Penduduk" \
  "berapa jumlah penduduk maluku utara 2024" \
  "penduduk|jiwa|juta|ribu|2024" ""

run_test "S07" "Stat-Gini" \
  "gini ratio maluku utara" \
  "gini|ketimpangan|rasio" ""

run_test "S08" "Stat-UMR" \
  "upah minimum maluku utara" \
  "upah|umr|ump|minimum" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 6: KNOWLEDGE BASE (BRS & PUBLIKASI)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 6: Knowledge Base - BRS & Publikasi (Latest by default)${NC}"

run_test "K01" "KB-BRS" \
  "berita statistik terbaru" \
  "brs|berita|statistik|resmi" ""

run_test "K02" "KB-BRS" \
  "brs kemiskinan" \
  "brs|kemiskinan|miskin|berita" ""

run_test "K03" "KB-Publikasi" \
  "publikasi maluku utara" \
  "publikasi|maluku utara" ""

run_test "K04" "KB-BRS" \
  "brs inflasi terbaru" \
  "brs|inflasi|ihk|harga" ""

run_test "K05" "KB-News" \
  "kabar terbaru dari bps malut" \
  "brs|berita|statistik|terbaru|data" ""

run_test "K06" "KB-BRS" \
  "berita resmi statistik tentang ekspor" \
  "brs|ekspor|berita resmi" ""

run_test "K07" "KB-Publikasi" \
  "ada publikasi tentang ketenagakerjaan" \
  "publikasi|ketenagakerjaan|tenaga kerja" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 7: EXIM (Export-Import)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 7: EXIM Queries${NC}"

run_test "E01" "EXIM" \
  "data ekspor maluku utara" \
  "ekspor|export|dolar|usd|ton" ""

run_test "E02" "EXIM" \
  "impor maluku utara 2024" \
  "impor|import|2024" ""

run_test "E03" "EXIM" \
  "neraca perdagangan maluku utara" \
  "neraca|perdagangan|ekspor|impor|surplus|defisit" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 8: COMPLEX / ANALYTICAL (Orchestrator triggers)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 8: Complex Analytical Queries${NC}"

run_test "C01" "Analytical-Compare" \
  "bandingkan kemiskinan kota ternate dan halmahera utara" \
  "ternate|halmahera utara|banding|perbandingan|lebih" ""

run_test "C02" "Analytical-Trend" \
  "bagaimana tren kemiskinan maluku utara 5 tahun terakhir" \
  "tren|trend|turun|naik|202[0-9]|tahun" ""

run_test "C03" "Analytical-Ranking" \
  "kabupaten mana yang paling miskin di maluku utara" \
  "kabupaten|miskin|kemiskinan|paling|tertinggi" ""

run_test "C04" "Analytical-Multi" \
  "hubungan antara kemiskinan dan pengangguran di maluku utara" \
  "kemiskinan|pengangguran|hubungan|korelasi" ""

run_test "C05" "Analytical-Why" \
  "mengapa inflasi maluku utara tinggi" \
  "inflasi|maluku utara|penyebab|faktor|karena|tinggi" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 9: EDGE CASES & ROBUSTNESS  
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 9: Edge Cases & Robustness${NC}"

run_test "X01" "Edge-Typo" \
  "kemsikinan malku utara" \
  "kemiskinan|miskin|maluku utara" ""

run_test "X02" "Edge-Abbreviation" \
  "tpt halut" \
  "pengangguran|tpt|halmahera utara|halut" ""

run_test "X03" "Edge-Informal" \
  "brp org miskin di malut" \
  "miskin|kemiskinan|maluku utara|malut" ""

run_test "X04" "Edge-Mixed" \
  "data kependudukan 2024 halbar" \
  "penduduk|kependudukan|halmahera barat|halbar|2024" ""

run_test "X05" "Edge-OOS" \
  "siapa presiden indonesia" \
  "malika|bps|statistik|maaf|tidak|bantu" ""

run_test "X06" "Edge-Vague" \
  "data" \
  "statistik|data|bantu|informasi|malika|kategori" ""

run_test "X07" "Edge-MultiRegion" \
  "penduduk halut dan halsel" \
  "halmahera utara|halmahera selatan|halut|halsel|penduduk" ""

# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY 10: DEEP MODE TESTS
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}▸ Category 10: Deep Mode Tests${NC}"

run_test "DM01" "Deep-Analytical" \
  "analisis mendalam kemiskinan maluku utara dari berbagai dimensi" \
  "kemiskinan|maluku utara|dimensi|analisis" "" "deep"

run_test "DM02" "Deep-Compare" \
  "bandingkan secara detail ipm semua kabupaten kota di maluku utara" \
  "ipm|kabupaten|kota|banding|perbandingan" "" "deep"

run_test "DM03" "Deep-Trend" \
  "evaluasi perkembangan ekonomi maluku utara 2020 sampai 2025" \
  "ekonomi|pdrb|202[0-5]|perkembangan|pertumbuhan" "" "deep"


# ═══════════════════════════════════════════════════════════════════════════
# RESULTS SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  ${CYAN}RESULTS SUMMARY${NC}"
echo "════════════════════════════════════════════════════════════════════════"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Pass:   $PASS${NC}"
echo -e "  ${RED}Fail:   $FAIL${NC}"
RATE=$(python3 -c "print(f'{$PASS/$TOTAL*100:.1f}%')" 2>/dev/null || echo "N/A")
echo -e "  Rate:   $RATE"
echo ""

# Latency breakdown
echo "── Latency Breakdown ──"
python3 -c "
import re
lines = open('$RESULTS_LOG').readlines()
cats = {}
total_ms = 0
count = 0
for line in lines:
    parts = line.strip().split('|')
    if len(parts) >= 6:
        status, tid, cat, query, reason, latency = parts[:6]
        match = re.search(r'([\d.]+)s', latency)
        if match:
            ms = float(match.group(1)) * 1000
            base_cat = cat.split('-')[0] if '-' in cat else cat
            if base_cat not in cats:
                cats[base_cat] = {'times': [], 'pass': 0, 'fail': 0}
            cats[base_cat]['times'].append(ms)
            if status == 'PASS': cats[base_cat]['pass'] += 1
            else: cats[base_cat]['fail'] += 1
            total_ms += ms
            count += 1

for cat in sorted(cats.keys()):
    d = cats[cat]
    avg = sum(d['times']) / len(d['times'])
    mx = max(d['times'])
    mn = min(d['times'])
    total = d['pass'] + d['fail']
    print(f'  {cat:20s}  avg={avg/1000:.1f}s  min={mn/1000:.1f}s  max={mx/1000:.1f}s  {d[\"pass\"]}/{total} pass')

if count > 0:
    print(f'  {\"OVERALL\":20s}  avg={total_ms/count/1000:.1f}s  total={total_ms/1000:.0f}s')
" 2>/dev/null

echo ""

# Failed tests detail
FAIL_COUNT=$(grep -c "^FAIL" "$RESULTS_LOG" 2>/dev/null || echo "0")
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "── Failed Tests Detail ──"
  python3 -c "
lines = open('$RESULTS_LOG').readlines()
for line in lines:
    parts = line.strip().split('|')
    if parts[0] == 'FAIL':
        print(f'  [{parts[1]}] {parts[2]}: \"{parts[3]}\" → {parts[4]} ({parts[5]})')
" 2>/dev/null
  echo ""
fi

echo "Raw results: $RESULTS_LOG"
echo "Response files: $RESULTS_DIR/*.txt"
echo "════════════════════════════════════════════════════════════════════════"
