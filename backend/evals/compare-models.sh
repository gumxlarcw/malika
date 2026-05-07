#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# MALIKA Model Comparison Runner v1.0
# Run all chat tests twice: Malika Flash (gpt-4.1) vs Malika Deep (gpt-5-mini)
# Then produce a side-by-side accuracy + latency comparison report.
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./compare-models.sh                    # Full chat suite (both models)
#   ./compare-models.sh --quick            # Quick subset only
#   ./compare-models.sh --cat=stat         # Single category
#   ./compare-models.sh --tag=core         # By tag
#   ./compare-models.sh --id=D01,D02       # Specific IDs
#   ./compare-models.sh --skip-deep        # Skip deep-category tests
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/master-test-runner.sh"

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
COMPARE_DIR="/tmp/malika_compare_${TIMESTAMP}"
mkdir -p "$COMPARE_DIR"

# Collect extra flags for the runner (pass everything through)
EXTRA_ARGS=()
for arg in "$@"; do
  EXTRA_ARGS+=("$arg")
done

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
MAGENTA='\033[0;35m'

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo -e "║  ${BOLD}MALIKA Model Comparison v1.0${NC}                                       ║"
echo -e "║  Flash (gpt-4.1) vs Deep (gpt-5-mini)                              ║"
echo "║  $(date '+%Y-%m-%d %H:%M:%S')                                                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${DIM}Output: $COMPARE_DIR${NC}"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# RUN 1: FLASH (gpt-4.1)
# ══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}${CYAN}RUN 1: MALIKA FLASH (gpt-4.1)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FLASH_START=$(date +%s)
bash "$RUNNER" --chat --model=flash "${EXTRA_ARGS[@]}" 2>&1 | tee "$COMPARE_DIR/flash-run.log" || true
FLASH_END=$(date +%s)
FLASH_ELAPSED=$((FLASH_END - FLASH_START))

# Find the flash results dir (most recent malika_master_tests_*)
FLASH_DIR=$(ls -1dt /tmp/malika_master_tests_* 2>/dev/null | head -1)
if [ -z "$FLASH_DIR" ]; then
  echo -e "  ${RED}✗ Flash run produced no output directory${NC}"
  exit 1
fi
cp "$FLASH_DIR/chat-timing.csv" "$COMPARE_DIR/flash-timing.csv" 2>/dev/null || true
echo -e "\n  ${DIM}Flash results at: $FLASH_DIR${NC}\n"

# ══════════════════════════════════════════════════════════════════════════════
# RUN 2: DEEP (gpt-5-mini)
# ══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}${MAGENTA}RUN 2: MALIKA DEEP (gpt-5-mini)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DEEP_START=$(date +%s)
bash "$RUNNER" --chat --model=deep "${EXTRA_ARGS[@]}" 2>&1 | tee "$COMPARE_DIR/deep-run.log" || true
DEEP_END=$(date +%s)
DEEP_ELAPSED=$((DEEP_END - DEEP_START))

# Find the deep results dir (most recent, different from flash)
DEEP_DIR=$(ls -1dt /tmp/malika_master_tests_* 2>/dev/null | head -1)
if [ "$DEEP_DIR" = "$FLASH_DIR" ]; then
  echo -e "  ${RED}✗ Deep run produced no new output directory${NC}"
  exit 1
fi
cp "$DEEP_DIR/chat-timing.csv" "$COMPARE_DIR/deep-timing.csv" 2>/dev/null || true
echo -e "\n  ${DIM}Deep results at: $DEEP_DIR${NC}\n"

# ══════════════════════════════════════════════════════════════════════════════
# COMPARISON REPORT
# ══════════════════════════════════════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}COMPARISON REPORT: Flash vs Deep${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Generate comparison via Python
FLASH_CSV="$COMPARE_DIR/flash-timing.csv"
DEEP_CSV="$COMPARE_DIR/deep-timing.csv"

python3 << 'PYEOF' "$FLASH_CSV" "$DEEP_CSV" "$COMPARE_DIR" "$FLASH_ELAPSED" "$DEEP_ELAPSED"
import csv, sys, json
from collections import OrderedDict

flash_csv = sys.argv[1]
deep_csv  = sys.argv[2]
out_dir   = sys.argv[3]
flash_wall = int(sys.argv[4])
deep_wall  = int(sys.argv[5])

def parse_timing(path):
    """Parse chat-timing.csv → dict[test_id] = row dict"""
    results = {}
    try:
        with open(path) as f:
            reader = csv.reader(f, delimiter='|')
            header = next(reader)
            for row in reader:
                if len(row) < 12: continue
                r = {
                    'status': row[0], 'id': row[1], 'cat': row[2], 'query': row[3],
                    'latency': float(row[4]) if row[4] else 0,
                    'text_len': int(row[5]) if row[5] else 0,
                    'model': row[6],
                    'total_ms': float(row[7]) if row[7] else 0,
                    'recon_ms': float(row[8]) if row[8] else 0,
                    'stream_ms': float(row[9]) if row[9] else 0,
                    'tok_in': int(row[10]) if row[10] else 0,
                    'tok_out': int(row[11]) if row[11] else 0,
                }
                results[r['id']] = r
    except FileNotFoundError:
        pass
    return results

