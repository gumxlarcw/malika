# Project Data Strategis (MALIKA) - Memory

## GitHub repo (consolidated 2026-05-09)
- **https://github.com/gumxlarcw/malika** (private)
- **Production IS the git-tracked tree**: `/var/www/html/project-data-strategis/.git` — direct origin tracking on `gumxlarcw/malika`, branch `main`. Edit + commit + push directly from production. No more sync script, no drift mechanism.
- **Previous setup (deleted 2026-05-09)**: `/var/www/html/.worktrees/malika-fresh/` worktree with rsync-based sync. Caused drift (114 untracked files at audit time). Worktree deleted, freed 751 MB. See [malika_github_repo.md](malika_github_repo.md) for the full migration story.
- Other projects in /var/www/html/ (agenda_work, opac-pst-malut, sipentas, etc.) still tracked by the local-only monorepo at /var/www/html/.git — unaffected by this migration.
- If you hit "dubious ownership" warnings (dir is www-data, root commits), run: `git config --global --add safe.directory /var/www/html/project-data-strategis`
- **CI/CD blocked by GitHub phantom workflow** — see `.github/TROUBLESHOOTING.md` in repo. Workflow YAML clean and ready for when phantom clears.

## Workspace — Project Line Files
Lokasi: **`docs/workspace/`** di root project (`/var/www/html/project-data-strategis/docs/workspace/`).
Setiap aspek punya file tracking sendiri. **Baca file terkait** saat bekerja di area itu.
**Update Change Log** di file terkait setelah perubahan signifikan.

| File | Aspek | Kapan Dibaca |
|---|---|---|
| `docs/workspace/backend.md` | Backend API: routes, controllers, models, services | Edit backend |
| `docs/workspace/frontend.md` | Frontend PWA: pages, components, hooks, libs | Edit frontend |
| `docs/workspace/admin.md` | Admin Panel: pages, components, state management | Edit admin |
| `docs/workspace/chat-pipeline.md` | Chat streaming: monolithic SSE flow inside `streaming.service.js`, tiers, LLM proxy | Edit chat system |
| `docs/workspace/ai-llm.md` | AI/LLM: models, proxy, API keys, AI services | Edit AI/model config |
| `docs/workspace/database.md` | Database: models, tables, migrations, schema | Edit DB/models |
| `docs/workspace/infra.md` | Infrastructure: PM2, CI/CD, deployment, build | Edit infra/deploy |

> **Full docs**: `PROJECT_COMPREHENSIVE_DOC.md` di root project
> **Quick ref**: `REFERENCE.md` di root project

## Architecture (Quick Summary)
- **3 apps** via PM2: pds-backend (:5000), pds-admin (:5050), pds-frontend (:6060)
- **LLM Proxy**: malika-llm-proxy (:3031) — live at `/opt/malika-llm-proxy/{src/index.js,.env}`, see [malika_llm_proxy.md](malika_llm_proxy.md). The `/opt/openclaw/malika-llm-proxy.config.js` ecosystem file is stale, NOT what PM2 runs.
- **Cloudflare Tunnel**: malika.bpsmalut.com (PWA), api-malika.bpsmalut.com (API + Admin)
- **All models**: `claude-sonnet-4-6` via Anthropic oat01, Gemini fallback (10 keys)
- **DB**: MariaDB 11.8.6 — `project_data_strategis` (primary, 32 tables) + `data_bps` (321 tables: 310 indikator_NNN + 8 pressrelease_kw_* + kodehs_indd + data_merged_cache + 1 misc, replica)

## Key Patterns
- Always backup before edit: `cp {file} {file}.backup` (per CLAUDE.md)
- Backend reload: `pm2 reload pds-backend --update-env`
- Frontend is git submodule — push separately
- CSRF on admin state-changing ops, rate limiting: chat 30/min, search 60/min
- **Git workflow (2026-05-09)**: edit in `/var/www/html/project-data-strategis/`, commit + push origin main directly. No worktree, no rsync.
- **Sync safeguards (2026-05-09)**: SessionStart hook fetches origin + prints state; Stop hook warns at session end if uncommitted/unpushed. Standalone CLI: `bash scripts/sync-status.sh`. Hook scripts in `.claude/hooks/`, wired in `.claude/settings.json`.
- **Repo structure (2026-05-09)**: root has 4 MDs (CLAUDE/README/REFERENCE/PROJECT_COMPREHENSIVE_DOC). Historical docs in `docs/archive/`, runbooks in `docs/runbook/`, technical refs in `docs/reference/`. Per-area living docs still in `docs/workspace/`.

