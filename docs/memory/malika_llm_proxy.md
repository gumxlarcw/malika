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
| `/opt/openclaw/malika-llm-proxy.config.js` | Stale ecosystem file pointing to a different script (`backend/src/services/chat/malika-llm-proxy.js`) | ❌ Not the running config |

`pm2 describe malika-llm-proxy` confirms: `script path = /opt/malika-llm-proxy/src/index.js`, `cwd = /opt/malika-llm-proxy`.

## Reload procedure
```bash
# Edit /opt/malika-llm-proxy/.env, then:
pm2 reload malika-llm-proxy --update-env
```
The `--update-env` flag is required — without it, the new env values aren't injected. `fork_mode` makes "reload" effectively a fast restart (uptime resets).

## Key loader behavior (`src/index.js` `loadGoogleKeys`)
1. Reads `GOOGLE_API_KEYS` (plural, comma-separated) from env. Wins if present.
2. Falls back to parsing `~/.openclaw/agents/main/agent/auth-profiles.json` for entries with `provider: google`.
3. If both empty → `google_keys: 0` in `/health`, fallback tier dies silently.

The singular `GOOGLE_API_KEY` is *not* read by the loader — leave it alone if present, but it's not load-bearing for the pool.

## Tier chain source
`~/.openclaw/openclaw.json` → `agents.defaults.model.{primary, fallbacks}`. Hot-reloaded via `fs.watch`. Hardcoded fallback in `index.js:26-31` if the JSON is unreadable.

Current chain (verified 2026-05-09):
1. `claude-cli/claude-sonnet-4-6` (primary, Anthropic via openclaw CLI)
2. `google/gemini-3-flash-preview` (uses the 10-key pool)
3. `google-gemini-cli/gemini-3-flash-preview` (uses gemini CLI OAuth, NOT the API key pool)
4. `google-gemini-cli/gemini-2.5-pro` (same)

Tiers 3-4 are unaffected by the API key pool — they auth via `~/.gemini/` OAuth tokens.

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

### Backend integration TODO
The chat backend at `/var/www/html/project-data-strategis/backend/` must propagate a stable session id (per chat session, not per request) as `X-Chat-Session-Id` on outbound requests to the proxy. **Until that's wired, every call still takes the legacy 10s path** — the worker pool exists but is never touched.

## 2026-05-09 fix
Wired 10 keys into `/opt/malika-llm-proxy/.env` as `GOOGLE_API_KEYS=…` (comma-separated). Before: `google_keys: 0` (Anthropic was single point of failure). After: `google_keys: 10`. Backup at `/opt/malika-llm-proxy/.env.backup`.
