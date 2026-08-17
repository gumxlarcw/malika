/**
 * Pure data shaping for the peta-tematik panels.
 *
 * Kept free of React and of the fetch layer so the arithmetic that decides what
 * a reader sees — which class a region falls in, how many regions share it, what
 * lands in the CSV — can be exercised directly.
 *
 * Values come from `/peta-tematik/public/data`, which returns one row per
 * kabupaten/kota with `value: number | null`. Null means the source published
 * nothing for that region and period. It is never coerced to zero: on a
 * choropleth a zero is a dark shape making a claim, where a gap is a gap.
 *
 * Deliberately import-free. The frontend has no unit-test runner — only
 * Playwright, which cannot reach these panels until they are mounted — so this
 * module is kept runnable on its own, and the region-code mapper is passed in
 * rather than imported.
 */

export type RegionValue = { kdkab: string; nama_kab: string; value: number | null };

/** Maps a `/peta-tematik` `kdkab` onto a full BPS code. See `@/lib/malutGeometry`. */
export type ToKode = (kdkab: string) => string;

/** One region's values across every requested year, keyed by full BPS code. */
export type MatrixRow = {
  kode: string;
  nama_kab: string;
  /** Same order and length as the `years` the matrix was built from. */
  cells: Array<number | null>;
};

export type YearMatrix = {
  years: number[];
  rows: MatrixRow[];
};

/**
 * Fold per-year responses into one region × year matrix.
 *
 * Rows are the union of regions seen in any year, so a region that appears only
 * in later years still gets a row with leading gaps rather than being dropped.
 */
export function buildMatrix(years: number[], byYear: Array<RegionValue[]>, toKode: ToKode): YearMatrix {
  const rows = new Map<string, MatrixRow>();

  years.forEach((_, yi) => {
    for (const v of byYear[yi] ?? []) {
      const kode = toKode(v.kdkab);
      if (!rows.has(kode)) {
        rows.set(kode, { kode, nama_kab: v.nama_kab, cells: years.map(() => null) });
      }
      rows.get(kode)!.cells[yi] = v.value;
    }
  });

  return {
    years,
    rows: [...rows.values()].sort((a, b) => a.nama_kab.localeCompare(b.nama_kab, "id")),
  };
}

/** Newest year first — the period a reader checks before anything else. */
export function latestPopulatedYear(matrix: YearMatrix): number | null {
  for (let i = matrix.years.length - 1; i >= 0; i--) {
    if (matrix.rows.some((r) => r.cells[i] != null)) return matrix.years[i];
  }
  return null;
}

export type LegendBucket = {
  /** Inclusive lower edge, exclusive upper edge except for the last bucket. */
  min: number;
  max: number;
  color: string;
  /** How many regions fall in this class in the active period. */
  count: number;
};

/**
 * Turn break points into legend rows with a population count each.
 *
 * `computeBins` returns upper edges, matching `colorForValue`'s `value <=
 * breaks[i]` test; the same comparison is used here so a legend row can never
 * disagree with the colour actually painted on the map.
 */
export function legendBuckets(values: Array<number | null>, breaks: number[], colors: string[]): LegendBucket[] {
  const present = values.filter((v): v is number => v != null);
  const lo = present.length ? Math.min(...present) : 0;

  return breaks.map((edge, i) => {
    const min = i === 0 ? lo : breaks[i - 1];
    const count = present.filter((v) => {
      for (let b = 0; b < breaks.length; b++) if (v <= breaks[b]) return b === i;
      return i === breaks.length - 1;
    }).length;
    return { min, max: edge, color: colors[i] ?? colors[colors.length - 1], count };
  });
}

/** Which legend class a value belongs to, or null when there is no value. */
export function bucketOf(value: number | null, breaks: number[]): number | null {
  if (value == null) return null;
  for (let i = 0; i < breaks.length; i++) if (value <= breaks[i]) return i;
  return breaks.length - 1;
}

/**
 * Rank highest-first, skipping regions with no value.
 *
 * Returned ranks are 1-based and dense — two regions never share a number here,
 * because the caller shows "#3 dari 10" and a tie would make the total wrong.
 */
export function rankRows(matrix: YearMatrix, yearIndex: number) {
  return matrix.rows
    .map((r) => ({ row: r, value: r.cells[yearIndex] }))
    .filter((x): x is { row: MatrixRow; value: number } => x.value != null)
    .sort((a, b) => b.value - a.value)
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

const escapeCell = (cell: string) => (/[";\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/**
 * Semicolon-delimited CSV.
 *
 * Values are formatted id-ID, where the decimal mark is a comma, so a comma
 * delimiter would split every number across two columns in Excel.
 */
export function matrixToCsv(matrix: YearMatrix, indicatorName: string, format: (v: number) => string): string {
  const header = ["Kode", "Kabupaten/kota", ...matrix.years.map(String)];
  const body = matrix.rows.map((r) => [
    r.kode,
    r.nama_kab,
    ...r.cells.map((v) => (v == null ? "" : format(v))),
  ]);
  return [[indicatorName], [], header, ...body]
    .map((line) => line.map(escapeCell).join(";"))
    .join("\r\n");
}

/** Points for a 0–100 × 0–34 sparkline viewBox, oldest to newest. */
export function sparklinePoints(cells: Array<number | null>): { points: string; lastX: number; lastY: number } | null {
  const present = cells.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (present.length < 2) return null;

  const values = present.map((p) => p.v);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const stepDenominator = cells.length - 1 || 1;

  const pts = present.map((p) => {
    const x = (p.i / stepDenominator) * 100;
    const y = 32 - ((p.v - lo) / span) * 30;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });

  const last = pts[pts.length - 1];
  return { points: pts.map((p) => `${p[0]},${p[1]}`).join(" "), lastX: last[0], lastY: last[1] };
}