## Warnings
- malika-llm-proxy MUST run before backend can answer chat
- Server startup 20-45s (embedding preload), PM2 wait_ready handles this

## Testing
- Backend: `cd backend && npx jest --passWithNoTests --no-coverage` (191 tests PASS)
- Known failure: `integration/chat.test.js` (missing searchMemory handler)
- Eval: `backend/evals/master-test-runner.sh` (81 cases)
- Deep doc eval: `node scripts/test-deep-document.js` (21 cases, **20/21 PASS** as of 2026-03-10)
- Deep doc stability: `bash scripts/test-deep-document-stability.sh [RUNS] [THRESHOLD]`
- Frontend E2E: Playwright

## Deep Doc System (Knowledge Context) — DELETED 2026-05-08
> ⚠ **CODE REMOVED**: Files implementing the Deep Doc 3-layer system (`knowledgeContext.service.js`, `pipeline.service.js`, `prompt.service.js`) were deleted in commit `9dc176f` after a reachability audit confirmed zero live importers. The 20/21 accuracy below is **historical only**. To restore the feature, recover logic from `git show 9dc176f^:<file>` and inline into `streaming.service.js`. See [chat_pipeline_orphan_code.md](chat_pipeline_orphan_code.md).

- **20/21 accuracy** with Claude Sonnet 4.6 (2026-03-10) — **historical; current live path has none of this logic**
- **3-Layer system (deleted)**: Layer 1 (post-response validator + 15 refusal patterns), Layer 3 (extraction quality score). Layer 2 (n-gram bonus) was reverted, replaced by scoped phrase bonus.
- **Layer 1 (deleted)**: Detected LLM refusal when context has numeric data → auto-retries with focused prompt (temp 0.1)
- **Layer 3 (deleted)**: 0-100 quality score → graduated prompt confidence (≥75=confirmed, ≥40=likely)
- **Phrase bonus (deleted)**: Bigram consecutive-word scoring in `extractByIndicatorIndex` (+0.5 per matching bigram)
- **Disambiguation hint (deleted)**: When top-2 indicator entries score within 0.5, prepend hint to context
- **Temperature**: COMPLEX/DEEP=0.2, SIMPLE=0.3, GREETING=0.7 (live in `modelRouter.service.js`, kept)
- Recovery path: `git show 9dc176f^:backend/src/services/chat/streaming/knowledgeContext.service.js` (and `pipeline.service.js`, `prompt.service.js`)

## User Preferences
- **Always use TaskCreate/TaskUpdate** for implementation tasks so progress shows as live checkboxes in Claude Code CLI
- **No `Co-Authored-By` trailer in commits** — see [feedback_no_coauthor.md](feedback_no_coauthor.md). User stripped 31 commits via filter-branch + force-push on 2026-05-08; do not re-introduce.
- **Verify subagent reports before trusting** — see [feedback_subagent_verify_before_trust.md](feedback_subagent_verify_before_trust.md). 3 fabrications (invented peer-dep concern, hallucinated commit SHA, impossible test count) surfaced in one 14-task audit run; verify SHA + diff + actually-run-tests after every implementer DONE.

## Active Plans
- [DB Audit Fixes (2026-05-08)](db_audit_findings_2026-05-08.md) — plan at `docs/superpowers/plans/2026-05-08-db-audit-fixes.md`. Phases A–F covering 11 audit findings + embedding drift. Phase C unifies retrieval into `retrieval_chunks` (VECTOR(768) cosine HNSW). **DONE 2026-05-09**.
- [Embedding decision: Gemini only (2026-05-09)](embedding_gemini_decision.md) — superseded by self-hosted e5-base @ 768d via @xenova/transformers (Gemini quotas exhausted, 3 keys suspended). **DONE 2026-05-09**.
- [BPS data integrity fixes (2026-05-09)](db_audit_findings_2026-05-08.md) — plan at `docs/superpowers/plans/2026-05-09-bps-data-integrity-fixes.md`. Phases 4-6 done 2026-05-10 (year=0 cleanup, CHECK constraints on 310 tables, index backfill on 1..20, `a` value_code, replicator guard, BPS API limitations doc). Phases 1-3 (dynamic→interop migration) deferred — needs manual BPS research per source.
- [Automation flow fixes (2026-05-11)](automation_flow_fixes_2026-05-11.md) — plan at `docs/superpowers/plans/2026-05-11-automation-flow-fixes.md`. 8 tasks: audit middleware write-only, batched/parallel status loop (560ms→175ms), durable run-log rows, structured progress events, scheduler badge UI, dead route removed. **DONE 2026-05-11**.

