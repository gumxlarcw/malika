---
name: malika-llm-proxy live paths
description: Where the actual running malika-llm-proxy code and env live (NOT the openclaw config that looks authoritative)
type: reference
originSessionId: bab0b173-f3d2-41f1-aeda-84ae5497fe81
---
# malika-llm-proxy — live source of truth

## The trap
There are two files that look like proxy config. Only one is actually used by the running PM2 process:

| Path | Role | Use? |
|---|---|---|
| `/opt/malika-llm-proxy/src/index.js` | **Live script** PM2 id 16 runs | ✅ Yes |
| `/opt/malika-llm-proxy/.env` | **Live env** loaded via `dotenv` | ✅ Yes |
| `/opt/openclaw/malika-llm-proxy.{config,ecosystem}.js` | Dead PM2 ecosystem files pointing at a script that does not exist (`backend/src/services/chat/malika-llm-proxy.js`). Both carry 10 Google API keys in plaintext — **pending rotation + deletion as of 2026-08-18** | ❌ Not the running config |

`pm2 describe malika-llm-proxy` confirms: `script path = /opt/malika-llm-proxy/src/index.js`, `cwd = /opt/malika-llm-proxy`.

## Reload procedure
```bash
# Edit /opt/malika-llm-proxy/.env, then:
pm2 reload malika-llm-proxy --update-env
```
The `--update-env` flag is required — without it, the new env values aren't injected. `fork_mode` makes "reload" effectively a fast restart (uptime resets).

## Key loader behavior (`src/index.js` `loadGoogleKeys`)
`GOOGLE_API_KEYS` (plural, comma-separated) from env is the only source. Empty or
unset → no Google pool at all, `google_keys: 0` in `/health`. That is the current
state and it is deliberate: the Google lane is not in the tier chain.

The openclaw `auth-profiles.json` fallback that used to sit here was removed
2026-08-18 — it could resurrect a pool the env had deliberately emptied.

The singular `GOOGLE_API_KEY` is *not* read by the loader — leave it alone if present, but it's not load-bearing for the pool.

## Tier chain source
`PROXY_PRIMARY_TIER` in `/opt/malika-llm-proxy/.env` — a comma-separated list of
`provider/model` specs. That is the whole chain; `PROXY_ALLOWED_PROVIDERS` then
filters it (fail-open: a filter that would empty a non-empty chain is ignored).
`HARDCODED_FALLBACK_TIER` in `index.js` applies only when `PROXY_PRIMARY_TIER` is
unset/empty, and is a single first-party lane.

**Env-only since 2026-08-18.** The chain used to be read from
`~/.openclaw/openclaw.json` (`agents.defaults.model.{primary, fallbacks}`) and
hot-reloaded via `fs.watch`, which coupled MALIKA's availability to a config file
owned by an unrelated agent framework — an edit there silently re-pointed every
chat request. Changing the chain now means editing `.env` and running
`pm2 reload malika-llm-proxy --update-env`.

Current chain (verified 2026-08-18 via `/health`) — **DeepSeek only**:
1. `neuralwatt/deepseek-v4-flash` (primary; cost gauge in `/health` as `neuralwatt_allowance_usd`)
2. `neuralwatt/deepseek-v4-flash-flex` (same-family fallback)

Tier 2 is not decoration. NeuralWatt returns a fast, empty-message network error
on roughly 9% of requests (43/477 on the live key), and the pattern is random —
not a `max_tokens` or prompt-shape threshold. A single-entry chain turns every one
of those into a user-visible 503, so the `-flex` variant absorbs them while
keeping the answer within DeepSeek. Both variants report their own distinct name
in the response, so `chat_messages.model` shows which one actually served.

Dropped from the chain 2026-08-18 on request ("semua pakai deepseek saja"):
`openagentic/glm-5` (9-key pool, still wired) and `anthropic/claude-sonnet-4-6`
(served by `handleClaudeCLI`, the `claude` CLI under OAuth subscription billing —
*not* the Anthropic HTTP API). Both handlers remain in `index.js`; restoring them
is an env edit, not a code change.

