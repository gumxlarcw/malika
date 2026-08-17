# Peta Tematik — mounting the new panels

**Status:** panels built, tested and committed. Wiring deferred.

**Why deferred:** on 2026-08-17 another session held 481 uncommitted lines across
`PetaTematikClient.tsx` (+309), `KabkotaDetailDrawer.tsx` (+283),
`CommandPalette.tsx`, `ShareBar.tsx`, `types.ts` and `useUrlState.ts` — including a
rebuild of the indicator taxonomy (`INDIKATOR_INTI_IDS`, `META_GROUPS`). Editing
those files concurrently risks destroying that work. Everything below is additive
and touches only files that were clean.

**Source design:** `MALIKA Peta Tematik.dc.html` (claude.ai design project
`2099e02b-3055-4a6b-9a33-4457345001ab`).

---

## What already existed — do not rebuild

Checked before building, and worth re-checking before anyone "adds" these:

| Design element | Already in the repo |
|---|---|
| Play / pause year animation | `components/TimeScrubber.tsx` — `PLAY_INTERVAL_MS`, `Play`/`Pause`/`Rewind` |
| Klasifikasi kuantil / interval | `colorScale.ts` implements `quantile`, `equal` **and** `jenks`; `components/BinningSelector.tsx` exists but is **not mounted** |
| Catalog picker with subjects + search | `components/CommandPalette.tsx` |
| Map, hover tooltip, click-to-pin | `ChoroplethMap.tsx` (Leaflet, full-resolution GeoJSON) |
| Rank list with bars | `components/LinkedBarChart.tsx` |
| CSV / share / embed | `components/ShareBar.tsx`, `components/EmbedModal.tsx` |

## What was built

All new files, no edits to existing ones:

- `src/lib/malutGeometry.ts` — seam over the pre-projected 100×95 geometry
  (`REGION_SHAPES`, 4,088 points) plus `kdkabToKode`.
- `peta-tematik/panelData.ts` — pure logic: `buildMatrix`, `legendBuckets`,
  `bucketOf`, `rankRows`, `matrixToCsv`, `sparklinePoints`. Import-free on
  purpose so it can be run directly; the frontend has no unit-test runner.
- `peta-tematik/useYearMatrix.ts` — parallel per-year fetch → `YearMatrix`.
- `components/MiniMapGrid.tsx` — small multiples, one map per period.
- `components/MapLegend.tsx` — legend with per-class counts and click-to-isolate.
- `components/FocusCard.tsx` — focus figure, rank and sparkline.
- `components/YearMatrixTable.tsx` — region × year table with CSV.

## Mount steps

All of these are in `PetaTematikClient.tsx` unless stated.

### 1. Imports

```tsx
import { useYearMatrix } from "./useYearMatrix";
import { bucketOf, rankRows } from "./panelData";
import MiniMapGrid from "./components/MiniMapGrid";
import MapLegend from "./components/MapLegend";
import FocusCard from "./components/FocusCard";
import YearMatrixTable from "./components/YearMatrixTable";
import BinningSelector from "./components/BinningSelector";
```

### 2. State

`binning` is currently a `const` pinned to `"quantile"` with a comment saying the
selector was removed "per simplification". The design asks for it back:

```tsx
const [binning, setBinning] = useState<BinningMethod>("quantile");
const [activeBucket, setActiveBucket] = useState<number | null>(null);
```

Render `<BinningSelector value={binning} onChange={setBinning} />` in the filter row.
Note it offers three methods (quantile / jenks / equal) where the design offers
two — keep all three; jenks is the better default for skewed indicators and is
already implemented.

### 3. The year matrix

`yearsResp.years` already holds the published years for the active indicator.
Cap the span — ten calls is ten queries:

```tsx
const panelYears = useMemo(
  () => (yearsResp?.years ?? []).filter((y) => !(yearsResp?.years_empty ?? []).includes(y)).slice(-5),
  [yearsResp]
);
const { matrix, loading: matrixLoading } = useYearMatrix(filters.indikator, panelYears, filters.metric);
```

