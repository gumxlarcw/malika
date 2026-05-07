#!/usr/bin/env python3
"""
Evaluate a single chat SSE result file: parse done event + pattern match.
Usage: python3 evaluate-chat-result.py <sse_file> <wall_ms> <expect_pattern> <must_not_pattern>
Output (pipe-delimited):
  PASS|text_len|model|total_ms|reconciler_ms|stream_ms|tok_in|tok_out|ok|preview
  FAIL|text_len|model|total_ms|reconciler_ms|stream_ms|tok_in|tok_out|reason|preview
"""
import re, json, sys

def main():
    filepath = sys.argv[1]
    wall_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    expect_pat = sys.argv[3] if len(sys.argv) > 3 else ""
    must_not_pat = sys.argv[4] if len(sys.argv) > 4 else ""

    data = open(filepath).read()
    m = re.search(r'event:\s*done\ndata:\s*(.+)', data)

    if not m:
        print(f"FAIL|0|?|0|0|0|0|0|NO_DONE|")
        return

    try:
        d = json.loads(m.group(1))
    except json.JSONDecodeError:
        print(f"FAIL|0|?|0|0|0|0|0|PARSE_ERR|")
        return

    meta = d.get("metadata", {})
    pm = meta.get("pipeline_ms", {})
    tokens = meta.get("tokens", {})

    ft = d.get("full_text", "")
    model = meta.get("model", "?")
    text_len = len(ft)
    total_ms = pm.get("total", 0)
    recon_ms = pm.get("reconciler", 0)
    stream_ms = pm.get("stream", 0)
    tok_in = tokens.get("input", tokens.get("prompt", 0))
    tok_out = tokens.get("output", tokens.get("completion", 0))

    flat = ft.replace("\n", " ").replace("\r", "")
    preview = flat[:120]

    # Check for empty response
    if text_len < 5:
        print(f"FAIL|{text_len}|{model}|{total_ms}|{recon_ms}|{stream_ms}|{tok_in}|{tok_out}|empty_response|{preview}")
        return

    # Pattern matching
    match_ok = True
    must_not_ok = True

    if expect_pat and expect_pat != "null":
        try:
            if not re.search(expect_pat, flat, re.IGNORECASE):
                match_ok = False
        except re.error:
            # Fallback: simple substring check
            match_ok = any(p.lower() in flat.lower() for p in expect_pat.split("|"))

    if must_not_pat and must_not_pat != "null":
        try:
            if re.search(must_not_pat, flat, re.IGNORECASE):
                must_not_ok = False
        except re.error:
            must_not_ok = not any(p.lower() in flat.lower() for p in must_not_pat.split("|"))

    if match_ok and must_not_ok:
        print(f"PASS|{text_len}|{model}|{total_ms}|{recon_ms}|{stream_ms}|{tok_in}|{tok_out}|ok|{preview}")
    else:
        reason = ""
        if not match_ok:
            reason = "expected_missing"
        if not must_not_ok:
            reason = (reason + "+must_not_found") if reason else "must_not_found"
        print(f"FAIL|{text_len}|{model}|{total_ms}|{recon_ms}|{stream_ms}|{tok_in}|{tok_out}|{reason}|{preview}")

if __name__ == "__main__":
    main()
