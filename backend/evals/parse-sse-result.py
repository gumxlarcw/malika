#!/usr/bin/env python3
"""
SSE Done-event parser for MALIKA chat tests.
Usage: python3 parse-sse-result.py <rawfile> [wall_ms]
Returns JSON with parsed fields on stdout.
"""
import re, json, sys

def parse(filepath, wall_ms=0):
    data = open(filepath).read()
    m = re.search(r'event:\s*done\ndata:\s*(.+)', data)
    if not m:
        return {"status": "NO_DONE", "wall_ms": wall_ms, "lines": len(data.splitlines())}
    try:
        d = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        return {"status": "PARSE_ERR", "error": str(e), "wall_ms": wall_ms}

    meta = d.get("metadata", {})
    pm = meta.get("pipeline_ms", {})
    tokens = meta.get("tokens", {})

    return {
        "status": "OK",
        "full_text": d.get("full_text", ""),
        "model": meta.get("model", "unknown"),
        "tier": meta.get("tier", ""),
        "wall_ms": wall_ms,
        "pipeline_ms": {
            "total":       pm.get("total", 0),
            "gate":        pm.get("gate", 0),
            "rerank":      pm.get("rerank", 0),
            "knowledge":   pm.get("knowledge", pm.get("knowledgeSearch", 0)),
            "model_select": pm.get("model", 0),
            "reconciler":  pm.get("reconciler", 0),
            "supervisor":  pm.get("supervisor", 0),
            "stream":      pm.get("stream", 0),
        },
        "tokens": {
            "input":     tokens.get("input", tokens.get("prompt", 0)),
            "output":    tokens.get("output", tokens.get("completion", 0)),
            "reasoning": tokens.get("reasoning", 0),
        },
    }

if __name__ == "__main__":
    fp = sys.argv[1]
    wm = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    result = parse(fp, wm)
    print(json.dumps(result))
