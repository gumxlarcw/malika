---
name: BPS value_code conventions in real interop data
description: Real BPS preliminary-number footnotes seen in production indikator_NNN tables — superset of the r/*/**/***/e/p/x classics. Reference for extending BPS_VALUE_CODE_LABELS without re-auditing.
type: reference
originSessionId: 7d0f103b-5cf1-4150-b59a-c30fdbdb9230
---
`data_bps.indikator_NNN` tables (311 of them) carry per-cell `value_code` populated by `interop.processor` from the BPS interop API's `value_code` field. The frontend whitelist in `frontend/src/lib/cellRender.tsx` (`BPS_VALUE_CODE_LABELS`) maps codes to Indonesian labels; unknown codes fall through to `Catatan: <code>`.

**Codes confirmed in real production data** (audit 2026-05-08 across the top tables by populated rows):

| Code | Where common | Indonesian label |
|---|---|---|
| `*` | indikator_404, 405, 411 | Angka sementara |
| `**` | (rare) | Angka sangat sementara |
| `***` | (rare) | Angka sangat-sangat sementara |
| `r` | (rare) | Angka revisi |
| `e` | (rare) | Angka estimasi |
| `p` | (rare) | Angka proyeksi |
| `x` | (rare) | Data tidak tersedia |
| `–` | indikator_338, 404 (very common — 2179/2205 in 338) | Data nihil atau tidak ada |
| `...` | seen in mixed sources | Data belum tersedia |
| `NA` | seen in mixed sources | Tidak berlaku |

**Notes:**
- `–` is the en-dash U+2013, NOT a regular hyphen `-`. Both BPS interop API and the DB column store the en-dash.
- Many `–` codes pair with `value=NULL` — the renderer wraps `formatCellValue(NULL)` (which produces `-`) with `<sup title="Data nihil atau tidak ada">–</sup>`. That's intentional: it tells the reader "this dash means a confirmed zero/no occurrence, not missing data".
- EXIM tables (data_sources.type='exim', 2 sources only) bypass per-cell codes — `indicatorTableGenericRead` strips them in the read path because SUM aggregation has no per-cell semantics.

**Verification recipe** (find real flagged rows for a candidate URL):
```sql
SELECT value_code, COUNT(*) FROM data_bps.indikator_404
WHERE value_code IS NOT NULL AND value_code <> '' AND value IS NOT NULL
GROUP BY value_code;
```
Year 2020 of source 404 has the cleanest demo URL: `/data?source_id=404&period=2020&type=interop` — 124 cells flagged with `*`.
