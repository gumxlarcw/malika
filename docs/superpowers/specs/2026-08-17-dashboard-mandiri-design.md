# Dashboard mandiri — design

> Replace the Metabase-embedded `/dashboard` with a self-built, catalog-driven
> dashboard that stays correct as data is refreshed.
>
> Status: design approved 2026-08-17. Implementation plan to follow.

## Goal

`/dashboard` currently renders a signed Metabase iframe (dashboard ID 3). Replace
it with a first-party page that:

1. **Scales with the catalog** — new indicators appear without code changes.
2. **Stays fresh** — reflects an automation refresh with no stale window.
3. Is **public**, consistent with the rest of the portal.

## Non-goals

- Decommissioning Metabase. It keeps running for ad-hoc analysis, and the
  `/metabase` admin tool and its backend routes stay. Only the iframe on
  `/dashboard` goes away.
- Per-user configurable layouts. The only curated element is the headline set.
- Changing the ingestion/automation pipeline. This is a read-side project.

## Evidence gathered before designing

Measured on the live replica, 2026-08-17:

| Measurement | Result |
|---|---|
| `indikator_*` tables | 310 |
| Total rows across all of them | ~160,900 |
| Largest single table | `indikator_160`, 11,943 rows |
| Aggregate on the heaviest table | 19 ms cold, 15 ms warm |
| `MAX(last_update)` (watermark read) | 6 ms |
| **Full-catalog sweep, all 310 tables** | **1,595 ms — 5.1 ms per indicator** |
| Heaviest 60 indicators containing a province-level `dim_value` | 40 of 60 (67%) |

Two conclusions follow directly, and both shaped the design:

- **No materialized snapshot table.** A dataset that aggregates end-to-end in
  1.6 s does not justify a second source of truth, a migration, and a sync
  obligation on every write path. On-demand reads plus caching are sufficient.
  If reads ever become slow, a snapshot slots in behind the same interface.
- **A third of indicators have no province row.** See the correctness rule below.

## Architecture

```
backend/src/services/indicator/        ← shared: dashboard AND peta-tematik
  watermark.service.js   getWatermark(indicatorId) -> MAX(last_update)
  read.service.js        getLatest / getTrend / getCard
  cache.js               getOrCompute(namespace, id, watermark, computeFn)

backend/src/services/dashboard/
  dashboard.service.js   headline + per-category card assembly
  eligibility.service.js which indicators qualify for a card

backend/src/routes/
  dashboard.public.routes.js   GET /dashboard/summary
                               GET /dashboard/indicator/:id
```

Cards assemble from three sources that already exist:

- **`data_sources`** — the catalog. It already carries presentation metadata:
  `category`, `icon`, `color`, `display_order`, `priority`, `visible`,
  `summary_trend`, `chart_config`. The dashboard consumes these rather than
  inventing a parallel config.
- **`IndicatorMeta`** — `title_clean`, `unit_id`, `decimal_places`,
  `subject_label`, `definition`. Units and rounding come from here, never
  hardcoded per indicator.
- **`IndicatorMetricMeta`** — per-metric `metric_label_id/en`, `metric_type`
  (`numeric|text|percent|currency|count|weight|area|index`), `unit_id/en`, and
  `unit_multiplier` / `unit_multiplier_desc`.
- **`services/indicator/read.service.js`** — latest value, previous value and
  delta, and a short trend series for the sparkline.

The headline set is the single curated element, stored via the existing
`appSettings.service.js` as `getJson('dashboard:headline')` → an array of
`source_id`. No new table. Falls back to `priority`/`display_order` ordering when
unset, so the page is never empty.

## The province-row rule (correctness)

Rows are dimensioned by `dim_key` / `dim_value`, not by a region code column.
Two facts make a naive "headline number" wrong:

1. `dim_key` is often `Wilayah`, but not always — `indikator_293` is dimensioned
   by `Lapangan Usaha (Kategori)`, i.e. business sector. Region is one possible
   dimension, not a guarantee.
2. Only ~67% of indicators contain a province-level `dim_value`.

**Rule: a province headline number is displayed only when the source provides an
explicit province-level row for that period. The dashboard never synthesises one
by aggregating regions.**

This is not fussiness. Averaging `Tingkat kemiskinan` across ten kabupaten/kota
produces a number that is not the provincial poverty rate — that requires
population weighting — and publishing it under a BPS masthead would be a
fabricated official statistic. Summing is equally wrong for rates and indices.

Cards therefore have three shapes, chosen from the data:

| Data available | Card shows |
|---|---|
| Province row exists | Headline value + delta + sparkline |
| Region-dimensioned, no province row | "10 kabupaten/kota" + range (min–max) + link to `/peta-tematik` |
| Non-region dimension | Dimension name + top categories + link to `/data?source=NNN` |