Measured cost on this chain: **$0.001024 per chat turn** (3 real turns via the
full pipeline, read off `neuralwatt_allowance_usd` before/after). 87% of tokens
are input, so cost tracks prompt size — context, not answer length. A reasoning-
capable model (`glm-5.2` on NeuralWatt, the only one in the roster that emits a
`reasoning` field) costs ~16× more; `deepseek-v4-flash` emits none.

Providers removed 2026-08-18 with the openclaw cut: `google-gemini-cli` and
`openai-codex` (both authenticated through openclaw's `auth-profiles.json`).
`google` (HTTP API, env keys) and `claude-cli` remain wired but are not in the chain.

## Health probe
```bash
curl -s http://127.0.0.1:3031/health | python3 -m json.tool
```
Watch for: `google_keys` should equal pool size; `cooldowns` near `google_keys` means all keys throttled (rare).

## Worker pool (added 2026-05-09)

### What
Persistent `claude` CLI subprocesses kept warm per chat session, replacing the previous `execFile`-per-request pattern for the `claude-cli/*` tier. Roughly 250 LOC added to `/opt/malika-llm-proxy/src/index.js`.

### Why
Each `claude -p "<prompt>"` invocation paid ~10s cold-start to bootstrap Node + the claude-code bundle. The Anthropic API itself was not the bottleneck — the CLI process was. Keeping the process alive across turns amortizes that cost.

### How it works
- Workers are spawned in stream-json IO mode:
  ```
  claude -p --input-format stream-json --output-format stream-json \
    --include-partial-messages --verbose \
    --model <model> \
    --disallowedTools Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task
  ```
- Each turn writes one JSON line to stdin, reads streaming JSON back from stdout.
- Workers are keyed by the `X-Chat-Session-Id` request header. One worker per session per model.
- Requests **without** `X-Chat-Session-Id` transparently fall through to the legacy `execFile`-per-request path. No regression for backends that don't opt in.

### CRITICAL: do NOT use `--bare`
The `claude` binary must run in normal (allowlisted-tools) mode to keep oat01 OAuth subscription billing. `--bare` disables OAuth and forces api03 pay-per-token billing. The `--disallowedTools …` list above is the correct way to neuter tools while preserving subscription billing — Anthropic's first-party tool allowlist still applies because `claude` is still the network client.

### Tunables (in `src/index.js`)
| Const | Default | Meaning |
|---|---|---|
| `WORKER_IDLE_MS` | 10 min | Reap a worker after this much idle time |
| `WORKER_MAX_AGE_MS` | 1 h | Hard cap on worker lifetime |
| `WORKER_MAX_TURNS` | 100 | Recycle worker after this many turns |
| `WORKER_POOL_CAP` | 10 | Max concurrent workers (LRU evict beyond this) |
| `WORKER_TURN_TIMEOUT_MS` | 60 s | Per-turn timeout |
| `WORKER_REAP_INTERVAL_MS` | 60 s | How often the reaper sweeps |

### Endpoints
- `GET /pool` — full worker stats (per-worker age, turns, idle time, model).
- `GET /health` — now includes `worker_pool_size` and `worker_pool_cap`.

### Spike test (2026-05-09)
- Cold turn (first request, fresh worker): **10.3s**
- Warm turns (subsequent requests, same session): **median 2.6s**
- ~4× speedup once warm.

### Backend integration — DONE
The chat backend propagates the thread id as `X-Chat-Session-Id` on every
outbound chat request, so the worker pool is live. See
`streaming.service.js` (all three `llmChat` call sites), `chat.service.js`
`callOpenAIChat`, and `autoTune/agent.service.js` (`auto-tune-<jobId>`).
The header is forwarded through `streaming/openaiClient.js` `chat({ extraHeaders })`.

## 2026-05-09 fix
Wired 10 keys into `/opt/malika-llm-proxy/.env` as `GOOGLE_API_KEYS=…` (comma-separated). Before: `google_keys: 0` (Anthropic was single point of failure). After: `google_keys: 10`. Backup at `/opt/malika-llm-proxy/.env.backup`.
