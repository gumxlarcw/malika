#!/usr/bin/env python3
"""Tests for evaluate-chat-result.py — focus on greeting false-fail fix."""
import subprocess, tempfile, os, sys

SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'evaluate-chat-result.py')

def run_evaluator(sse_content, expect='', must_not=''):
    """Run evaluate-chat-result.py against an SSE blob, return (status, reason)."""
    with tempfile.NamedTemporaryFile('w', suffix='.sse', delete=False) as f:
        f.write(sse_content)
        path = f.name
    try:
        out = subprocess.check_output(
            ['python3', SCRIPT, path, '1000', expect, must_not],
            text=True
        ).strip()
        parts = out.split('|')
        return parts[0], parts[8] if len(parts) > 8 else ''
    finally:
        os.unlink(path)

def test_greeting_with_chunks_and_empty_full_text():
    """Done event has empty full_text, but chunk events have content. Should PASS, not FAIL with empty_response."""
    sse = (
        'event: chunk\ndata: {"text":"Halo! "}\n\n'
        'event: chunk\ndata: {"text":"Ada yang bisa "}\n\n'
        'event: chunk\ndata: {"text":"saya bantu?"}\n\n'
        'event: done\ndata: {"full_text":"","metadata":{"model":"claude-sonnet-4-6","pipeline_ms":{"total":1500},"tokens":{"input":50,"output":10}}}\n\n'
    )
    status, reason = run_evaluator(sse, expect='halo|bantu')
    assert status == 'PASS', f"Expected PASS, got {status} ({reason})"

def test_normal_full_text_path_still_works():
    """Done event has populated full_text. Should PASS via the existing path."""
    sse = 'event: done\ndata: {"full_text":"Inflasi Maluku Utara per April 2026 adalah 0.3%.","metadata":{"model":"claude-sonnet-4-6","pipeline_ms":{"total":3000},"tokens":{"input":200,"output":50}}}\n\n'
    status, reason = run_evaluator(sse, expect='inflasi')
    assert status == 'PASS', f"Expected PASS, got {status} ({reason})"

def test_genuinely_empty_response_still_fails():
    """No content anywhere — should still FAIL with empty_response."""
    sse = 'event: done\ndata: {"full_text":"","metadata":{}}\n\n'
    status, reason = run_evaluator(sse)
    assert status == 'FAIL'
    assert reason == 'empty_response'

if __name__ == '__main__':
    test_greeting_with_chunks_and_empty_full_text()
    test_normal_full_text_path_still_works()
    test_genuinely_empty_response_still_fails()
    print('All 3 tests passed.')
