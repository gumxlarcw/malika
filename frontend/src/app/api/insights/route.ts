import { NextRequest } from "next/server";

type InsightRequest = {
  q?: string;
  dataset?: {
    source_id?: string | number;
    type?: string;
    period?: string;
    periods?: string[];
    month?: string | number | null;
    geo?: string;
    group?: string;
    code_hs?: string;
    pod?: string;
    ctr?: string;
    metric?: string;
  };
  preview?: {
    source?: string;
    period?: string;
    last_update?: string | null;
    type?: string;
    geo?: string;
    month?: number | null;
    availableYears?: string[];
    columns?: string[];
    sampleRows?: Array<Record<string, unknown>>;
    unit?: string | null;
    useClientData?: boolean;
  };
  chart?: {
    recommended?: "line" | "bar" | "pie";
    labelKey?: string;
    valueKey?: string;
  };
};

type InsightItem = {
  icon: string;
  label: string;
  text: string;
};

type InsightResponse = {
  ok: boolean;
  mode: "ai" | "template";
  interpretation: {
    title: string;
    headline?: string;
    subheadline?: string;
    insights?: InsightItem[];
    bullets: string[]; // backward compatibility
    methodology?: string;
    confidence?: "high" | "medium" | "low";
    disclaimer?: string;
  };
  chart?: {
    recommended?: "line" | "bar" | "pie";
    reason?: string;
    labelKey?: string;
    valueKey?: string;
  };
  error?: string;
};

const INSIGHTS_BULLET_TARGET = 7;

// month=0 means year-only (e.g., 2017) when month is not available.
type YearMonth = { year: number; month: number; key: number; label: string };

type SummaryBase = {
  kind: "timeseries" | "categorical" | "unknown";
  primaryMetricKey?: string;
  primaryMetricLabel?: string;
  primaryMetricMeaning?: string;
  metricUnitHint?: string;
  availableMetrics?: Array<{ key: string; label?: string; meaning?: string; unitHint?: string }>;
  rowsConsidered: number;
  missingValues: number;
};

type SummaryTimeSeries = SummaryBase & {
  kind: "timeseries";
  labelKey?: string;
  valueKey?: string;
  extraMetrics?: Array<{
    key: string;
    label?: string;
    meaning?: string;
    unitHint?: string;
    latest?: { period?: string; value?: number | null };
  }>;
  secondaryMetric?: {
    key: string;
    label?: string;
    meaning?: string;
    unitHint?: string;
    allowed?: boolean;
    latest?: { period?: string; value?: number | null };
    min?: { period?: string; value?: number | null };
    max?: { period?: string; value?: number | null };
    avg?: number | null;
    change?: { from?: string; to?: string; delta?: number | null };
    recentChange?: { from?: string; to?: string; delta?: number | null; pct?: number | null };
    trend?: { direction?: "naik" | "turun" | "stabil"; from?: string; to?: string };
  };
  range?: { start?: string; end?: string };
  latest?: { period?: string; value?: number | null };
  min?: { period?: string; value?: number | null };
  max?: { period?: string; value?: number | null };
  avg?: number | null;
  change?: { from?: string; to?: string; delta?: number | null };
  recentChange?: { from?: string; to?: string; delta?: number | null; pct?: number | null };
  trend?: { direction?: "naik" | "turun" | "stabil"; from?: string; to?: string };
  biggestIncrease?: { from?: string; to?: string; delta?: number | null };
  biggestDecrease?: { from?: string; to?: string; delta?: number | null };
};

function pctChange(delta: number, base: number) {
  if (!Number.isFinite(delta) || !Number.isFinite(base) || base === 0) return null;
  return (delta / Math.abs(base)) * 100;
}

function inferTrendDirection(series: Array<{ ym: YearMonth; value: number }>) {
  const n = Math.min(6, series.length);
  if (n < 3) return null;
  const window = series.slice(series.length - n);
  let min = window[0].value;
  let max = window[0].value;
  for (const p of window) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const span = Math.max(0, max - min);
  const delta = window[window.length - 1].value - window[0].value;
  const threshold = span > 0 ? span * 0.08 : 0; // 8% of observed span in the window

  if (Math.abs(delta) <= threshold) return "stabil" as const;
  return delta > 0 ? ("naik" as const) : ("turun" as const);
}

type SummaryCategorical = SummaryBase & {
  kind: "categorical";
  labelKey?: string;
  valueKey?: string;
  top?: Array<{ label: string; value: number }>;
  distinctLabels?: number;
  totalValue?: number;
};

type PreviewSummary = SummaryTimeSeries | SummaryCategorical | SummaryBase;

type NormalizationResult = {
  rows: Array<Record<string, unknown>>;
  normalized: boolean;
  details?: string;
  scaleFactor?: number;
};

/**
 * Detect and normalize mixed-scale data (e.g., 1282937 vs 1337.2 when unit is "ribu jiwa").
 * This runs SERVER-SIDE before sending to AI, ensuring consistent data.
 * Handles two scenarios:
 * 1. Multi-year data: Year columns (2020, 2021) with scale mismatch
 * 2. Single-period data: Metric columns with all values in raw units
 */
function normalizeDataRows(
  rows: Array<Record<string, unknown>>,
  unit?: string | null
): NormalizationResult {
  if (!rows || rows.length === 0) {
    return { rows, normalized: false };
  }

  // Only apply for units that indicate scale (ribu, juta, etc.)
  const unitLower = (unit || "").toLowerCase();
  const isScaledUnit = /ribu|juta|miliar|triliun/.test(unitLower);
  if (!isScaledUnit) {
    return { rows, normalized: false };
  }

  const sampleRow = rows[0];
  if (!sampleRow) {
    return { rows, normalized: false };
  }

  // Find year columns (numeric column names like 2020, 2021, etc.)
  const yearColumns: string[] = [];
  for (const key of Object.keys(sampleRow)) {
    if (/^\d{4}$/.test(key)) {
      yearColumns.push(key);
    }
  }

  // SCENARIO 1: Multi-year data with year columns
  if (yearColumns.length > 0) {
    // Collect all numeric values across year columns
    const allValues: number[] = [];
    for (const row of rows) {
      for (const col of yearColumns) {
        const val = row[col];
        if (typeof val === "number" && !isNaN(val) && val > 0) {
          allValues.push(val);
        }
      }
    }

    if (allValues.length < 2) {
      return { rows, normalized: false };
    }

    // Detect scale mismatch: some values >100000, others <10000
    const hasLargeValues = allValues.some((v) => v > 100000);
    const hasSmallValues = allValues.some((v) => v < 10000);

    if (!hasLargeValues || !hasSmallValues) {
      return { rows, normalized: false };
    }

    const scaleFactor = 1000;
    const threshold = 100000;

    const normalizedRows = rows.map((row) => {
      const newRow = { ...row };
      for (const col of yearColumns) {
        const val = row[col];
        if (typeof val === "number" && !isNaN(val) && val > threshold) {
          newRow[col] = Math.round((val / scaleFactor) * 100) / 100;
        }
      }
      return newRow;
    });

    const affectedYears = yearColumns.filter((col) =>
      rows.some((row) => {
        const val = row[col];
        return typeof val === "number" && val > threshold;
      })
    );

    const details = affectedYears.length > 0
      ? `Data tahun ${affectedYears.join(", ")} dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`
      : undefined;

    return {
      rows: normalizedRows,
      normalized: true,
      details,
      scaleFactor,
    };
  }

  // SCENARIO 2: Single-period data with metric columns
  // Find numeric metric columns (exclude label columns)
  const labelPatterns = /^(wilayah|region|kab|kota|provinsi|area|bulan|tahun|periode|__.*|id|kode)$/i;
  const numericColumns: string[] = [];
  
  for (const key of Object.keys(sampleRow)) {
    if (labelPatterns.test(key)) continue;
    const val = sampleRow[key];
    if (typeof val === "number" && !isNaN(val)) {
      numericColumns.push(key);
    }
  }

  if (numericColumns.length === 0) {
    return { rows, normalized: false };
  }

  // Check if values have mixed scales (some >1000, others <1000)
  // This handles cases like:
  // - 2020: 63452 (raw) - should be 63.45
  // - 2024: 124.3 (ribu jiwa) - already correct
  let hasLargeValues = false;
  let hasSmallValues = false;
  let allValuesLarge = true;

  for (const row of rows) {
    for (const col of numericColumns) {
      const val = row[col];
      if (typeof val === "number" && !isNaN(val) && val > 0) {
        if (val > 1000) {
          hasLargeValues = true;
        } else {
          allValuesLarge = false;
          hasSmallValues = true;
        }
      }
    }
  }

  // Mixed scale: some values are large (raw units) and some are small (already scaled)
  const hasMixedScale = hasLargeValues && hasSmallValues;
  
  // Normalize if:
  // 1. ALL values are large (single period with raw data), OR
  // 2. Mixed scale detected (multi-period with inconsistent formatting)
  const needsNormalization = (hasLargeValues && allValuesLarge) || hasMixedScale;
  
  if (!needsNormalization) {
    return { rows, normalized: false };
  }

  const scaleFactor = 1000;
  const threshold = 1000;

  const normalizedRows = rows.map((row) => {
    const newRow = { ...row };
    for (const col of numericColumns) {
      const val = row[col];
      if (typeof val === "number" && !isNaN(val) && val > threshold) {
        newRow[col] = Math.round((val / scaleFactor) * 100) / 100;
      }
    }
    return newRow;
  });

  const details = hasMixedScale 
    ? `Data dengan skala berbeda dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`
    : `Data dinormalisasi (÷${scaleFactor}) ke satuan ${unitLower}`;

  return {
    rows: normalizedRows,
    normalized: true,
    details,
    scaleFactor,
  };
}

function safeTrim(input: unknown, max = 240) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function backendBaseUrl() {
  return (
    process.env.BACKEND_BASE_URL ||
    process.env.BACKEND_INTERNAL_API_URL ||
    process.env.INTERNAL_BACKEND_API_URL ||
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://127.0.0.1:5000"
  );
}

function normalizeEximGroup(groupRaw: string) {
  const g = String(groupRaw || "").trim().toLowerCase();
  if (!g) return "";
  if (g === "hs2") return "hs2";
  if (g === "pod" || g === "pelabuhan" || g === "port") return "pod";
  if (g === "ctr" || g === "negara" || g === "country") return "ctr";
  if (g === "detail") return "detail";
  if (g === "hs2ctr") return "hs2ctr";
  if (g === "hs2pod") return "hs2pod";
  return "";
}

function toIntMonth(input: unknown): number | null {
  const n = toNumberLoose(input);
  if (n === null) return null;
  const i = Math.trunc(n);
  if (i >= 1 && i <= 12) return i;
  return null;
}

function normGeoLoose(input: unknown) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findGeoColumnLoose(columns: string[]) {
  const cols = Array.isArray(columns) ? columns : [];
  return (
    cols.find((c) => /(wilayah|kabupaten|kota|kab\/kota|kab\s*\/\s*kota|daerah)/i.test(String(c || "").trim())) ||
    ""
  );
}

function matchesGeoCellLoose(cell: unknown, geoNorm: string) {
  const s = normGeoLoose(cell);
  if (!s || !geoNorm) return false;
  if (s === geoNorm) return true;
  return s.includes(geoNorm);
}

