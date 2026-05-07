# Search Eval Baseline — 2026-04-18

**Report:** `backend/evals/reports/eval-2026-04-18-13-37.json` (+ .md)
**Fixture:** 45 labeled cases across 8 tags (core, geo, abbrev, period, knowledge, deeplink, nomatch, typo)
**Duration:** 39.5s
**Backend target:** production `pds-backend` on `:5000` (main branch — Phase B backend changes **not yet deployed**)

## Headline

| Stage | Cases exercised | Pass rate | p95 latency |
|---|---|---|---|
| Dropdown | 11 | **0.727** | 55 ms |
| Intent (LLM) | 0 | — | — |
| Intent (deterministic, `noLlm=1`) | 36 | **0.028** | 2832 ms |
| Knowledge | 6 | 1.00 | 160 ms |
| Plan | 7 | 0.429 | — |
| End-to-end | 0 | — | — |

`comparison_llm_vs_det`: **inconclusive** — fixture only labeled `expect_intent_det`, no case had `expect_intent_llm`, so both_pass = llm_wins = det_wins = 0.

## Critical finding — deterministic intent is not production-ready

**35 of 36 cases failed** `intent_det` with the same diff pattern:

> `type: expected "dynamic", got "unknown"`

Root cause lives at `backend/src/services/search/intent.service.js:430,437`:

```js
const type = ensureTypeIsAllowed(mappedType);
// ...
type: type || 'unknown',
```

`mappedType` comes from `mapDatasourceFromQuery`, which needs `qb` hints to filter DB candidates effectively. When `qb` is null (the `noLlm=true` path), type inference falls through to `'unknown'`.

The one passing case (`AB06 "IPM malut 2024"`) passes **trivially** — the fixture only labeled `{ year: 2024 }` on that case, so the strict `type` check was never applied.

### What this means for Phase B deployment

**Deploying Task 10 (BFF always sends `noLlm=1`) to production today would break search.** Every PWA `/search` request would return `type: unknown` intent, which cascades to:
- No deeplink routing (all queries → generic `/search` result page)
- Stripped year/geo params on downstream data fetches
- Degraded top-1 accuracy vs current LLM-based flow

## Other notable findings

**Dropdown (0.727 pass rate):** 3 of 11 cases failed. Specific expected IDs didn't surface in top-10:
- `CR02 "kemiskinan maluku utara 2023"` — source_id 456 missing from top-10
- `CR03 "ipm maluku utara"` — source_id 10 missing
- `CR06 "jumlah penduduk malut"` — source_ids 4 and 184 both missing

These suggest ranking weight tuning opportunity in `datasourceSearch.service.js` — aggregate province-level indicators (`456`, `10`, `4`) should outrank more specific kab/kota variants for broad queries.

**Plan (0.429 pass rate):** 4 of 7 deeplink cases failed. All 4 returned `action: "search"` instead of `"deeplink"`:
- `DL01 "TPT kab/kota 2024"`
- `DL02 "persentase penduduk miskin kabupaten kota"`
- `DL03 "IPM menurut kabupaten kota"`
- `DL04 "inflasi kota ternate 2024"`

Even with LLM active, deeplink confidence didn't clear threshold. Either LLM confidence scoring is too conservative, or `SEARCH_INTENT_MIN_CONFIDENCE` env should be lowered (current default guards false positives but blocks obvious-deeplink queries).

**Knowledge (1.00):** Passes trivially — fixture uses `min_precision_at_5: 0` (endpoint-alive check only). Real precision@5 assertions require populating `expect_knowledge.must_contain_ids` with actual knowledge_base IDs — open for a follow-up fixture revision.

**End-to-end (0):** No cases labeled `expect_e2e`. Add labels in next fixture rev.

## Recommendations for Project 2 (deterministic-strengthening)

**Priority order, driven by the defect map:**

1. **Fix `mapDatasourceFromQuery` to work without `qb` hints.** When called with `qb = null` (i.e., `noLlm` path), fall back to pure text similarity over `DataSourceSearchTerm` + `DataSource.name` and infer `type` from the top-matched datasource's `type` field. This alone should lift `intent_det` from 3% to somewhere north of 60%.

2. **Widen abbreviation expansion.** The seed fixture's `hal-ut`, `halsel`, `tikep`, `pulmor`, `halbar` etc. should route through `expandGeoAbbreviations` (already exists in `datasourceSearch.service.js`). Verify each alias maps correctly and the map is consulted in the deterministic path.

3. **Tune dropdown ranking** so aggregate province indicators outrank per-kab/kota ones for broad queries. Three specific failures (CR02, CR03, CR06) point to the same pattern.

4. **Lower deeplink confidence threshold** or rework confidence scoring so unambiguous queries like "TPT kab/kota 2024" reach the threshold. Currently ~57% of deeplink-intended queries fall to `action: search`.

5. **Typo handling** — `kemikisnan` and `pengngguran` are expected-fail cases until fuzzy matching is added. Low priority unless ops logs show high typo rate.

## Deploy decision (revised)

| Task | Ready for main? | Ready for prod reload? |
|---|---|---|
| 8 — `noLlm` flag in service | ✅ yes | ✅ yes (opt-in, no default behavior change) |
| 9 — controller forwards `noLlm=1` | ✅ yes | ✅ yes (opt-in) |
| Cache bypass when `noLlm=1` | ✅ yes | ✅ yes |
| 10 — BFF always sends `noLlm=1` | ❌ **HOLD** | ❌ **would break PWA search** |
| 11 — InterpretationPanel feature flag | ✅ yes (default off on `/search`) | ✅ yes |

**Recommendation:** Merge Phase A + most of Phase B to main, but **hold Task 10** (revert just that one file's change on main) until Project 2 lands. This preserves the measurement infrastructure and the opt-in mechanism while keeping production safe.

## Caveats for this baseline

1. **Backend running pre-Phase-B code** — the `noLlm=1` query param sent by the harness is currently ignored by the live backend. Intent_det stage results reflect what the existing deterministic fallback already produces when LLM is unreachable (cascaded from try/catch failures, not a clean opt-in). A post-deploy re-run against updated backend will give the authoritative numbers.

2. **`intent_llm` stage has zero cases** — the fixture labels `expect_intent_det` universally, never `expect_intent_llm`. To populate `comparison_llm_vs_det`, dual-label the core cases with both. Low-effort follow-up: copy the `expect_intent_det` block to `expect_intent_llm` on 10 cases with stricter expectations (source_id required).

3. **`expect_e2e` labels are missing** — fixture v1.1 didn't include `expect_e2e` on any case. BFF `/api/search` was never exercised by the harness. Add `expect_e2e: { top_datasource_id: N, bucket: "exact" }` to deeplink cases in next fixture rev.

## Next actions

- [ ] Copy this one-pager to the workspace docs for team visibility
- [ ] Decide on merge strategy (full Phase B vs Phase B minus Task 10)
- [ ] File Project 2 (deterministic-strengthening) with the 5 prioritized findings above
- [ ] Re-run baseline after Project 2 lands — the `retire_llm_safe` flag in `comparison_llm_vs_det` becomes the deploy gate