flash = parse_timing(flash_csv)
deep  = parse_timing(deep_csv)

all_ids = sorted(set(list(flash.keys()) + list(deep.keys())))

if not all_ids:
    print("  No test results to compare.")
    sys.exit(0)

# ── Per-test comparison ──
print(f"  {'ID':<6} {'Cat':<14} {'Flash':>7} {'Deep':>7} {'Δ Lat':>8} {'F/D':>5} {'F✓':>3} {'D✓':>3} {'Query':<35}")
print(f"  {'─'*6} {'─'*14} {'─'*7} {'─'*7} {'─'*8} {'─'*5} {'─'*3} {'─'*3} {'─'*35}")

cat_stats = {}
flash_pass = 0; flash_fail = 0; flash_total_lat = 0
deep_pass = 0; deep_fail = 0; deep_total_lat = 0
both_pass = 0; flash_only = 0; deep_only = 0; both_fail = 0
total_flash_tok = 0; total_deep_tok = 0

for tid in all_ids:
    f = flash.get(tid, {})
    d = deep.get(tid, {})
    cat = f.get('cat', d.get('cat', '?'))
    query = f.get('query', d.get('query', ''))[:35]

    f_lat = f.get('latency', 0)
    d_lat = d.get('latency', 0)
    f_ok = f.get('status') == 'PASS'
    d_ok = d.get('status') == 'PASS'

    if f_ok: flash_pass += 1
    else: flash_fail += 1
    if d_ok: deep_pass += 1
    else: deep_fail += 1

    flash_total_lat += f_lat
    deep_total_lat += d_lat
    total_flash_tok += f.get('tok_out', 0)
    total_deep_tok += d.get('tok_out', 0)

    if f_ok and d_ok: both_pass += 1
    elif f_ok and not d_ok: flash_only += 1
    elif not f_ok and d_ok: deep_only += 1
    else: both_fail += 1

    # Delta
    delta = d_lat - f_lat
    delta_s = f"{delta:+.1f}s"
    ratio = f"{f_lat/d_lat:.2f}x" if d_lat > 0 else "—"

    f_mark = "✓" if f_ok else "✗"
    d_mark = "✓" if d_ok else "✗"

    print(f"  {tid:<6} {cat:<14} {f_lat:6.1f}s {d_lat:6.1f}s {delta_s:>8} {ratio:>5} {f_mark:>3} {d_mark:>3} {query}")

    # Category aggregation
    if cat not in cat_stats:
        cat_stats[cat] = {'f_lat': [], 'd_lat': [], 'f_pass': 0, 'f_fail': 0, 'd_pass': 0, 'd_fail': 0, 'f_tok': 0, 'd_tok': 0}
    cat_stats[cat]['f_lat'].append(f_lat)
    cat_stats[cat]['d_lat'].append(d_lat)
    cat_stats[cat]['f_pass'] += int(f_ok)
    cat_stats[cat]['f_fail'] += int(not f_ok)
    cat_stats[cat]['d_pass'] += int(d_ok)
    cat_stats[cat]['d_fail'] += int(not d_ok)
    cat_stats[cat]['f_tok'] += f.get('tok_out', 0)
    cat_stats[cat]['d_tok'] += d.get('tok_out', 0)

# ── Category summary ──
print()
print(f"  ── Category Summary ──────────────────────────────────────────────────")
print(f"  {'Category':<14} {'Flash Acc':>10} {'Deep Acc':>10} {'Flash Avg':>10} {'Deep Avg':>10} {'Speed Δ':>10}")
print(f"  {'─'*14} {'─'*10} {'─'*10} {'─'*10} {'─'*10} {'─'*10}")

for cat in sorted(cat_stats.keys()):
    s = cat_stats[cat]
    ft = s['f_pass'] + s['f_fail']
    dt = s['d_pass'] + s['d_fail']
    f_acc = f"{s['f_pass']}/{ft}" if ft > 0 else "—"
    d_acc = f"{s['d_pass']}/{dt}" if dt > 0 else "—"
    f_avg = sum(s['f_lat'])/len(s['f_lat']) if s['f_lat'] else 0
    d_avg = sum(s['d_lat'])/len(s['d_lat']) if s['d_lat'] else 0
    speed = f"Flash {f_avg/d_avg:.1f}x" if d_avg > 0 and f_avg > 0 else "—"
    if d_avg > f_avg:
        speed = f"Flash {d_avg/f_avg:.1f}x ⚡"
    elif f_avg > d_avg:
        speed = f"Deep {f_avg/d_avg:.1f}x ⚡"
    else:
        speed = "tie"
    print(f"  {cat:<14} {f_acc:>10} {d_acc:>10} {f_avg:9.1f}s {d_avg:9.1f}s {speed:>10}")