### 4. Panels

```tsx
{matrix && (
  <>
    <FocusCard
      matrix={matrix}
      activeYear={filters.year!}
      selectedKode={drawerKab ? `82${drawerKab.kdkab}` : null}
      indicatorName={list?.idToName.get(filters.indikator!) ?? ""}
      unit={data?.meta?.unit ?? null}
    />

    <MapLegend
      values={matrix.rows.map((r) => r.cells[matrix.years.indexOf(filters.year!)])}
      breaks={breaks}
      paletteId={paletteId}
      binning={binning}
      unit={data?.meta?.unit ?? null}
      activeBucket={activeBucket}
      onPickBucket={setActiveBucket}
      noDataCount={matrix.rows.filter((r) => r.cells[matrix.years.indexOf(filters.year!)] == null).length}
    />

    <MiniMapGrid
      matrix={matrix}
      activeYear={filters.year!}
      onPickYear={(y) => setFilters((f) => ({ ...f, year: y }))}
      binning={binning}
      paletteId={paletteId}
      selectedKode={drawerKab ? `82${drawerKab.kdkab}` : null}
    />

    <YearMatrixTable
      matrix={matrix}
      activeYear={filters.year!}
      indicatorName={list?.idToName.get(filters.indikator!) ?? ""}
      unit={data?.meta?.unit ?? null}
      binning={binning}
      paletteId={paletteId}
      selectedKode={drawerKab ? `82${drawerKab.kdkab}` : null}
      onPickRegion={(kode) => /* open drawer for kode?.slice(2) */ undefined}
    />
  </>
)}
```

`MiniMapGrid` and `YearMatrixTable` are full-width; `FocusCard` and `MapLegend`
are rail-width. `/peta-tematik` is a full-width route in the site shell, so
there is no 1200px column to fight.

### 5. Legend filtering

`activeBucket` isolates a class. `ChoroplethMap` decides fill in `styleFn`, so
dim the others there:

```tsx
const dimmed = activeBucket != null && bucketOf(value, breaks) !== activeBucket;
// fillOpacity: dimmed ? 0.25 : 0.85
```

## Still outstanding

- **Region label toggle** ("Label wilayah"). Needs `ChoroplethMap.tsx`: each layer
  already has a hover `bindTooltip`, and Leaflet allows only one tooltip per
  layer, so permanent labels need either a second `L.marker` with a `divIcon` at
  each polygon centroid or a rework of the existing tooltip. The map already
  names each region on hover, so this is a nicety, not a gap. Not built.
- Re-mounting `MethodologyFooter.tsx`, which is also currently unused.

## Facts worth keeping

- **Region codes join cleanly.** `/peta-tematik/public/data` returns `kdkab` as a
  two-digit suffix; the geometry is keyed by the full BPS code. Verified
  2026-08-17 across all ten regions — including the three that are transposed in
  some sources. MALIKA's geometry *and* its API both use the official numbering:
  **8203 Kepulauan Sula, 8205 Halmahera Utara, 8206 Halmahera Timur**. The source
  design's own region table has these three swapped; do not copy it.
- **The design's figures are mock**, and it says so twice: *"nilai contoh untuk
  mockup"* and *"belum tersambung ke tabel BPS"*. Its ~70-indicator catalog is
  generated from `mid`/`spread`/`urban` with a hash. MALIKA's real catalog is
  196 eligible indicators from `/peta-tematik/public/indikator-list`.
- **`initIndikatorList()` is lazy.** A `/data` call made before the eligible list
  is warm returns `Invalid indikator (not in eligible list)`. Hit
  `/indikator-list` first, or expect a cold-start miss after a backend reload.
- **Small multiples must share one classification.** `MiniMapGrid` classifies
  every period against the active year's breaks. Re-classifying each panel
  against its own values gives all of them the same colour spread whatever the
  data does, which turns a decade of change into a decade of nothing.
