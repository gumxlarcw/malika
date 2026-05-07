#!/usr/bin/env python3
"""Integration test: verify chart agent in live chat pipeline."""

import subprocess, json, sys, urllib.parse, time

BASE = "http://localhost:5000"

def create_thread():
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{BASE}/chat/threads",
         "-H", "Content-Type: application/json",
         "-H", "x-malika-uid: test-chart-eval"],
        capture_output=True, text=True, timeout=10
    )
    data = json.loads(r.stdout)
    return data["thread"]["id"]

def stream_query(thread_id, query):
    encoded = urllib.parse.quote(query)
    url = f"{BASE}/chat/threads/{thread_id}/stream?text={encoded}"
    r = subprocess.run(
        ["curl", "-sN", url,
         "-H", "x-malika-uid: test-chart-eval",
         "--max-time", "90"],
        capture_output=True, text=True, timeout=100
    )
    return r.stdout

def parse_sse(raw):
    lines = raw.split("\n")
    result = {"chart": None, "chartAgent_ms": None, "total_ms": None}
    for line in lines:
        line = line.rstrip()
        if not line.startswith("data: "):
            continue
        data_str = line[6:]
        try:
            obj = json.loads(data_str)
        except:
            continue
        # malika_ui has a "chart" key
        if "chart" in obj and "table" in obj:
            result["chart"] = obj.get("chart")
        # done event has pipeline_ms in metadata
        if "pipeline_ms" in obj:
            ms = obj.get("pipeline_ms", {})
            result["chartAgent_ms"] = ms.get("chartAgent")
            result["total_ms"] = ms.get("total")
        elif "metadata" in obj and "pipeline_ms" in obj.get("metadata", {}):
            ms = obj["metadata"]["pipeline_ms"]
            result["chartAgent_ms"] = ms.get("chartAgent")
            result["total_ms"] = ms.get("total")
    return result

# Test cases: (query, expected_chart_type, expected_should_render)
TESTS = [
    ("gini rasio kab kota 2023", None, True),          # geo → bar/grouped-bar
    ("inflasi kota ternate 2024", "line", True),        # time-series → line
    ("jumlah penduduk menurut kelompok umur 2024", None, True),  # categorical → bar/grouped-bar
]

passed = 0
failed = 0

for query, expected_type, expected_render in TESTS:
    print(f"\n{'='*60}")
    print(f"QUERY: {query}")
    tid = create_thread()
    print(f"Thread: {tid}")
    
    raw = stream_query(tid, query)
    result = parse_sse(raw)
    chart = result["chart"]
    
    if chart is None:
        print(f"  CHART: null (chart agent did not produce output)")
        if expected_render:
            print(f"  ❌ FAIL — expected chart but got null")
            failed += 1
        else:
            print(f"  ✅ PASS — correctly no chart")
            passed += 1
    else:
        ct = chart.get("chart_type")
        sr = chart.get("should_render")
        reason = chart.get("render_reason", "")[:80]
        series = [s.get("column") for s in chart.get("series", [])]
        x_col = chart.get("x_axis", {}).get("column")
        title = chart.get("chart_title", "")[:60]
        
        print(f"  chart_type: {ct}")
        print(f"  should_render: {sr}")
        print(f"  render_reason: {reason}")
        print(f"  x_axis: {x_col}")
        print(f"  series: {series}")
        print(f"  title: {title}")
        print(f"  chartAgent_ms: {result['chartAgent_ms']}")
        print(f"  total_ms: {result['total_ms']}")
        
        ok = True
        if expected_render and not sr:
            print(f"  ❌ expected should_render=true")
            ok = False
        if expected_type and ct != expected_type:
            print(f"  ⚠️  expected chart_type={expected_type}, got {ct}")
            # Not a hard fail — LLM may choose differently
        
        if ok:
            print(f"  ✅ PASS")
            passed += 1
        else:
            print(f"  ❌ FAIL")
            failed += 1

print(f"\n{'='*60}")
print(f"RESULTS: {passed} passed, {failed} failed, {passed+failed} total")
sys.exit(1 if failed > 0 else 0)
