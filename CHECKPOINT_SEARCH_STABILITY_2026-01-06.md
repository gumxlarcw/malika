# Checkpoint — Search Stability (2026-01-06)

This checkpoint captures the current stable behavior for PWA search (EXIM + non-EXIM) and related backend ranking rules.

## Scope
- PWA search aggregator: `frontend/src/app/api/search/route.ts`.
- Backend datasource ranking + intent: `/search/intent`, `/search/datasource`.

## What’s Stable Now
### Datasource Ranking (Backend)
- Inflasi vs IHK disambiguation: explicit query intent boosts the matching indicator and demotes the other.
- Generic “topic token” boosts: datasource name + aliases receive capped bonuses to improve relevance broadly.
- Maluku Utara geo shorthands: deterministic expansions (e.g. halteng/halut/halsel/haltim/halbar/tikep/kepsul/pultal/pulmor) are understood for ranking.
- Geo phrases are treated as scoring hints only (not mandatory AND filters) to avoid empty candidate sets.

### Deeplinks + Geo (PWA)
- `geo=` is attached only when the datasource is filterable by wilayah (kab/kota dimension), not merely because a dataset is about a kab/kota.
- Column-based probe (bounded): for top candidates, PWA may call backend public endpoints:
  - `/dynamic/:id?period=<year>`
  - `/interop/:id?period=<year>`
  to detect kab/kota dimension from `data.columns`.
- `/data` page applies geo filter defensively (only if it matches at least one row).

### Publications & BRS Suggestions (PWA)
- Keyword expansion improves recall for BRS/publikasi queries (`frontend/src/lib/bpsKeyword.ts`).
- Ordering: sorted by relevance score, then newest (with a small recency bonus when query has no period).

## Guardrails
- If query does not include a year, avoid forcing a strict deeplink that requires a year.
- Do not double-apply backend scoring bonuses in frontend when backend already provides a numeric score.

## Tests
- Backend Jest regressions for ranking/disambiguation and geo shorthand safety.
- Frontend tests: `npm run test:nonexim`.

## Known Limits / Notes
- Geo attachment is intentionally conservative; only kab/kota-dimension datasets should receive `geo=`.
- BPS keyword endpoints sometimes return empty for overly specific phrases; keyword expansion mitigates but cannot guarantee results.
