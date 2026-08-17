// Sorting, per-year statistics and compare-series maths for the /data table.
//
// Deliberately free of imports, like `peta-tematik/panelData.ts`: the frontend
// has no unit-test runner beyond `node --test`, and that only loads modules
// whose import graph is empty. Anything this module needs from the page — the
// number parser, the provincial-total predicate — arrives as a parameter.

export type SortDir = "asc" | "desc";

export type SortState = {
  /** Column being sorted on, or null for the source's natural row order. */
  key: string | null;
  dir: SortDir;
};

export type Row = Record<string, unknown>;

/** Parses a cell into a number, or null when it holds no measurement. */
export type ToNumber = (value: unknown) => number | null;

/** True when the row is the provincial total rather than a kabupaten/kota. */
export type IsTotalRow = (row: Row, labelColumn: string) => boolean;

/**
 * Header-click transition. A fresh column starts descending for measures
 * (largest first is what a reader wants from a ranking) but ascending for the
 * region name, where alphabetical is the useful order. Re-clicking the active
 * column flips direction; that is the only way to reach ascending on a measure.
 */
export function nextSortState(
  current: SortState,
  key: string,
  isLabelColumn: boolean,
): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: isLabelColumn ? "asc" : "desc" };
}

/**
 * Orders rows for display.
 *
 * The provincial total keeps its place at the top no matter what is sorted:
 * it is the row every other row is read against, and letting it fall into the
 * middle of a ranking invites reading it as one kabupaten among ten. With
 * `key === null` the caller's own ordering (`applyTableRowOrdering`) survives
 * untouched.
 *
 * Rows whose sort cell has no number always sink to the bottom, in both
 * directions — ascending would otherwise open with a block of dashes.
 */
export function sortRows(params: {
  rows: Row[];
  sort: SortState;
  labelColumn: string;
  numericColumns: ReadonlySet<string>;
  toNumber: ToNumber;
  isTotalRow?: IsTotalRow;
}): Row[] {
  const { rows, sort, labelColumn, numericColumns, toNumber, isTotalRow } = params;
  if (!sort.key) return rows.slice();

  const key = sort.key;
  const sign = sort.dir === "asc" ? 1 : -1;
  const isNumeric = numericColumns.has(key);

  const totals: Row[] = [];
  const rest: Row[] = [];
  for (const row of rows) {
    if (isTotalRow && labelColumn && isTotalRow(row, labelColumn)) totals.push(row);
    else rest.push(row);
  }

  const decorated = rest.map((row, index) => ({ row, index }));
  decorated.sort((a, b) => {
    if (isNumeric) {
      const av = toNumber(a.row[key]);
      const bv = toNumber(b.row[key]);
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return (av - bv) * sign;
      return a.index - b.index;
    }
    const av = String(a.row[key] ?? "").trim();
    const bv = String(b.row[key] ?? "").trim();
    if (!av && !bv) return a.index - b.index;
    if (!av) return 1;
    if (!bv) return -1;
    const cmp = av.localeCompare(bv, "id");
    return cmp !== 0 ? cmp * sign : a.index - b.index;
  });

  return totals.concat(decorated.map((d) => d.row));
}

/** Human sentence describing the active ordering, shown under the table title. */
export function describeSort(sort: SortState, labelColumn: string): string {
  if (!sort.key) return "Urutan bawaan sumber";
  if (sort.key === labelColumn) {
    return `Diurutkan menurut ${sort.key.toLowerCase()}${sort.dir === "asc" ? " (A–Z)" : " (Z–A)"}`;
  }
  return `Diurutkan menurut ${sort.key.toLowerCase()}${sort.dir === "asc" ? " (terkecil)" : " (terbesar)"}`;
}

/** Case- and space-insensitive match of the label column against a query. */
export function filterRowsByQuery(params: {
  rows: Row[];
  labelColumn: string;
  query: string;
  isTotalRow?: IsTotalRow;
}): Row[] {
  const { rows, labelColumn, query, isTotalRow } = params;
  const needle = query.trim().toLowerCase();
  if (!needle || !labelColumn) return rows.slice();
  return rows.filter((row) => {
    // The provincial total is context, not a search hit — dropping it would
    // leave a filtered table with nothing to compare its rows against.
    if (isTotalRow && isTotalRow(row, labelColumn)) return true;
    return String(row[labelColumn] ?? "").toLowerCase().includes(needle);
  });
}

export type MetricStats = {
  /** Regions carrying a value, ranked highest first. */
  ranked: Array<{ label: string; value: number }>;
  top: { label: string; value: number } | null;
  low: { label: string; value: number } | null;
  mean: number | null;
  above: number;
  below: number;
  count: number;
  /** How many times the highest region exceeds the lowest, or null if undefined. */
  ratio: number | null;
  /** Largest absolute value, for scaling in-cell data bars. */
  maxAbs: number;
};

/**
 * Ranks kabupaten/kota by one measure for one year.
 *
 * The provincial total is excluded throughout: including it would win every
 * ranking and drag the mean above every region it summarises.
 */