# ── Grand summary ──
n = len(all_ids)
print()
print(f"  ══════════════════════════════════════════════════════════════════════")
print(f"  GRAND SUMMARY ({n} tests)")
print(f"  ══════════════════════════════════════════════════════════════════════")
print()

f_rate = f"{flash_pass}/{n} ({flash_pass/n*100:.1f}%)" if n > 0 else "—"
d_rate = f"{deep_pass}/{n} ({deep_pass/n*100:.1f}%)" if n > 0 else "—"
f_avg_lat = flash_total_lat/n if n > 0 else 0
d_avg_lat = deep_total_lat/n if n > 0 else 0

print(f"  {'Metric':<28} {'Flash (gpt-4.1)':>18} {'Deep (gpt-5-mini)':>18}")
print(f"  {'─'*28} {'─'*18} {'─'*18}")
print(f"  {'Accuracy':<28} {f_rate:>18} {d_rate:>18}")
print(f"  {'Avg latency/test':<28} {f_avg_lat:17.1f}s {d_avg_lat:17.1f}s")
print(f"  {'Total wall time':<28} {flash_wall:17d}s {deep_wall:17d}s")
print(f"  {'Total output tokens':<28} {total_flash_tok:>18,} {total_deep_tok:>18,}")
print(f"  {'Both pass':<28} {both_pass:>18}")
print(f"  {'Flash only pass':<28} {flash_only:>18}")
print(f"  {'Deep only pass':<28} {deep_only:>18}")
print(f"  {'Both fail':<28} {both_fail:>18}")

# Speed comparison
if d_avg_lat > 0 and f_avg_lat > 0:
    if f_avg_lat < d_avg_lat:
        ratio = d_avg_lat / f_avg_lat
        print(f"\n  ⚡ Flash is {ratio:.1f}x faster on average")
    else:
        ratio = f_avg_lat / d_avg_lat
        print(f"\n  ⚡ Deep is {ratio:.1f}x faster on average")

# Accuracy verdict
if flash_pass > deep_pass:
    print(f"  🎯 Flash wins on accuracy ({flash_pass} vs {deep_pass})")
elif deep_pass > flash_pass:
    print(f"  🎯 Deep wins on accuracy ({deep_pass} vs {flash_pass})")
else:
    print(f"  🎯 Tied on accuracy ({flash_pass} = {deep_pass})")

# ── Disagreement analysis ──
if flash_only + deep_only > 0:
    print()
    print(f"  ── Disagreement Analysis (tests where only one model passed) ─────")
    for tid in all_ids:
        f = flash.get(tid, {})
        d = deep.get(tid, {})
        f_ok = f.get('status') == 'PASS'
        d_ok = d.get('status') == 'PASS'
        if f_ok == d_ok: continue
        winner = "FLASH✓" if f_ok else "DEEP✓ "
        query = f.get('query', d.get('query', ''))[:60]
        print(f"    [{tid}] {winner}  {query}")

# ── Save JSON report ──
report = {
    'timestamp': __import__('datetime').datetime.now().isoformat(),
    'test_count': n,
    'flash': {'pass': flash_pass, 'fail': flash_fail, 'avg_latency': round(f_avg_lat, 1), 'wall_time': flash_wall, 'tokens_out': total_flash_tok},
    'deep':  {'pass': deep_pass,  'fail': deep_fail,  'avg_latency': round(d_avg_lat, 1), 'wall_time': deep_wall,  'tokens_out': total_deep_tok},
    'both_pass': both_pass, 'flash_only': flash_only, 'deep_only': deep_only, 'both_fail': both_fail,
    'per_test': [],
}
for tid in all_ids:
    f = flash.get(tid, {})
    d = deep.get(tid, {})
    report['per_test'].append({
        'id': tid, 'cat': f.get('cat', d.get('cat', '?')),
        'query': f.get('query', d.get('query', '')),
        'flash_status': f.get('status', 'SKIP'), 'flash_latency': f.get('latency', 0),
        'deep_status': d.get('status', 'SKIP'), 'deep_latency': d.get('latency', 0),
    })

report_path = f"{out_dir}/comparison-report.json"
with open(report_path, 'w') as fp:
    json.dump(report, fp, indent=2, ensure_ascii=False)

print()
print(f"  📊 JSON report: {report_path}")

PYEOF

echo ""
echo -e "  ${DIM}All outputs: $COMPARE_DIR/${NC}"
echo -e "  ${DIM}  flash-timing.csv, deep-timing.csv${NC}"
echo -e "  ${DIM}  flash-run.log, deep-run.log${NC}"
echo -e "  ${DIM}  comparison-report.json${NC}"
echo ""
