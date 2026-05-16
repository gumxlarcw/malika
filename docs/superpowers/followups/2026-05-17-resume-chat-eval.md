# Resume note — paused chat-accuracy harness run (2026-05-17)

Paused mid-run during the session that closed the sonnet-only single-lane followups (plan `docs/superpowers/plans/2026-05-16-sonnet-only-followups-cleanup.md`). Two partial runs stitched together:

- First run: started 2026-05-16 20:47:36, paused after 15 cases. Results: `/tmp/malika_master_tests_20260516_204736/` (may be cleared on reboot).
- Resume run: started 2026-05-17 00:15:14, paused after 33 more cases. Results: `/tmp/malika_master_tests_20260517_001514/`.

## Cumulative status

**48 / 81 cases done · 0 FAIL · 7 categories cleared**

Cleared: greeting (3), chitchat (3), default (7), period (5), geo (7), stat (11), knowledge (11) — plus knowledge-ppid case KB01.

## Remaining 33 cases

Categories: knowledge-ppid (KB02), edge (E01-E04), exim (C01-C06), edge-extra (X01-X12), hallucination (H01-H02), overlap (OV01-OV05), deep (DM01-DM03).

These are the higher-signal cases for regression hunting (hallucination + out-of-scope + deep + overlap).

## Resume command

```bash
cd /var/www/html/project-data-strategis/backend/evals && \
./master-test-runner.sh --chat --id=KB02,E01,E02,E03,E04,C01,C02,C03,C04,C05,C06,X01,X02,X03,X04,X05,X06,X07,X08,X09,X10,X11,X12,H01,H02,OV01,OV02,OV03,OV04,OV05,DM01,DM02,DM03
```

ETA at the observed ~2 min/case pace: **~65 minutes** for this final 33-case chunk. Run in background; the harness writes a fresh timestamped dir under `/tmp/malika_master_tests_*/` and writes `chat-timing.csv` incrementally as each case completes.

## What "done" looks like

After the resume completes, verify cumulative result by reading from all 3 result dirs:

```bash
python3 - << 'PY'
import json
cases = json.load(open('/var/www/html/project-data-strategis/backend/evals/fixtures/master-test-cases.json'))['cases']
all_ids = [c['id'] for c in cases]
done = set(); fail = []
# Adjust this list with the path of the final resume run's timestamped dir
for path in [
    '/tmp/malika_master_tests_20260516_204736/chat-timing.csv',
    '/tmp/malika_master_tests_20260517_001514/chat-timing.csv',
    # '/tmp/malika_master_tests_<NEW_TIMESTAMP>/chat-timing.csv',
]:
    try:
        with open(path) as f:
            next(f)
            for line in f:
                p = line.split('|')
                if len(p) > 1:
                    done.add(p[1])
                    if p[0] == 'FAIL':
                        fail.append((p[1], p[2], p[8] if len(p) > 8 else '?'))
    except FileNotFoundError:
        pass
print(f"done: {len(done)}/81  fail: {len(fail)}  remaining: {81 - len(done)}")
for f in fail:
    print(f"  FAIL {f}")
PY
```

Target: 81/81 done, 0 FAIL.

## Why this matters

- The session's refactors (`requireProxyUrl()` helper, dropped backend `MODEL_ALIASES`, unified key-resolution in `keywordExtractor`, harness false-fail fix in `evaluate-chat-result.py`) need a full chat-accuracy sweep to prove no regression — especially in hallucination + edge-out-of-scope + overlap, which are the categories most likely to surface subtle prompt/retrieval changes.
- 0/48 fail rate so far is a strong signal; closing the remaining 33 cleanly would let us declare the followups stream "fully proven", not just "fully shipped".
- The first run already validated the harness fix (`3f97634`): G01/G02/G06 all PASS, no more `empty_response` false-fails.

## Pace observation worth remembering

Real chat case latencies are ~90-210s each (not the ~10s I initially estimated from greeting cases). DEFAULT, PERIOD, STAT cases all do real retrieval + reranking + reconciliation + LLM, which dominates the wall time. A full 81-case sweep is realistically a **2.5-3 hour** background job, not a 15-25 minute one. Keep this in mind when scheduling.

## Disposable / cleanup

When this note is no longer relevant (i.e., a fresh full run has shipped and the followups stream is closed), delete this file.
