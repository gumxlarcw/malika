# MALIKA Sonnet-only cleanup — follow-ups (2026-05-16)

Surfaced by the per-task and final code reviews during execution of `docs/superpowers/plans/2026-05-16-malika-sonnet-only-single-lane.md`. None of these blocked shipping; all are quality-of-life. Tackle as separate small PRs when convenient.

## Priority guide
- **P1** — has user-visible or operational impact; do soon.
- **P2** — clean cleanup; do when next touching the area.
- **P3** — cosmetic / archival; do whenever (or never).

---

## 1. [P1] Eval harness false-fail on greeting cases

**Surfaced by:** the partial 2026-05-16 eval run (Task 13). Cases `G01` (halo), `G02` (selamat pagi), `G06` (terima kasih) showed `FAIL · empty_response · text_len=0` in `chat-timing.csv`, but inspection of the SSE output files (`/tmp/malika_master_tests_20260516_154215/G01.sse` etc) showed perfectly valid MALIKA responses with all expected keywords present.

**Root cause hypothesis:** the chat-eval harness extracts the response text from the SSE stream in a way that misses short greeting responses. Possibly looking for `chunk` events with a specific shape, or buffering until a non-greeting event arrives.

**Where to look:** the chat eval runner invoked from `backend/evals/master-test-runner.sh` Phase 3 (search for `_cases.tsv`, `chat-timing.csv` writers, and the SSE parser).

**Impact if ignored:** every future eval over-reports failures on greeting/chitchat cases, masking real regressions in non-greeting categories and making "did anything actually break?" calls harder.

**Estimate:** 30-60 min to identify the parser bug + fix.

---

## 2. [P2] DRY the 4 `throw if !process.env.X` blocks

**Surfaced by:** code reviews on Tasks 8, 9, 10 (and implicitly Task 11).

**Current state:** 4 near-identical blocks:
- `backend/src/services/ai/openaiChat.service.js:3-9`
- `backend/src/services/ai/keywordExtractor.service.js:33-38`
- `backend/src/services/ai/client/openaiClient.js:12-18`
- `frontend/src/app/api/insights/route.ts:2300` (uses fallback instead of throw — asymmetric)

**Suggested helper:** `backend/src/utils/requireProxyUrl.js` exporting `requireProxyUrl(moduleName: string, envVarName?: string): string`. Each call site becomes one line:

```js
const CHAT_URL = require('../../utils/requireProxyUrl')('openaiChat.service');
```

Frontend route can stay with its own fallback shape since Next.js env loading differs — or extract its own small helper.

**Impact if ignored:** each next bypass closure adds another duplicate block; changes to the message format require N edits.

**Estimate:** 20 min.

---

## 3. [P2] Stale `MODEL_ALIASES` in backend `config.js`

**Surfaced by:** final code review.

**Location:** `backend/src/services/chat/streaming/config.js:165-168`:

```js
const MODEL_ALIASES = {
  'gpt-5-mini': 'MALIKA Deep',
  'gpt-4.1': 'MALIKA Flash',
};
```

Both labels reference models that aren't in the chat path anymore (the proxy only serves `claude-sonnet-4-6`).

**Suggested fix:** either delete `MODEL_ALIASES` from backend (and any consumer) since the frontend has its own, OR update to:

```js
const MODEL_ALIASES = { 'claude-sonnet-4-6': 'MALIKA' };
```

Verify no consumer reads the old keys first.

**Impact if ignored:** none (not user-visible — backend MODEL_ALIASES has no consumers post-cleanup); just stale code surface.

**Estimate:** 5 min.

---

## 4. [P3] Stale comment at `streaming.service.js:95`

**Surfaced by:** Task 2 code review.

**Location:** `backend/src/services/chat/streaming.service.js:95` reads:

```
// shared openaiClient.chat() helper. Tier-based model selection via modelForTier.
```

Line 98 now (correctly) says:

```
// (modelForTier/MODEL_TIERS removed 2026-05-16 — single Sonnet lane, no tier-based model selection)
```

The two comments contradict.

**Suggested fix:** change line 95 to something like `// shared openaiClient.chat() helper. Single Sonnet lane — no tier-based selection.`

**Impact if ignored:** confusing for future readers; trivial.

**Estimate:** 1 min.

---

## 5. [P3] Backup file accumulation

**Surfaced by:** final code review.

**State:** roughly 60 `.backup` files exist under `backend/src/` and `frontend/src/` (and a few in `/opt/malika-llm-proxy/`), accumulated from the global CLAUDE.md `cp file file.backup` rule across many editing sessions.

**Already correctly handled:** the project `.gitignore` excludes them — none show up in `git status` or commit diffs.

**Suggested cleanup:** periodic housekeeping pass, e.g.:

```bash
find /var/www/html/project-data-strategis/backend/src \
     /var/www/html/project-data-strategis/frontend/src \
     -name '*.backup' -mtime +7 -delete
```

(Keeps backups newer than 7 days so an in-flight session isn't disrupted.)

**Impact if ignored:** none — they're gitignored. Just disk space and `ls` noise.

**Estimate:** trivial.

---

## 6. [P3] `keywordExtractor.service.js:439-442` inconsistent key handling

**Surfaced by:** Task 9 code review.

**State:** The deep-extraction path reads `OPENAI_API_KEY_CHAT` / `_INTERPRETATION` / `_QUERY_BUILDER` directly and silently returns if no key. The title-extraction path uses `getNextKey()` + the new throw-at-load `CHAT_URL`. Inconsistent within the same file.

**Suggested fix:** unify both paths on the same key/URL resolution helpers. Probably part of the same PR as Followup #2 (the proxy-URL helper extraction).

**Estimate:** 15 min, alongside #2.

---

## 7. [P3] Frontend asymmetry vs backend bypass closures

**Surfaced by:** Task 11 code review.

**State:** Backend bypass closures (Tasks 8/9/10) throw at module load if `OPENAI_API_URL` is missing. Frontend `/api/insights/route.ts` silently uses a hardcoded fallback (`'http://127.0.0.1:3031/v1/chat/completions'`) instead.

**Rationale:** Next.js server routes don't auto-load backend `.env`, so a throw would risk false-positives in dev. The hardcoded fallback works because the proxy is always on the same host.

**Suggested cleanup:** add `OPENAI_API_URL` to `frontend/.env.production.local` for parity, then either keep the fallback (defense in depth) or remove it. Document the asymmetry in the runbook either way.

**Estimate:** 10 min.