## BPS API limitations (key finding 2026-05-09)
- **Dynamic API does NOT expose `*`/`**`/`r`/`e`/`p` value_code flags** — BPS strips them before serializing JSON. 157 of 310 indikator sources are dynamic; all lack provisional flags.
- **Interop API DOES expose `value_code`** — 150 sources, 95 have flags captured.
- **Migration is per-source manual** — different identifiers (var_id vs id_tabel), no automated mapping. See `docs/reference/BPS_API_LIMITATIONS.md`.

## BPS data integrity cleanup (2026-05-10)
- **Schema CHECK constraints applied** to all 310 indikator tables: `year BETWEEN 2000 AND 2100`, `month_no IN (0,1-12,31-37)`. BPS `month_no` sentinel set: `0`=annual rollup, `1-12`=monthly, `31-34`=Triwulan I-IV, `35`=Tahunan, `36-37`=semester (Maret/Sept for Kemiskinan).
- **dim_hash duplicate cleanup**: 93 legacy empty-hash duplicate rows deleted from indikator_3/4/5/6 (each had a proper-hash twin with same `(th_id, month_no, dim_value, metric)`). All 4 tables now have 0 buggy empty-hash rows. Replicator at `indicatorTableBps.service.js:280` has a self-healing `UPDATE dim_hash = SHA1(...)` that runs on every `ensureIndicatorTable` invocation.
- **Index backfill on indikator_1..20**: 43 missing indexes added (idx_dim_hash, idx_hs2, idx_dim).
- **Year=0 corruption**: 11 rows in indikator_7 deleted; replicator now rejects `year < 2000 || year > 2100` at write time.
- **Legitimate empty-hash rows**: 2,448 rows across single-metric no-dimension tables (e.g., national-level Inflasi). These have `dim_key=''` AND `dim_value=''` — uniqueness comes from `metric` instead. Not a bug.

## Year coverage backfill 2010-2026 (2026-05-11)
- **`data_period_map` ↔ `indikator_NNN` reconciliation complete** — all 311 active sources have `db_distinct_years >= pm_distinct_periods`. 332 PM rows backfilled (3,257→3,589) earlier; replication via `GET /cache/merge/:id?all=true&save=true` propagated to indikator tables.
- **`?save=true` is required for replication** — the merge endpoint without `save=true` only computes the merged structure and returns it; replication to `data_bps.indikator_NNN` runs only inside the `if (save==='true')` branch in `cache.merge.controller.js:192`. Test calls without `save=true` are no-ops.
- **`cache/merge/:id` is dynamic-only for non-EXIM** — `mergeBuilder.service.js` always routes through `fetchByTh` which throws "Missing domain/var/key in datasource" on interop sources. Interop replication happens via scheduled processor jobs, not on-demand endpoint calls. EXIM has its own branch in the controller.
- **Source 454 (Kemiskinan)** had a stale `period_value='1979'` PM row from period discovery; the year CHECK constraint correctly rejected the 1979 BPS row, and the orphan PM entry was deleted. Pattern to remember: check for `period_value < 2000 OR > 2100` after period-map rebuilds.
- **JWT minting shortcut** for admin-only endpoints when login is broken: `node -e "const j=require('jsonwebtoken'); console.log(j.sign({id:1,email:'admin@bps.go.id',role:'admin'}, 'JWT_SECRET_VALUE', {expiresIn:'2h'}))"` from `backend/`. Login route is `POST /auth/login` (no `/api` prefix) and uses `email` field, not `username`.

## BPS API health audit + interop notes fix (2026-05-11)
- **309/309 active sources fully healthy** — full year coverage + new BPS data flowing. Verified via 40-source spot-check (15 stratified + 25 random) → 100% backfillable, 0 silently dead.
- **5 CPI/Inflasi sources migrated 2026-05-11** to live vars (24 rows each → 612-636 rows each, 17 years 2010-2026):
  - id=2 (CPI Halmahera Tengah): var 375 → **403 with turvar=681**
  - id=161 (CPI Maluku Utara): var 377 → **403 with turvar=683**
  - id=163 (Inflasi Halmahera Tengah): var 376 → **405** (clean 1:1)
  - id=164 (Inflasi Kota Ternate): var 379 → **406** (clean 1:1)
  - id=165 (CPI Kota Ternate): var 380 → **403 with turvar=682**
  - **Pattern: BPS deprecated vars 375-380 but kept the 2022=100 series alive on new var IDs (403, 405, 406).** var=403 is consolidated 3-region (turvar = {681:HT, 682:KT, 683:Provinsi}). Migration workflow: ALTER api_url → `generatePeriodMap(id, 2010, 2026)` → `GET /cache/merge/:id?all=true&save=true` with admin JWT.
