---
name: DB Audit Findings 2026-05-08
description: Snapshot of MALIKA database audit (project_data_strategis + data_bps) listing 11 schema/integrity issues plus the embedding-dim drift, with severity, evidence, and fix direction. Verify before acting — DB state evolves.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---
# DB Audit Findings — 2026-05-08

> **Why:** User requested an audit of MALIKA's two MariaDB schemas before acting on embedding work. Findings produced by SQL probes against live DB on 2026-05-08.
> **How to apply:** Use as the punch list when writing the consolidated DB-fix plan. Re-verify each finding against live state before acting — the DB drifts week to week.

## Live State (verified 2026-05-08, updated 2026-05-10)

- **MariaDB 11.8.6** with native VECTOR support. Sequelize 6.37.7. Pool max=20.
- **`project_data_strategis`**: 32 tables, 27 models exported via `models/index.js` (3 added 2026-05-09: RetrievalChunk, IndicatorMeta, IndicatorMetricMeta).
- **`data_bps`**: 321 tables (310 `indikator_NNN` + 8 `pressrelease_kw_*` + `kodehs_indd` + `data_merged_cache` + 2 misc).
- **DataSource breakdown (2026-05-10)**: 311 active visible (157 dynamic + 149 interop + 3 static + 2 exim). Inactive: id=313 (junk hash-name, deleted 2026-05-09), id=415 (BPS endpoint dead, Option B applied 2026-05-10).
- **retrieval_chunks**: 28,716 rows = 311 datasource + 1331 knowledge_doc + 26772 knowledge_chunk + 302 indicator_meta. All 768d e5-base via @xenova/transformers.
- **Embedding system unified** to native VECTOR(768) cosine HNSW.

## P0 — broken / compliance

1. **`admin_audit_logs` writer offline since 2026-02-20.** Middleware `middleware/auditLog.middleware.js:22-56` is correct but unwired — only test files reference it. Last row id=21898. Action: re-wire `createAuditLogMiddleware` to admin/state-changing routes.
2. **EXIM cross-collation join broken.** `data_bps.kodehs_indd` is `utf8mb4_unicode_ci`, `indikator_NNN.kodehs` is `utf8mb4_uca1400_ai_ci`. Probe `LEFT JOIN ... ON i.kodehs=k.hs2digit` errors with "Illegal mix of collations". Consumers: `controllers/exim.controller.js`, `services/exim/hs2Lookup.service.js`. Fix: `ALTER TABLE data_bps.kodehs_indd CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`.

## P1 — schema drift (model vs DB)

3. **`DataSource.model.js` missing 4 live columns**: `bps_web_url VARCHAR(255)`, `priority INT DEFAULT 3`, `bps_last_metadata_fetch DATETIME`, `bps_last_metadata_status VARCHAR(50)`.
4. **`KnowledgeBase.model.js` missing 2 live columns + length mismatch**: `keywords VARCHAR(2000)` and `indicator_index MEDIUMTEXT` (already read by `vectorSearch.service.js:223`); `title` is `STRING(255)` in model but `VARCHAR(500)` in DB → silent truncation.
5. **`models/index.js` missing 9 entries**:
   - File exists but unexported: `ActiveSession`, `DnaCache`, `PageView`, `UserMemory`.
   - Tables exist with no model file: `data_period_map`, `indicator_meta`, `indicator_metric_meta`, `indicator_static_table`.
   - System: `innodb_ft_stopwords` (32 rows, FTS custom stopwords) — intentional, just doc.

## P2 — collation + retention

6. **PDS collation drift**: 22 tables on `utf8mb4_general_ci` + 10 on `utf8mb4_uca1400_ai_ci`. Cross-collation joins error. The 10 newer tables: `app_settings`, `data_merged_cache`, `data_period_map`, `data_processed_cache`, `data_sources`, `fetch_logs`, `indicator_meta`, `indicator_metric_meta`, `indicator_static_table`, `knowledge_base`. Direction: converge legacy 22 → `uca1400`.
7. **`fetch_logs` retention**: 2,489,263 rows / 142 MB / 5 months. 328K rows >90 days. No purge. Index size 45 MB (32% overhead). Fix: daily cron `WHERE created_at < NOW() - INTERVAL 90 DAY` + denormalize `last_fetched_at` onto `data_sources` first if any consumer needs it.
8. **`automation_run_logs` retention**: 122,596 rows / 130 MB. 100K >30 days. Fix: 30-day retention.

## P3 — cleanup

9. **`indikator_313` is empty + `data_sources.id=313` has hash name** `e5d1be11320576d466bdeb2f7f210387`, type=static. Aborted insert. `DELETE FROM data_sources WHERE id=313` then `DROP TABLE data_bps.indikator_313`.
10. **`_archive_pressrelease_data_sources_20260507`**: 8 rows / 400 KB / no PK. Snapshot from press-release purge work. Drop after confirm.
11. **2 system pseudo-sources** (`id=176` "System: Publikasi Notifications", `id=177` "System: MergedCache Watcher"): `static`/`visible=0`/no backing table. Either introduce `system` enum value or document the convention in `docs/workspace/database.md`.

## Bonus — earlier embedding finding (resolved by Gemini decision)

12. **Embedding dim drift**: live storage was 99.99% 3072-dim OpenAI. **Resolution (2026-05-09)**: budget constraint → standardize on Gemini `gemini-embedding-001 @ 768d` exclusively. See [embedding_gemini_decision.md](embedding_gemini_decision.md). All OpenAI 3072d vectors abandoned in place; re-embedded via Gemini into `retrieval_chunks` table (Phase C of the plan).

## FK inventory (PDS only)

- `data_merged_cache.source_id` → `data_sources.id` CASCADE/CASCADE
- `data_period_map.source_id` → `data_sources.id` CASCADE/CASCADE
- `data_processed_cache.source_id` → `data_sources.id` CASCADE/CASCADE
- `fetch_logs.source_id` → `data_sources.id` CASCADE/SET NULL

No FKs cross from PDS into `data_bps` (intentional — they're separate schemas).