async function fetchFullDataset(dataset: InsightRequest["dataset"]) {
  const sourceIdRaw = dataset?.source_id;
  const sourceId = Number(String(sourceIdRaw ?? "").trim());
  const type = String(dataset?.type || "dynamic").trim().toLowerCase();
  const period = String(dataset?.period || "").trim();
  const periodsRaw = Array.isArray(dataset?.periods) ? dataset!.periods! : [];
  const periods = periodsRaw
    .map((p) => String(p || "").trim())
    .filter(Boolean);

  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;

  const endpoint =
    type === "exim" ? "exim" : type === "interop" ? "interop" : type === "static" ? "static" : "dynamic";
  if (endpoint !== "static" && periods.length === 0 && (!period || period.length < 1)) return null;

  const base = `${backendBaseUrl()}/${endpoint}/${encodeURIComponent(String(sourceId))}`;
  if (endpoint === "static") {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as any;
  }

  const group = type === "exim" ? normalizeEximGroup(String(dataset?.group || "")) : "";
  const codeHs = String(dataset?.code_hs || "").trim();
  const month = String(dataset?.month ?? "").trim();
  const pod = String(dataset?.pod || "").trim();
  const ctr = String(dataset?.ctr || "").trim();
  const metricRaw = String(dataset?.metric || "").trim().toLowerCase();
  const metricWanted = metricRaw === "value" || metricRaw === "netweight" ? metricRaw : "";

  const buildUrl = (p: string) =>
    `${base}?period=${encodeURIComponent(p)}${endpoint === "exim" && group ? `&group=${encodeURIComponent(group)}` : ""}${endpoint === "exim" && codeHs ? `&code_hs=${encodeURIComponent(codeHs)}` : ""}${endpoint === "exim" && month ? `&month=${encodeURIComponent(month)}` : ""}${endpoint === "exim" && pod ? `&pod=${encodeURIComponent(pod)}` : ""}${endpoint === "exim" && ctr ? `&ctr=${encodeURIComponent(ctr)}` : ""}${endpoint === "exim" && metricWanted ? `&metric=${encodeURIComponent(metricWanted)}` : ""}`;

  // Multi-period support (e.g., year-range tabs): fetch each period once and merge rows.
  if (periods.length > 0) {
    const uniq = Array.from(new Set(periods));
    // Keep a stable, sensible order (ascending numeric year when possible).
    uniq.sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });

    const results = await Promise.all(
      uniq.map(async (p) => {
        try {
          const res = await fetch(buildUrl(p), { cache: "no-store" });
          if (!res.ok) return null;
          return (await res.json()) as any;
        } catch {
          return null;
        }
      })
    );

    const nonNull = results.filter(Boolean) as any[];
    if (nonNull.length === 0) return null;

    const mergedColumns: string[] = [];
    const mergedRows: Array<Record<string, unknown>> = [];
    let sourceLabel: string | undefined;
    let lastUpdate: string | null | undefined;

    for (const r of nonNull) {
      const dataObj = r && typeof r === 'object' ? ((r as any).data ?? null) : null;
      const cols = Array.isArray(dataObj?.columns) ? (dataObj.columns as string[]) : [];
      const rows = Array.isArray(dataObj?.data) ? (dataObj.data as Array<Record<string, unknown>>) : [];

      if (!sourceLabel && typeof dataObj?.source === 'string') sourceLabel = dataObj.source;
      if (lastUpdate === undefined && (typeof dataObj?.last_update === 'string' || dataObj?.last_update === null)) {
        lastUpdate = dataObj.last_update;
      }

      for (const c of cols) {
        const name = String(c || '').trim();
        if (!name) continue;
        if (!mergedColumns.includes(name)) mergedColumns.push(name);
      }
      if (rows.length > 0) mergedRows.push(...rows);
    }

    const first = nonNull[0];
    return {
      ...(first && typeof first === 'object' ? first : {}),
      data: {
        ...(first && typeof first === 'object' ? ((first as any).data ?? {}) : {}),
        source: sourceLabel,
        columns: mergedColumns,
        data: mergedRows,
        last_update: lastUpdate,
      },
    } as any;
  }

  const res = await fetch(buildUrl(period), { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as any;
}

function capSummaryRows(rows: Array<Record<string, unknown>>) {
  const maxRaw = String(process.env.INSIGHTS_SUMMARY_MAX_ROWS || "50000").trim();
  const max = Math.max(100, Number.parseInt(maxRaw, 10) || 50000);
  if (rows.length <= max) return { rows, capped: false };
  return { rows: rows.slice(0, max), capped: true };
}

function cutNoEllipsis(input: unknown, max = 260) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const minCut = Math.floor(max * 0.7);
  const cutAt = lastSpace >= minCut ? lastSpace : max;
  return sliced.slice(0, cutAt).trim();
}