- **3 Agriculture sources still dead at BPS** (id 368, 371, 412) — Produksi Sayuran/Buah, Luas Panen. DB has 1,078-2,376 rows (2015-2023). BPS dropped the series entirely; no replacement var ID exists in BPS var-list. `malut.bps.go.id` page shows "Tidak Tersedia". Decision: leave visible since historical data is valid.
- **1 static source w/ 0 rows** — id 7 (Ibukota Kabupaten/Kota); never ingested because the static processor doesn't route this URL pattern. Low priority.
- **Interop `catatan` captured 2026-05-11** — commit `6e4657c` added `notes: sanitizeKeepInline(payload.catatan)` in `interop.extractor.js`. Re-extract on 149 interop sources lifted `indicator_meta.notes` coverage from **0/149 → 82/149 (55%)**. Remaining 67 have empty `catatan` at default period 2023 — not a code bug.
- **BPS API doc landed** at repo root `apibpsdocs.md` (~730 lines, 19 sections). Used to audit our coverage. Currently active endpoints: §4.1 (Dynamic), §4.4 (th list), §6.9 (SIMDASI Detail id=25), §14 (EXIM). Unused-but-useful: §13 Glosarium (def backfill), §11 Strategic Indicators, §7 Static Table, §4.5 Unit list.
- **Schema correctly handles interop's per-kolom design** — `indicator_meta.unit_id`/`definition` are intentionally null for interop (units live per-column in `indicator_metric_meta`). Earlier read of "0/149 unit_filled" on `indicator_meta` was a false alarm; `indicator_metric_meta` shows 496/1006 unit_filled (49%) and 223/1006 def_filled (22%) for interop metrics.
- **EXIM `netweight` IS persisted** — long-format (one row per metric). Verified 2026-05-11: 822 `metric='value'` + 822 `metric='netweight'` rows in indikator_159. Earlier "gap" was misread.
- **§13 Glosarium deferred** — crawled 20/327 pages (10k entries) before BPS rate-limited with HTTP 500. Quality analysis: only 5.4% of entries have real `definisi` content (>50 chars); `konsep` is empty across the sample. Match rate against our 287 sources: 5 exact + 32 substring (13%). Even with full crawl, expected matches with usable definitions ≈ 30-50. Poor ROI; defer indefinitely.
- **§11 Strategic Indicators (2026-05-11)** — 13 indicators for domain 8200 (`/v1/api/list/model/indicators/`), all matched to our `bps_var_id`. Updated `data_sources.priority=1` for ids: 1, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 162, 170.
- **§4.5, §7 verified non-issues** — `indicator_meta.unit_id` already stores human labels (not numeric codes); `indikator_7=0 rows` is by design (static-table data lives in `indicator_static_table`, 11 rows correctly parsed).

