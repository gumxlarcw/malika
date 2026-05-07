#!/bin/bash
# Functional audit: per indikator, fetch latest year data + sample metric
# and tally how many polygons have values.
BACKEND=http://localhost:5000
OUT=tmp/petatematik_functional_audit.tsv
echo -e "source_id\tsource_name\tlatest_year\thas_monthly\tn_metrics\tdefault_metric\tn_with_values\tstatus" > "$OUT"

# Get indikator list
curl -s "$BACKEND/peta-tematik/public/indikator-list" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for cat, items in d.get('kategori', {}).items():
    for it in items:
        print(f\"{it['sourceId']}\t{it['sourceName']}\")" > tmp/indikator_ids.tsv

total=$(wc -l < tmp/indikator_ids.tsv)
i=0
empty_count=0
ok_count=0
while IFS=$'\t' read -r id name; do
  i=$((i+1))
  # 1. years
  years_json=$(curl -s "$BACKEND/peta-tematik/public/years?indikator=$id")
  latest=$(echo "$years_json" | python3 -c "import sys,json; d=json.load(sys.stdin); ys=d.get('years',[]); print(ys[-1] if ys else '')" 2>/dev/null)
  has_monthly=$(echo "$years_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print('1' if d.get('has_monthly') else '0')" 2>/dev/null)
  if [ -z "$latest" ]; then
    echo -e "$id\t$name\t\t\t\t\t0\tNO_YEARS" >> "$OUT"
    empty_count=$((empty_count+1))
    continue
  fi
  # 2. metrics
  metrics_json=$(curl -s "$BACKEND/peta-tematik/public/metrics?indikator=$id")
  metrics_list=$(echo "$metrics_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d.get('metrics',[])))" 2>/dev/null)
  n_metrics=$(echo "$metrics_list" | tr ',' '\n' | wc -l)
  default_metric=$(echo "$metrics_list" | python3 -c "import sys; ms=sys.stdin.read().strip().split(','); print('value' if 'value' in ms else (ms[0] if ms[0] else ''))" 2>/dev/null)
  # 3. data
  url="$BACKEND/peta-tematik/public/data?indikator=$id&year=$latest"
  if [ -n "$default_metric" ]; then
    enc=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$default_metric")
    url="$url&metric=$enc"
  fi
  n_with=$(curl -s "$url" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for r in d.get('data',[]) if r.get('value') is not None))" 2>/dev/null)
  status="OK"
  if [ "$n_with" = "0" ]; then status="EMPTY"; empty_count=$((empty_count+1)); else ok_count=$((ok_count+1)); fi
  echo -e "$id\t$name\t$latest\t$has_monthly\t$n_metrics\t$default_metric\t$n_with\t$status" >> "$OUT"
done < tmp/indikator_ids.tsv
echo "Done: $i scanned, $ok_count with data, $empty_count empty"