function toNumberLoose(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;

  // Keep only digits, sign, and separators.
  let cleaned = s.replace(/[^0-9,\.\-+]/g, "");
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  // Helper: collapse multiple dots to a single decimal dot (keep last one).
  const normalizeSingleDecimalDot = (input: string) => {
    const idx = input.lastIndexOf(".");
    if (idx <= 0) return input;
    const head = input.slice(0, idx).replace(/\./g, "");
    const tail = input.slice(idx);
    return head + tail;
  };

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    cleaned = cleaned.split(thousandSep).join("");
    if (decimalSep === ",") cleaned = cleaned.replace(/,/g, ".");
    cleaned = normalizeSingleDecimalDot(cleaned);
  } else if (hasComma) {
    const last = cleaned.lastIndexOf(",");
    const frac = cleaned.slice(last + 1);
    // If 1-2 digits after comma, treat comma as decimal; else comma as thousands.
    if (frac.length >= 1 && frac.length <= 2) {
      cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
      cleaned = normalizeSingleDecimalDot(cleaned);
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (hasDot) {
    const last = cleaned.lastIndexOf(".");
    const frac = cleaned.slice(last + 1);
    // If 1-2 digits after dot, treat dot as decimal; else dot as thousands.
    if (frac.length >= 1 && frac.length <= 2) {
      cleaned = cleaned.replace(/,/g, "");
      cleaned = normalizeSingleDecimalDot(cleaned);
    } else {
      cleaned = cleaned.replace(/\./g, "");
    }
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normKey(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isAxisYearColumn(col: string) {
  return /^(tahun|year|th_id|thid)$/i.test(String(col || "").trim());
}

function isAxisMonthColumn(col: string) {
  return /^(bulan|month|month_no|bln)$/i.test(String(col || "").trim());
}

function isAxisPeriodColumn(col: string) {
  return /^(periode|period|tanggal|date)$/i.test(String(col || "").trim());
}

function normalizeYear(input: unknown): number | null {
  const n = toNumberLoose(input);
  if (n === null) return null;
  const i = Math.trunc(n);
  if (i >= 1900 && i <= 2100) return i;
  if (i >= 0 && i <= 300) return 1900 + i;
  return null;
}

function isYearOnlyLabel(text: string) {
  return /^\s*(19\d{2}|20\d{2}|2100)\s*$/.test(String(text || ""));
}

function formatYearOnly(year: number): YearMonth {
  return { year, month: 0, key: year * 100, label: String(year) };
}

function monthFromCell(cell: unknown): number | null {
  const n = toNumberLoose(cell);
  if (n !== null) {
    const i = Math.trunc(n);
    if (i >= 1 && i <= 12) return i;
  }
  const raw = String(cell ?? "").trim().toLowerCase();
  if (!raw) return null;
  // [8] Agustus
  const m = raw.match(/^\[\s*(\d{1,2})\s*\]\s*/);
  if (m) {
    const i = Number(m[1]);
    if (i >= 1 && i <= 12) return i;
  }
  // Month word
  for (const [k, v] of Object.entries(MONTHS_ID)) {
    if (raw.includes(k)) return v;
  }
  return null;
}

function inferYearMonthFromRow(row: Record<string, unknown>, columns: string[]): YearMonth | null {
  const periodCol = columns.find((c) => isAxisPeriodColumn(c)) || "";
  const yearCol = columns.find((c) => isAxisYearColumn(c)) || "";
  const monthCol = columns.find((c) => isAxisMonthColumn(c)) || "";

  if (periodCol) {
    const parsed = parseYearMonthFromText(String((row as any)?.[periodCol] ?? ""));
    if (parsed) return parsed;
  }

  // Prefer injected preview year when month exists but year column may be absent.
  const yy = normalizeYear((row as any)?.__preview_year);
  if (yy && monthCol) {
    const mm = monthFromCell((row as any)?.[monthCol]);
    if (mm) return { year: yy, month: mm, key: yy * 100 + mm, label: `${monthNoToIdName(mm)} ${yy}` };
  }

  // Year-only mode (multi-year previews): __preview_year without month.
  if (yy && !monthCol) {
    return formatYearOnly(yy);
  }

  if (yearCol && monthCol) {
    const y = normalizeYear((row as any)?.[yearCol]);
    const m = monthFromCell((row as any)?.[monthCol]);
    if (y && m) return { year: y, month: m, key: y * 100 + m, label: `${monthNoToIdName(m)} ${y}` };
  }

  // As last resort: parse any text cell that contains month+year
  for (const c of columns.slice(0, 10)) {
    const parsed = parseYearMonthFromText(String((row as any)?.[c] ?? ""));
    if (parsed) return parsed;
  }

  return null;
}

function getColumnStats(col: string, rows: Array<Record<string, unknown>>) {
  const sample = rows.slice(0, Math.min(rows.length, 2000));
  let seen = 0;
  let numeric = 0;
  const uniq = new Set<string>();
  for (const r of sample) {
    const raw = (r as any)?.[col];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    seen++;
    uniq.add(String(raw).trim());
    if (toNumberLoose(raw) !== null) numeric++;
  }
  const numericRatio = seen ? numeric / seen : 0;
  const uniqCount = uniq.size;
  const uniqueRatio = seen ? uniqCount / seen : 0;
  return { seen, numericRatio, uniqueRatio, uniqCount };
}

function pickValueKey(columns: string[], rows: Array<Record<string, unknown>>) {
  const preferred = ["value", "netweight", "jumlah", "nilai", "total", "persentase", "indeks", "month-to-month", "year-on-year"];
  const colNorm = columns.map((c) => ({ c, n: normKey(c) }));
  for (const p of preferred) {
    const hit = colNorm.find((x) => x.n === p);
    if (hit && !isAxisYearColumn(hit.c) && !isAxisMonthColumn(hit.c) && !isAxisPeriodColumn(hit.c)) return hit.c;
  }

  let best: { c: string; score: number } | null = null;
  for (const c of columns) {
    if (isAxisYearColumn(c) || isAxisMonthColumn(c) || isAxisPeriodColumn(c)) continue;
    const s = getColumnStats(c, rows);
    const variationBonus = s.uniqueRatio >= 0.1 && s.uniqueRatio <= 0.98 ? 0.1 : 0;
    const score = s.numericRatio + variationBonus;
    if (!best || score > best.score) best = { c, score };
  }
  return best && best.score >= 0.45 ? best.c : "";
}

function pickLabelKey(columns: string[], rows: Array<Record<string, unknown>>, valueKey: string) {
  const v = normKey(valueKey);
  const candidates = columns.filter((c) => normKey(c) !== v);
  const monthCol = candidates.find((c) => isAxisMonthColumn(c));
  const periodCol = candidates.find((c) => isAxisPeriodColumn(c));

  // Period/month are great label keys for time-series. But for month-filtered views (e.g. EXIM
  // "komoditas pada Juni 2025"), these columns can be constant and would make categorical
  // summarization impossible (top labels would be < 3). Only use them when they have enough
  // distinct values in the provided sample.
  if (periodCol) {
    const st = getColumnStats(periodCol, rows);
    if (st.uniqCount >= 3 || st.uniqueRatio >= 0.15) return periodCol;
  }
  if (monthCol) {
    const st = getColumnStats(monthCol, rows);
    if (st.uniqCount >= 4 || st.uniqueRatio >= 0.15) return monthCol;
  }

  // Otherwise pick a non-numeric categorical-ish column
  let best: { c: string; score: number } | null = null;
  for (const c of candidates) {
    const s = getColumnStats(c, rows);
    const nameBonus = /(wilayah|daerah|provinsi|kabupaten|kota|kab\/kota|negara|pod|ctr|kodehs|komoditas)/i.test(c)
      ? 0.2
      : 0;
    // Prefer columns that are not mostly numeric and have some variety.
    const score = (1 - s.numericRatio) + (s.uniqueRatio >= 0.1 ? 0.1 : 0) + nameBonus;
    if (!best || score > best.score) best = { c, score };
  }
  return best?.c || candidates[0] || "";
}

function inferUnitHint(valueKey: string) {
  const k = normKey(valueKey);
  if (
    k.includes("persen") ||
    k.includes("percent") ||
    k.includes("percentage") ||
    k.includes("month-to-month") ||
    k.includes("year-on-year") ||
    k.includes("y-on-y") ||
    k.includes("q-to-q") ||
    k.includes("c-to-c")
  )
    return "%";
  if (k.includes("indeks") || k.includes("index")) return "indeks";
  if (k === "value") return "US$";
  if (k === "netweight") return "kg";
  return "";
}

/**
 * Extract scale/unit hints from indicator name (e.g., "ribu jiwa", "juta rupiah", "M3")
 * This helps AI understand when numbers are in thousands/millions/etc.
 */
function extractScaleFromSourceName(sourceName: string | undefined): string | null {
  if (!sourceName) return null;
  const s = sourceName.toLowerCase();
  
  // Population units
  if (s.includes("(ribu jiwa)") || s.includes("ribu jiwa")) return "ribu jiwa (data dalam ribuan orang)";
  if (s.includes("(jiwa)") || /\bjiwa\b/.test(s)) return "jiwa";
  
  // Currency units  
  if (s.includes("(juta rupiah)") || s.includes("juta rupiah") || s.includes("juta rp")) 
    return "juta rupiah (data dalam jutaan rupiah)";
  if (s.includes("(miliar rupiah)") || s.includes("miliar rupiah")) 
    return "miliar rupiah (data dalam miliaran rupiah)";
  if (s.includes("(triliun rupiah)") || s.includes("triliun rupiah")) 
    return "triliun rupiah (data dalam triliunan rupiah)";
  if (s.includes("(ribu rupiah)") || s.includes("ribu rupiah") || s.includes("ribu rp")) 
    return "ribu rupiah (data dalam ribuan rupiah)";
  if (s.includes("(rp)") || /\brp\b/.test(s)) return "rupiah";
  
  // Volume/area units
  if (s.includes("(m3)") || s.includes("(m 3)") || /\bm3\b/.test(s)) return "meter kubik (M3)";
  if (s.includes("(m2)") || s.includes("(m 2)") || /\bm2\b/.test(s)) return "meter persegi (M2)";
  if (s.includes("(ha)") || /\bhektar\b/.test(s) || /\bha\b/.test(s)) return "hektar";
  if (s.includes("(ton)") || /\bton\b/.test(s)) return "ton";
  if (s.includes("(kg)") || /\bkg\b/.test(s)) return "kilogram";
  if (s.includes("(kw)") || s.includes("(kuintal)") || /\bkuintal\b/.test(s)) return "kuintal";
  
  // Count/quantity
  if (s.includes("(ribu)") && !s.includes("rupiah")) return "ribuan (data dalam ribuan unit)";
  if (s.includes("(000)")) return "ribuan (data dalam ribuan)";
  
  // Index
  if (/\bindeks\b/.test(s) || /\bindex\b/.test(s)) return "indeks";
  
  // Percentage
  if (s.includes("persentase") || s.includes("persen") || s.includes("(%)")) return "persen (%)";
  
  return null;
}

/**
 * Detect if data contains Maluku Utara aggregate row mixed with kabupaten/kota
 * Specific to BPS Maluku Utara scope
 */
function detectMalukuUtaraAggregate(
  rows: Array<Record<string, unknown>>,
  labelColumn: string | undefined
): { hasAggregate: boolean; hasGeoMix: boolean } {
  if (!labelColumn || rows.length === 0) return { hasAggregate: false, hasGeoMix: false };
  
  let hasProvince = false;
  let hasKabKota = false;
  
  for (const row of rows) {
    const val = row[labelColumn];
    if (typeof val !== "string") continue;
    const lower = val.trim().toLowerCase();
    
    // Check for Maluku Utara province aggregate
    if (lower === "maluku utara" || lower.includes("provinsi maluku utara") || 
        lower === "total" || lower === "jumlah") {
      hasProvince = true;
    }
    
    // Check for kab/kota patterns
    if (lower.startsWith("kab.") || lower.startsWith("kab ") || lower.startsWith("kabupaten") ||
        lower.startsWith("kota ") || lower.includes("halmahera") || lower.includes("kepulauan") || 
        lower.includes("pulau ") || lower.includes("tidore") || lower.includes("ternate") ||
        lower.includes("morotai") || lower.includes("taliabu") || lower.includes("sula")) {
      hasKabKota = true;
    }
  }
  
  return { hasAggregate: hasProvince, hasGeoMix: hasProvince && hasKabKota };
}

function humanizeMetric(valueKey: string, unitHint: string) {
  const k = normKey(valueKey);
  const unit = unitHint ? ` (${unitHint})` : "";

  // Growth-rate metrics commonly present in PDRB/growth tables
  if (k === "c-to-c" || k === "ctoc" || /c\s*to\s*c/.test(k) || /c[-\s]?to[-\s]?c/.test(k)) {
    return {
      label: `c-to-c${unit}`,
      meaning: "Pertumbuhan kumulatif dibanding kumulatif periode yang sama (cumulative-to-cumulative).",
    };
  }
  if (k === "q-to-q" || k === "qtq" || /q\s*to\s*q/.test(k) || /q[-\s]?to[-\s]?q/.test(k)) {
    return {
      label: `q-to-q${unit}`,
      meaning: "Perubahan dibanding kuartal sebelumnya (quarter-to-quarter).",
    };
  }
  if (k === "y-on-y" || k === "yoy" || /y\s*on\s*y/.test(k) || /y[-\s]?on[-\s]?y/.test(k) || /year\s*on\s*year/.test(k)) {
    return {
      label: `y-on-y${unit}`,
      meaning: "Perubahan dibanding periode yang sama tahun sebelumnya (year-on-year).",
    };
  }

  // Common cases in this app
  if (k === "month-to-month" || k === "mom" || k.includes("m to m") || k.includes("month to month")) {
    return {
      label: `Inflasi MoM${unit}`,
      meaning: "Perubahan inflasi dibanding bulan sebelumnya (month-to-month).",
    };
  }
  if (k === "year-on-year" || k === "yoy" || k.includes("y on y") || k.includes("year on year")) {
    return {
      label: `Inflasi YoY${unit}`,
      meaning: "Perubahan inflasi dibanding bulan yang sama tahun sebelumnya (year-on-year).",
    };
  }
  if (k === "value") {
    return {
      label: `Nilai (Value)${unit}`,
      meaning: "Nilai transaksi/nominal (umumnya US$ untuk EXIM).",
    };
  }
  if (k === "netweight") {
    return {
      label: `Volume (Netweight)${unit}`,
      meaning: "Volume/berat bersih (umumnya kg untuk EXIM).",
    };
  }
  if (k.includes("indeks") || k.includes("index")) {
    return {
      label: `Indeks${unit}`,
      meaning: "Nilai indeks sesuai definisi indikator.",
    };
  }
  if (k.includes("persen") || unitHint === "%") {
    return {
      label: `${valueKey}${unit}`,
      meaning: "Nilai dalam persentase.",
    };
  }

  return {
    label: `${valueKey}${unit}`,
    meaning: "Metrik utama yang digunakan untuk membaca angka pada grafik/interpretasi.",
  };
}

function isMoMMetricKey(valueKey: string) {
  const k = normKey(valueKey);
  return k === "month-to-month" || k === "mom" || /month\s*to\s*month/.test(k) || /month.*month/.test(k);
}

function isYoYMetricKey(valueKey: string) {
  const k = normKey(valueKey);
  return (
    k === "year-on-year" ||
    k === "yoy" ||
    k === "y-on-y" ||
    /y\s*on\s*y/.test(k) ||
    /year\s*on\s*year/.test(k) ||
    /year.*year/.test(k)
  );
}

function isQoQMetricKey(valueKey: string) {
  const k = normKey(valueKey);
  return k === "q-to-q" || k === "qtq" || /q\s*to\s*q/.test(k) || /quarter\s*to\s*quarter/.test(k);
}

function isCtoCMetricKey(valueKey: string) {
  const k = normKey(valueKey);
  return k === "c-to-c" || k === "ctoc" || /c\s*to\s*c/.test(k) || /cumulative\s*to\s*cumulative/.test(k);
}

function findMetricColumn(columns: string[], predicate: (c: string) => boolean) {
  for (const c of columns) {
    if (predicate(c)) return c;
  }
  return "";
}

function computeYoYAllowedFromSample(sample: Array<Record<string, unknown>>, columns: string[]) {
  // YoY is meaningful when we have (at least) the same month across multiple years.
  const monthToYears = new Map<number, Set<number>>();
  for (const r of sample) {
    const ym = inferYearMonthFromRow(r, columns);
    if (!ym) continue;
    let set = monthToYears.get(ym.month);
    if (!set) {
      set = new Set<number>();
      monthToYears.set(ym.month, set);
    }
    set.add(ym.year);
  }
  for (const set of monthToYears.values()) {
    if (set.size >= 2) return true;
  }
  return false;
}

function summarizePreview(columns: string[], rows: Array<Record<string, unknown>>): PreviewSummary {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const capped = capSummaryRows(safeRows);
  const rowsConsidered = capped.rows.length;
  const sample = capped.rows;

  if (safeColumns.length === 0 || sample.length === 0) {
    return { kind: "unknown", rowsConsidered, missingValues: 0 };
  }

  const momKey = findMetricColumn(safeColumns, (c) => isMoMMetricKey(c));
  const yoyKey = findMetricColumn(safeColumns, (c) => isYoYMetricKey(c));
  const qoqKey = findMetricColumn(safeColumns, (c) => isQoQMetricKey(c));
  const ctocKey = findMetricColumn(safeColumns, (c) => isCtoCMetricKey(c));

  // Prefer MoM as default primary when both MoM and YoY exist.
  // For growth tables (PDRB), prefer c-to-c when present.
  const picked = pickValueKey(safeColumns, sample);
  const valueKey = momKey && yoyKey ? momKey : (ctocKey || picked);
  const labelKey = pickLabelKey(safeColumns, sample, valueKey);
  const unitHint = inferUnitHint(valueKey);
  const metricHuman = valueKey ? humanizeMetric(valueKey, unitHint) : null;

  // Expose available metrics so AI/template can explain them even if only one is selected as primary.
  const availableMetricKeys = Array.from(
    new Set([valueKey, ctocKey, qoqKey, yoyKey].filter((x) => typeof x === 'string' && x.trim().length > 0))
  );
  const availableMetrics = availableMetricKeys
    .map((k) => {
      const u = inferUnitHint(k);
      const h = humanizeMetric(k, u);
      return { key: k, label: h?.label || k, meaning: h?.meaning, unitHint: u || undefined };
    })
    .slice(0, 6);

  const yoyAllowed = yoyKey ? computeYoYAllowedFromSample(sample, safeColumns) : false;

  const buildSeries = (metricKey: string) => {
    const points: Array<{ ym: YearMonth; value: number }> = [];
    const byKey = new Map<number, { ym: YearMonth; value: number | null; raw: unknown }>();
    let latestYmAny: YearMonth | null = null;
    let missing = 0;
    for (const r of sample) {
      const ym = inferYearMonthFromRow(r, safeColumns);
      if (!ym) continue;

      // Track latest period even if value is missing.
      if (!latestYmAny || ym.key > latestYmAny.key) latestYmAny = ym;

      const rawCell = metricKey ? (r as any)?.[metricKey] : null;
      const v = metricKey ? toNumberLoose(rawCell) : null;
      if (v === null) missing++;

      // Keep a per-period record (prefer non-null numeric if duplicates exist).
      const prev = byKey.get(ym.key);
      if (!prev || (prev.value === null && v !== null)) {
        byKey.set(ym.key, { ym, value: v, raw: rawCell });
      }
      if (v !== null) points.push({ ym, value: v });
    }
    const uniq = new Map<number, { ym: YearMonth; value: number }>();
    for (const p of points) uniq.set(p.ym.key, p);
    const series = Array.from(uniq.values()).sort((a, b) => a.ym.key - b.ym.key);
    return { series, missing, byKey, latestYmAny };
  };

  // Try time-series first.
  const built = valueKey ? buildSeries(valueKey) : null;
  const series = built?.series || [];
  const missingValues = built?.missing || 0;

  if (series.length >= 4) {
    const values = series.map((x) => x.value);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

    let min = series[0];
    let max = series[0];
    for (const p of series) {
      if (p.value < min.value) min = p;
      if (p.value > max.value) max = p;
    }

    const latestNonNull = series[series.length - 1];
    const latestYm = built?.latestYmAny || latestNonNull.ym;
    const latestVal = (built?.byKey.get(latestYm.key)?.value ?? latestNonNull.value);
    const first = series[0];
    const change = series.length >= 2 ? latestNonNull.value - first.value : null;

    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const recentDelta = prev ? latestNonNull.value - prev.value : null;
    const recentPct = prev && recentDelta !== null ? pctChange(recentDelta, prev.value) : null;
    const trendDir = inferTrendDirection(series);

    let biggestInc: { from?: string; to?: string; delta?: number | null } | undefined;
    let biggestDec: { from?: string; to?: string; delta?: number | null } | undefined;
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      const delta = cur.value - prev.value;
      if (!biggestInc || (delta !== null && (biggestInc.delta ?? -Infinity) < delta)) {
        biggestInc = { from: prev.ym.label, to: cur.ym.label, delta };
      }
      if (!biggestDec || (delta !== null && (biggestDec.delta ?? Infinity) > delta)) {
        biggestDec = { from: prev.ym.label, to: cur.ym.label, delta };
      }
    }

    const out: SummaryTimeSeries = {
      kind: "timeseries",
      primaryMetricKey: valueKey || undefined,
      primaryMetricLabel: metricHuman?.label || (valueKey || undefined),
      primaryMetricMeaning: metricHuman?.meaning || undefined,
      metricUnitHint: unitHint || undefined,
      availableMetrics,
      rowsConsidered,
      missingValues,
      labelKey: labelKey || undefined,
      valueKey: valueKey || undefined,
      range: { start: first.ym.label, end: latestYm.label },
      latest: { period: latestYm.label, value: latestVal },
      min: { period: min.ym.label, value: min.value },
      max: { period: max.ym.label, value: max.value },
      avg,
      change: { from: first.ym.label, to: latestYm.label, delta: change },
      recentChange: prev
        ? { from: prev.ym.label, to: latestYm.label, delta: recentDelta, pct: recentPct }
        : undefined,
      trend: trendDir
        ? {
            direction: trendDir,
            from: series[Math.max(0, series.length - Math.min(6, series.length))].ym.label,
            to: latestYm.label,
          }
        : undefined,
      biggestIncrease: biggestInc,
      biggestDecrease: biggestDec,
    };

    // Provide a small deterministic snapshot for other available metrics (if any).
    // This helps the AI mention q-to-q/y-on-y in addition to the primary.
    {
      const extras = availableMetricKeys.filter((k) => k && k !== valueKey).slice(0, 3);
      const extraMetrics: SummaryTimeSeries['extraMetrics'] = [];
      for (const k of extras) {
        const builtX = buildSeries(k);
        const latestX = builtX.latestYmAny;
        if (!latestX) continue;
        const v = builtX.byKey.get(latestX.key)?.value ?? null;
        const u = inferUnitHint(k);
        const h = humanizeMetric(k, u);
        extraMetrics.push({
          key: k,
          label: h?.label || k,
          meaning: h?.meaning,
          unitHint: u || undefined,
          latest: { period: latestX.label, value: typeof v === 'number' ? v : null },
        });
      }
      if (extraMetrics.length > 0) out.extraMetrics = extraMetrics;
    }

    // Optional secondary metric (commonly YoY for inflation) only when context supports it.
    if (yoyKey && yoyKey !== valueKey) {
      if (yoyAllowed) {
        const unit2 = inferUnitHint(yoyKey);
        const metric2 = humanizeMetric(yoyKey, unit2);
        const built2 = buildSeries(yoyKey);
        const s2 = built2.series;
        if (s2.length >= 4) {
          const values2 = s2.map((x) => x.value);
          const avg2 = values2.length ? values2.reduce((a, b) => a + b, 0) / values2.length : null;

          let min2 = s2[0];
          let max2 = s2[0];
          for (const p of s2) {
            if (p.value < min2.value) min2 = p;
            if (p.value > max2.value) max2 = p;
          }

          const latestNonNull2 = s2[s2.length - 1];
          const latestYm2 = built2.latestYmAny || latestNonNull2.ym;
          const latestVal2 = (built2.byKey.get(latestYm2.key)?.value ?? latestNonNull2.value);
          const first2 = s2[0];
          const change2 = s2.length >= 2 ? latestNonNull2.value - first2.value : null;

          const prev2 = s2.length >= 2 ? s2[s2.length - 2] : null;
          const recentDelta2 = prev2 ? latestNonNull2.value - prev2.value : null;
          const recentPct2 = prev2 && recentDelta2 !== null ? pctChange(recentDelta2, prev2.value) : null;
          const trendDir2 = inferTrendDirection(s2);

          out.secondaryMetric = {
            key: yoyKey,
            label: metric2?.label || yoyKey,
            meaning: metric2?.meaning,
            unitHint: unit2 || undefined,
            allowed: true,
            latest: { period: latestYm2.label, value: latestVal2 },
            min: { period: min2.ym.label, value: min2.value },
            max: { period: max2.ym.label, value: max2.value },
            avg: avg2,
            change: { from: first2.ym.label, to: latestYm2.label, delta: change2 },
            recentChange: prev2
              ? { from: prev2.ym.label, to: latestYm2.label, delta: recentDelta2, pct: recentPct2 }
              : undefined,
            trend: trendDir2
              ? {
                  direction: trendDir2,
                  from: s2[Math.max(0, s2.length - Math.min(6, s2.length))].ym.label,
                  to: latestYm2.label,
                }
              : undefined,
          };
        }
      } else {
        const unit2 = inferUnitHint(yoyKey);
        const metric2 = humanizeMetric(yoyKey, unit2);
        out.secondaryMetric = {
          key: yoyKey,
          label: metric2?.label || yoyKey,
          meaning: metric2?.meaning,
          unitHint: unit2 || undefined,
          allowed: false,
        };
      }
    }

    return out;
  }

  // Fallback: categorical summary (top labels by value).
  if (valueKey && labelKey) {
    const map = new Map<string, number>();
    let missingValuesCat = 0;
    for (const r of sample) {
      const label = safeTrim((r as any)?.[labelKey], 80);
      const v = toNumberLoose((r as any)?.[valueKey]);
      if (!label) continue;
      if (v === null) {
        missingValuesCat++;
        continue;
      }
      map.set(label, (map.get(label) || 0) + v);
    }
    let totalValue = 0;
    for (const v of map.values()) totalValue += v;
    const top = Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    if (top.length >= 3) {
      return {
        kind: "categorical",
        primaryMetricKey: valueKey || undefined,
        primaryMetricLabel: metricHuman?.label || (valueKey || undefined),
        primaryMetricMeaning: metricHuman?.meaning || undefined,
        metricUnitHint: unitHint || undefined,
        availableMetrics,
        rowsConsidered,
        missingValues: missingValuesCat,
        labelKey: labelKey || undefined,
        valueKey: valueKey || undefined,
        top,
        distinctLabels: map.size,
        totalValue,
      };
    }
  }

  return {
    kind: "unknown",
    primaryMetricKey: valueKey || undefined,
    primaryMetricLabel: metricHuman?.label || (valueKey || undefined),
    primaryMetricMeaning: metricHuman?.meaning || undefined,
    metricUnitHint: unitHint || undefined,
    availableMetrics,
    rowsConsidered,
    missingValues,
  };
}

function formatNumberId(n: number, decimals = 2) {
  try {
    return n.toLocaleString('id-ID', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function compactScaleLabel(scale: number) {
  if (scale === 1e12) return 'triliun';
  if (scale === 1e9) return 'miliar';
  if (scale === 1e6) return 'juta';
  if (scale === 1e3) return 'ribu';
  return '';
}

function pickCompactScale(absValue: number) {
  if (absValue >= 1e12) return 1e12;
  if (absValue >= 1e9) return 1e9;
  if (absValue >= 1e6) return 1e6;
  if (absValue >= 1e3) return 1e3;
  return 1;
}

function formatCompactValueNumber(n: number) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const scale = pickCompactScale(abs);
  if (scale === 1) return `${sign}${formatNumberId(abs, 2)}`;
  const label = compactScaleLabel(scale);
  return `${sign}${formatNumberId(abs / scale, 2)} ${label}`.trim();
}

function formatMetricValue(n: number, metricKeyOrLabel: string, unitHint?: string | null) {
  const m = String(metricKeyOrLabel || '').toLowerCase();
  const unit = String(unitHint || '').trim();

  const isNetweight = m.includes('netweight') || m === 'volume' || m.includes('berat');
  const isKg = /\bkg\b/i.test(unit);
  if (isNetweight && isKg) {
    const tons = n / 1000;
    const sign = tons < 0 ? '-' : '';
    const abs = Math.abs(tons);
    const scale = pickCompactScale(abs);
    const label = scale === 1 ? 'ton' : `${compactScaleLabel(scale)} ton`;
    return `${sign}${formatNumberId(abs / scale, 2)} ${label}`.trim();
  }

  if (m === 'value' || m.includes('nilai')) {
    return `${formatCompactValueNumber(n)}${unit ? ` ${unit}` : ''}`.trim();
  }

  return `${formatNumberId(n, 2)}${unit ? ` ${unit}` : ''}`.trim();
}

function parseNumericToken(token: string): number | null {
  const s = String(token || '').trim();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (Number.isFinite(y) && y >= 1900 && y <= 2100) return null;
  }

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized = s;

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const decimalSep = lastDot > lastComma ? '.' : ',';
    if (decimalSep === '.') normalized = s.replace(/,/g, '');
    else normalized = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasComma && !hasDot) {
    normalized = s.replace(/\./g, '').replace(/,/g, '.');
  } else {
    normalized = s.replace(/,/g, '');
  }

  normalized = normalized.replace(/\s+/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatNumbersInTextId(text: string) {
  const s = String(text || '');
  if (!s) return s;
  const re = /\b\d{4,}(?:[\.,]\d+)?\b|\b\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d+)?\b/g;
  return s.replace(re, (m) => {
    const n = parseNumericToken(m);
    if (n == null) return m;
    return formatNumberId(n, 2);
  });
}

function buildTemplate(req: InsightRequest, summary?: PreviewSummary): InsightResponse {
  const q = safeTrim(req.q, 300);
  const source = safeTrim(req.preview?.source, 200) || "-";
  const period = safeTrim(req.preview?.period, 120) || "-";
  const type = safeTrim(req.preview?.type, 40) || "dynamic";
  const geo = safeTrim(req.preview?.geo, 80);
  const month = typeof req.preview?.month === "number" ? req.preview?.month : null;
  const lastUpdate = safeTrim(req.preview?.last_update, 40);
  const rowsCount = typeof (summary as any)?.rowsConsidered === 'number'
    ? Number((summary as any).rowsConsidered)
    : (Array.isArray(req.preview?.sampleRows) ? req.preview!.sampleRows!.length : 0);

  const bullets: string[] = [];

  const place = geo ? ` pada kabupaten/kota ${geo}` : "";
  const unit = summary?.metricUnitHint ? ` ${summary.metricUnitHint}` : "";
  const metric = summary?.primaryMetricLabel || summary?.primaryMetricKey || "";
  const metricMeaning = summary?.primaryMetricMeaning ? ` ${summary.primaryMetricMeaning}` : "";
  const available = Array.isArray((summary as any)?.availableMetrics)
    ? (((summary as any).availableMetrics as any[]) || [])
    : [];
  const hasGrowthGlossary = available.some((m) => {
    const k = String(m?.key || '').toLowerCase();
    return k.includes('c-to-c') || k.includes('q-to-q') || k.includes('y-on-y');
  });
  const querySentence = q ? ` Pencarian dilakukan dengan kata kunci "${q}".` : "";
  const monthSentence = month ? ` Tampilan saat ini difilter untuk bulan ke-${month}.` : "";

  const overviewParts: string[] = [];
  overviewParts.push(`Ringkasan ini merangkum ${source}${place} untuk periode ${period}.`);
  if (metric) overviewParts.push(`Metrik utama yang digunakan adalah ${metric}.${metricMeaning}`.trim());
  if (hasGrowthGlossary) {
    overviewParts.push('Glosarium: c-to-c (cumulative-to-cumulative), q-to-q (quarter-to-quarter), y-on-y (year-on-year).');
  }
  if (querySentence) overviewParts.push(querySentence.trim());
  bullets.push(overviewParts.join(' '));

  if (summary?.kind === "timeseries") {
    const s = summary as SummaryTimeSeries;

    // Bullet 2: latest + recent change
    const latestParts: string[] = [];
    if (s.latest?.period && typeof s.latest.value === "number") {
      const m = s.primaryMetricLabel || s.primaryMetricKey || s.valueKey || "nilai";
      latestParts.push(
        `Nilai terbaru pada ${s.latest.period} tercatat sebesar ${formatMetricValue(
          s.latest.value,
          String(s.primaryMetricKey || m),
          s.metricUnitHint
        )} untuk metrik ${m}.`
      );
    }
    if (s.recentChange?.from && s.recentChange?.to && typeof s.recentChange.delta === "number") {
      const pct = typeof s.recentChange.pct === "number" ? ` (${formatNumberId(s.recentChange.pct, 2)}%)` : "";
      latestParts.push(
        `Dibanding ${s.recentChange.from}, perubahan pada ${s.recentChange.to} adalah ${formatMetricValue(
          s.recentChange.delta,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}${pct}.`
      );
    }
    if (latestParts.length > 0) bullets.push(latestParts.join(' '));

    // Bullet 3: trend + extremes
    const trendParts: string[] = [];
    if (s.trend?.direction && s.trend.from && s.trend.to) {
      trendParts.push(`Dalam rentang ${s.trend.from} hingga ${s.trend.to}, pergerakan nilai cenderung ${s.trend.direction}.`);
    }
    if (s.max?.period && typeof s.max.value === "number" && s.latest?.period) {
      const isAtMax = s.latest?.period === s.max.period;
      trendParts.push(
        `${isAtMax ? "Nilai terbaru juga merupakan puncak" : "Puncak tertinggi"} terjadi pada ${s.max.period} dengan nilai ${formatMetricValue(
          s.max.value,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    }
    if (s.min?.period && typeof s.min.value === "number") {
      trendParts.push(
        `Titik terendah berada pada ${s.min.period} dengan nilai ${formatMetricValue(
          s.min.value,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    }
    if (trendParts.length > 0) bullets.push(trendParts.join(' '));

    // Bullet 4: coverage + update notes
    const contextParts: string[] = [];
    if (s.range?.start && s.range?.end) contextParts.push(`Cakupan data tersedia dari ${s.range.start} sampai ${s.range.end}.`);
    if (s.biggestIncrease?.from && s.biggestIncrease?.to && typeof s.biggestIncrease.delta === "number") {
      contextParts.push(
        `Kenaikan terbesar terjadi dari ${s.biggestIncrease.from} ke ${s.biggestIncrease.to} sebesar ${formatMetricValue(
          s.biggestIncrease.delta,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    } else if (s.change?.from && s.change?.to && typeof s.change.delta === "number") {
      contextParts.push(
        `Secara agregat dari ${s.change.from} ke ${s.change.to}, perubahan totalnya adalah ${formatMetricValue(
          s.change.delta,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    }
    if (monthSentence) contextParts.push(monthSentence.trim());
    if (rowsCount > 0) contextParts.push(`Ringkasan ini dihitung dari sekitar ${rowsCount} baris data.`);
    if (lastUpdate) contextParts.push(`Pembaruan terakhir tercatat pada ${lastUpdate}.`);
    if (contextParts.length > 0) bullets.push(contextParts.join(' '));

    // Bullet 5: biggest decrease + average (when available)
    const extra5: string[] = [];
    if (s.biggestDecrease?.from && s.biggestDecrease?.to && typeof s.biggestDecrease.delta === 'number') {
      extra5.push(
        `Penurunan terbesar terjadi dari ${s.biggestDecrease.from} ke ${s.biggestDecrease.to} sebesar ${formatMetricValue(
          s.biggestDecrease.delta,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    }
    if (typeof s.avg === 'number') {
      extra5.push(
        `Rata-rata pada rentang yang tersedia berada di sekitar ${formatMetricValue(
          s.avg,
          String(s.primaryMetricKey || ''),
          s.metricUnitHint
        )}.`
      );
    }
    if (extra5.length > 0) bullets.push(extra5.join(' '));

    // Bullet 6: secondary metric (e.g. YoY) or data quality note
    const extra6: string[] = [];
    if (s.secondaryMetric?.allowed && s.secondaryMetric?.latest?.period && typeof s.secondaryMetric.latest.value === 'number') {
      const mm = s.secondaryMetric.label || s.secondaryMetric.key;
      extra6.push(
        `Sebagai konteks tambahan, ${mm} pada ${s.secondaryMetric.latest.period} tercatat ${formatMetricValue(
          s.secondaryMetric.latest.value,
          String(s.secondaryMetric.key || ''),
          s.secondaryMetric.unitHint
        )}.`
      );
    } else if (typeof s.missingValues === 'number' && s.missingValues > 0) {
      extra6.push(`Sebagian nilai pada rentang periode tidak terisi; interpretasi mengikuti data yang tersedia.`);
    }
    if (extra6.length > 0) bullets.push(extra6.join(' '));
  } else if (summary?.kind === "categorical") {
    const s = summary as SummaryCategorical;
    const metric = s.primaryMetricLabel || s.primaryMetricKey || s.valueKey || "nilai";
    const unit = s.metricUnitHint ? ` ${s.metricUnitHint}` : "";
    if (Array.isArray(s.top) && s.top.length > 0) {
      const metricKey = String(s.primaryMetricKey || metric);
      const top3 = s.top
        .slice(0, 3)
        .map((t) => `${t.label} (${formatMetricValue(t.value, metricKey, s.metricUnitHint)})`)
        .join(", ");
      const topMore = s.top.length > 3 ? " dan beberapa kategori lainnya" : "";
      bullets.push(`Kategori dengan nilai terbesar pada metrik ${metric} terlihat pada ${top3}${topMore}. Ini membantu mengidentifikasi kontributor utama pada periode yang dipilih.`);

      // Bullet 3: share/ratio (best-effort)
      const total = typeof s.totalValue === 'number' ? s.totalValue : null;
      const v1 = typeof s.top?.[0]?.value === 'number' ? s.top[0].value : null;
      const v2 = typeof s.top?.[1]?.value === 'number' ? s.top[1].value : null;
      const shareParts: string[] = [];
      if (total && v1 != null && total > 0) {
        const pct = (v1 / total) * 100;
        shareParts.push(`Kontributor terbesar menyumbang sekitar ${formatNumberId(pct, 2)}% dari total ${metric}${unit}.`);
      }
      if (v1 != null && v2 != null && v2 !== 0) {
        const ratio = v1 / v2;
        if (Number.isFinite(ratio)) {
          shareParts.push(`Nilai terbesar sekitar ${formatNumberId(ratio, 2)}x dibanding peringkat kedua.`);
        }
      }
      if (shareParts.length > 0) bullets.push(shareParts.join(' '));

      // Bullet 4: coverage/diversity note
      const diversityParts: string[] = [];
      if (typeof s.distinctLabels === 'number' && s.distinctLabels > 0) {
        diversityParts.push(`Terdapat sekitar ${s.distinctLabels} kategori unik pada hasil yang terbaca.`);
      }
      if (total && total > 0) {
        diversityParts.push(`Total agregat ${metric}${unit} pada periode ini sekitar ${formatMetricValue(total, metricKey, s.metricUnitHint)}.`);
      }
      if (diversityParts.length > 0) bullets.push(diversityParts.join(' '));
    }

    const contextParts: string[] = [];
    if (monthSentence) contextParts.push(monthSentence.trim());
    if (rowsCount > 0) contextParts.push(`Ringkasan ini dihitung dari sekitar ${rowsCount} baris data.`);
    if (lastUpdate) contextParts.push(`Pembaruan terakhir tercatat pada ${lastUpdate}.`);
    if (contextParts.length > 0) bullets.push(contextParts.join(' '));

    // Bullet 6: cautionary note
    bullets.push(`Interpretasi ini bersifat ringkas; gunakan tabel untuk melihat rincian per kategori.`);
  } else {
    const miscParts: string[] = [];
    miscParts.push(`Jenis data yang terdeteksi adalah ${type}.`);
    if (monthSentence) miscParts.push(monthSentence.trim());
    if (rowsCount > 0) miscParts.push(`Ringkasan ini dihitung dari sekitar ${rowsCount} baris data.`);
    if (lastUpdate) miscParts.push(`Pembaruan terakhir tercatat pada ${lastUpdate}.`);
    bullets.push(miscParts.join(' '));

    // Fill to target with neutral bullets.
    bullets.push(`Pastikan konteks periode dan filter sudah sesuai sebelum menarik kesimpulan.`);
    bullets.push(`Jika tersedia, coba ubah metrik/grafik untuk melihat pola yang berbeda.`);
    bullets.push(`Interpretasi ini bersifat ringkas; cek tabel untuk rincian lengkap.`);
  }

  // Ensure we don't flood the UI.
  const bulletsFinal = bullets
    .map((b) => cutNoEllipsis(String(b || "").trim(), 260))
    .filter(Boolean)
    .slice(0, INSIGHTS_BULLET_TARGET);

  // Build insights array from bullets for new format
  const icons = ["📊", "⚡", "📈", "🔺", "🔻", "🔍", "📋"];
  const labels = ["Nilai Terkini", "Perubahan", "Tren", "Tertinggi", "Terendah", "Temuan", "Cakupan"];
  const insights: InsightItem[] = bulletsFinal.map((text, idx) => ({
    icon: icons[idx] || "📊",
    label: labels[idx] || "Insight",
    text,
  }));

  // Build headline from summary if available
  const headline = (() => {
    if (summary?.kind === "timeseries") {
      const s = summary as SummaryTimeSeries;
      if (s.latest?.value != null && s.latest?.period) {
        const val = formatMetricValue(s.latest.value, String(s.primaryMetricKey || ''), s.metricUnitHint);
        const change = s.recentChange?.pct != null 
          ? ` (${s.recentChange.pct >= 0 ? '+' : ''}${formatNumberId(s.recentChange.pct, 2)}%)`
          : '';
        return `${val}${change}`;
      }
    }
    return undefined;
  })();

  const subheadline = period !== "-" ? `Data ${period}` : undefined;

  // Determine confidence based on data quality
  const confidence = (() => {
    if (!summary) return "low" as const;
    const rows = (summary as any)?.rowsConsidered || 0;
    const missing = (summary as any)?.missingValues || 0;
    if (rows > 20 && missing < rows * 0.1) return "high" as const;
    if (rows > 10) return "medium" as const;
    return "low" as const;
  })();

  const methodology = rowsCount > 0 
    ? `Dihitung dari ${rowsCount} titik data${lastUpdate ? `, pembaruan ${lastUpdate}` : ''}`
    : undefined;

  return {
    ok: true,
    mode: "template",
    interpretation: {
      // Use a very high limit so title doesn't get ellipsized in UI.
      title:
        String(req.preview?.source ?? "").trim() && String(req.preview?.period ?? "").trim()
          ? safeTrim(`Ringkasan ${String(req.preview?.source ?? "").trim()} ${String(req.preview?.period ?? "").trim()}`, 2000)
          : "Interpretasi (ringkas)",
      headline,
      subheadline,
      insights,
      bullets: bulletsFinal, // backward compatibility
      methodology,
      confidence,
      disclaimer: "Catatan: interpretasi ini bersifat ringkas. Pastikan membaca tabel untuk detail lengkap.",
    },
    chart: {
      recommended: req.chart?.recommended,
      reason: req.chart?.recommended ? "Rekomendasi chart otomatis berbasis struktur data." : undefined,
      labelKey: req.chart?.labelKey,
      valueKey: req.chart?.valueKey,
    },
  };
}

function fillBulletsToTarget(args: { primary: string[]; fallback: string[]; target: number }) {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (b: string) => {
    const k = normTextLoose(b);
    if (!k) return;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(b);
  };

  for (const b of args.primary) {
    push(b);
    if (out.length >= args.target) return out.slice(0, args.target);
  }
  for (const b of args.fallback) {
    push(b);
    if (out.length >= args.target) return out.slice(0, args.target);
  }

  return out.slice(0, args.target);
}

function getOpenAIKey() {
  // Prefer dedicated key for interpretation; fall back to chat key.
  return process.env.OPENAI_API_KEY_INTERPRETATION || process.env.OPENAI_API_KEY_CHAT || "";
}

function getOpenAIModel() {
  // Prefer dedicated model for interpretation; fall back to chat model.
  return process.env.OPENAI_MODEL_INTERPRETATION || process.env.OPENAI_MODEL_CHAT || "gpt-4.1-mini";
}

function extractJsonObject(text: string) {
  const s = String(text || "").trim();
  if (!s) return "";
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return "";
  return s.slice(start, end + 1);
}

function containsMonthNameId(s: string) {
  return /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(
    String(s || "")
  );
}

const MONTHS_ID: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  ags: 8,
  agustus: 8,
  sep: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
};

function monthNoToIdName(month: number) {
  const names = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return names[month - 1] || String(month);
}

function parseYearMonthFromText(text: string): YearMonth | null {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return null;

  // Year-only
  const yOnly = s.match(/^\s*(19\d{2}|20\d{2}|2100)\s*$/);
  if (yOnly) {
    const year = Number(yOnly[1]);
    return formatYearOnly(year);
  }

  const iso = s.match(/\b(19\d{2}|20\d{2}|2100)[-\/\.](\d{1,2})(?:[-\/\.](\d{1,2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      return { year, month, key: year * 100 + month, label: `${monthNoToIdName(month)} ${year}` };
    }
  }

  const m1 = s.match(/\b([a-z]+)\s+(19\d{2}|20\d{2}|2100)\b/);
  if (m1) {
    const month = MONTHS_ID[m1[1]];
    const year = Number(m1[2]);
    if (month && year) return { year, month, key: year * 100 + month, label: `${monthNoToIdName(month)} ${year}` };
  }

  const m2 = s.match(/\b(19\d{2}|20\d{2}|2100)\s+([a-z]+)\b/);
  if (m2) {
    const year = Number(m2[1]);
    const month = MONTHS_ID[m2[2]];
    if (month && year) return { year, month, key: year * 100 + month, label: `${monthNoToIdName(month)} ${year}` };
  }

  return null;
}

function hasMonthWordWithoutYear(text: string) {
  const s = String(text || "").toLowerCase();
  const monthWord = /\b(jan|feb|mar|apr|mei|jun|jul|agu|ags|sep|okt|nov|des|januari|februari|maret|april|agustus|september|oktober|november|desember)\b/;
  const year = /\b(19\d{2}|20\d{2}|2100)\b/;
  return monthWord.test(s) && !year.test(s);
}

function extractAvailableYears(dataRows: Array<Record<string, unknown>>, columns: string[]): number[] {
  const yearSet = new Set<number>();
  const yearCol = columns.find((c) => isAxisYearColumn(String(c))) || "";
  for (const r of dataRows) {
    const yy = normalizeYear((r as any)?.__preview_year);
    if (yy) yearSet.add(yy);
    if (yearCol) {
      const normalized = normalizeYear((r as any)?.[yearCol]);
      if (normalized) yearSet.add(normalized);
    }
  }
  return Array.from(yearSet).sort((a, b) => a - b);
}

function buildYearMonthRangeFromRows(dataRows: Array<Record<string, unknown>>, columns: string[]): {
  min?: YearMonth;
  max?: YearMonth;
  periods?: string[];
} {
  const yearCol = columns.find((c) => isAxisYearColumn(String(c))) || "";
  const monthCol = columns.find((c) => isAxisMonthColumn(String(c))) || "";
  const periodCol = columns.find((c) => isAxisPeriodColumn(String(c))) || "";

  const list: YearMonth[] = [];
  for (const r of dataRows) {
    const yy = normalizeYear((r as any)?.__preview_year);
    if (yy) list.push(formatYearOnly(yy));
    if (periodCol) {
      const parsed = parseYearMonthFromText(String((r as any)?.[periodCol] ?? ""));
      if (parsed) list.push(parsed);
    }
    if (yearCol && monthCol) {
      const y = normalizeYear((r as any)?.[yearCol]);
      const m = Number(String((r as any)?.[monthCol] ?? "").trim());
      if (Number.isFinite(m) && m >= 1 && m <= 12 && y) {
        list.push({ year: y, month: m, key: y * 100 + m, label: `${monthNoToIdName(m)} ${y}` });
      }
    }
  }

  const uniq = new Map<number, YearMonth>();
  for (const ym of list) uniq.set(ym.key, ym);
  const arr = Array.from(uniq.values()).sort((a, b) => a.key - b.key);
  return {
    min: arr[0],
    max: arr[arr.length - 1],
    periods: arr.map((x) => x.label).slice(0, 40),
  };
}

function bulletHasTimeContext(text: string) {
  if (!text) return false;
  if (containsMonthNameId(text)) return true;
  if (extractYears(text).length >= 1) return true;
  return false;
}

function bulletHasNumber(text: string) {
  const s = String(text || "");
  // Any digit; keep it simple and robust for id-ID decimals.
  return /\d/.test(s);
}

function appendTimeContextIfMissing(text: string, context: string) {
  if (!text) return text;
  if (!context) return text;
  if (!bulletHasNumber(text)) return text;
  if (bulletHasTimeContext(text)) return text;
  return `${text} pada ${context}.`;
}

function inferContextPeriodLabel(periodText: string, range?: { min?: YearMonth; max?: YearMonth }) {
  const p = String(periodText || "").trim();
  if (p) {
    // If period already contains month+year or a year, we can reuse it.
    if (containsMonthNameId(p) || extractYears(p).length >= 1) return p;
  }
  if (range?.max?.label) return range.max.label;
  if (range?.min?.label && range?.max?.label) return `${range.min.label}–${range.max.label}`;
  return "";
}

function isSinglePeriodRange(range?: { min?: YearMonth; max?: YearMonth }) {
  const minKey = range?.min?.key;
  const maxKey = range?.max?.key;
  if (typeof minKey !== 'number' || typeof maxKey !== 'number') return false;
  return minKey === maxKey;
}

function validateAiBullets(bullets: string[], range?: { min?: YearMonth; max?: YearMonth }) {
  const minKey = range?.min?.key;
  const maxKey = range?.max?.key;

  const singlePeriod = isSinglePeriodRange(range);

  const context = inferContextPeriodLabel("", range);

  const out: string[] = [];
  for (const b of bullets) {
    const textRaw = cutNoEllipsis(b, 260);
    const text = appendTimeContextIfMissing(textRaw, context);
    if (!text) continue;

    // Guardrail: only use "tren" wording when the data spans multiple periods.
    // If we only have a single point, keep interpretation factual (values) without trend claims.
    if (singlePeriod && /\b(tren|trend|cenderung)\b/i.test(text)) continue;

    // Enforce: month mention must include year.
    if (hasMonthWordWithoutYear(text)) continue;

    // If bullet contains a month-year, ensure it's within range.
    const ym = parseYearMonthFromText(text);
    if (ym && minKey && maxKey) {
      if (ym.key < minKey || ym.key > maxKey) continue;
    }

    out.push(text);
    if (out.length >= 10) break;
  }

  return out;
}

function stripYoYBullets(bullets: string[]) {
  const out: string[] = [];
  for (const b of bullets) {
    const s = String(b || "");
    if (/\b(yoy|year\s*-?on\s*-?year|year\s+on\s+year|year-on-year)\b/i.test(s)) continue;
    out.push(b);
  }
  return out;
}

function normTextLoose(input: string) {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pickTemplateLatestBullet(templateBullets: string[]) {
  for (const b of templateBullets) {
    const s = normTextLoose(b);
    if (s.includes("nilai terbaru")) return b;
  }
  return "";
}

function dropConflictingLatestBullets(aiBullets: string[], latestPeriodLabel: string) {
  const latestNorm = normTextLoose(latestPeriodLabel);
  if (!latestNorm) return aiBullets;
  return aiBullets.filter((b) => {
    const s = normTextLoose(b);
    // If the bullet claims "terbaru" but doesn't mention the deterministically-known latest period,
    // drop it to avoid October-vs-November mismatches.
    const claimsLatest = s.includes("nilai terbaru") || /\bterbaru\b/i.test(s);
    if (!claimsLatest) return true;
    return s.includes(latestNorm);
  });
}

function injectLatestBullet(args: { aiBullets: string[]; templateBullets: string[]; latestPeriodLabel: string }) {
  const latestNorm = normTextLoose(args.latestPeriodLabel);
  if (!latestNorm) return args.aiBullets;
  const templateLatest = pickTemplateLatestBullet(args.templateBullets);
  if (!templateLatest) return args.aiBullets;
  const alreadyHas = args.aiBullets.some((b) => normTextLoose(b).includes(latestNorm) && normTextLoose(b).includes("nilai terbaru"));
  if (alreadyHas) return args.aiBullets;

  const out: string[] = [];
  if (args.aiBullets.length > 0) out.push(args.aiBullets[0]);
  out.push(templateLatest);
  for (const b of args.aiBullets.slice(1)) out.push(b);

  // De-dup by normalized string.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const b of out) {
    const k = normTextLoose(b);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(b);
    if (deduped.length >= 8) break;
  }
  return deduped;
}

function extractYears(text: string) {
  const s = String(text || "");
  const years = Array.from(s.matchAll(/\b(19\d{2}|20\d{2}|2100)\b/g)).map((m) => String(m[1] || "").trim());
  return Array.from(new Set(years));
}

export async function POST(request: NextRequest) {
  let body: InsightRequest = {};
  try {
    body = (await request.json()) as InsightRequest;
  } catch {
    return Response.json({
      ok: false,
      mode: "template",
      interpretation: {
        title: "Interpretasi (ringkas)",
        bullets: ["Request tidak valid."],
      },
      error: "invalid_json",
    } as InsightResponse);
  }

  const key = getOpenAIKey();

  // Use client-side data when flagged (ensures interpretation matches displayed table)
  // Skip server re-fetch to guarantee consistency with what user sees
  let previewColumns = Array.isArray(body.preview?.columns) ? body.preview!.columns! : [];
  let sampleRows = Array.isArray(body.preview?.sampleRows) ? body.preview!.sampleRows! : [];
  const useClientData = body.preview?.useClientData === true;

  // Only fetch server-side if not using client data
  if (!useClientData) {
    try {
      if (body.dataset && body.dataset.source_id) {
        const fetched = await fetchFullDataset(body.dataset);
        const dataObj = fetched && typeof fetched === 'object' ? ((fetched as any).data ?? null) : null;
        const cols = Array.isArray(dataObj?.columns) ? (dataObj.columns as string[]) : [];
        const rows = Array.isArray(dataObj?.data) ? (dataObj.data as Array<Record<string, unknown>>) : [];

        if (cols.length > 0 && rows.length > 0) {
          // Apply optional month filter (for endpoints that don't natively support it).
          const monthWanted = toIntMonth(body.dataset.month);
          if (monthWanted) {
            const monthCol = cols.find((c) => isAxisMonthColumn(String(c))) || '';
            if (monthCol) {
              const filtered = rows.filter((r) => monthFromCell((r as any)?.[monthCol]) === monthWanted);
              if (filtered.length > 0) sampleRows = filtered;
              else sampleRows = rows;
            } else {
              sampleRows = rows;
            }
          } else {
            sampleRows = rows;
          }

          // Apply optional geo filter (best-effort) so interpretation follows the displayed subset.
          const geoNorm = normGeoLoose(body.dataset.geo);
          if (geoNorm) {
            const geoCol = findGeoColumnLoose(cols);
            if (geoCol) {
              const filtered = sampleRows.filter((r) => matchesGeoCellLoose((r as any)?.[geoCol], geoNorm));
              if (filtered.length > 0) sampleRows = filtered;
            }
          }

          previewColumns = cols;

          // Prefer backend-derived labels for accuracy.
          if (!body.preview) body.preview = {};
          if (!body.preview.source && typeof dataObj?.source === 'string') body.preview.source = dataObj.source;
          if (!body.preview.period && typeof dataObj?.period === 'string') body.preview.period = dataObj.period;
          if (!body.preview.last_update && (typeof dataObj?.last_update === 'string' || dataObj?.last_update === null)) {
            body.preview.last_update = dataObj.last_update;
          }
          if (!body.preview.type && body.dataset?.type) body.preview.type = String(body.dataset.type);
        }
      }
    } catch {
      // Fall through to use client-provided data
    }
  }

  const summary = summarizePreview(previewColumns, sampleRows);
  const template = buildTemplate(body, summary);

  const disallowYoY =
    summary?.kind === "timeseries" &&
    !!(summary as SummaryTimeSeries).secondaryMetric?.key &&
    isYoYMetricKey(String((summary as SummaryTimeSeries).secondaryMetric?.key || "")) &&
    (summary as SummaryTimeSeries).secondaryMetric?.allowed === false;

  if (!key) return Response.json(template);

  const model = getOpenAIModel();
  const ymRange = buildYearMonthRangeFromRows(sampleRows, previewColumns);
  const contextPeriod = inferContextPeriodLabel(String(body.preview?.period ?? ""), ymRange);
  const singlePeriod = isSinglePeriodRange(ymRange);

  // Detect if the requested year is unavailable → fallback to available range with focus on latest year.
  const queryYears = extractYears(String(body.q || ""))
    .map((y) => Number(String(y || '').trim()))
    .filter((y) => Number.isFinite(y) && y >= 1900 && y <= 2100)
    .sort((a, b) => a - b);
  const requestedYearFromQuery = queryYears.length > 0 ? queryYears[queryYears.length - 1] : null;

  const availableYearsFromClient = Array.isArray(body.preview?.availableYears)
    ? body.preview!.availableYears!
        .map((y) => Number(String(y || '').trim()))
        .filter((y) => Number.isFinite(y) && y >= 1900 && y <= 2100)
        .sort((a, b) => a - b)
    : [];

  const availableYears = availableYearsFromClient.length > 0 ? availableYearsFromClient : extractAvailableYears(sampleRows, previewColumns);
  const focusYear = availableYears.length > 0 ? availableYears[availableYears.length - 1] : null;

  const requestedYearUnavailable = !!(requestedYearFromQuery && availableYears.length > 0 && !availableYears.includes(requestedYearFromQuery));
  const noYearInQuery = queryYears.length === 0;

  const yearRangeFallbackNote = (() => {
    if (!focusYear || availableYears.length === 0) return "";
    const minYear = availableYears[0];
    const maxYear = availableYears[availableYears.length - 1];
    const rangeLabel = minYear === maxYear ? `${maxYear}` : `${minYear}–${maxYear}`;

    if (requestedYearUnavailable && requestedYearFromQuery) {
      return `Data tahun ${requestedYearFromQuery} belum tersedia; analisis difokuskan pada tahun ${focusYear} (terbaru) dari rentang ${rangeLabel}.`;
    }
    if (noYearInQuery) {
      return `Analisis mencakup rentang data ${rangeLabel} dengan fokus pada tahun ${focusYear} (terbaru).`;
    }
    return "";
  })();

  // Keep payload small + safe.
  // Use explicit unit from database if available, fallback to heuristic extraction from source name
  const heuristicUnit = extractScaleFromSourceName(body.preview?.source);
  const sourceScaleHint = body.preview?.unit || heuristicUnit;
  
  // === SERVER-SIDE DATA NORMALIZATION ===
  // Normalize mixed-scale data BEFORE sending to AI
  const normalization = normalizeDataRows(sampleRows, sourceScaleHint);
  const normalizedRows = normalization.rows;
  
  // Detect label column for geo aggregates (Maluku Utara specific)
  const labelColumn = body.chart?.labelKey || previewColumns.find(c => 
    /wilayah|region|kab|kota|provinsi|area/i.test(c)
  );
  const geoInfo = detectMalukuUtaraAggregate(normalizedRows, labelColumn);
  
  const safePayload = {
    q: safeTrim(body.q, 280),
    preview: {
      source: safeTrim(body.preview?.source, 200),
      sourceScaleHint: sourceScaleHint || undefined,
      period: safeTrim(body.preview?.period, 120),
      last_update: safeTrim(body.preview?.last_update, 40) || null,
      type: safeTrim(body.preview?.type, 40),
      geo: safeTrim(body.preview?.geo, 80),
      month: typeof body.preview?.month === "number" ? body.preview?.month : null,
      columns: previewColumns.map((c) => safeTrim(c, 80)),
      // Send NORMALIZED rows to AI for consistent analysis
      dataRows: normalizedRows,
      // Include normalization metadata so AI knows what was done
      normalization: normalization.normalized ? {
        applied: true,
        details: normalization.details,
        scaleFactor: normalization.scaleFactor,
      } : undefined,
      summary,
      // Aggregate detection for geo data (Maluku Utara)
      hasGeoMix: geoInfo.hasGeoMix || undefined,
      inferred_period_range:
        ymRange.min && ymRange.max
          ? {
              min: ymRange.min.label,
              max: ymRange.max.label,
              periods_sample: ymRange.periods || [],
            }
          : undefined,
    },
    chart: {
      recommended: body.chart?.recommended,
      labelKey: safeTrim(body.chart?.labelKey, 80),
      valueKey: safeTrim(body.chart?.valueKey, 80),
    },
  };

  const isCategorical = summary?.kind === 'categorical';
  const hasExtraMetrics = Array.isArray((summary as any)?.extraMetrics) && ((summary as any).extraMetrics as any[]).length > 0;
  
  // Geo aggregate rule for Maluku Utara
  const geoAggregateRule = geoInfo.hasGeoMix
    ? "Jika ada baris 'Maluku Utara' atau 'Total' bersama kabupaten/kota, sebutkan sebagai total provinsi terpisah. JANGAN masukkan provinsi dalam daftar '3 terbesar'."
    : "";

  // Build structured system prompt
  const system = `Anda adalah analis data BPS Provinsi Maluku Utara.

TUGAS: Buat interpretasi data statistik yang informatif dan mudah dipahami.

ATURAN MEMBACA INPUT:
- Angka dalam payload menggunakan format internasional: titik (.) adalah DESIMAL, bukan ribuan
- Contoh: 1319.338 berarti seribu tiga ratus sembilan belas koma tiga puluh delapan
- Jika satuan "ribu jiwa": nilai 1319.338 = 1.319.338 orang = sekitar 1,32 JUTA jiwa
- Jika satuan "juta rupiah": nilai 500.25 = Rp500,25 juta

ATURAN FORMAT OUTPUT:
- Pemisah ribuan: titik (.)
- Pemisah desimal: koma (,)
- Bulatkan ke 2 desimal
- Konversi ke satuan lebih besar untuk keterbacaan:
  * ribu jiwa → juta jiwa jika > 1000 (contoh: 1319 ribu = 1,32 juta)
  * juta rupiah → miliar rupiah jika > 1000
  * dst.
- Volume kg: boleh konversi ke ton jika > 1000

ATURAN SATUAN:
${sourceScaleHint ? `- Data ini dalam satuan "${sourceScaleHint}" - WAJIB konversi ke satuan lebih besar jika nilai > 1000` : '- Sebutkan satuan jika diketahui dari konteks'}

ATURAN DATA DEMOGRAFI (kelompok umur/jenis kelamin):
- Jika ada kolom "Kelompok Umur" atau breakdown per usia: CARI baris TOTAL atau jumlahkan semua usia
- Jika ada kolom "Jenis Kelamin": CARI baris TOTAL atau jumlahkan Laki-laki + Perempuan
- Untuk headline: gunakan TOTAL populasi, bukan per-kategori
- Untuk perbandingan antar tahun: bandingkan TOTAL tahun X vs TOTAL tahun Y
- JANGAN bandingkan "0-4 tahun" di 2023 vs "Total" di 2024

GLOSARIUM METRIK:
- c-to-c: cumulative vs cumulative periode sama tahun lalu
- q-to-q: kuartal vs kuartal sebelumnya  
- y-on-y: tahun vs tahun sebelumnya
- m-to-m: bulan vs bulan sebelumnya

GAYA PENULISAN:
- Semi-formal, profesional tapi mudah dipahami
- Kalimat naratif utuh, HINDARI format "Label: nilai"
- Sebutkan bulan+tahun lengkap untuk setiap angka
- Langsung ke temuan, JANGAN awali dengan "pengguna bertanya" atau "data menunjukkan"
${geoAggregateRule ? `- ${geoAggregateRule}` : ''}
${singlePeriod ? '- SINGLE PERIOD: Jangan gunakan kata "tren". Fokus pada nilai periode tersebut.' : ''}

PRINSIP UTAMA:
1. Gunakan HANYA data dari preview.dataRows (SEMUA baris data yang ditampilkan) dan preview.summary
2. Setiap angka WAJIB disertai periode waktu
3. Jangan mengarang fakta yang tidak ada di payload
4. Analisis SELURUH data dalam dataRows - ini adalah data LENGKAP bukan sample
${hasExtraMetrics ? '5. Jika ada extraMetrics, sertakan minimal 1 nilai konkret' : ''}

PROSES CROSS-CHECK 3x (WAJIB):
Sebelum menghasilkan output, lakukan verifikasi 3 kali:

=== VERIFIKASI 1: CEK NORMALISASI ===
LANGKAH 0 - DETEKSI PERIODE:
- Scan SEMUA baris dataRows dan kumpulkan nilai unik __preview_year
- Catat tahun pertama dan tahun terakhir dari data
- Ini WAJIB disebutkan di bagian CAKUPAN

LANGKAH 0.5 - CEK METADATA NORMALISASI:
- Jika preview.normalization.applied === true, data SUDAH dinormalisasi server-side
- Sebutkan preview.normalization.details di bagian TEMUAN jika ada
- Semua nilai dalam dataRows sudah dalam skala yang KONSISTEN - gunakan langsung

=== VERIFIKASI 2: VALIDASI ANGKA ===
LANGKAH 1 - HITUNG:
- Hitung nilai tertinggi/terendah dari dataRows (data sudah ternormalisasi)
- Pastikan perubahan (delta) dihitung dari periode berurutan yang benar
- Untuk mencari total: cari baris "Jumlah/Total", "Indonesia", "Total", atau "Jumlah"

LANGKAH 1.5 - KONFIRMASI PERHITUNGAN:
- Cek: Apakah tertinggi > terendah? (Jika tidak, ada kesalahan)
- Cek: Apakah perubahan tahunan wajar (1-5% untuk penduduk)?
- Cek: Apakah semua angka yang disebutkan ada di dataRows?

=== VERIFIKASI 3: VALIDASI LOGIKA ===
LANGKAH 2 - CEK KONSISTENSI:
- Jika data per kelompok umur/gender, fokus pada baris TOTAL/agregat
- JANGAN bandingkan baris berbeda kategori
- Untuk data penduduk: perubahan >10%/tahun = ANOMALI, sebutkan

LANGKAH 2.5 - REVIEW AKHIR:
- Baca ulang semua insight yang akan dihasilkan
- Pastikan setiap angka memiliki periode waktu
- Pastikan tidak ada kontradiksi antar insight
- Jika menemukan inkonsistensi, perbaiki sebelum output

OUTPUT: Kembalikan STRICT JSON sesuai schema HANYA setelah 3x verifikasi selesai.`;

  // Build structured user prompt
  const dataContext = `
KONTEKS DATA:
- Indikator: ${safeTrim(body.preview?.source, 200) || 'Tidak diketahui'}
- Periode: ${safeTrim(body.preview?.period, 120) || contextPeriod || 'Tidak diketahui'}
${sourceScaleHint ? `- Satuan: ${sourceScaleHint}` : ''}
${body.preview?.geo ? `- Wilayah: ${safeTrim(body.preview.geo, 80)}` : ''}
${yearRangeFallbackNote ? `- Catatan: ${yearRangeFallbackNote}` : ''}`;

  const insightStructure = isCategorical
    ? `STRUKTUR INSIGHT (5-7 poin):
1. 📊 NILAI TERKINI - Total agregat provinsi/keseluruhan dengan periode
2. 🏆 TOP 3 - Tiga kabupaten/kota terbesar dengan nilai dan proporsi
3. 📉 BOTTOM 3 - Tiga kabupaten/kota terkecil
4. ⚖️ PERBANDINGAN - Rasio antar wilayah (terbesar vs terkecil)
5. 🔍 TEMUAN - Pola atau insight menarik dari data
6. 📋 CAKUPAN - Jumlah kategori, rentang data, pembaruan terakhir`
    : `STRUKTUR INSIGHT (5-7 poin) - ANALISIS SELURUH PERIODE:

LANGKAH AWAL WAJIB:
1. Ekstrak semua nilai unik __preview_year dari dataRows
2. Untuk setiap tahun, identifikasi baris Total/Jumlah (bisa "Jumlah/Total", "Indonesia", atau "Total")
3. Jika tidak ada baris Total, hitung manual dengan menjumlahkan semua baris
4. DETEKSI perbedaan format antar tahun (whole numbers >100000 vs decimals <10000)
5. NORMALISASI semua nilai ke skala yang sama sebelum analisis

STRUKTUR OUTPUT:
1. 📊 NILAI TERKINI - Angka tahun TERAKHIR dalam data dengan periode eksplisit
2. ⚡ PERUBAHAN - Selisih antara tahun terakhir dan tahun sebelumnya (HARUS bandingkan kategori SAMA)
${singlePeriod ? '' : '3. 📈 TREN - Pola KESELURUHAN dari tahun PERTAMA hingga TERAKHIR dalam data (sebutkan kedua tahun)'}
4. 🔺 TERTINGGI - Nilai puncak sepanjang SELURUH rentang dan tahunnya
5. 🔻 TERENDAH - Nilai minimum sepanjang SELURUH rentang dan tahunnya (abaikan tahun dengan null)
6. 🔍 TEMUAN - Insight dari SEMUA tahun (jika data berubah struktur antar tahun, sebutkan)
7. 📋 CAKUPAN - WAJIB sebutkan: "Data mencakup tahun X sampai tahun Y" (tahun pertama dan terakhir dari __preview_year)`;

  const jsonSchema = `
SCHEMA JSON OUTPUT:
{
  "headline": "angka utama dengan satuan dan perubahan singkat, contoh: 1,35 juta jiwa (+2,3%)",
  "subheadline": "konteks periode singkat, contoh: Data Desember 2025",
  "insights": [
    { "icon": "📊", "label": "Nilai Terkini", "text": "kalimat naratif 2-3 kalimat max 250 karakter" },
    { "icon": "⚡", "label": "Perubahan", "text": "..." },
    ...tambahan sesuai struktur di atas...
  ],
  "methodology": "Dihitung dari X titik data, periode Y sampai Z",
  "confidence": "high" | "medium" | "low",
  "chart": { "recommended": "line" | "bar" | "pie", "reason": "alasan singkat" }
}

ATURAN CONFIDENCE:
- "high": data lengkap, >20 titik data, tidak ada missing value signifikan
- "medium": data cukup, 10-20 titik data, beberapa missing value
- "low": data terbatas, <10 titik data, banyak missing value`;

  const user = `Analisis payload berikut dan hasilkan interpretasi profesional.
${dataContext}
${insightStructure}
${jsonSchema}

PAYLOAD: ${JSON.stringify(safePayload)}`;

  let aiText = "";
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  let lastError: string = "";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutMs = Number(process.env.OPENAI_INTERPRETATION_TIMEOUT_MS || "12000");
      const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        lastError = `openai_http_${res.status}`;
        // Retry on server errors (5xx) and rate limits (429)
        if (res.status >= 500 || res.status === 429) {
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue; // Retry
          }
        }
        // Don't retry on client errors (4xx except 429)
        throw new Error(lastError);
      }

      const json = (await res.json()) as any;
      aiText = String(json?.choices?.[0]?.message?.content ?? "");
      
      if (!aiText || aiText.trim().length === 0) {
        lastError = "openai_empty_response";
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue; // Retry
        }
        throw new Error(lastError);
      }
      
      break; // Success, exit retry loop
    } catch (e: unknown) {
      const isAbort = typeof e === "object" && e !== null && (e as any).name === "AbortError";
      lastError = isAbort ? "openai_timeout" : "openai_fetch_failed";
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue; // Retry
      }
      
      // All retries exhausted
      return Response.json({
        ...buildTemplate(body),
        ok: true,
        mode: "template",
        error: `${lastError}_after_${maxRetries}_retries`,
      } as InsightResponse);
    }
  }

  const extracted = extractJsonObject(aiText);
  if (!extracted) {
    // Retry logic already exhausted at this point, but JSON extraction failed
    // This means we got a response but it wasn't valid JSON
    return Response.json({
      ...buildTemplate(body, summary),
      ok: true,
      mode: "template",
      error: `openai_non_json_after_${maxRetries}_attempts`,
    } as InsightResponse);
  }

  try {
    const parsed = JSON.parse(extracted) as any;
    // Keep the full title visible in UI; avoid short ellipsis trims.
    const aiTitle = safeTrim(parsed?.interpretation?.title, 2000) || "";
    const sourceLabel = safeTrim(body.preview?.source, 200) || "Interpretasi";
    const periodLabel = safeTrim(body.preview?.period, 120) || "";

    const forcedTitle = (() => {
      if (!yearRangeFallbackNote) return "";
      if (!focusYear || availableYears.length === 0) return "";
      const minYear = availableYears[0];
      const maxYear = availableYears[availableYears.length - 1];
      const rangeLabel = minYear === maxYear ? `${maxYear}` : `${minYear}–${maxYear}`;
      return safeTrim(`Ringkasan ${sourceLabel} ${rangeLabel}`, 2000);
    })();

    const periodYears = extractYears(periodLabel);
    const aiYears = extractYears(aiTitle);
    const expectedLastYear = periodYears.length >= 2 ? periodYears[periodYears.length - 1] : "";

    const expectedHasMonths = containsMonthNameId(periodLabel);
    const aiHasMonths = containsMonthNameId(aiTitle);

    // If the requested/displayed period spans multiple years, don't allow the title to omit the end-year.
    const title =
      (expectedLastYear && !aiYears.includes(expectedLastYear)) || (expectedHasMonths && !aiHasMonths)
        ? safeTrim(`Ringkasan ${sourceLabel} ${periodLabel}`, 2000)
        : (aiTitle || safeTrim(`Ringkasan ${sourceLabel} ${periodLabel}`, 2000) || "Interpretasi (AI)");

    const finalTitle =
      forcedTitle ||
      (disallowYoY && /\b(yoy|year\s*-?on\s*-?year|year-on-year)\b/i.test(title)
        ? safeTrim(`Ringkasan ${sourceLabel} ${periodLabel}`, 2000)
        : title);

    // Parse new format fields
    const headline = safeTrim(parsed?.headline, 150) || "";
    const subheadline = safeTrim(parsed?.subheadline, 100) || "";
    const methodology = safeTrim(parsed?.methodology, 200) || "";
    const confidenceRaw = String(parsed?.confidence || "").toLowerCase();
    const confidence = (["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "medium") as "high" | "medium" | "low";

    // Parse insights array (new format)
    const insightsRaw = Array.isArray(parsed?.insights) ? parsed.insights : [];
    const insights: InsightItem[] = insightsRaw
      .filter((i: any) => i && typeof i === "object" && typeof i.text === "string")
      .map((i: any) => ({
        icon: safeTrim(i.icon, 4) || "📊",
        label: safeTrim(i.label, 30) || "Insight",
        text: formatNumbersInTextId(appendTimeContextIfMissing(cutNoEllipsis(String(i.text || ""), 280), contextPeriod)),
      }))
      .filter((i: InsightItem) => i.text.length > 10);

    // Extract bullets from insights for backward compatibility
    const bulletsFromInsights = insights.map((i) => i.text);

    // Also check old format bullets as fallback
    const bulletsRaw = bulletsFromInsights.length > 0 
      ? bulletsFromInsights 
      : (Array.isArray(parsed?.interpretation?.bullets) ? parsed.interpretation.bullets : []);
    const bulletsCleaned = bulletsRaw
      .map((b: any) => appendTimeContextIfMissing(cutNoEllipsis(b, 260), contextPeriod))
      .map((b: any) => formatNumbersInTextId(b))
      .filter(Boolean);
    const bulletsValidated = validateAiBullets(bulletsCleaned, ymRange);

    // Guardrail: AI occasionally mislabels the latest period (e.g., says Oktober when sample includes November).
    // Force "latest" to follow deterministic summary.latest.period.
    const latestPeriodLabel =
      summary?.kind === 'timeseries' ? String((summary as SummaryTimeSeries).latest?.period || '') : '';

    let bulletsGuarded = disallowYoY ? stripYoYBullets(bulletsValidated) : bulletsValidated;
    if (latestPeriodLabel) {
      bulletsGuarded = dropConflictingLatestBullets(bulletsGuarded, latestPeriodLabel);
      bulletsGuarded = injectLatestBullet({
        aiBullets: bulletsGuarded,
        templateBullets: template.interpretation.bullets,
        latestPeriodLabel,
      });
    }

    const bullets = bulletsGuarded;

    const disclaimerBase = safeTrim(parsed?.interpretation?.disclaimer, 200);
    const disclaimer = yearRangeFallbackNote
      ? safeTrim(`${yearRangeFallbackNote}${disclaimerBase ? ` ${disclaimerBase}` : ""}`, 240)
      : disclaimerBase;

    // If AI output is too sparse after validation, fall back to template and report mode accurately.
    if (bullets.length < 3) {
      const fallback: InsightResponse = {
        ...template,
        ok: true,
        mode: "template",
        interpretation: {
          ...template.interpretation,
          title: finalTitle || template.interpretation.title,
          disclaimer: disclaimer || template.interpretation.disclaimer,
        },
        error: "openai_insufficient_bullets",
      };
      return Response.json(fallback);
    }

    const bulletsFilled = fillBulletsToTarget({
      primary: bullets,
      fallback: template.interpretation.bullets,
      target: INSIGHTS_BULLET_TARGET,
    });

    // Build final insights array from bullets if not parsed from new format
    const finalInsights: InsightItem[] = insights.length >= 3 
      ? insights 
      : bulletsFilled.map((text, idx) => {
          const icons = ["📊", "⚡", "📈", "🔺", "🔻", "🔍", "📋"];
          const labels = ["Nilai Terkini", "Perubahan", "Tren", "Tertinggi", "Terendah", "Temuan", "Cakupan"];
          return {
            icon: icons[idx] || "📊",
            label: labels[idx] || "Insight",
            text,
          };
        });

    const out: InsightResponse = {
      ok: true,
      mode: "ai",
      interpretation: {
        title: finalTitle,
        headline: headline || undefined,
        subheadline: subheadline || undefined,
        insights: finalInsights,
        bullets: bulletsFilled, // backward compatibility
        methodology: methodology || undefined,
        confidence,
        disclaimer: disclaimer || undefined,
      },
      chart: {
        recommended: (parsed?.chart?.recommended as any) || body.chart?.recommended,
        reason: safeTrim(parsed?.chart?.reason, 200) || undefined,
        labelKey: body.chart?.labelKey,
        valueKey: body.chart?.valueKey,
      },
    };

    return Response.json(out);
  } catch {
    return Response.json({
      ...buildTemplate(body, summary),
      ok: true,
      mode: "template",
      error: "openai_json_parse_failed",
    } as InsightResponse);
  }
}
