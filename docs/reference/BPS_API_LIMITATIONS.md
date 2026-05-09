# BPS API Limitations

> Last updated: 2026-05-10
> Source: data integrity audit on 2026-05-09

BPS (Badan Pusat Statistik) provides multiple JSON APIs for the same data, with different fidelity. Understanding which API to use for which indicator is critical to data quality.

## Two API families used by MALIKA

### 1. Dynamic API (`webapi.bps.go.id/v1/api/list/...`) — limited

URL pattern:
```
https://webapi.bps.go.id/v1/api/list/model/data/lang/ind/domain/{kdkab}/var/{var_id}/th/{period}/key/{api_key}
```

Response: `datacontent` is a flat object mapping composite keys to numeric values:
```json
{
  "datacontent": {
    "13786291260": 1.48,
    "13786301260": 4.86
  }
}
```

**Limitation**: values are plain numbers. **`*`, `**`, `***`, `r`, `e`, `p` flags are NOT in the response**, even though BPS's HTML web pages display them. The flags are stripped before the API serializes the data.

Used by 157 of 310 indikator sources. All are exposed without provisional flags.

### 2. Interop API (Sirusa, `webapi.bps.go.id/v1/api/interoperabilitas/...`) — full coverage

URL pattern:
```
https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/25/tahun/{period}/id_tabel/{base64_table_id}/wilayah/{wilayah_id}/key/{api_key}
```

Response: each cell is a full object:
```json
{
  "data": [
    {
      "label": "Halmahera Utara",
      "variables": {
        "kol1": { "value_raw": 4.26, "value_code": "*" }
      }
    }
  ]
}
```

**Full coverage**: provisional flags ARE captured in `value_code`. Used by 150 of 310 indikator sources. The processor at `backend/src/services/processor/interop.processor.js:38-63` reads `row.variables[colId].value_code` and emits a `value_codes` map per row.

## Implications

### A. Dynamic-source indicators have no `value_code` data

When BPS publishes recent quarters/months as `*` (angka sementara) or `**` (angka sangat sementara), the dynamic API drops the flag before sending. Our processor cannot extract what the API doesn't include.

**Impact**: 213 of 310 tables have zero `value_code` rows. Flagship indicators (PDRB, Inflasi, TPT, Kemiskinan, IPM) are dynamic-source, so users see no provisional indication on their numbers.

### B. Migrating dynamic → interop is per-source manual research

The two APIs use different identifiers:
- Dynamic: `var_id` (e.g., `378` for Inflasi Maluku Utara)
- Interop: `id_tabel` (e.g., `VHpUK3MrOVd6dTJjcHdoQ1Z6TGlmUT09` — base64 BPS table id)

There is no automated mapping. Each candidate source requires manual investigation:
1. Find the equivalent BPS Sirusa "Tabel Statis" page for the indicator
2. Look up the `id_tabel` value
3. Replace `data_sources.api_url` accordingly
4. Trigger re-fetch

This is a future-work effort. See `docs/superpowers/plans/2026-05-09-bps-data-integrity-fixes.md` for the migration approach.

### C. Workaround for high-priority indicators

If migration isn't feasible, two fallback options:

1. **Display a static disclaimer** on dynamic-source indicators: "Sumber: BPS. Angka sementara/revisi mengikuti publikasi BPS."
2. **HTML scraping** — fetch the BPS web page, parse `*` flags from the DOM, persist alongside the API-fetched values. High maintenance burden, fragile to BPS layout changes.

## value_code coverage matrix (snapshot 2026-05-10)

| API family | Tables | With value_code | %     |
|---|---:|---:|---:|
| dynamic | 157 | 0 | 0% |
| interop | 150 | 95 | 63% |
| exim | 2 | 1 | 50% |
| static | 1 | 0 | 0% |
| **Total** | **310** | **97** | **31.3%** |

The 55 interop tables without `value_code` (95/150) are tables where BPS itself doesn't publish provisional flags (older yearbooks, fully-revised historical series).

## Future work

- Identify the 36 flagship sources with potential interop equivalents (PDRB, Inflasi, TPT, Kemiskinan, IPM, Gini, Ekspor, Impor) and migrate them.
- Audit interop sources without `value_code` to determine if they truly lack flags or if our processor is missing a code path.
- Consider HTML fallback for highest-impact 5-10 indicators if interop migration proves infeasible.
