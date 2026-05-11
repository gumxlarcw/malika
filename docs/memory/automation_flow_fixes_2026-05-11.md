---
name: Automation flow fixes 2026-05-11
description: Eight-task hardening pass on /backend/automation flow — audit middleware write-only, batched/parallel status loop (560ms→175ms warm), durable run-log rows, structured progress events, scheduler badge UI, dead sync controller removed.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---
# Automation flow fixes — 2026-05-11

> **Why:** Audit of `https://api-malika.bpsmalut.com/backend/automation` end-to-end revealed perf hot path, audit-log noise, in-memory job fragility, log-string-matched progress, and dead duplicate code. Plan at `docs/superpowers/plans/2026-05-11-automation-flow-fixes.md`.
>
> **How to apply:** All 8 tasks merged to main as commits `7a7396e..45940b6`. Reference for future automation changes.

## Verified ground truth (pre-execution)
- `automation_configs(source_id)` already UNIQUE — dropped my "add unique" finding.
- `retention.job` already wired (90/30/365d compliance verified) — dropped my "retention missing" finding.
- N+1 wall-clock was ~560ms (not 5–15s as initially framed) — measured live via Sequelize timing.
- `admin_audit_logs` writer healthy (22k rows, growing daily).

## What changed

| Task | Commit | Effect |
|--:|---|---|
| 1 | `7a7396e` | EXIM `indikator_159/160` got `idx_pod`; UNIQUE source_id documented |
| 2 | `c19940f` | `createAuditLogMiddleware` write-only by default; `logReads:true` opt-in retains read audit per-resource |
| 3 | `468856c` | `scheduler_enabled` now reads from `getAutomationSchedulerState()` (runtime); adds `scheduler_mode` + `scheduler_next_run_at` |
| 4 | `9ee366e` | Batched info_schema (1 query) + chunked-10 parallel aggregates → status load 560ms→175ms warm |
| 5 | `80ea240` | `automationRunJob` INSERTs placeholder run-log at start, debounced 2s flush, runner UPDATEs same row at terminal via `persistRunLog(payload, runLogRowId)` — single row per run, mid-run state durable across PM2 reload |
| 6 | `9b34d87` | Runner emits structured `progress({stage, percent, message})` callback at 12 stages; `updateProgressFromLog` log-string fallback retained |
| 7 | `ebdd903` | Admin shows green/gray scheduler badge + next-run-at; auto-Smart toast copy clarified + info pill near title |
| 8 | `45940b6` | Removed dead `GET /automation` + 4 duplicate helpers (-210 LOC); verified 0 consumers |

## Files touched (canonical list for future grep)
- `backend/src/middleware/auditLog.middleware.js`
- `backend/src/services/automation/automationStatusJob.service.js`
- `backend/src/services/automation/automationRunJob.service.js`
- `backend/src/services/automation/automationRunner.service.js`
- `backend/src/controllers/automation.controller.js`
- `backend/src/routes/automation.routes.js`
- `backend/admin/app/automation/page.tsx`
- `backend/src/__tests__/auditLog.middleware.test.js` (new, 4 tests)
- `backend/src/__tests__/automationStatusJob.shape.test.js` (new, 2 tests)
- `docs/workspace/database.md` (invariants section + change-log entry)

## Behaviors to remember
- **`createAuditLogMiddleware({ logReads: true })`** if a future resource needs forensic read-tracking; default skips GET/HEAD/OPTIONS.
- **`runAutomationForSource({ ..., runLogRowId })`** — passing a row id makes the runner UPDATE in place instead of CREATE. Scheduler-tick runs don't pass it, so they still CREATE on completion.
- **`runAutomationForSource({ ..., progress })`** — pass a callback to receive `{stage, percent, message}` events. Stages: `config_updated, smart_check, latest_th_detected, remote_last_update, smart_skip, full_refresh_start, periods_available, saved_primary, replicating, saved_replica, upserted_production, automation_cfg_updated`.
- **`scheduler_enabled` in status payload** reflects live `getAutomationSchedulerState().enabled` — not `process.env.AUTOMATION_ENABLED`. The env flag is now only consulted at scheduler boot.

## Out of scope (deferred)
- Persisting runtime stats sidecar onto `data_sources` — measured perf already at 175ms warm, complexity not justified.
- SSE for run-job logs — current poll cadence acceptable; chat-streaming.service already proves SSE works through this CF Tunnel if needed later.
- Splitting `page.tsx` (1,254 lines) — do when next touching it for a feature.

## Live measurements (post-deploy)
- Status load wall-clock: 175ms warm, 350ms cold (3× faster).
- All shape + middleware tests pass (`npx jest src/__tests__/auditLog.middleware src/__tests__/automationStatusJob` → 6 passed).
- Single row per run-job in `automation_run_logs` (verified id=124802 smart-skip, id=124809 daily-mode).
- Bare `GET /automation` → 404 (route removed).