## Gotchas
- [serve -s flag is SPA fallback](serve-spa-flag-trap.md) — drop `-s` for multi-page static sites; otherwise every path returns top-level index.html silently
- Always backup before edit: `cp {file} {file}.backup` (per CLAUDE.md)
- [Peta Tematik kdkab](peta_tematik_kdkab.md) — BPS standard: 03=Kepulauan Sula, 05=Halmahera Utara (NOT swapped). Don't author kdkab tables from memory.
- [Peta Tematik palettes](peta_tematik_palettes.md) — 5 palettes, hover outline must clash with ALL bins (complementary hue, never a same-hue shade).
- [Tailwind 4 + html2canvas oklch](tailwind4_html2canvas_oklch.md) — html2canvas@1.4.1 chokes on oklch() from Tailwind 4. Use html2canvas-pro for any DOM-to-canvas capture.
- [Leaflet PNG export canvas renderer](leaflet_export_canvas_renderer.md) — Set preferCanvas=true on Leaflet maps that get exported via DOM-to-canvas; otherwise SVG polygons misalign with tiles.
- [BPS value_code conventions](bps_value_codes.md) — 10 codes seen in real interop data (incl. `–` U+2013 = "Data nihil", `...`, `NA` beyond r/*/**/***/e/p/x). Reference before extending `BPS_VALUE_CODE_LABELS`.
- [Chat pipeline orphan code](chat_pipeline_orphan_code.md) — historical: the V2 refactor's 35 dead files were deleted in commit `9dc176f` (2026-05-08). `streaming/` now has only 4 live files. Live flow remains monolithic in `streaming.service.js`.
- [Chat MALIKA design implementation](chat_malika_design.md) — Claude Design handoff bundle (`api.anthropic.com/v1/design/h/e-86ojQ1LBP1z0fDlEHCHQ`) was implemented as commit `9fac57a` (2026-05-08). UnifiedThinkingCard component, branded EmptyState with 4 colored category cards (Demografi/Ekonomi/Sosial/Harga & Inflasi), QuickReplies grid layout, and MALIKA-specific CSS animations (malika-pulse, malika-rail-glow). SAMPLE_QUERIES now lives in chatConstants.ts.
- [Kategori MALIKA design implementation](kategori_malika_design.md) — Claude Design handoff bundle (`api.anthropic.com/v1/design/h/K4KpeIAzPwJoXqt2YTX1UA`) implemented 2026-05-08 for both mobile + desktop. Atlas dark hero on list, color-tinted hero on detail, donut chart, segmented type filter, per-category palette via CSS custom-props + `dark:bg-[var(--cat-bg-dark)]` for class-based dark mode. Code lives in private `_lib/` and `_components/` folders under `(admin)/kategori/`.
- [Data MALIKA design implementation](data_malika_design.md) — Claude Design handoff bundle (`api.anthropic.com/v1/design/h/RWEMGilAN2OAn_p79cpG5g`) implemented 2026-05-09 for both desktop + mobile. Hero with sparkline summary, sticky StuckContextBar + FilterBar stack, table with sticky-first-column + per-row sparkline + cell tooltip, ChartCard + InterpretationCard wrappers around existing components. Initial commit `54cc9e9`; audit-rooted fixes on PR #1 (`fix/data-audit-regressions`) covering aggregateColumn picker for wide multi-commodity tables, lossy-NaN-parse fix, dark-mode shadow class, shared `backendBaseUrl()` helper.
- [Next 16 notFound() returns 200](next16_notfound_status.md) — calling `notFound()` from an in-route dynamic server component renders the not-found UI but emits HTTP 200 (not 404). Verified on 16.0.10. `force-dynamic` and segment-level `not-found.tsx` don't fix it. Body is correct; only SEO status is wrong. Use middleware if real 404 status is required.
- [/api/insights template-mode error wiring](insights_template_mode_error.md) — endpoint returns 200 with both `error: "openai_fetch_failed_after_3_retries"` and a usable `interpretation` template fallback. The `InterpretationPanel` wrapper reads `error` and shows failure UI anyway, hiding the template content. Pre-existing; "Gagal memuat interpretasi" on `/data` pages is the LLM rate-limit fallback, not a frontend regression. Fix lives in the shared panel, not in route wrappers.

## SIPENTAS (separate project at `/var/www/html/sipentas/`)
- **Deployed 2026-04-30** at `https://sipentas.bpsmalut.com` — Sistem Penilaian Petugas PST Terbaik for BPS Kota Ternate
- Stack: Express+Sequelize+MariaDB `sipentas_pst` (backend :5104) + React+Vite SPA (:6101), 49/49 backend tests passing
- PM2: `sipentas-backend` (id 27), `sipentas-frontend` (id 28). Cloudflare path-based ingress.
- 4 roles (admin, kepala_kantor, ketua_tim, ketua_ipds). Initial accounts: `admin`/`kepala`/`ketuaipds` with password `Sipentas2026!` (must change on first login).
- Full details: [sipentas_project.md](sipentas_project.md). Spec at `/var/www/html/sipentas/docs/superpowers/specs/2026-04-29-sipentas-design.md`, plan at `/var/www/html/sipentas/docs/superpowers/plans/2026-04-29-sipentas.md`.

## OPAC PST Malut (separate project at `/var/www/html/opac-pst-malut/`)
- 3-sub-project series A/B/C completed 2026-04-28: audit (87 findings) → role refactor → UI redesign mobile-first
- Stack: Express + Sequelize + MySQL `library_pst` (backend :5102) + React 18 + Vite + AntD 5 + Tailwind (frontend :6100), public URL `https://library.bpsmalut.com/`
- Source code now tracked in git as of 2026-04-29 (commit `b7b3b1c`); previously untracked
- Roles: `admin`, `operator` (`librarian` removed); FK `created_by` on books + digital_collections
- Pending strategic decisions: [opac_pending_decisions.md](opac_pending_decisions.md) — F-dep-1 critical (node-tesseract-ocr replacement), F-perf-3/4 backend pagination, Lighthouse perf gap (vendor-antd 325KB)