export function computeMetricStats(params: {
  rows: Row[];
  labelColumn: string;
  metricColumn: string | null;
  toNumber: ToNumber;
  isTotalRow?: IsTotalRow;
}): MetricStats {
  const { rows, labelColumn, metricColumn, toNumber, isTotalRow } = params;
  const empty: MetricStats = {
    ranked: [],
    top: null,
    low: null,
    mean: null,
    above: 0,
    below: 0,
    count: 0,
    ratio: null,
    maxAbs: 0,
  };
  if (!metricColumn || !labelColumn) return empty;

  const points: Array<{ label: string; value: number }> = [];
  for (const row of rows) {
    if (isTotalRow && isTotalRow(row, labelColumn)) continue;
    const value = toNumber(row[metricColumn]);
    if (value === null) continue;
    const label = String(row[labelColumn] ?? "").trim();
    if (!label) continue;
    points.push({ label, value });
  }
  if (points.length === 0) return empty;

  const ranked = points.slice().sort((a, b) => b.value - a.value);
  const sum = points.reduce((acc, p) => acc + p.value, 0);
  const mean = sum / points.length;
  const above = points.filter((p) => p.value > mean).length;
  const top = ranked[0];
  const low = ranked[ranked.length - 1];
  // A zero or negative floor makes "N× the lowest" meaningless rather than
  // merely large, so the caller gets null and omits the note.
  const ratio = low.value > 0 && top.value > 0 ? top.value / low.value : null;
  const maxAbs = points.reduce((acc, p) => Math.max(acc, Math.abs(p.value)), 0);

  return {
    ranked,
    top,
    low,
    mean,
    above,
    below: points.length - above,
    count: points.length,
    ratio,
    maxAbs,
  };
}

/**
 * Width of a cell's data bar, as a percentage of the widest value in the
 * column. Bars are drawn from zero so that a column containing negatives
 * (monthly inflation, growth rates) stays honest about magnitude.
 */
export function barPercent(value: number | null, maxAbs: number): number | null {
  if (value === null || !Number.isFinite(value) || maxAbs <= 0) return null;
  const pct = (Math.abs(value) / maxAbs) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

export type ComparePoint = { year: string; value: number | null };
export type CompareSeries = { label: string; points: ComparePoint[] };

/**
 * Per-region values across every year, for the "Tren tahun" chart.
 *
 * Years with no row for a region yield null rather than zero: a kabupaten that
 * only appears in later years must leave a gap, not a line dropping to the axis.
 */
export function buildCompareSeries(params: {
  labels: string[];
  yearsAsc: Array<{ year: string; rows: Row[] }>;
  labelColumn: string;
  metricColumn: string | null;
  toNumber: ToNumber;
}): CompareSeries[] {
  const { labels, yearsAsc, labelColumn, metricColumn, toNumber } = params;
  if (!metricColumn || !labelColumn) return [];
  return labels.map((label) => ({
    label,
    points: yearsAsc.map((yd) => {
      const row = yd.rows.find((r) => String(r[labelColumn] ?? "").trim() === label);
      return { year: yd.year, value: row ? toNumber(row[metricColumn]) : null };
    }),
  }));
}

/**
 * Turns a series into SVG path segments in a 0..width / 0..height box.
 *
 * Returns one path per unbroken run of values so a gap year breaks the stroke
 * instead of being bridged by a straight line that implies data nobody has.
 */
export function seriesToPaths(params: {
  points: ComparePoint[];
  min: number;
  max: number;
  width: number;
  height: number;
  padY?: number;
}): string[] {
  const { points, min, max, width, height } = params;
  const padY = params.padY ?? 0;
  if (points.length === 0) return [];
  const span = max - min || 1;
  const innerH = Math.max(1, height - padY * 2);
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const paths: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null || !Number.isFinite(p.value)) {
      if (run.length > 1) paths.push(run.join(" "));
      run = [];
      return;
    }
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = padY + innerH - ((p.value - min) / span) * innerH;
    run.push(`${run.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  });
  if (run.length > 1) paths.push(run.join(" "));
  else if (run.length === 1 && paths.length === 0) {
    // A single readable point still deserves a mark; a zero-length line is
    // invisible, so emit a degenerate segment the renderer draws with a cap.
    paths.push(`${run[0]} L${run[0].slice(1)}`);
  }
  return paths;
}

/** Shared vertical scale across every compared series, with 12% headroom. */
export function compareExtent(series: CompareSeries[]): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.value === null || !Number.isFinite(p.value)) continue;
      if (p.value < lo) lo = p.value;
      if (p.value > hi) hi = p.value;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.12 || 1;
  return { min: lo - pad, max: hi + pad };
}

/**
 * Add or remove a region from the comparison set, respecting the ceiling.
 *
 * The cap lives here, inside a pure function the caller applies as a state
 * updater, because a component that checks `pinned.length` before calling
 * setState reads the value from its last render: three clicks in one task all
 * see the same length and every one of them passes a check that should have
 * stopped the last two.
 *
 * Returns the original array when nothing changes, so React can skip the
 * re-render.
 */
export function togglePin(pinned: string[], label: string, limit: number): string[] {
  if (pinned.includes(label)) return pinned.filter((k) => k !== label);
  if (pinned.length >= limit) return pinned;
  return pinned.concat(label);
}