An indicator with fewer than two periods carrying non-null values is not
eligible for a card at all; it stays discoverable via `/kategori`.

## Freshness

Cache key includes the data watermark:

```
dash:v1:${sourceId}:${metric}:${watermarkMs}
```

`watermarkMs` is `MAX(last_update)` from the indicator's own table (6 ms). When
an automation run writes rows it advances `last_update`, which produces a new
key; the previous entry is simply never read again and ages out of the LRU. No
invalidation message, no hook in `automationRunner`, no stale window, and it
stays correct with more than one process.

The watermark itself is cached for 30 s so a 40-card page does not issue 40 extra
queries per render.

**This also fixes an existing bug.** `services/petaTematik/cache.service.js` is an
LRU with a blind `TTL_MS = 60 * 60 * 1000` and no invalidation, so the thematic
map can serve figures up to an hour behind the database after a refresh.
Retrofitting it onto the same watermark keying is part of phase 1.

## Scalability

- Reads are ~5 ms per indicator; a fully cold dashboard is ~1.6 s and is cached
  thereafter. Warm renders are a cache hit plus a 6 ms watermark check.
- All three PM2 apps run `exec_mode: "fork", instances: 1`, so an in-process LRU
  is correct today. It is a ceiling, not a design: with two instances each
  process holds its own cache and users see different numbers depending on which
  answers. The cache therefore sits behind a four-method interface
  (`get`/`set`/`clear`/`getOrCompute`) so an LRU→Redis swap is one file.
- Cost grows linearly with catalog size and is bounded by the cache, not by the
  page: adding indicators adds keys, not query fan-out per request.

## Frontend

`/dashboard` becomes a real page in the `(admin)` shell (it keeps the sidebar;
only the iframe goes). Note that `(admin)` is a **layout** group in the PWA, not
an auth boundary — `(admin)/layout.tsx` contains no auth gate and every route in
it already answers publicly. Keeping the dashboard there is consistent with the
"public" decision; it is the sidebar/bottom-nav shell, nothing more.

- `HeadlineStrip` — the curated set, same visual language as the landing page's
  "Angka utama" cards.
- `CategorySection` — one per `data_sources.category`, ordered by
  `display_order`.
- `IndicatorCard` — value, delta pill, sparkline (recharts, already a
  dependency), unit and decimals from `IndicatorMeta`, drill-through to
  `/data?source=NNN` or `/peta-tematik`.
- `/api/dashboard/*` proxy route matching the existing frontend convention.

Reuses the landing page's token constants and card conventions rather than a new
visual system.

## Phasing

Three shippable slices:

1. **Read layer + freshness.** `services/indicator/*`, watermark caching,
   `GET /dashboard/summary`, peta-tematik retrofit. No UI change; verifiable by
   API tests alone.
2. **The page.** `/dashboard` UI replacing the iframe.
3. **Curation.** Admin editing of the headline set and category order.

## Testing

- **Backend (Jest + supertest):** route contract for `/dashboard/summary` and
  `/dashboard/indicator/:id`; eligibility rules; and specifically a test that
  **the cache key changes when `last_update` advances** — the freshness
  guarantee asserted rather than assumed.
- **Correctness:** a test that an indicator with no province row does not emit a
  headline value, using a fixture with region rows only. This is the rule most
  likely to be broken by a well-meaning later change.
- **Frontend (Playwright):** dashboard renders headline + at least one category,
  cards show values, no horizontal scroll at 360/390/768/1440, reusing the
  patterns from `e2e/landing.spec.ts`.

## Risks and open questions

- **Metric selection.** Indicators can expose several `metric` values, and
  `IndicatorMetricMeta` has **no ordering column** — only `id` (insertion order).
  Phase 1 therefore selects by `metric_type` preference
  (`percent`/`index`/`count` before `text`), falling back to lowest `id`, and
  `chart_config` can name a preferred metric explicitly when that is wrong.
  Picking "the first metric" without a rule would be non-deterministic across
  re-ingestion.

- **`unit_multiplier` must be applied.** `IndicatorMetricMeta.unit_multiplier`
  (with `unit_multiplier_desc`, e.g. "ribu", "juta") means the stored `value` is
  not always the display value. Rendering `value` raw would show figures wrong by
  orders of magnitude. Formatting is centralised in one helper, unit-tested
  against a multiplier fixture — not left to each card.
- **Period comparison.** `month_no` uses BPS sentinels (0 annual rollup, 1–12
  monthly, 31–34 quarterly, 35 annual, 36–37 semester). "Previous period" must
  compare like with like — quarter to quarter, not quarter to annual. Encoded in
  `read.service.js` and unit-tested against the sentinel set.
- **Category quality.** `data_sources.category` is free text with a "Lainnya"
  fallback in `categories.routes.js`. If it is messy the dashboard will show it;
  cleaning it is a separate data task, not a blocker.
