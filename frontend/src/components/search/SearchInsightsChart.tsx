"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import ChartComparisonModal, { CompareIcon, type ComparisonData } from "./ChartComparisonModal";

function CircularSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500 dark:border-gray-800 dark:border-t-gray-300" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

// Icons for chart controls
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15,3 21,3 21,9" />
      <polyline points="9,21 3,21 3,15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,14 10,14 10,20" />
      <polyline points="20,10 14,10 14,4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function ResetZoomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function LineChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
    </svg>
  );
}

function BarChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PieChartIconSmall({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

function CsvIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function SvgIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <path d="M8 14h8" />
      <path d="M8 17h8" />
    </svg>
  );
}

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => <CircularSpinner label="Memuat grafik" />,
});

import { getIndicatorChartConfig, profileChartData, INDICATOR_CHART_MAP } from "@/lib/chartDataProfiler";
import { useTheme } from "@/context/ThemeContext";
import type { DataProfileResult, ChartRecommendation } from "@/lib/chartDataProfiler";

// Simplified comparison chart component
function ComparisonChart({ 
  rows, 
  columns, 
  sourceId, 
  sourceType, 
  chartType,
  isDark,
}: { 
  rows: Array<Record<string, any>>; 
  columns: string[];
  sourceId?: number;
  sourceType?: "dynamic" | "interop" | "exim";
  chartType: "line" | "bar" | "pie";
  isDark: boolean;
}) {
  // Simple data extraction for comparison chart
  const chartData = useMemo(() => {
    if (!rows.length || !columns.length) return null;

    // Find numeric value column
    const numericCols = columns.filter(c => {
      const vals = rows.slice(0, 10).map(r => r[c]);
      return vals.some(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v))));
    });

    const valueCol = numericCols.find(c => 
      /nilai|value|jumlah|total|angka/i.test(c)
    ) || numericCols[0];

    if (!valueCol) return null;

    // Find label column
    const labelCol = columns.find(c => 
      /tahun|bulan|periode|year|month|wilayah|kab|kota/i.test(c)
    ) || columns[0];

    // Extract data
    const labels: string[] = [];
    const values: number[] = [];

    rows.slice(0, 50).forEach(row => {
      const label = String(row[labelCol] || '');
      const val = parseFloat(String(row[valueCol] || '0').replace(/[^\d.-]/g, ''));
      if (label && !isNaN(val)) {
        labels.push(label);
        values.push(val);
      }
    });

    return { labels, values, valueCol };
  }, [rows, columns]);

  if (!chartData || chartData.values.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm text-gray-500">Data tidak dapat divisualisasikan</p>
      </div>
    );
  }

  const textColor = isDark ? "#e5e7eb" : "#374151";
  const gridColor = isDark ? "#374151" : "#e5e7eb";

  const options: ApexOptions = {
    chart: {
      type: chartType === "pie" ? "pie" : chartType,
      toolbar: { show: false },
      background: "transparent",
      fontFamily: "inherit",
    },
    colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
    xaxis: chartType !== "pie" ? {
      categories: chartData.labels,
      labels: { 
        style: { colors: textColor, fontSize: "11px" },
        rotate: -45,
        trim: true,
      },
    } : undefined,
    yaxis: chartType !== "pie" ? {
      labels: { style: { colors: textColor, fontSize: "11px" } },
    } : undefined,
    grid: {
      borderColor: gridColor,
      strokeDashArray: 4,
    },
    dataLabels: { enabled: chartType === "pie" },
    legend: {
      position: "bottom",
      labels: { colors: textColor },
    },
    tooltip: {
      theme: isDark ? "dark" : "light",
    },
    labels: chartType === "pie" ? chartData.labels : undefined,
  };

  const series = chartType === "pie" 
    ? chartData.values 
    : [{ name: chartData.valueCol, data: chartData.values }];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <ReactApexChart
        options={options}
        series={series as any}
        type={chartType}
        height={280}
        width="100%"
      />
    </div>
  );
}

type ChartType = "line" | "bar" | "pie";
type XMode = "time" | "geo";
type ChartHeight = "compact" | "normal" | "expanded";
type PeriodType = "all" | "yearly" | "quarterly";
type ComparisonMode = "none" | "yoy" | "mom";

const CHART_HEIGHTS: Record<ChartHeight, number> = {
  compact: 200,
  normal: 300,
  expanded: 420,
};

type ChartConfigFromDb = {
  chart_type?: 'line' | 'bar';
  period_type?: 'monthly' | 'quarterly' | 'yearly' | 'unknown';
  data_type?: 'simple' | 'geo' | 'geo-categorical' | 'categorical';
  facet_column?: string | null;
  available_metrics?: string[];
  default_metric?: string | null;
  has_geo_dimension?: boolean;
  has_facet_dimension?: boolean;
  year_range?: { min?: number | null; max?: number | null };
};

type Props = {
  rows: Array<Record<string, any>>;
  columns: string[];
  title?: string;
  /** Optional: datasource ID for pre-computed chart config lookup */
  sourceId?: number;
  /** Optional: datasource type (dynamic, interop, exim) */
  sourceType?: "dynamic" | "interop" | "exim";
  /** Optional: allow full time range (no clipping) */
  allowFullTimeRange?: boolean;
  /** Optional: chart config from database */
  chartConfig?: ChartConfigFromDb | string | null;
};

type ParsedYearMonth = { year: number; month: number; key: number };

// Period types for chart axis configuration (renamed to avoid conflict with UI PeriodType)
type AxisPeriodType = 'yearly' | 'quarterly' | 'monthly' | 'mixed';

/**
 * Detect the period type from an array of labels.
 * Returns 'yearly' for year-only labels, 'quarterly' for quarter labels,
 * 'monthly' for month labels, or 'mixed' for inconsistent data.
 */
function detectPeriodType(labels: string[]): AxisPeriodType {
  if (!labels || labels.length === 0) return 'mixed';
  
  const isYear = (s: string) => /^\s*(19\d{2}|20\d{2}|2100)\s*$/.test(s);
  const isQuarter = (s: string) => /\b(triwulan|kuartal|quarter|q)\s*([iv]{1,3}|[1-4])/i.test(s);
  const isMonth = (s: string) => {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'mei', 'may', 'jun', 'jul', 'agu', 'aug', 'sep', 'okt', 'oct', 'nov', 'des', 'dec'];
    return monthNames.some(m => s.toLowerCase().includes(m));
  };
  
  const yearCount = labels.filter(isYear).length;
  const quarterCount = labels.filter(isQuarter).length;
  const monthCount = labels.filter(isMonth).length;
  
  // Determine dominant type (>50% of labels)
  const threshold = labels.length * 0.5;
  if (yearCount > threshold) return 'yearly';
  if (quarterCount > threshold) return 'quarterly';
  if (monthCount > threshold) return 'monthly';
  return 'mixed';
}

/**
 * Build a consistent xaxis configuration for ApexCharts.
 * Uses category axis for discrete period data to ensure proper label-to-dot alignment.
 */
function buildXAxisConfig(options: {
  labels: string[];
  periodType?: AxisPeriodType;
  chartType?: 'line' | 'bar';
  labelColor?: string;
  showTitle?: boolean;
  titleText?: string;
}): ApexXAxis {
  const { labels, periodType = 'mixed', chartType = 'line', labelColor = '#6b7280', showTitle = false, titleText } = options;
  
  // Always use category axis for discrete period data - this ensures
  // perfect alignment between labels and data points/markers
  return {
    type: 'category',
    categories: labels,
    tickPlacement: 'on', // Critical: ensures labels are directly under data points
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      rotate: periodType === 'yearly' ? 0 : -45,
      rotateAlways: false,
      hideOverlappingLabels: false,
      trim: periodType !== 'yearly',
      maxHeight: 80,
      style: { fontSize: '10px', colors: labelColor },
    },
    ...(showTitle && titleText ? {
      title: {
        text: titleText,
        style: { fontSize: '11px', fontWeight: 500, color: labelColor },
        offsetY: 8,
      },
    } : {}),
  };
}

function toUtcTimestamp(ym: ParsedYearMonth) {
  const year = ym.year;
  if (!year) return null;
  // Always use first day of month for consistent positioning
  // This ensures timestamps align with label positions on category axis
  const month = ym.month && ym.month >= 1 && ym.month <= 12 ? ym.month : 1;
  const day = 1; // Always use first of month for consistent alignment
  return Date.UTC(year, month - 1, day);
}

function stableHash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class ApexChartErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // No-op: avoid noisy console spam in production.
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <p className="text-sm text-gray-500 dark:text-gray-400">Grafik gagal dirender untuk format data ini.</p>
        )
      );
    }
    return this.props.children;
  }
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

function formatNumberId2(input: number) {
  if (!Number.isFinite(input)) return String(input);
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(input);
}

function formatPercentId(input: number) {
  if (!Number.isFinite(input)) return String(input);
  return `${new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(input)}%`;
}

function normKey(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normGeoName(s: unknown) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractProvinceFromTitle(title: unknown): string {
  const t = String(title || "");
  const m = t.match(/\bprovinsi\s+([a-z\s]+)\b/i);
  if (!m) return "";
  // Trim and normalize; keep words (avoid swallowing trailing punctuation).
  return normGeoName(m[1]).replace(/[^a-z\s]/g, "").trim();
}

function dedupeStable<T>(items: T[], keyFn: (x: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function buildDistinctColors(count: number) {
  const base = ["#465FFF", "#9CB9FF"]; // keep existing brand-ish colors first
  const n = Math.max(0, Math.trunc(count || 0));
  if (n <= base.length) return base.slice(0, n);

  // Use golden-angle hue stepping to reduce repeats even for larger series counts.
  const out: string[] = base.slice();
  let i = 0;
  while (out.length < n) {
    const hue = (i * 137.508) % 360;
    out.push(`hsl(${hue.toFixed(1)}, 70%, 50%)`);
    i++;
  }
  return out;
}

function buildRowKeyMap(rows: Array<Record<string, any>>) {
  const map = new Map<string, string>();
  for (const r of rows.slice(0, 10)) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      const nk = normKey(k);
      if (!map.has(nk)) map.set(nk, k);
    }
  }
  return map;
}

function resolveKey(keyMap: Map<string, string>, displayKey: string) {
  return keyMap.get(normKey(displayKey)) || displayKey;
}

function isTimeLikeColumnName(col: string) {
  const c = String(col || "");
  if (/^__preview_year$/i.test(c.trim())) return true;
  return /(bulan|month|tanggal|date|triwulan|kuartal|quarter|semester|tahun|year|th_id|thid|periode|period)/i.test(c);
}

function isLikelyBpsYearId(n: number) {
  if (!Number.isFinite(n)) return false;
  const i = Math.trunc(n);
  if (i !== n) return false;
  // BPS th_id often looks like 124/125 (representing 2024/2025).
  if (i >= 80 && i <= 200) return true;
  // Real years.
  if (i >= 1900 && i <= 2100) return true;
  return false;
}

function isLikelyMonthNo(n: number) {
  if (!Number.isFinite(n)) return false;
  const i = Math.trunc(n);
  return i === n && i >= 1 && i <= 12;
}

function getColumnStats(col: string, rows: Array<Record<string, any>>, resolve?: (k: string) => string) {
  const sample = rows.slice(0, 80);
  let seen = 0;
  let numeric = 0;
  let yearLike = 0;
  let monthLike = 0;
  const uniq = new Set<string>();

  for (const r of sample) {
    const raw = r?.[resolve ? resolve(col) : col];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    seen++;
    const s = String(raw).trim();
    uniq.add(s);
    const n = toNumberLoose(raw);
    if (n !== null) {
      numeric++;
      if (isLikelyBpsYearId(n)) yearLike++;
      if (isLikelyMonthNo(n)) monthLike++;
    }
  }

  const numericRatio = seen ? numeric / seen : 0;
  const uniqueRatio = seen ? uniq.size / seen : 0;
  const yearLikeRatio = numeric ? yearLike / numeric : 0;
  const monthLikeRatio = numeric ? monthLike / numeric : 0;
  return { seen, numericRatio, uniqueRatio, yearLikeRatio, monthLikeRatio };
}

function pickValueKey(columns: string[], rows: Array<Record<string, any>>, resolve?: (k: string) => string) {
  const preferred = [
    "value",
    "netweight",
    "jumlah",
    "nilai",
    "total",
    "persentase",
    "indeks",
    "y-on-y",
    "q-to-q",
    "c-to-c",
  ];
  const colNorm = columns.map((c) => ({ c, n: normKey(c) }));
  for (const p of preferred) {
    const hit = colNorm.find((x) => x.n === p);
    if (hit && !isTimeLikeColumnName(hit.c)) return hit.c;
  }

  // Otherwise: pick the column with the most numeric values.
  let best: { c: string; score: number } | null = null;
  for (const c of columns) {
    const s = getColumnStats(c, rows, resolve);
    // Avoid picking period-like columns as Y values.
    const timeNamePenalty = isTimeLikeColumnName(c) ? 0.55 : 0;
    const yearPenalty = s.yearLikeRatio >= 0.6 ? 0.6 : 0;
    const monthPenalty = s.monthLikeRatio >= 0.6 ? 0.4 : 0;
    // Prefer numeric columns with some variation (not all unique IDs and not all constants).
    const variationBonus = s.uniqueRatio >= 0.15 && s.uniqueRatio <= 0.95 ? 0.1 : 0;
    const score = s.numericRatio - timeNamePenalty - yearPenalty - monthPenalty + variationBonus;
    if (!best || score > best.score) best = { c, score };
  }

  return best && best.score >= 0.4 ? best.c : "";
}

function pickValueCandidates(columns: string[], rows: Array<Record<string, any>>, resolve?: (k: string) => string) {
  const preferred = [
    // Common numeric metrics we want to surface first
    "month-to-month",
    "year-on-year",
    "y-on-y",
    "q-to-q",
    "c-to-c",
    "yoy",
    "mom",
    "value",
    "netweight",
    "jumlah",
    "nilai",
    "total",
    "persentase",
    "indeks",
  ];

  const colNorm = columns.map((c) => ({ c, n: normKey(c) }));
  const preferredHits = preferred
    .map((p) => colNorm.find((x) => x.n === p))
    .filter(Boolean)
    .map((x) => x!.c);

  const scored: Array<{ c: string; score: number }> = [];
  for (const c of columns) {
    const s = getColumnStats(c, rows, resolve);
    const timeNamePenalty = isTimeLikeColumnName(c) ? 0.55 : 0;
    const yearPenalty = s.yearLikeRatio >= 0.6 ? 0.6 : 0;
    const monthPenalty = s.monthLikeRatio >= 0.6 ? 0.4 : 0;
    const variationBonus = s.uniqueRatio >= 0.15 && s.uniqueRatio <= 0.95 ? 0.1 : 0;

    // Prefer known metric names.
    const prefBoost = preferredHits.includes(c) ? 0.25 : 0;
    const score = s.numericRatio - timeNamePenalty - yearPenalty - monthPenalty + variationBonus + prefBoost;
    scored.push({ c, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((x) => x.score >= 0.35).map((x) => x.c);
  if (preferredHits.length > 0) {
    const uniq = new Set<string>();
    const out: string[] = [];
    for (const c of preferredHits) {
      if (!uniq.has(c)) {
        uniq.add(c);
        out.push(c);
      }
    }
    for (const c of picked) {
      if (!uniq.has(c)) {
        uniq.add(c);
        out.push(c);
      }
    }
    return out;
  }
  return picked;
}

function isTrueGeoColumnName(col: string) {
  // Strict-ish geographic dimensions only (Kab/Kota/Prov/etc).
  // IMPORTANT: do not include komoditas/HS/country/POD here.
  return /(kabupaten\s*\/\s*kota|kab\/?kota|wilayah|daerah|provinsi|kecamatan|desa|kelurahan|kota|kab\b)/i.test(
    String(col || "")
  );
}

function isFacetColumnName(col: string) {
  // Non-geo categorical facets often used as X/series in EXIM and some tables.
  // Includes PDRB-specific categories like "Komponen Pengeluaran", "Lapangan Usaha"
  return /(negara|country|ctr\b|tujuan|asal|pod\b|pelabuhan|komoditas|hs\b|kode\s*hs|kodehs|komponen|pengeluaran|lapangan\s*usaha|sektor|kategori|jenis|kelompok|subkelompok|golongan)/i.test(String(col || ""));
}

function isCategoryLikeColumnName(col: string) {
  return isTrueGeoColumnName(col) || isFacetColumnName(col);
}

function pickTimeLabelKey(
  columns: string[],
  rows: Array<Record<string, any>>,
  valueKey: string,
  resolve?: (k: string) => string
) {
  const v = normKey(valueKey);
  const candidates = columns.filter((c) => normKey(c) !== v);

  let best: { c: string; score: number } | null = null;
  for (const c of candidates) {
    const s = getColumnStats(c, rows, resolve);
    const nameScore = isTimeLikeColumnName(c) ? 2.0 : 0;
    const statsScore =
      (s.yearLikeRatio >= 0.6 ? 0.9 : 0) +
      (s.monthLikeRatio >= 0.6 ? 0.7 : 0) +
      (s.uniqueRatio >= 0.15 ? 0.2 : 0) +
      // Penalize measured numeric values.
      (s.numericRatio >= 0.8 && s.yearLikeRatio < 0.4 && s.monthLikeRatio < 0.4 ? -0.6 : 0);

    // Quick probe on the rendered labels (handles month-only + __preview_year).
    const probeLabels = rows
      .slice(0, 24)
      .map((r) => buildBestLabel(r, columns, c, resolve))
      .filter(Boolean);
    const probeBonus = looksTimeLike(probeLabels) ? 1.4 : 0;

    const score = nameScore + statsScore + probeBonus;
    if (!best || score > best.score) best = { c, score };
  }

  return best && best.score >= 1.6 ? best.c : "";
}

function pickGeoLabelKey(
  columns: string[],
  rows: Array<Record<string, any>>,
  valueKey: string,
  resolve?: (k: string) => string
) {
  const v = normKey(valueKey);
  const candidates = columns.filter((c) => normKey(c) !== v);

  let best: { c: string; score: number } | null = null;
  for (const c of candidates) {
    const s = getColumnStats(c, rows, resolve);
    const nameScore = isCategoryLikeColumnName(c) ? 2.0 : 0;
    const statsScore =
      (s.uniqueRatio >= 0.2 ? 0.4 : 0) +
      // Penalize numeric columns.
      (s.numericRatio >= 0.8 ? -0.9 : 0);

    const score = nameScore + statsScore;
    if (!best || score > best.score) best = { c, score };
  }

  return best && best.score >= 1.8 ? best.c : "";
}

function pickLabelKey(
  columns: string[],
  rows: Array<Record<string, any>>,
  valueKey: string,
  resolve?: (k: string) => string
) {
  const v = normKey(valueKey);
  const candidates = columns.filter((c) => normKey(c) !== v);

  // Score-based selection so X axis tends to be "periode/wilayah/kategori"
  // and not accidentally a numeric value column.
  let best: { c: string; score: number } | null = null;
  for (const c of candidates) {
    const s = getColumnStats(c, rows, resolve);
    const nameScore =
      (isTimeLikeColumnName(c) ? 2.0 : 0) +
      (/kabupaten\s*\/\s*kota|kab\/?kota|wilayah|daerah|provinsi/i.test(c) ? 1.6 : 0) +
      (/ctr|negara|pod|pelabuhan|kodehs|komoditas/i.test(c) ? 1.2 : 0) +
      (/(value|nilai|jumlah|total|netweight|persentase|indeks)/i.test(c) ? -2.0 : 0);

    // Data-shape hints:
    // - labels are often more "categorical" (higher unique ratio)
    // - time-ish columns (year/month) are acceptable labels even when numeric
    const statsScore =
      (s.uniqueRatio >= 0.2 ? 0.3 : 0) +
      (s.yearLikeRatio >= 0.6 ? 0.8 : 0) +
      (s.monthLikeRatio >= 0.6 ? 0.6 : 0) +
      // Penalize columns that look like a measured numeric value (high numeric ratio but not time-ish)
      (s.numericRatio >= 0.8 && s.yearLikeRatio < 0.4 && s.monthLikeRatio < 0.4 ? -0.5 : 0);

    const score = nameScore + statsScore;
    if (!best || score > best.score) best = { c, score };
  }

  return best?.c || candidates[0] || "";
}

function looksTimeLike(values: string[]) {
  const sample = values.slice(0, 20).map((s) => String(s || "").toLowerCase());
  const monthWords = /\b(jan|feb|mar|apr|mei|jun|jul|agu|ags|sep|okt|nov|des|januari|februari|maret|april|agustus|september|oktober|november|desember)\b/;
  const quarterWords = /\b(triwulan|kuartal|quarter|q\s*[1-4]|q[1-4]|tw\s*[1-4])\b/;
  const year = /\b(19\d{2}|20\d{2}|2100)\b/;
  const isoDate = /\b\d{4}-\d{1,2}-\d{1,2}\b/;
  return sample.some((s) => monthWords.test(s) || quarterWords.test(s) || year.test(s) || isoDate.test(s));
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
  august: 8,
  agustus: 8,
  sep: 9,
  september: 9,
  okt: 10,
  october: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  des: 12,
  december: 12,
  desember: 12,
};

function thIdToYear(n: number) {
  // BPS th_id commonly uses 124/125 for 2024/2025.
  if (!Number.isFinite(n)) return n;
  const i = Math.trunc(n);
  if (i >= 0 && i <= 300) return 1900 + i;
  return i;
}

function parseYearMonth(label: string): ParsedYearMonth | null {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return null;

  // Tahunan/Annual/Yearly markers (year-only aggregate, needs year from __preview_year)
  if (/^(tahunan|annual|yearly)$/i.test(s)) {
    return { year: 0, month: 0, key: 0 };
  }

  const parseQuarterNo = (input: string) => {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return null;
    if (/(\bq1\b|\bq\s*1\b)/i.test(raw)) return 1;
    if (/(\bq2\b|\bq\s*2\b)/i.test(raw)) return 2;
    if (/(\bq3\b|\bq\s*3\b)/i.test(raw)) return 3;
    if (/(\bq4\b|\bq\s*4\b)/i.test(raw)) return 4;
    if (/\biv\b/.test(raw)) return 4;
    if (/\biii\b/.test(raw)) return 3;
    if (/\bii\b/.test(raw)) return 2;
    if (/\bi\b/.test(raw)) return 1;
    if (/\b1\b/.test(raw)) return 1;
    if (/\b2\b/.test(raw)) return 2;
    if (/\b3\b/.test(raw)) return 3;
    if (/\b4\b/.test(raw)) return 4;
    return null;
  };

  // Year-only labels (common when X is __preview_year)
  const yearOnly = s.match(/^\s*(19\d{2}|20\d{2}|2100)\s*$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return { year, month: 0, key: year * 100 };
  }

  // ISO-like: YYYY-MM or YYYY-MM-DD
  const iso = s.match(/\b(19\d{2}|20\d{2}|2100)[-\/\.](\d{1,2})(?:[-\/\.](\d{1,2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (year && month >= 1 && month <= 12) return { year, month, key: year * 100 + month };
  }

  // MonthName YYYY
  const m1 = s.match(/\b([a-z]+)\s+(19\d{2}|20\d{2}|2100)\b/);
  if (m1) {
    const month = MONTHS_ID[m1[1]];
    const year = Number(m1[2]);
    if (month && year) return { year, month, key: year * 100 + month };
  }

  // Quarter YYYY (e.g., Triwulan I 2024 / Kuartal 2 2024 / Q3 2024)
  const q1 = s.match(/\b(triwulan|kuartal|quarter|q)\s*([iv]{1,3}|iv|[1-4])\s+(19\d{2}|20\d{2}|2100)\b/);
  if (q1) {
    const qNo = parseQuarterNo(q1[2]);
    const year = Number(q1[3]);
    if (qNo && year) return { year, month: qNo * 3, key: year * 100 + qNo * 3 };
  }

  // YYYY MonthName
  const m2 = s.match(/\b(19\d{2}|20\d{2}|2100)\s+([a-z]+)\b/);
  if (m2) {
    const year = Number(m2[1]);
    const month = MONTHS_ID[m2[2]];
    if (month && year) return { year, month, key: year * 100 + month };
  }

  // YYYY Quarter (e.g., 2024 Triwulan II)
  const q2 = s.match(/\b(19\d{2}|20\d{2}|2100)\s+(triwulan|kuartal|quarter|q)\s*([iv]{1,3}|iv|[1-4])\b/);
  if (q2) {
    const year = Number(q2[1]);
    const qNo = parseQuarterNo(q2[3]);
    if (qNo && year) return { year, month: qNo * 3, key: year * 100 + qNo * 3 };
  }

  // th_id style: 124 + month 1..12 inside label
  const nums = s.match(/\b\d+\b/g) || [];
  const parsedNums = nums.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (parsedNums.length === 1) {
    const only = parsedNums[0];
    if ((only >= 1900 && only <= 2100) || (only >= 80 && only <= 300)) {
      const year = only >= 1900 ? only : thIdToYear(only);
      return { year, month: 0, key: year * 100 };
    }
  }
  if (parsedNums.length >= 2) {
    const maybeYear = parsedNums.find((n) => n >= 80 && n <= 300) ?? parsedNums.find((n) => n >= 1900 && n <= 2100);
    const maybeMonth = parsedNums.find((n) => n >= 1 && n <= 12);
    if (maybeYear && maybeMonth) {
      const year = maybeYear >= 1900 ? maybeYear : thIdToYear(maybeYear);
      return { year, month: maybeMonth, key: year * 100 + maybeMonth };
    }
  }

  // Month-only labels commonly seen in BPS dynamic tables, e.g. "[1] Januari" or "Januari".
  const bracketMonth = s.match(/^\[\s*(\d{1,2})\s*\]\s*([a-z]+)\b/);
  if (bracketMonth) {
    const month = Number(bracketMonth[1]);
    if (month >= 1 && month <= 12) return { year: 0, month, key: month };
  }

  // Quarter-only labels (e.g., "Triwulan I", "Q2")
  const qOnly = s.match(/\b(triwulan|kuartal|quarter|q)\s*([iv]{1,3}|iv|[1-4])\b/);
  if (qOnly) {
    const qNo = parseQuarterNo(qOnly[2]);
    if (qNo) return { year: 0, month: qNo * 3, key: qNo * 3 };
  }

  // Tahunan/annual/yearly labels - treat as year-only marker (month=0)
  // Will be enriched with __preview_year in buildBestLabel
  if (/^(tahunan|annual|yearly)$/i.test(s)) {
    return { year: 0, month: 0, key: 0 };
  }

  const justMonth = s.match(/^([a-z]+)$/);
  if (justMonth) {
    const month = MONTHS_ID[justMonth[1]];
    if (month) return { year: 0, month, key: month };
  }

  return null;
}

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

function pickColumn(columns: string[], re: RegExp) {
  return columns.find((c) => re.test(String(c))) || "";
}

function normalizeYear(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i >= 1900 && i <= 2100) return i;
  if (i >= 0 && i <= 300) return thIdToYear(i);
  return null;
}

function buildBestLabel(
  row: Record<string, any>,
  columns: string[],
  labelKey: string,
  resolve?: (k: string) => string
) {
  const raw = String(row?.[resolve ? resolve(labelKey) : labelKey] ?? "").trim();
  if (!raw) return "";

  const labelKeyTrim = String(labelKey || "").trim();
  const labelKeyIsTime =
    isTimeLikeColumnName(labelKeyTrim) ||
    /^(__preview_year|tahun|year|th_id|thid|bulan|month|month_no|bln|periode|period|tanggal|date)$/i.test(labelKeyTrim);

  // If label already includes year-month, keep it.
  const ymRaw = parseYearMonth(raw);
  if (ymRaw && ymRaw.year > 0) return raw;

  // If label is month-only OR year-only marker (common in BPS dynamic tables), prefer the injected preview year
  // even if other columns (e.g. "year-on-year") could be mistaken as a year column.
  if (ymRaw && ymRaw.year === 0) {
    const y = normalizeYear((row as any)?.__preview_year);
    if (y) {
      // Tahunan/annual/yearly: return just the year
      if (/^(tahunan|annual|yearly)$/i.test(raw.trim())) {
        return String(y);
      }
      // Quarter labels: return "Triwulan X YYYY"
      if (/\b(triwulan|kuartal|quarter|q)\b/i.test(raw) && ymRaw.month >= 3) {
        const tri = Math.max(1, Math.min(4, Math.round(ymRaw.month / 3)));
        return `Triwulan ${tri} ${y}`;
      }
      // Month labels: return "MonthName YYYY"
      if (ymRaw.month >= 1 && ymRaw.month <= 12) {
        return `${monthNoToIdName(ymRaw.month)} ${y}`;
      }
    } else {
      // No __preview_year available - for "Tahunan", keep original label
      if (/^(tahunan|annual|yearly)$/i.test(raw.trim())) {
        return raw; // Return "Tahunan" as-is
      }
    }
  }

  // Only synthesize month/year labels when the chosen label key is time-like.
  // For categorical keys (e.g., ctr/negara/komoditas), keep the raw label.
  if (!labelKeyIsTime) return raw;

  // Prefer strict year/month columns; avoid matching metric names like "year-on-year" / "month-to-month".
  const yearCol =
    columns.find((c) => /^(tahun|year|th_id|thid)$/i.test(String(c).trim())) ||
    columns.find((c) => /^(tahun|year)$/i.test(String(c).trim())) ||
    "";
  const monthCol = columns.find((c) => /^(bulan|month|month_no|bln)$/i.test(String(c).trim())) || "";
  const quarterCol = columns.find((c) => /^(triwulan|kuartal|quarter|q)$/i.test(String(c).trim())) || "";
  // Prefer explicit year+month columns
  if (yearCol && monthCol) {
    const yRaw = toNumberLoose(row?.[resolve ? resolve(yearCol) : yearCol]);
    const mRaw = toNumberLoose(row?.[resolve ? resolve(monthCol) : monthCol]);
    if (yRaw !== null && mRaw !== null && mRaw >= 1 && mRaw <= 12) {
      const year = yRaw >= 1900 ? Math.trunc(yRaw) : thIdToYear(Math.trunc(yRaw));
      return `${monthNoToIdName(Math.trunc(mRaw))} ${year}`;
    }
  }

  if (yearCol && quarterCol) {
    const yRaw = toNumberLoose(row?.[resolve ? resolve(yearCol) : yearCol]);
    const qRaw = String(row?.[resolve ? resolve(quarterCol) : quarterCol] ?? "").trim();
    const qNo = qRaw ? parseYearMonth(`triwulan ${qRaw}`)?.month : null;
    if (yRaw !== null && qNo && qNo >= 3) {
      const year = yRaw >= 1900 ? Math.trunc(yRaw) : thIdToYear(Math.trunc(yRaw));
      const tri = qNo / 3;
      return `Triwulan ${tri} ${year}`;
    }
  }

  // Multi-year mode from SearchPageClient: __preview_year injected.
  if (!yearCol && monthCol) {
    const yy = String((row as any)?.__preview_year ?? "").trim();
    const mRaw = toNumberLoose(row?.[resolve ? resolve(monthCol) : monthCol]);
    if (/^(19\d{2}|20\d{2}|2100)$/.test(yy) && mRaw !== null && mRaw >= 1 && mRaw <= 12) {
      return `${monthNoToIdName(Math.trunc(mRaw))} ${yy}`;
    }
  }

  if (!yearCol && quarterCol) {
    const yy = String((row as any)?.__preview_year ?? "").trim();
    const qRaw = String(row?.[resolve ? resolve(quarterCol) : quarterCol] ?? "").trim();
    const qNo = qRaw ? parseYearMonth(`triwulan ${qRaw}`)?.month : null;
    if (/^(19\d{2}|20\d{2}|2100)$/.test(yy) && qNo && qNo >= 3) {
      const tri = qNo / 3;
      return `Triwulan ${tri} ${yy}`;
    }
  }

  return raw;
}

function recommendedTypeFromData(
  labelValues: string[],
  numericValues: number[],
  xMode: XMode,
  profilerHint?: ChartRecommendation | null
): ChartType {
  // If profiler has a strong recommendation, prefer it
  if (profilerHint && profilerHint.chartType !== 'none') {
    // Map profiler chart type to component's ChartType
    const mapped = profilerHint.chartType as ChartType;
    if (mapped === 'line' || mapped === 'bar' || mapped === 'pie') {
      return mapped;
    }
  }

  const uniqueLabels = Array.from(new Set(labelValues.filter(Boolean)));
  const allNonNeg = numericValues.every((n) => Number.isFinite(n) && n >= 0);

  if (xMode === "time") {
    // Avoid LINE when there are too few distinct periods (e.g. only "Oktober 2025").
    if (uniqueLabels.length >= 3 && looksTimeLike(uniqueLabels)) return "line";
    return "bar";
  }

  // Categorical axis: pie for small category counts, otherwise bar.
  // Guardrail: never pick pie for a single category.
  if (uniqueLabels.length >= 2 && uniqueLabels.length <= 8 && allNonNeg) return "pie";
  return "bar";
}

export default function SearchInsightsChart({ rows, columns, title, sourceId, sourceType, allowFullTimeRange, chartConfig }: Props) {
  const [apexBroken, setApexBroken] = useState(false);
  const [geoDropdownOpen, setGeoDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartHeight, setChartHeight] = useState<ChartHeight>("normal");
  const [manualChartType, setManualChartType] = useState<ChartType | "auto">("auto");
  const [isZoomed, setIsZoomed] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Comparison mode state
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [comparisonRows, setComparisonRows] = useState<Array<Record<string, any>>>([]);
  const [comparisonColumns, setComparisonColumns] = useState<string[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Dark mode detection
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Keyboard shortcut: Esc to close fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  // Parse chart config if string
  const parsedDbConfig: ChartConfigFromDb | null = useMemo(() => {
    if (!chartConfig) return null;
    if (typeof chartConfig === 'string') {
      try {
        return JSON.parse(chartConfig) as ChartConfigFromDb;
      } catch {
        return null;
      }
    }
    return chartConfig;
  }, [chartConfig]);

  // Use profiler to get chart configuration hints
  const profilerResult: DataProfileResult | null = useMemo(() => {
    // For EXIM sources, always use dynamic profiling to detect category views
    const isEximSource = sourceId === 159 || sourceId === 160 || sourceType === 'exim';
    
    if (isEximSource && safeColumns.length > 0 && safeRows.length > 0) {
      return getIndicatorChartConfig(sourceId || 0, safeColumns, safeRows, 'exim');
    }
    
    // Check if we have a pre-computed config for this source
    if (sourceId && INDICATOR_CHART_MAP[sourceId]) {
      return getIndicatorChartConfig(sourceId, safeColumns, safeRows, sourceType);
    }
    // Fall back to dynamic profiling
    if (safeColumns.length > 0 && safeRows.length > 0) {
      return profileChartData(safeColumns, safeRows, sourceType);
    }
    return null;
  }, [sourceId, sourceType, safeColumns, safeRows]);

  const rowKeyMap = useMemo(() => buildRowKeyMap(safeRows), [safeRows]);
  const resolve = useMemo(() => (k: string) => resolveKey(rowKeyMap, k), [rowKeyMap]);

  const valueCandidates = useMemo(() => {
    const picked = pickValueCandidates(safeColumns, safeRows, resolve);
    if (picked.length > 0) return picked;
    const fallback = pickValueKey(safeColumns, safeRows, resolve);
    return fallback ? [fallback] : [];
  }, [safeColumns.join("|"), safeRows, resolve]);

  const [selectedValueKey, setSelectedValueKey] = useState<string>(valueCandidates[0] || "");

  useEffect(() => {
    if (!selectedValueKey && valueCandidates[0]) {
      setSelectedValueKey(valueCandidates[0]);
      return;
    }
    if (selectedValueKey && !valueCandidates.includes(selectedValueKey)) {
      setSelectedValueKey(valueCandidates[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCandidates.join("|")]);

  const axes = useMemo(() => {
    const valueKey = selectedValueKey || valueCandidates[0] || "";
    const timeLabelKey = valueKey ? pickTimeLabelKey(safeColumns, safeRows, valueKey, resolve) : "";
    const geoLabelKeyPicked = valueKey ? pickGeoLabelKey(safeColumns, safeRows, valueKey, resolve) : "";

    // Robust fallback: some datasets name the geo column clearly but the scoring threshold may miss it.
    // If we can find a geo-like, non-numeric-ish column, use it.
    const geoLabelKeyFallback = (() => {
      if (geoLabelKeyPicked) return "";
      let best: { c: string; score: number } | null = null;
      for (const c of safeColumns) {
        if (isTimeLikeColumnName(c)) continue;
        const s = getColumnStats(c, safeRows, resolve);
        const nameScore = isCategoryLikeColumnName(c) ? 2.0 : 0;
        const numericPenalty = s.numericRatio >= 0.6 ? -1.0 : 0;
        const uniqBonus = s.uniqueRatio >= 0.2 ? 0.4 : 0;
        const score = nameScore + numericPenalty + uniqBonus;
        if (!best || score > best.score) best = { c, score };
      }
      return best && best.score >= 1.4 ? best.c : "";
    })();

    const geoLabelKey = geoLabelKeyPicked || geoLabelKeyFallback;

    // Fallback: multi-year payloads from SearchPageClient inject `__preview_year`.
    // For wide tables without an explicit year column (e.g., columns like "TPAK - Agustus"),
    // we still want a time axis and a line chart across years.
    const previewYears = new Set<number>();
    for (const r of safeRows.slice(0, 80)) {
      const y = normalizeYear((r as any)?.__preview_year);
      if (y) previewYears.add(y);
    }
    const hasPreviewYearAxis = previewYears.size >= 2;
    const effectiveTimeKey = timeLabelKey || (hasPreviewYearAxis ? "__preview_year" : "");

    const hasTime = Boolean(effectiveTimeKey);
    const hasGeo = Boolean(geoLabelKey);
    return { timeLabelKey: effectiveTimeKey, geoLabelKey, hasTime, hasGeo };
  }, [safeColumns.join("|"), safeRows, selectedValueKey, valueCandidates.join("|"), resolve]);

  const dimensionMeta = useMemo(() => {
    // The internal naming uses "geo" for any categorical dimension column.
    // In practice this can be real geography (kab/kota/provinsi) OR non-geo facets
    // like komoditas / HS / negara / POD. Label the UI defensively.
    const key = String(axes.geoLabelKey || "").trim();
    const isGeo = isTrueGeoColumnName(key);
    return {
      isGeo,
      label: isGeo ? "Wilayah" : "Kategori",
    };
  }, [axes.geoLabelKey]);

  const geoOptions = useMemo(() => {
    if (!axes.geoLabelKey) return [] as Array<{ label: string; key: string }>;
    const geoKeyRaw = resolve(axes.geoLabelKey);
    const items = safeRows
      .slice(0, 200)
      .map((r) => String(r?.[geoKeyRaw] ?? "").trim())
      .filter(Boolean)
      .map((label) => ({ label, key: normGeoName(label) }));
    return dedupeStable(items, (x) => x.key);
  }, [axes.geoLabelKey, safeRows, safeColumns.join("|"), resolve]);

  const [selectedGeoKeys, setSelectedGeoKeys] = useState<string[]>([]);

  useEffect(() => {
    // Initialize selection when geo options change.
    if (geoOptions.length === 0) {
      if (selectedGeoKeys.length) setSelectedGeoKeys([]);
      return;
    }

    const allKeys = geoOptions.map((g) => g.key);
    const existing = selectedGeoKeys.filter((k) => allKeys.includes(k));
    if (existing.length >= 1) {
      // Keep existing selection as long as it still exists.
      if (existing.length !== selectedGeoKeys.length) setSelectedGeoKeys(existing);
      return;
    }

    // Default selection: for real-geo dimensions, prefer aggregate province line if present; else top wilayah by latest value.
    // For non-geo categorical dimensions (komoditas/negara/hs/pod), prefer aggregate/total items.
    const provinceFromTitle = dimensionMeta.isGeo ? extractProvinceFromTitle(title) : "";
    const preferred = dimensionMeta.isGeo
      ? (provinceFromTitle && allKeys.includes(provinceFromTitle) ? provinceFromTitle : "") ||
        (allKeys.includes("maluku utara") ? "maluku utara" : "")
      : "";

    const maxDefault = 6;
    const picked: string[] = [];
    if (preferred) picked.push(preferred);

    // For non-geo categories (like Komponen Pengeluaran), prefer aggregate items
    if (!dimensionMeta.isGeo && !preferred) {
      // Look for common aggregate patterns
      const aggregatePatterns = [
        /^p\s*d\s*r\s*b$/i,         // P D R B
        /^pdrb$/i,                   // PDRB
        /^total\b/i,                 // Total ...
        /^jumlah\b/i,                // Jumlah ...
        /^seluruh\b/i,               // Seluruh ...
        /^agregat/i,                 // Agregat ...
      ];
      for (const pattern of aggregatePatterns) {
        const match = allKeys.find((k) => {
          const original = geoOptions.find((g) => g.key === k)?.label || k;
          return pattern.test(original.trim());
        });
        if (match && !picked.includes(match)) {
          picked.push(match);
          break;
        }
      }
    }

    // If we can compute latest period, pick additional wilayah by latest value.
    const valueKey = selectedValueKey || valueCandidates[0] || "";
    const timeKey = axes.timeLabelKey;
    const geoKey = axes.geoLabelKey;
    if (valueKey && timeKey && geoKey) {
      const valueKeyAccess = resolve(valueKey);
      const timeKeyAccess = resolve(timeKey);
      const geoKeyAccess = resolve(geoKey);

      const pts = safeRows.slice(0, 200).map((r) => {
        const geo = normGeoName(r?.[geoKeyAccess]);
        const label = buildBestLabel(r, safeColumns, timeKeyAccess, resolve);
        const ym = parseYearMonth(label);
        const val = toNumberLoose(r?.[valueKeyAccess]);
        return { geo, ym, val };
      }).filter((p) => p.geo && p.ym && p.val !== null) as Array<{ geo: string; ym: ParsedYearMonth; val: number }>;

      // For data with year > 0, use latest period; for quarter-only (year === 0), use all data
      const ptsWithYear = pts.filter((p) => p.ym.year > 0);
      const hasYears = ptsWithYear.length > 0;

      if (pts.length > 0) {
        const ptsToUse = hasYears ? ptsWithYear : pts;
        ptsToUse.sort((a, b) => a.ym.key - b.ym.key);
        const latestKey = ptsToUse[ptsToUse.length - 1].ym.key;
        const latestVals = new Map<string, number>();
        for (const p of ptsToUse) {
          if (p.ym.key !== latestKey) continue;
          latestVals.set(p.geo, (latestVals.get(p.geo) || 0) + p.val);
        }
        const ranked = Array.from(latestVals.entries())
          .sort((a, b) => b[1] - a[1])
          .map((x) => x[0])
          .filter((k) => k && !picked.includes(k));

        for (const k of ranked) {
          if (picked.length >= maxDefault) break;
          picked.push(k);
        }
      }
    }

    // Fallback: just take the first few.
    if (picked.length === 0) {
      picked.push(...allKeys.slice(0, 4));
    }

    setSelectedGeoKeys(picked.slice(0, maxDefault));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoOptions.map((g) => g.key).join("|"), axes.timeLabelKey, axes.geoLabelKey, selectedValueKey, valueCandidates.join("|"), rowKeyMap]);

  const [selectedXMode, setSelectedXMode] = useState<XMode>("time");
  const [chartBooting, setChartBooting] = useState(false);
  
  // Period type selector: "all" = show all periods, "yearly" = annual data only, "quarterly" = triwulan only
  const [selectedPeriodType, setSelectedPeriodType] = useState<PeriodType>("all");
  
  // Detect available period types from data
  const periodTypeOptions = useMemo(() => {
    if (!axes.timeLabelKey) return { hasYearly: false, hasQuarterly: false, hasMonthly: false };
    
    const labelKeyAccess = resolve(axes.timeLabelKey);
    const labels = safeRows.slice(0, 200).map((r) => 
      buildBestLabel(r, safeColumns, axes.timeLabelKey, resolve)
    ).filter(Boolean);
    
    let hasYearly = false;
    let hasQuarterly = false;
    let hasMonthly = false;
    
    for (const label of labels) {
      const labelLower = label.toLowerCase();
      
      // Check for "Tahunan" or annual label
      if (/\b(tahunan|annual|yearly)\b/i.test(label)) {
        hasYearly = true;
        continue;
      }
      
      // Check for quarterly pattern in label
      const isQuarter = /\b(triwulan|kuartal|quarter|q\s*[1-4]|q[1-4]|tw\s*[1-4])\b/i.test(label);
      if (isQuarter) {
        hasQuarterly = true;
        continue;
      }
      
      const ym = parseYearMonth(label);
      if (!ym) continue;
      
      if (ym.month === 0 && ym.year > 0) {
        // Year-only (month=0) → yearly
        hasYearly = true;
      } else if (ym.month >= 1 && ym.month <= 12) {
        hasMonthly = true;
      }
    }
    
    return { hasYearly, hasQuarterly, hasMonthly };
  }, [axes.timeLabelKey, safeRows, safeColumns, resolve]);

  // Detect unique years from rows (__preview_year or from time labels)
  const availableYears = useMemo(() => {
    const yearsSet = new Set<string>();
    for (const r of safeRows.slice(0, 500)) {
      // Check __preview_year first (injected from multi-year fetch)
      const py = String((r as any)?.__preview_year ?? "").trim();
      if (/^(19\d{2}|20\d{2}|2100)$/.test(py)) {
        yearsSet.add(py);
        continue;
      }
      // Try to extract year from time label
      if (axes.timeLabelKey) {
        const label = buildBestLabel(r, safeColumns, axes.timeLabelKey, resolve);
        const ym = parseYearMonth(label);
        if (ym && ym.year >= 1990 && ym.year <= 2100) {
          yearsSet.add(String(ym.year));
        }
      }
    }
    const years = Array.from(yearsSet).sort((a, b) => Number(a) - Number(b));
    return years;
  }, [safeRows, safeColumns, axes.timeLabelKey, resolve]);

  const canMoM = periodTypeOptions.hasMonthly || periodTypeOptions.hasQuarterly;
  const canYoY = availableYears.length > 1;

  useEffect(() => {
    if (!canMoM && comparisonMode === "mom") setComparisonMode("none");
    if (!canYoY && comparisonMode === "yoy") setComparisonMode("none");
  }, [canMoM, canYoY, comparisonMode]);

  // Selected years for filtering (empty = all years)
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const [yearFilterTouched, setYearFilterTouched] = useState(false);
  // Selected period for geo mode (bar/pie charts) - stores ym.key (yearmonth key)
  const [selectedGeoPeriod, setSelectedGeoPeriod] = useState<number | null>(null);

  // Get available periods for selected year (for geo mode period selector)
  const availableGeoPeriods = useMemo(() => {
    if (selectedXMode !== "geo" || !axes.timeLabelKey || selectedYears.length === 0) return [];
    
    const selectedYear = selectedYears[0]; // geo mode only has single year
    const periodsSet = new Set<string>();
    const periodKeys: Array<{ key: number; label: string; month: number }> = [];
    
    safeRows.slice(0, 800).forEach((r) => {
      const label = buildBestLabel(r, safeColumns, axes.timeLabelKey, resolve);
      if (!label) return;
      
      let ym = parseYearMonth(label);
      // Enrich year=0 from __preview_year
      if (ym && ym.year === 0) {
        const previewYear = normalizeYear((r as any)?.__preview_year);
        if (previewYear) {
          ym = { year: previewYear, month: ym.month, key: previewYear * 100 + ym.month };
        }
      }
      
      if (ym && String(ym.year) === selectedYear) {
        const periodKey = `${ym.key}`;
        if (!periodsSet.has(periodKey)) {
          periodsSet.add(periodKey);
          // Create display label
          let displayLabel = label;
          if (/tahunan|annual|yearly/i.test(label)) {
            displayLabel = "Tahunan";
          } else if (/triwulan|quarter/i.test(label)) {
            const qMatch = label.match(/[1-4IVX]+/);
            if (qMatch) {
              const qNum = qMatch[0];
              // Convert to Roman if needed
              const romanMap: Record<string, string> = {"1": "I", "2": "II", "3": "III", "4": "IV"};
              const romanNum = romanMap[qNum] || qNum;
              displayLabel = `Triwulan ${romanNum}`;
            }
          }
          periodKeys.push({ key: ym.key, label: displayLabel, month: ym.month });
        }
      }
    });
    
    // Sort by key (yearmonth)
    periodKeys.sort((a, b) => a.key - b.key);
    return periodKeys;
  }, [safeRows, safeColumns, axes.timeLabelKey, resolve, selectedYears, selectedXMode]);

  // Auto-select latest period when year changes or mode switches to geo
  useEffect(() => {
    if (selectedXMode === "geo" && availableGeoPeriods.length > 0) {
      const latestPeriod = availableGeoPeriods[availableGeoPeriods.length - 1];
      if (selectedGeoPeriod !== latestPeriod.key) {
        setSelectedGeoPeriod(latestPeriod.key);
      }
    }
  }, [availableGeoPeriods, selectedXMode]);

  // Auto-select years based on chart mode:
  // - Line chart (time mode): select all years for multi-series
  // - Bar/Pie (geo mode): select latest year only
  useEffect(() => {
    if (availableYears.length > 1 && !yearFilterTouched) {
      const shouldSelectAll = selectedXMode === "time";
      const latestYear = availableYears[availableYears.length - 1];
      
      if (shouldSelectAll) {
        const needsSync = selectedYears.length !== availableYears.length ||
          selectedYears.some((y) => !availableYears.includes(y));
        if (needsSync) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[Chart] Auto-selecting all years for line chart:', availableYears);
          }
          setSelectedYears(availableYears.slice());
        }
      } else {
        const needsSync = selectedYears.length !== 1 || selectedYears[0] !== latestYear;
        if (needsSync) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[Chart] Auto-selecting latest year for bar/pie:', latestYear);
          }
          setSelectedYears([latestYear]);
        }
      }
    }
  }, [availableYears.join('|'), yearFilterTouched, selectedXMode]);

  // Apply explicit time range selector (start/end years)
  useEffect(() => {
    if (selectedXMode !== "time") return;
    if (!axes.hasTime || availableYears.length < 2) return;
    if (!rangeStart && !rangeEnd) return;

    const start = rangeStart || availableYears[0];
    const end = rangeEnd || availableYears[availableYears.length - 1];
    const startNum = Number(start);
    const endNum = Number(end);
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return;
    const min = Math.min(startNum, endNum);
    const max = Math.max(startNum, endNum);
    const next = availableYears.filter((y) => {
      const n = Number(y);
      return Number.isFinite(n) && n >= min && n <= max;
    });

    if (next.length > 0) {
      setYearFilterTouched(true);
      setSelectedYears(next);
    }
  }, [availableYears.join('|'), axes.hasTime, rangeStart, rangeEnd, selectedXMode]);

  useEffect(() => {
    if (!geoDropdownOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Close when clicking outside any element marked as part of the geo dropdown.
      const inside = target.closest('[data-geo-dropdown="1"]');
      if (!inside) setGeoDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [geoDropdownOpen]);

  // Close year dropdown when clicking outside
  useEffect(() => {
    if (!yearDropdownOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const inside = target.closest('[data-year-dropdown="1"]');
      if (!inside) setYearDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [yearDropdownOpen]);

  useEffect(() => {
    if (axes.hasTime && !axes.hasGeo) {
      setSelectedXMode("time");
      return;
    }
    if (!axes.hasTime && axes.hasGeo) {
      setSelectedXMode("geo");
      return;
    }

    if (axes.hasTime && axes.hasGeo) {
      // Prefer time-series when there is a meaningful spread of periods.
      const probe = safeRows
        .slice(0, 80)
        .map((r) => buildBestLabel(r, safeColumns, axes.timeLabelKey, resolve))
        .filter(Boolean);
      const uniqPeriods = new Set(probe).size;
      setSelectedXMode(uniqPeriods >= 6 ? "time" : "geo");
    }
  }, [axes.hasTime, axes.hasGeo, axes.timeLabelKey, safeRows, safeColumns.join("|"), resolve]);

  const prepared = useMemo(() => {
    // DEBUG: log input to prepared useMemo
    console.log('[Prepared DEBUG] Inputs:', {
      safeRowsLen: safeRows.length,
      safeColumnsLen: safeColumns.length,
      selectedValueKey,
      valueCandidatesLen: valueCandidates.length,
      selectedGeoKeysLen: selectedGeoKeys.length,
      geoOptionsLen: geoOptions.length,
      availableYearsLen: availableYears.length,
      selectedYearsLen: selectedYears.length,
      samplePreviewYear: (safeRows[0] as any)?.__preview_year,
    });
    
    const valueKey = selectedValueKey || valueCandidates[0] || "";
    
    if (!valueKey) {
      return {
        valueKey: "",
        labelKey: "",
        xMode: "time" as XMode,
        labels: [] as string[],
        values: [] as number[],
        categories: [] as string[],
        series: [] as Array<{ name: string; data: Array<number | null> }>,
        multiSeries: false,
        recommended: "bar" as ChartType,
      };
    }

    const canChooseX = axes.hasTime && axes.hasGeo;
    const xMode: XMode = canChooseX ? selectedXMode : axes.hasTime ? "time" : "geo";
    const labelKey =
      xMode === "time"
        ? axes.timeLabelKey || pickLabelKey(safeColumns, safeRows, valueKey, resolve)
        : axes.geoLabelKey || pickLabelKey(safeColumns, safeRows, valueKey, resolve);

    const valueKeyAccess = resolve(valueKey);

    const geoKeyRaw = axes.geoLabelKey ? resolve(axes.geoLabelKey) : "";
    const provinceFromTitle = dimensionMeta.isGeo ? extractProvinceFromTitle(title) : "";

    const wantsGeoMultiSeries = xMode === "time" && Boolean(geoKeyRaw) && geoOptions.length >= 2 && selectedGeoKeys.length > 0;

    // Helper to check if a label is quarterly
    const isQuarterlyLabel = (label: string) => /\b(triwulan|kuartal|quarter|q\s*[1-4]|q[1-4]|tw\s*[1-4])\b/i.test(label);
    
    // Helper to check if a label is yearly (year only, no month)
    const isYearlyLabel = (label: string, ym: ParsedYearMonth | null) => {
      if (!ym) return false;
      // Year-only if month=0 and has a year, OR if label is just a year
      return (ym.year > 0 && ym.month === 0) || /^\s*(19\d{2}|20\d{2})\s*$/.test(label);
    };

    const rawPointsWithGeo = safeRows
      .slice(0, 800)
      .map((r) => {
        const label = buildBestLabel(r, safeColumns, labelKey, resolve);
        const val = toNumberLoose(r?.[valueKeyAccess]);
        const geo = geoKeyRaw ? String(r?.[geoKeyRaw] ?? "").trim() : "";
        return { row: r, label, val, geo };
      })
      .filter((p) => p.label && p.val !== null && p.val !== undefined && !isNaN(p.val)) as Array<{ row: Record<string, any>; label: string; val: number; geo: string }>;

    // DEBUG: Focused Tahunan diagnostics in rawPointsWithGeo
    const tahunanInPoints = rawPointsWithGeo.filter(p => /tahunan|^\s*(19\d{2}|20\d{2}|2100)\s*$/.test(p.label));
    if (tahunanInPoints.length > 0) {
      const yearCounts = tahunanInPoints.reduce<Record<string, number>>((acc, p) => {
        const ym = parseYearMonth(p.label);
        const y = ym?.year ? String(ym.year) : p.label.match(/^\s*(19\d{2}|20\d{2}|2100)\s*$/)?.[1] || '(unknown)';
        acc[y] = (acc[y] || 0) + 1;
        return acc;
      }, {});
      const uniqueYearLabels = Array.from(new Set(tahunanInPoints.map(p => p.label)));
      console.log('[Tahunan in rawPointsWithGeo]:', {
        count: tahunanInPoints.length,
        yearCounts,
        uniqueLabels: uniqueYearLabels,
        valueKey: valueKey,
        samples: tahunanInPoints.slice(0, 6).map(p => ({ label: p.label, val: p.val, geo: p.geo })),
      });
    } else {
      console.log('[Tahunan in rawPointsWithGeo]: NO Tahunan rows found after value filter (val !== null)');
    }

    // Helper to check if a label is "Tahunan" (yearly aggregate) or year-only
    const isTahunanOrYearLabel = (label: string, ym: ParsedYearMonth | null) => {
      // Check for "Tahunan", "Annual", "Yearly" keywords
      if (/\b(tahunan|annual|yearly)\b/i.test(label)) return true;
      // Check for year-only format (just "2023", "2024", etc.)
      if (/^\s*(19\d{2}|20\d{2}|2100)\s*$/.test(label)) return true;
      // Check if parsed as year-only (month = 0)
      if (ym && ym.year > 0 && ym.month === 0) return true;
      return false;
    };

    // Apply period type filter
    let filteredPointsWithGeo = selectedPeriodType === "all" 
      ? rawPointsWithGeo 
      : rawPointsWithGeo.filter((p) => {
          const ym = parseYearMonth(p.label);
          if (selectedPeriodType === "quarterly") {
            return isQuarterlyLabel(p.label);
          } else if (selectedPeriodType === "yearly") {
            return isTahunanOrYearLabel(p.label, ym);
          }
          return true;
        });
    
    // Auto-switch metric if period filter results in insufficient data
    // (e.g., y-on-y might be null for older Tahunan rows, but c-to-c has values)
    if (selectedPeriodType === "yearly" && filteredPointsWithGeo.length < rawPointsWithGeo.length * 0.3 && valueCandidates.length > 1) {
      // Try other metrics to see if they have better coverage for yearly data
      let bestMetric = valueKey;
      let bestCount = filteredPointsWithGeo.length;
      
      for (const candidateMetric of valueCandidates) {
        if (candidateMetric === valueKey) continue;
        const candidateAccess = resolve(candidateMetric);
        const testPoints = safeRows
          .slice(0, 800)
          .map((r) => {
            const label = buildBestLabel(r, safeColumns, labelKey, resolve);
            const val = toNumberLoose(r?.[candidateAccess]);
            return { label, val };
          })
          .filter((p) => p.label && p.val !== null && p.val !== undefined && !isNaN(p.val) && isTahunanOrYearLabel(p.label, parseYearMonth(p.label)));
        
        if (testPoints.length > bestCount) {
          bestMetric = candidateMetric;
          bestCount = testPoints.length;
        }
      }
      
      // If found a better metric, rebuild points with that metric
      if (bestMetric !== valueKey && bestCount >= rawPointsWithGeo.length * 0.5) {
        console.log(`[Auto-switch metric] ${valueKey} → ${bestMetric} for yearly data (${filteredPointsWithGeo.length} → ${bestCount} rows)`);
        const bestAccess = resolve(bestMetric);
        const rebuiltPoints = safeRows
          .slice(0, 800)
          .map((r) => {
            const label = buildBestLabel(r, safeColumns, labelKey, resolve);
            const val = toNumberLoose(r?.[bestAccess]);
            const geo = geoKeyRaw ? String(r?.[geoKeyRaw] ?? "").trim() : "";
            return { row: r, label, val, geo };
          })
          .filter((p) => p.label && p.val !== null && p.val !== undefined && !isNaN(p.val)) as Array<{ row: Record<string, any>; label: string; val: number; geo: string }>;
        
        const rebuiltFiltered = rebuiltPoints.filter((p) => {
          const ym = parseYearMonth(p.label);
          return isTahunanOrYearLabel(p.label, ym);
        });
        
        filteredPointsWithGeo = rebuiltFiltered;
        // Update the effective valueKey for this render
        // (Note: this won't change selectedValueKey state, just this computed path)
      }
    }

    // Helper to get year from point (either __preview_year or parsed from label)
    const getPointYear = (p: { row: Record<string, any>; label: string }): string | null => {
      const py = String((p.row as any)?.__preview_year ?? "").trim();
      if (/^(19\d{2}|20\d{2}|2100)$/.test(py)) return py;
      const ym = parseYearMonth(p.label);
      if (ym && ym.year >= 1990 && ym.year <= 2100) return String(ym.year);
      return null;
    };

    // Apply year filter (only if specific years are selected)
    const applyYearFilter = selectedYears.length > 0 && selectedYears.length < availableYears.length;
    const filteredByYear = applyYearFilter
      ? filteredPointsWithGeo.filter((p) => {
          const y = getPointYear(p);
          return y ? selectedYears.includes(y) : true;
        })
      : filteredPointsWithGeo;

    // Log multi-series decision
    console.log('[Chart] wantsGeoMultiSeries:', wantsGeoMultiSeries, {
      xMode,
      geoKeyRaw: Boolean(geoKeyRaw),
      geoOptionsLen: geoOptions.length,
      selectedGeoKeysLen: selectedGeoKeys.length,
      filteredByYearLen: filteredByYear.length,
    });

    // Multi-series time chart: build one series per selected wilayah.
    // Note: if user clears selection, keep multi-series mode (empty series) so the chart becomes blank.
    if (wantsGeoMultiSeries) {
      const points = filteredByYear.filter((p) => p.geo);

      // Parse all points, enriching year=0 from __preview_year when available
      const allParsedPoints = points
        .map((p) => {
          let ym = parseYearMonth(p.label);
          // If label is quarter/month-only (year=0), try to get year from __preview_year
          if (ym && ym.year === 0) {
            const previewYear = normalizeYear((p.row as any)?.__preview_year);
            if (previewYear) {
              ym = { year: previewYear, month: ym.month, key: previewYear * 100 + ym.month };
            }
          }
          return { ...p, ym };
        })
        .filter((p) => p.ym) as Array<{ row: Record<string, any>; label: string; val: number; geo: string; ym: ParsedYearMonth }>;
      
      // Check if all data is quarter-only AND no __preview_year was available to enrich
      const allYearZeroMulti = allParsedPoints.length > 0 && allParsedPoints.every((p) => p.ym.year === 0);
      
      // Debug: log multi-series state (always log to help diagnose issues)
      const samplePoints = allParsedPoints.slice(0, 3);
      console.log('[Chart Multi] allYearZeroMulti:', allYearZeroMulti, {
        wantsGeoMultiSeries,
        pointsLen: points.length,
        allParsedLen: allParsedPoints.length,
        sampleLabels: samplePoints.map(p => p.label),
        sampleYears: samplePoints.map(p => p.ym.year),
        samplePreviewYear: samplePoints.map(p => (p.row as any)?.__preview_year),
      });
      
      // If quarter-only, skip multi-series datetime mode and fall through to single-series category mode
      if (allYearZeroMulti) {
        // Fall through to single-series / geo mode below
      } else {
        const parsed = allParsedPoints.filter((p) => p.ym.year > 0);

        // Build ordered time axis (chronological) as UTC timestamps.
        parsed.sort((a, b) => a.ym.key - b.ym.key);
        const uniqByKey = new Map<number, { x: number; label: string; ym: ParsedYearMonth }>();
        for (const p of parsed) {
          const x = toUtcTimestamp(p.ym);
          if (x === null) continue;
          if (!uniqByKey.has(p.ym.key)) uniqByKey.set(p.ym.key, { x, label: p.label, ym: p.ym });
        }
        let axis = Array.from(uniqByKey.values()).sort((a, b) => a.x - b.x);
        
        // If we couldn't parse any time axis (geo-only data without time labels),
        // fallback to non-multi-series mode below instead of showing empty chart.
        if (axis.length === 0) {
          // Fall through to single-series / geo mode below
        } else {
          const maxPoints = allowFullTimeRange ? Infinity : 36;
          if (axis.length > maxPoints) axis = axis.slice(axis.length - maxPoints);

          const idxByX = new Map<number, number>();
          axis.forEach((t, i) => idxByX.set(t.x, i));
          const labelByX = new Map<number, string>();
          for (const t of axis) labelByX.set(t.x, t.label);

          const keyToDisplay = new Map<string, string>();
          for (const opt of geoOptions) keyToDisplay.set(opt.key, opt.label);

          const selected = selectedGeoKeys.filter((k) => keyToDisplay.has(k));

          // Detect if this is year-only data (labels are "2020", "2021", etc.)
          const yearOnlyAxis = axis.length > 0 && axis.every((t) => /^(19\d{2}|20\d{2}|2100)$/.test(String(t.label || "").trim()));

          const series = selected.map((k) => {
            // For year-only data: use simple array format for proper category alignment
            // For datetime data: use {x: timestamp, y: value} format
            const agg = new Map<number, number>();
            // Use the already-enriched parsed points (with __preview_year applied)
            for (const p of parsed) {
              if (normGeoName(p.geo) !== k) continue;
              // p.ym is already enriched with __preview_year, so use it directly
              const x = toUtcTimestamp(p.ym);
              if (x === null) continue;
              const idx = idxByX.get(x);
              if (idx === undefined) continue;
              agg.set(idx, (agg.get(idx) || 0) + p.val);
            }
            
            if (yearOnlyAxis) {
              // Simple array format: [val1, val2, val3, ...] - index maps to category
              const data: (number | null)[] = axis.map(() => null);
              for (const [idx, v] of agg.entries()) {
                data[idx] = v;
              }
              return { name: keyToDisplay.get(k) || k, data };
            } else {
              // Datetime format: [{x: timestamp, y: value}, ...]
              const data: Array<{ x: number; y: number | null }> = axis.map((t) => ({ x: t.x, y: null }));
              for (const [idx, v] of agg.entries()) {
                data[idx] = { x: axis[idx].x, y: v };
              }
              return { name: keyToDisplay.get(k) || k, data };
            }
          });

          // Recommend line for multi-series time charts.
          return {
            valueKey,
            labelKey,
            xMode,
            labels: [],
            values: [],
            // For year-only: use actual labels. For datetime: use timestamps
            categories: yearOnlyAxis ? axis.map((t) => t.label) : axis.map((t) => String(t.x)),
            series,
            multiSeries: true,
            recommended: "line" as ChartType,
            _labelByX: Array.from(labelByX.entries()),
            _yearOnlyAxis: yearOnlyAxis,
          };
        }
      }
    }

    // Single-series fallback (for geo-only data or when multi-series time axis failed)
    // If we fell through from multi-series mode with geo selection, filter to selected geos
    const pointsForSingleSeries = wantsGeoMultiSeries && selectedGeoKeys.length > 0
      ? filteredByYear.filter((p) => selectedGeoKeys.includes(normGeoName(p.geo)))
      : filteredByYear;
    const rawPoints = pointsForSingleSeries.map((p) => ({ row: p.row, label: p.label, val: p.val }));

    // If using GEO as X and there are multiple periods available,
    // filter to the latest detected period to avoid summing across time.
    // Also respect year filter when applied
    let points = rawPoints;
    if (xMode === "geo" && axes.timeLabelKey) {
      const allPeriodParsed = rawPoints
        .map((p) => {
          let ym = parseYearMonth(buildBestLabel(p.row, safeColumns, axes.timeLabelKey, resolve));
          // Enrich year=0 from __preview_year
          if (ym && ym.year === 0) {
            const previewYear = normalizeYear((p.row as any)?.__preview_year);
            if (previewYear) {
              ym = { year: previewYear, month: ym.month, key: previewYear * 100 + ym.month };
            }
          }
          return { p, ym };
        })
        .filter((x) => x.ym) as Array<{ p: (typeof rawPoints)[number]; ym: ParsedYearMonth }>;
      
      // Use points with year > 0, or all points if year=0 (quarter-only)
      const periodParsed = allPeriodParsed.filter((x) => x.ym.year > 0);
      const ptsToUse = periodParsed.length > 0 ? periodParsed : allPeriodParsed;
      
      if (ptsToUse.length >= 6) {
        ptsToUse.sort((a, b) => a.ym.key - b.ym.key);
        // If year filter is active, use selected period from selected years
        const applyYearFilter = selectedYears.length > 0 && selectedYears.length < availableYears.length;
        let filteredByYearPts = ptsToUse;
        if (applyYearFilter) {
          filteredByYearPts = ptsToUse.filter((x) => {
            const yearStr = String(x.ym.year);
            return selectedYears.includes(yearStr);
          });
        }
        // Use selected period if available, otherwise use latest
        if (filteredByYearPts.length > 0) {
          const targetPeriod = selectedGeoPeriod || filteredByYearPts[filteredByYearPts.length - 1].ym.key;
          const matchingPeriod = filteredByYearPts.filter((x) => x.ym.key === targetPeriod);
          if (matchingPeriod.length > 0) {
            points = matchingPeriod.map((x) => x.p);
          } else {
            // Fallback to latest if selected period not found
            const latest = filteredByYearPts[filteredByYearPts.length - 1].ym.key;
            points = filteredByYearPts.filter((x) => x.ym.key === latest).map((x) => x.p);
          }
        } else {
          // Fallback to latest overall if no points match year filter
          const latest = ptsToUse[ptsToUse.length - 1].ym.key;
          points = ptsToUse.filter((x) => x.ym.key === latest).map((x) => x.p);
        }
      }
    }

    if (xMode === "time" && geoKeyRaw) {
      // Use pointsForSingleSeries (which respects geo selection) instead of filteredByYear
      const uniqGeo = new Set(pointsForSingleSeries.map((p) => normGeoName(p.geo)).filter(Boolean));
      const hasManyGeo = uniqGeo.size >= 3;
      if (hasManyGeo) {
        const provinceWanted = provinceFromTitle || "";
        const wantMalut = "maluku utara";
        const preferredGeoNorm = dimensionMeta.isGeo
          ? (provinceWanted && uniqGeo.has(provinceWanted) ? provinceWanted : "") ||
            (uniqGeo.has(wantMalut) ? wantMalut : "")
          : "";

        // Build per-period aggregation.
        const perLabel = new Map<string, { sum: number; count: number }>();

        if (preferredGeoNorm) {
          for (const p of pointsForSingleSeries) {
            if (normGeoName(p.geo) !== preferredGeoNorm) continue;
            const cur = perLabel.get(p.label) || { sum: 0, count: 0 };
            perLabel.set(p.label, { sum: cur.sum + p.val, count: cur.count + 1 });
          }
        }

        // If no preferred geo points were found (or title didn't match), fall back to mean across geo.
        if (!preferredGeoNorm || perLabel.size === 0) {
          perLabel.clear();
          for (const p of pointsForSingleSeries) {
            const cur = perLabel.get(p.label) || { sum: 0, count: 0 };
            perLabel.set(p.label, { sum: cur.sum + p.val, count: cur.count + 1 });
          }
        }

        points = Array.from(perLabel.entries()).map(([label, agg]) => ({ row: {}, label, val: agg.count ? agg.sum / agg.count : 0 }));
      }
    }

    // Aggregate by label (sum).
    const map = new Map<string, number>();
    for (const p of points) map.set(p.label, (map.get(p.label) || 0) + p.val);

    let labels = Array.from(map.keys());
    
    // Sort labels chronologically if they are year-like
    const allYearLabels = labels.every(l => /^\s*(19\d{2}|20\d{2}|2100)\s*$/.test(l));
    if (allYearLabels) {
      labels = labels.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }
    
    const values = labels.map((l) => map.get(l) || 0);

    // Use database chart config first, then profiler recommendation, then fallback to heuristic
    // Convert dbHint (string) to ChartRecommendation format
    const dbChartType = parsedDbConfig?.chart_type;
    const dbHint: ChartRecommendation | null = dbChartType 
      ? { 
          chartType: dbChartType, 
          xAxis: '', 
          yAxis: [], 
          alternatives: [], 
          reason: 'database config' 
        }
      : null;
    const profilerHint = profilerResult?.recommended || null;
    const finalHint = dbHint || profilerHint;
    const recommended: ChartType = recommendedTypeFromData(labels, values, xMode, finalHint);

    return { valueKey, labelKey, xMode, labels, values, categories: labels, series: [], multiSeries: false, recommended };
  }, [
    safeRows,
    safeColumns,
    selectedValueKey,
    valueCandidates,
    axes,
    selectedXMode,
    rowKeyMap,
    selectedGeoKeys.join("|"),
    geoOptions.map((g) => g.key).join("|"),
    title,
    profilerResult,
    parsedDbConfig,
    allowFullTimeRange,
    selectedPeriodType,
    selectedYears.join("|"),
    availableYears.join("|"),
  ]);

  const needsGeoSelection =
    axes.hasTime &&
    axes.hasGeo &&
    selectedXMode === "time" &&
    geoOptions.length >= 2 &&
    selectedGeoKeys.length === 0;

  const chartTypeKey = prepared.multiSeries
    ? "line"
    : prepared.recommended === "pie"
      ? "pie"
      : prepared.recommended === "line"
        ? "line"
        : "bar";

  // Include manualChartType in renderKey to force chart re-render when user changes type
  const renderKey = `${manualChartType}:${comparisonMode}:${chartTypeKey}:${prepared.labelKey}:${prepared.valueKey}:${prepared.multiSeries ? selectedGeoKeys.join('|') : ''}`;
  const chartId = useMemo(() => {
    const h = stableHash(renderKey);
    return `insights-${h}`;
  }, [renderKey]);

  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<{ dataMin: number; dataMax: number; min: number; max: number } | null>(null);
  const apexExecRef = useRef<((chartID: string, method: string, ...args: any[]) => Promise<any>) | null>(null);

  // If the dataset changes, allow attempting to render again.
  useEffect(() => {
    setApexBroken(false);
  }, [
    prepared.labelKey,
    prepared.valueKey,
    rows.length,
    Array.isArray(columns) ? columns.join("|") : "",
    prepared.recommended,
  ]);

  const top = useMemo(() => {
    if (prepared.multiSeries) {
      return { labels: prepared.categories || [], values: [] as number[] };
    }
    // Sanitize values: convert non-finite to 0
    const entries = prepared.labels.map((l, i) => {
      const rawVal = prepared.values[i];
      const val = typeof rawVal === 'number' && Number.isFinite(rawVal) ? rawVal : 0;
      return { label: l, value: val };
    });

    // Determine effective chart type for sorting logic
    const effectiveType = manualChartType === "auto" ? prepared.recommended : manualChartType;

    // For line chart: keep chronological order if labels are time-like.
    if (effectiveType === "line") {
      const parsed = entries
        .map((e) => ({ ...e, ym: parseYearMonth(e.label) }))
        .filter((e) => e.ym !== null) as Array<{ label: string; value: number; ym: ParsedYearMonth }>;
      if (parsed.length >= Math.min(6, entries.length)) {
        parsed.sort((a, b) => a.ym.key - b.ym.key);

        // Keep it readable when the range is long.
        const maxPoints = allowFullTimeRange ? Infinity : 36;
        const clipped = parsed.length > maxPoints ? parsed.slice(parsed.length - maxPoints) : parsed;
        return {
          labels: clipped.map((e) => e.label),
          values: clipped.map((e) => e.value),
        };
      }
    }

    // Default: show highest values first.
    entries.sort((a, b) => b.value - a.value);

    const max = effectiveType === "pie" ? 8 : 12;
    const sliced = entries.slice(0, max);
    // Final sanitization: ensure all values are finite numbers
    const safeLabels = sliced.map((e) => String(e.label || '').trim() || 'N/A');
    const safeValues = sliced.map((e) => Number.isFinite(e.value) ? e.value : 0);
    return {
      labels: safeLabels,
      values: safeValues,
    };
  }, [prepared.labels, prepared.values, prepared.recommended, prepared.multiSeries, prepared.categories, manualChartType]);

  // Effective chart height based on mode
  const effectiveChartHeight = useMemo(() => {
    if (isFullscreen) return Math.max(window.innerHeight - 200, 400);
    return CHART_HEIGHTS[chartHeight];
  }, [isFullscreen, chartHeight]);

  // Determine effective chart type (manual override or auto)
  const effectiveChartType = useMemo(() => {
    if (manualChartType === "auto") return prepared.recommended;
    // Don't allow pie for multi-series
    if (prepared.multiSeries && manualChartType === "pie") return "line";
    return manualChartType;
  }, [manualChartType, prepared.recommended, prepared.multiSeries]);

  // Download chart as PNG/SVG
  const handleDownload = useCallback(async (format: "png" | "svg") => {
    try {
      const ApexCharts = (await import("apexcharts")).default;
      const chartInstance = ApexCharts.getChartByID(chartId);
      if (!chartInstance) return;
      
      const { imgURI, svgURI } = await (chartInstance as any).dataURI({ scale: 2 });
      const uri = format === "svg" ? svgURI : imgURI;
      if (!uri) return;
      const link = document.createElement("a");
      link.href = uri;
      link.download = `grafik-${title || "data"}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }, [chartId, title]);

  // Download data as CSV
  const handleDownloadCSV = useCallback(() => {
    try {
      if (!safeColumns.length || !safeRows.length) return;
      
      // Build CSV content
      const headers = safeColumns.join(",");
      const csvRows = safeRows.map((row) => {
        return safeColumns.map((col) => {
          const val = row[col];
          // Escape values with commas or quotes
          if (val === null || val === undefined) return "";
          const strVal = String(val);
          if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
            return `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        }).join(",");
      });
      
      const csvContent = [headers, ...csvRows].join("\n");
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = `data-${title || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV download failed:", err);
    }
  }, [safeColumns, safeRows, title]);

  // Reset zoom
  const handleResetZoom = useCallback(async () => {
    try {
      const ApexCharts = (await import("apexcharts")).default;
      const chartInstance = ApexCharts.getChartByID(chartId);
      if (!chartInstance) return;
      await (chartInstance as any).resetSeries(true, true);
      setIsZoomed(false);
      if (zoomRef.current) {
        zoomRef.current = { ...zoomRef.current, min: zoomRef.current.dataMin, max: zoomRef.current.dataMax };
      }
    } catch (err) {
      console.error("Reset zoom failed:", err);
    }
  }, [chartId]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Handle comparison request
  const handleCompare = useCallback(async (data: ComparisonData) => {
    setComparisonData(data);
    setComparisonLoading(true);
    setComparisonError(null);
    setComparisonRows([]);
    setComparisonColumns([]);

    try {
      if (data.type === "period" && data.secondYear && sourceId) {
        // Fetch data for the comparison period
        const res = await fetch(`/api/data-preview?source_id=${sourceId}&period=${data.secondYear}`);
        if (!res.ok) throw new Error("Gagal memuat data periode pembanding");
        const json = await res.json();
        if (json.data?.columns && json.data?.data) {
          setComparisonColumns(json.data.columns);
          setComparisonRows(json.data.data);
        } else {
          throw new Error("Data periode pembanding tidak tersedia");
        }
      } else if (data.type === "indicator" && data.secondSourceId) {
        // Fetch data for the comparison indicator
        const year = title?.match(/\d{4}/)?.[0] || new Date().getFullYear().toString();
        const res = await fetch(`/api/data-preview?source_id=${data.secondSourceId}&period=${year}`);
        if (!res.ok) throw new Error("Gagal memuat data indikator pembanding");
        const json = await res.json();
        if (json.data?.columns && json.data?.data) {
          setComparisonColumns(json.data.columns);
          setComparisonRows(json.data.data);
        } else {
          throw new Error("Data indikator pembanding tidak tersedia");
        }
      }
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : "Terjadi kesalahan");
      setComparisonData(null);
    } finally {
      setComparisonLoading(false);
    }
  }, [sourceId, title]);

  // Clear comparison
  const clearComparison = useCallback(() => {
    setComparisonData(null);
    setComparisonRows([]);
    setComparisonColumns([]);
    setComparisonError(null);
  }, []);

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isFullscreen]);

  const chart = useMemo(() => {
    // Dark mode colors
    const textColor = isDark ? "#e5e7eb" : "#374151";
    const labelColor = isDark ? "#9ca3af" : "#6b7280";
    const gridColor = isDark ? "#374151" : "#e5e7eb";
    const tooltipBg = isDark ? "#1f2937" : "#ffffff";
    const tooltipBorder = isDark ? "#374151" : "#e5e7eb";
    const comparisonEnabled = comparisonMode !== "none" && effectiveChartType === "line" && prepared.xMode === "time";
    const comparisonLabel = comparisonMode === "yoy" ? "YoY (%)" : comparisonMode === "mom" ? "MoM (%)" : "";

    const base: ApexOptions = {
      chart: {
        id: chartId,
        fontFamily: "Outfit, sans-serif",
        toolbar: { show: false },
        background: "transparent",
        foreColor: textColor,
        animations: {
          enabled: true,
          speed: 400,
          dynamicAnimation: { enabled: true, speed: 350 },
        },
        events: {
          zoomed: () => setIsZoomed(true),
          scrolled: () => setIsZoomed(true),
        },
      },
      dataLabels: { enabled: false },
      grid: {
        borderColor: gridColor,
        yaxis: { lines: { show: true } },
        padding: { left: 10, right: 10 },
      },
      tooltip: {
        theme: isDark ? "dark" : "light",
        style: { fontFamily: "Outfit, sans-serif" },
      },
    };

    const currentHeight = effectiveChartHeight;

    if (effectiveChartType === "pie") {
      // Guard: pie chart needs at least 1 valid data point
      if (top.labels.length === 0 || top.values.length === 0) {
        return {
          type: "bar" as const,
          options: base,
          series: [],
          height: currentHeight,
        };
      }
      const options: ApexOptions = {
        ...base,
        colors: buildDistinctColors(top.labels.length || 1),
        chart: { ...base.chart, type: "pie", height: currentHeight },
        labels: top.labels.length > 0 ? top.labels : ['No Data'],
        legend: {
          show: true,
          showForSingleSeries: true,
          position: "bottom",
          fontFamily: "Outfit",
          fontSize: isFullscreen ? "14px" : "12px",
          floating: false,
          itemMargin: { horizontal: 8, vertical: 4 },
          labels: { colors: textColor },
        },
        tooltip: {
          ...base.tooltip,
          y: {
            formatter: (val: number) => formatNumberId2(val),
          },
        },
        responsive: [
          {
            breakpoint: 640,
            options: {
              legend: { position: "bottom" },
            },
          },
        ],
      };

      return {
        type: "pie" as const,
        options,
        series: top.values,
        height: currentHeight,
      };
    }

    if ((effectiveChartType === "line" || effectiveChartType === "bar") && prepared.multiSeries) {
      // Guard: need at least one series with data
      if (!prepared.series || prepared.series.length === 0) {
        return {
          type: "bar" as const,
          options: base,
          series: [],
          height: currentHeight,
        };
      }
      
      const colors = buildDistinctColors(prepared.series.length || 1);
      // Safely create labelByX Map - ensure it's always valid
      const rawLabelByX = ((prepared as any)._labelByX as Array<[number, string]>) || [];
      const labelByX = new Map<number, string>(
        Array.isArray(rawLabelByX) ? rawLabelByX.filter((e): e is [number, string] => 
          Array.isArray(e) && e.length === 2 && Number.isFinite(e[0]) && typeof e[1] === 'string'
        ) : []
      );
      const yearOnlyAxis = Boolean((prepared as any)._yearOnlyAxis);
      const xKeys = Array.from(labelByX.keys()).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      
      // Pre-compute label lookup for safer closure and detect year boundaries
      const labelLookup: Record<number, string> = {};
      const yearGroups: Array<{ year: number; startX: number; endX: number }> = [];
      let currentYear: number | null = null;
      let yearStartX: number | null = null;
      
      for (const [k, v] of labelByX.entries()) {
        labelLookup[k] = v;
        // Extract year from label
        const labelYear = v.match(/\b(19\d{2}|20\d{2}|2100)\b/)?.[1];
        const year = labelYear ? parseInt(labelYear, 10) : null;
        
        if (year && year !== currentYear) {
          // Save previous year group
          if (currentYear !== null && yearStartX !== null) {
            yearGroups.push({ year: currentYear, startX: yearStartX, endX: k });
          }
          // Start new year group
          currentYear = year;
          yearStartX = k;
        }
      }
      // Close last year group
      if (currentYear !== null && yearStartX !== null && xKeys.length > 0) {
        yearGroups.push({ year: currentYear, startX: yearStartX, endX: xKeys[xKeys.length - 1] });
      }
      
      // CRITICAL: Build categoriesArray from sorted xKeys, not from Map iteration order
      // Map.values() preserves insertion order which may not be chronological
      const categoriesArray = xKeys.map((x) => labelByX.get(x) || String(x));
      
      // Debug: log axis and categories for year-only data
      if (yearOnlyAxis) {
        console.log('[Chart Debug] yearOnlyAxis=true, xKeys:', xKeys.length, 'categoriesArray:', categoriesArray);
      }
      
      const options: ApexOptions = {
        ...base,
        colors,
        chart: {
          ...base.chart,
          type: effectiveChartType,
          height: currentHeight,
          zoom: {
            enabled: true,
            type: "x",
            autoScaleYaxis: true,
          },
          selection: {
            enabled: false,
            fill: { opacity: 0 },
            stroke: { width: 0 },
          },
        },
        stroke: effectiveChartType === "line" 
          ? { curve: "smooth", width: 2.5 } 
          : { show: false, width: 0 },
        plotOptions: {
          bar: {
            horizontal: false,
            columnWidth: "60%",
            borderRadius: 4,
            borderRadiusApplication: "end",
          },
        },
        annotations: effectiveChartType === "line" && !yearOnlyAxis && yearGroups.length > 1 ? {
          xaxis: yearGroups.map((yg, idx) => ({
            x: yg.startX,
            x2: yg.endX,
            fillColor: isDark ? (idx % 2 === 0 ? '#1f2937' : '#111827') : (idx % 2 === 0 ? '#f9fafb' : '#ffffff'),
            opacity: 0.3,
            label: {
              text: String(yg.year),
              borderWidth: 0,
              style: {
                background: 'transparent',
                color: labelColor,
                fontSize: '11px',
                fontWeight: 600,
                padding: { left: 4, right: 4, top: 2, bottom: 2 },
              },
              position: 'top',
              offsetY: -5,
              textAnchor: 'middle',
            },
          })),
        } : undefined,
        xaxis: {
          // Always use category axis for discrete period data - ensures perfect label-to-dot alignment
          type: "category",
          categories: categoriesArray,
          tickPlacement: "on", // Critical: labels directly under data points
          axisBorder: { show: false },
          axisTicks: { show: false },
          labels: {
            rotate: yearOnlyAxis ? 0 : -45,
            rotateAlways: false,
            hideOverlappingLabels: false,
            trim: !yearOnlyAxis,
            maxHeight: 80,
            style: { fontSize: '10px', colors: labelColor },
          },
        },
        yaxis: {
          title: { 
            text: prepared.valueKey
              ? `${String(prepared.valueKey).replace(/[-_]/g, ' ').toUpperCase()}${comparisonEnabled ? ` • ${comparisonLabel}` : ""}`
              : undefined,
            style: { fontSize: '11px', fontWeight: 500, color: labelColor }
          },
          labels: { 
            formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)),
            style: { colors: labelColor },
          },
        },
        tooltip: {
          ...base.tooltip,
          x: {
            formatter: (value: number) => {
              const x = Number(value);
              const fromLookup = Number.isFinite(x) ? labelLookup[x] : undefined;
              if (fromLookup) return fromLookup;
              if (Number.isFinite(x) && yearOnlyAxis) return String(new Date(x).getUTCFullYear());
              return String(value || '');
            },
          },
          y: { formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)) },
        },
        legend: {
          show: true,
          showForSingleSeries: true,
          position: "bottom",
          fontFamily: "Outfit",
          fontSize: isFullscreen ? "14px" : "12px",
          floating: false,
          itemMargin: { horizontal: 8, vertical: 4 },
          labels: { colors: textColor },
          onItemClick: { toggleDataSeries: true },
          onItemHover: { highlightDataSeries: true },
        },
        markers: effectiveChartType === "line" ? {
          size: 4,
          strokeWidth: 0,
          hover: { size: 6 },
        } : { size: 0 },
      };

      const keyByX = new Map<number, number>();
      for (const [x, label] of labelByX.entries()) {
        const ym = parseYearMonth(label);
        if (ym && ym.year > 0) {
          keyByX.set(x, ym.year * 100 + ym.month);
        }
      }

      // Sanitize series data: ensure all y values are finite numbers or null
      const sanitizedSeries = (prepared.series || []).map((s: any) => {
        const sanitizedData = (s.data || []).map((d: any) => {
          if (effectiveChartType === "bar") {
            // Bar chart: extract y value
            const y = typeof d === 'object' && d !== null ? d.y : d;
            return Number.isFinite(y) ? y : 0;
          }
          // Line chart: keep {x, y} format but sanitize
          if (typeof d === 'object' && d !== null) {
            const x = Number.isFinite(d.x) ? d.x : 0;
            const y = Number.isFinite(d.y) ? d.y : null;
            return { x, y };
          }
          return { x: 0, y: null };
        });
        return { name: s.name || 'Series', data: sanitizedData };
      });

      const seriesToRender = comparisonEnabled
        ? sanitizedSeries.map((s: any) => {
            const valueByKey = new Map<number, number>();
            const baseData = Array.isArray(s.data) ? s.data : [];
            for (const d of baseData) {
              if (!d || typeof d !== "object") continue;
              const x = Number(d.x);
              const y = Number(d.y);
              const key = keyByX.get(x);
              if (!Number.isFinite(x) || !Number.isFinite(y) || !key) continue;
              valueByKey.set(key, y);
            }

            const data = xKeys.map((x, idx) => {
              const key = keyByX.get(x);
              if (!key) return { x, y: null };
              const cur = valueByKey.get(key);
              if (!Number.isFinite(cur as number)) return { x, y: null };
              let prevKey: number | null = null;
              if (comparisonMode === "yoy") {
                const year = Math.floor(key / 100);
                const month = key % 100;
                prevKey = (year - 1) * 100 + month;
              } else if (comparisonMode === "mom") {
                const prevX = idx > 0 ? xKeys[idx - 1] : null;
                prevKey = prevX !== null ? keyByX.get(prevX) || null : null;
              }
              const prev = prevKey ? valueByKey.get(prevKey) : null;
              if (!Number.isFinite(prev as number) || !prev) return { x, y: null };
              return { x, y: ((cur as number) - (prev as number)) / (prev as number) * 100 };
            });

            return {
              name: comparisonEnabled ? `${s.name || 'Series'} ${comparisonLabel}` : s.name || 'Series',
              data,
            };
          })
        : sanitizedSeries;

      return {
        type: effectiveChartType as "line" | "bar",
        options,
        series: seriesToRender,
        height: currentHeight,
      };
    }

    // Single-series time line chart: prefer datetime axis for pinch/zoom.
    if (effectiveChartType === "line" && prepared.xMode === "time") {
      // First pass: parse all labels to detect structure
      const allParsed = top.labels
        .map((l, i) => ({ l, v: top.values[i], ym: parseYearMonth(l) }))
        .filter((x) => x.ym && Number.isFinite(x.v)) as Array<{ l: string; v: number; ym: ParsedYearMonth }>;
      
      // Check if data is quarter-only (all year === 0) - use category axis for these
      const allYearZero = allParsed.length > 0 && allParsed.every((x) => x.ym.year === 0);
      
      // For datetime axis, require year > 0
      const parsed = allYearZero
        ? [] // Force fallback to category axis for quarter-only data
        : allParsed.filter((x) => x.ym.year > 0);

      // Relaxed requirement: show datetime line chart with at least 3 points
      const canDatetime = parsed.length >= Math.min(3, top.labels.length);
      if (canDatetime) {
        const points = parsed
          .map((p) => {
            const x = toUtcTimestamp(p.ym);
            return x === null ? null : { x, y: p.v, label: p.l };
          })
          .filter(Boolean) as Array<{ x: number; y: number; label: string }>;
        points.sort((a, b) => a.x - b.x);
        
        // Pre-compute label lookup for safer closure (avoid Map.get in formatter)
        const labelLookup2: Record<number, string> = {};
        for (const p of points) {
          if (!(p.x in labelLookup2)) labelLookup2[p.x] = p.label;
        }

        const keyByX2 = new Map<number, number>();
        for (const p of points) {
          const ym = parseYearMonth(p.label);
          if (ym && ym.year > 0) {
            keyByX2.set(p.x, ym.year * 100 + ym.month);
          }
        }

        const comparisonPoints = comparisonEnabled
          ? points.map((p, idx) => {
              const key = keyByX2.get(p.x);
              if (!key || !Number.isFinite(p.y)) return { x: p.x, y: null };
              let prevKey: number | null = null;
              if (comparisonMode === "yoy") {
                const year = Math.floor(key / 100);
                const month = key % 100;
                prevKey = (year - 1) * 100 + month;
              } else if (comparisonMode === "mom") {
                const prev = idx > 0 ? points[idx - 1] : null;
                prevKey = prev ? keyByX2.get(prev.x) || null : null;
              }
              const prev = prevKey ? points.find((pp) => keyByX2.get(pp.x) === prevKey)?.y : null;
              if (!Number.isFinite(prev as number) || !prev) return { x: p.x, y: null };
              return { x: p.x, y: ((p.y as number) - (prev as number)) / (prev as number) * 100 };
            })
          : points;

        const yearOnlyAxis = points.length > 0 && points.every((p) => /^(19\d{2}|20\d{2}|2100)$/.test(String(p.label || "").trim()));

        const options: ApexOptions = {
          ...base,
          colors: buildDistinctColors(2),
          chart: {
            ...base.chart,
            type: "line",
            height: 260,
            zoom: {
              enabled: true,
              type: "x",
              autoScaleYaxis: true,
            },
            selection: {
              enabled: false,
              fill: { opacity: 0 },
              stroke: { width: 0 },
            },
          },
          stroke: { curve: "smooth", width: 2.5 },
          markers: {
            size: 4,
            strokeWidth: 0,
            hover: { size: 6 },
          },
          xaxis: {
            // Use category axis for proper label-to-dot alignment
            type: "category",
            categories: points.map((p) => p.label),
            tickPlacement: "on", // Critical: labels directly under data points
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: {
              rotate: yearOnlyAxis ? 0 : -45,
              rotateAlways: false,
              hideOverlappingLabels: false,
              trim: !yearOnlyAxis,
              maxHeight: 80,
              style: { fontSize: '10px', colors: '#6b7280' },
            },
          },
          yaxis: {
            title: { 
              text: prepared.valueKey
                ? `${String(prepared.valueKey).replace(/[-_]/g, ' ').toUpperCase()}${comparisonEnabled ? ` • ${comparisonLabel}` : ""}`
                : undefined,
              style: { fontSize: '11px', fontWeight: 500, color: '#6b7280' }
            },
            labels: { formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)) },
          },
          tooltip: {
            // For category axis, x formatter receives category index or label
            y: { formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)) },
          },
          legend: { show: false },
        };

        // For category axis: use simple array of values (not {x, y} objects)
        const sanitizedValues = comparisonPoints
          .map((p) => (Number.isFinite(p.y) ? p.y : null));
        
        if (sanitizedValues.every((v) => v === null)) {
          // Fallback if no valid points
          return {
            type: "bar" as const,
            options: base,
            series: [],
            height: currentHeight,
          };
        }

        return {
          type: "line" as const,
          options,
          series: [{ name: comparisonEnabled ? `${prepared.valueKey || "Value"} ${comparisonLabel}` : prepared.valueKey || "Value", data: sanitizedValues }],
          height: currentHeight,
        };
      }
    }

    // Fallback single-series bar/line chart
    const comparisonValues = comparisonEnabled && effectiveChartType === "line"
      ? top.labels.map((label, idx) => {
          const ym = parseYearMonth(label);
          if (!ym || ym.year <= 0) return null;
          const current = top.values[idx];
          if (!Number.isFinite(current)) return null;
          if (comparisonMode === "yoy") {
            const prevKey = (ym.year - 1) * 100 + ym.month;
            const prevIdx = top.labels.findIndex((l) => {
              const prevYm = parseYearMonth(l);
              return prevYm && prevYm.year > 0 && prevYm.year * 100 + prevYm.month === prevKey;
            });
            const prev = prevIdx >= 0 ? top.values[prevIdx] : null;
            if (!Number.isFinite(prev as number) || !prev) return null;
            return ((current as number) - (prev as number)) / (prev as number) * 100;
          }

          if (comparisonMode === "mom") {
            const prev = idx > 0 ? top.values[idx - 1] : null;
            if (!Number.isFinite(prev as number) || !prev) return null;
            return ((current as number) - (prev as number)) / (prev as number) * 100;
          }

          return null;
        })
      : top.values;

    const options: ApexOptions = {
      ...base,
      colors: buildDistinctColors(2),
      chart:
        effectiveChartType === "line"
          ? {
              ...base.chart,
              type: "line",
              height: currentHeight,
              zoom: {
                enabled: true,
                type: "x",
                autoScaleYaxis: true,
              },
              selection: {
                fill: { opacity: 0 },
                stroke: { width: 0 },
              },
            }
          : { ...base.chart, type: "bar", height: currentHeight },
      stroke:
        effectiveChartType === "line"
          ? {
              curve: "smooth",
              width: 2.5,
            }
          : { show: false, width: 0 },
      markers: effectiveChartType === "line" ? {
        size: 4,
        strokeWidth: 0,
        hover: { size: 6 },
      } : { size: 0 },
      // Keep plotOptions stable to avoid ApexCharts update-path crashes
      // when toggling chart type.
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: "55%",
          borderRadius: 5,
          borderRadiusApplication: "end",
        },
      },
      xaxis: {
        type: "category",
        categories: top.labels,
        tickPlacement: "on", // Critical: labels directly under data points/bars
        title: {
          text: prepared.xMode === 'time' ? 'Periode' : prepared.labelKey ? String(prepared.labelKey).replace(/[-_]/g, ' ') : undefined,
          style: { fontSize: '11px', fontWeight: 500, color: labelColor },
          offsetY: 8,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          rotate: -45,
          rotateAlways: false,
          trim: true,
          maxHeight: 80,
          style: { fontSize: '10px', colors: labelColor },
        },
      },
      yaxis: {
        title: { 
          text: prepared.valueKey
            ? `${String(prepared.valueKey).replace(/[-_]/g, ' ').toUpperCase()}${comparisonEnabled ? ` • ${comparisonLabel}` : ""}`
            : undefined,
          style: { fontSize: '11px', fontWeight: 500, color: labelColor }
        },
        labels: {
          formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)),
          style: { colors: labelColor },
        },
      },
      tooltip: {
        ...base.tooltip,
        y: {
          formatter: (val: number) => (comparisonEnabled ? formatPercentId(val) : formatNumberId2(val)),
        },
      },
      legend: { show: false },
    };

    const chartType: "line" | "bar" = effectiveChartType === "line" ? "line" : "bar";
    // Guard: ensure series data is valid
    const safeSeriesData = (comparisonValues || []).map((v) => (Number.isFinite(v as number) ? (v as number) : 0));
    return {
      type: chartType,
      options,
      series: [{ name: comparisonEnabled ? `${prepared.valueKey || "Value"} ${comparisonLabel}` : prepared.valueKey || "Value", data: safeSeriesData }],
      height: currentHeight,
    };
  }, [effectiveChartType, effectiveChartHeight, isFullscreen, prepared.multiSeries, prepared.categories, prepared.series, top.labels, top.values, prepared.valueKey, prepared.xMode, chartId, manualChartType, isDark, comparisonMode]);

  const noData = !prepared.valueKey || !prepared.labelKey || top.labels.length === 0;
  const hasFiniteValues = top.values.length > 0 && top.values.every((n) => Number.isFinite(n));
  const hasEmptyData = (prepared.multiSeries 
    ? (prepared.categories?.length || 0) === 0 || (prepared.series?.length || 0) === 0
    : top.labels.length === 0 || top.values.length === 0);
  const canRender = !hasEmptyData && (prepared.multiSeries
    ? Boolean(prepared.valueKey) && (prepared.categories?.length || 0) > 0 && (prepared.series?.length || 0) > 0 && !apexBroken
    : !noData && hasFiniteValues && !apexBroken);

  // Debug logging to trace canRender issues
  if (process.env.NODE_ENV === 'development' || !canRender) {
    console.log('[Chart Debug] canRender:', canRender, {
      multiSeries: prepared.multiSeries,
      valueKey: prepared.valueKey,
      categoriesLen: prepared.categories?.length || 0,
      seriesLen: prepared.series?.length || 0,
      apexBroken,
      noData,
      hasFiniteValues,
      topLabelsLen: top.labels.length,
      topValuesLen: top.values.length,
    });
  }

  // Two-finger pinch zoom for datetime line charts.
  useEffect(() => {
    if (!canRender) return;
    if (chart.type !== "line") return;
    const xaxisType = (chart.options?.xaxis as any)?.type;
    if (xaxisType !== "datetime") return;

    let cancelled = false;
    // Lazy-load ApexCharts (browser-only) to avoid SSR `window` issues.
    if (!apexExecRef.current) {
      void import("apexcharts").then((mod: any) => {
        if (cancelled) return;
        const apex = mod?.default || mod;
        if (apex && typeof apex.exec === "function") {
          apexExecRef.current = apex.exec.bind(apex);
        }
      });
    }

    // Extract X range from series data ({x,y}).
    const xs: number[] = [];
    const seriesArr = (chart.series as any[]) || [];
    for (const s of seriesArr) {
      const data = (s && (s.data as any[])) || [];
      for (const pt of data) {
        const x = typeof pt === "object" && pt ? Number((pt as any).x) : NaN;
        if (Number.isFinite(x)) xs.push(x);
      }
    }
    if (xs.length < 2) return;
    xs.sort((a, b) => a - b);
    const dataMin = xs[0];
    const dataMax = xs[xs.length - 1];

    // Reset zoom range when dataset changes.
    zoomRef.current = { dataMin, dataMax, min: dataMin, max: dataMax };

    const el = chartAreaRef.current;
    if (!el) return;

    let pinchStart: { dist: number; min: number; max: number } | null = null;

    const dist = (t1: Touch, t2: Touch) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const z = zoomRef.current;
      if (!z) return;
      pinchStart = { dist: dist(e.touches[0], e.touches[1]), min: z.min, max: z.max };
    };

    const onMove = (e: TouchEvent) => {
      if (!pinchStart) return;
      if (e.touches.length !== 2) return;
      // Prevent the browser from treating this as page zoom/scroll.
      e.preventDefault();

      const z = zoomRef.current;
      if (!z) return;

      const d0 = pinchStart.dist;
      const d1 = dist(e.touches[0], e.touches[1]);
      if (!Number.isFinite(d0) || d0 <= 0 || !Number.isFinite(d1) || d1 <= 0) return;

      const factor = d1 / d0;
      const startRange = pinchStart.max - pinchStart.min;
      if (!Number.isFinite(startRange) || startRange <= 0) return;

      // Fingers apart => zoom in (smaller range).
      const nextRange = clamp(startRange / factor, 24 * 60 * 60 * 1000, z.dataMax - z.dataMin);
      const center = (pinchStart.min + pinchStart.max) / 2;
      let nextMin = center - nextRange / 2;
      let nextMax = center + nextRange / 2;

      if (nextMin < z.dataMin) {
        const shift = z.dataMin - nextMin;
        nextMin += shift;
        nextMax += shift;
      }
      if (nextMax > z.dataMax) {
        const shift = nextMax - z.dataMax;
        nextMin -= shift;
        nextMax -= shift;
      }
      nextMin = clamp(nextMin, z.dataMin, z.dataMax);
      nextMax = clamp(nextMax, z.dataMin, z.dataMax);
      if (nextMax - nextMin < 24 * 60 * 60 * 1000) return;

      zoomRef.current = { ...z, min: nextMin, max: nextMax };
      const exec = apexExecRef.current;
      if (exec) void exec(chartId, "zoomX", nextMin, nextMax);
    };

    const onEnd = () => {
      pinchStart = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    el.addEventListener("touchend", onEnd, { capture: true } as any);
    el.addEventListener("touchcancel", onEnd, { capture: true } as any);
    return () => {
      cancelled = true;
      el.removeEventListener("touchstart", onStart as any, true);
      el.removeEventListener("touchmove", onMove as any, true);
      el.removeEventListener("touchend", onEnd as any, true);
      el.removeEventListener("touchcancel", onEnd as any, true);
    };
  }, [canRender, chartId, chart.options, chart.series, chart.type]);

  useEffect(() => {
    if (!canRender) {
      setChartBooting(false);
      return;
    }
    // Show a brief circular loader on first mount per renderKey.
    setChartBooting(true);
    const t = setTimeout(() => setChartBooting(false), 280);
    return () => clearTimeout(t);
     
  }, [renderKey, canRender]);

  useEffect(() => {
    if (!canRender) return;

    // Handler for unhandled Promise rejections (async ApexCharts errors)
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = (event && (event as any).reason) || "";
      const msg = String(reason?.message || reason || "");
      const stack = String(reason?.stack || "");
      // ApexCharts sometimes rejects internally and spams console; if that happens,
      // disable the chart for this dataset and prevent default logging.
      // Detect ApexCharts errors by:
      // 1. Message pattern like "Cannot read properties of undefined (reading 'xxx')"
      // 2. Stack trace containing apexcharts-related code patterns
      const isApexError = (
        // Direct ApexCharts error patterns in message
        /\b(colors|_extendSeries)\b/i.test(msg) ||
        // Common "undefined property" errors from ApexCharts initialization
        (/Cannot read properties of (undefined|null)/i.test(msg) && 
         (/\breading ['"]?(line|size|colors|stroke|font|series|data|chart|options|xaxis|yaxis)['"]?\b/i.test(msg) ||
          /apex/i.test(stack) ||
          // Match minified ApexCharts stack patterns (e.g., "at t.value", "at new t")
          /at (new )?t[.\s(]/i.test(stack)))
      );
      
      if (isApexError) {
        console.error('❌ [ApexCharts Error - Rejection]:', {
          message: msg,
          stack: stack.substring(0, 500),
          reason,
        });
        event.preventDefault();
        setApexBroken(true);
      }
    };

    // Handler for synchronous errors (also from ApexCharts)
    const errorHandler = (event: ErrorEvent) => {
      const msg = String(event?.message || "");
      const stack = String(event?.error?.stack || "");
      const filename = String(event?.filename || "");
      
      // Detect ApexCharts synchronous errors
      const isApexError = (
        /\b(colors|_extendSeries)\b/i.test(msg) ||
        (/Cannot read properties of (undefined|null)/i.test(msg) && 
         (/\breading ['"]?(line|size|colors|stroke|font|series|data|chart|options|xaxis|yaxis)['"]?\b/i.test(msg) ||
          /apex/i.test(stack) ||
          /apex/i.test(filename) ||
          /at (new )?t[.\s(]/i.test(stack)))
      );
      
      if (isApexError) {
        console.error('❌ [ApexCharts Error - Sync]:', {
          message: msg,
          stack: stack.substring(0, 500),
          filename,
        });
        event.preventDefault();
        setApexBroken(true);
      }
    };

    window.addEventListener("unhandledrejection", rejectionHandler);
    window.addEventListener("error", errorHandler);
    return () => {
      window.removeEventListener("unhandledrejection", rejectionHandler);
      window.removeEventListener("error", errorHandler);
    };
  }, [canRender]);

  // Fullscreen modal wrapper
  const chartContent = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {title || "Grafik"}
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {manualChartType === "auto" ? "Auto" : "Manual"}: {effectiveChartType.toUpperCase()} • X: {prepared.labelKey || (prepared.xMode === "geo" ? dimensionMeta.label : "Periode")} • Y: {prepared.valueKey || "-"}
            {comparisonMode !== "none" ? ` • Mode: ${comparisonMode === "yoy" ? "YoY" : "MoM"}` : ""}
          </p>
          {/* Data coverage indicator */}
          {availableYears.length > 1 && selectedXMode === "time" && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              📊 Data: {availableYears[0]}-{availableYears[availableYears.length - 1]} ({availableYears.length} tahun)
              {selectedYears.length > 0 && selectedYears.length < availableYears.length && (
                <span className="ml-1 text-brand-500 dark:text-brand-400">
                  • Filter: {selectedYears.length === 1 ? selectedYears[0] : `${selectedYears.length} tahun dipilih`}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Action buttons - download, fullscreen, reset zoom */}
        <div className="flex items-center gap-1.5">
          {/* Chart type toggle */}
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
            {/* Line chart: only show when X is time/periode */}
            {selectedXMode === "time" && (
              <button
                type="button"
                onClick={() => {
                  setApexBroken(false);
                  setManualChartType("line");
                }}
                className={`rounded-md p-1.5 transition-colors ${
                  effectiveChartType === "line"
                    ? "bg-white text-brand-500 shadow-sm dark:bg-gray-700 dark:text-brand-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                title="Grafik Garis"
              >
                <LineChartIcon className="h-4 w-4" />
              </button>
            )}
            {/* Bar chart: only show when X is geo/wilayah */}
            {selectedXMode === "geo" && (
              <button
                type="button"
                onClick={() => {
                  setApexBroken(false);
                  setManualChartType("bar");
                }}
                className={`rounded-md p-1.5 transition-colors ${
                  effectiveChartType === "bar"
                    ? "bg-white text-brand-500 shadow-sm dark:bg-gray-700 dark:text-brand-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                title="Grafik Batang"
              >
                <BarChartIcon className="h-4 w-4" />
              </button>
            )}
            {/* Pie chart: show when data has geo dimension and single series */}
            {axes.hasGeo && !prepared.multiSeries && (
              <button
                type="button"
                onClick={() => {
                  setApexBroken(false);
                  // Auto-switch to geo mode if not already
                  if (selectedXMode !== "geo") {
                    setSelectedXMode("geo");
                  }
                  setManualChartType("pie");
                }}
                className={`rounded-md p-1.5 transition-colors ${
                  effectiveChartType === "pie"
                    ? "bg-white text-brand-500 shadow-sm dark:bg-gray-700 dark:text-brand-400"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                title="Grafik Lingkaran"
              >
                <PieChartIconSmall className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-gray-700" />

          {isZoomed && (
            <button
              type="button"
              onClick={handleResetZoom}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="Reset Zoom"
            >
              <ResetZoomIcon className="h-4 w-4" />
            </button>
          )}

          {/* Compare button */}
          {sourceId && (
            <>
              {comparisonData ? (
                <button
                  type="button"
                  onClick={clearComparison}
                  className="flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/30"
                  title="Hapus Perbandingan"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span className="hidden sm:inline">Hapus</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCompareModal(true)}
                  className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  title="Bandingkan"
                >
                  <CompareIcon className="h-4 w-4" />
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => handleDownload("png")}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title="Download PNG"
          >
            <DownloadIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => handleDownload("svg")}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title="Download SVG"
          >
            <SvgIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleDownloadCSV}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title="Download CSV"
          >
            <CsvIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Second row: data controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {axes.hasTime && axes.hasGeo ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap">X</span>
            <select
              value={selectedXMode}
              onChange={(e) => {
                setApexBroken(false);
                const newMode = e.target.value as XMode;
                setSelectedXMode(newMode);
                // Auto-switch chart type based on X-axis mode only if user hasn't explicitly chosen pie
                if (newMode === "geo" && manualChartType !== "pie") {
                  // Switched to Wilayah/Kategori - default to bar chart
                  setManualChartType("bar");
                } else if (newMode === "time") {
                  // Switched to Periode - force line chart
                  setManualChartType("line");
                }
              }}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="time">Periode</option>
              <option value="geo">{dimensionMeta.label}</option>
            </select>
          </label>
        ) : null}

        {/* Period type selector - show when X is time and data has multiple period types */}
        {selectedXMode === "time" && axes.hasTime && (periodTypeOptions.hasQuarterly || periodTypeOptions.hasYearly) ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap font-medium">📅 Periode</span>
            <select
              value={selectedPeriodType}
              onChange={(e) => {
                setApexBroken(false);
                setSelectedPeriodType(e.target.value as PeriodType);
              }}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="all">Semua Periode</option>
              {periodTypeOptions.hasQuarterly && <option value="quarterly">Triwulanan</option>}
              {periodTypeOptions.hasYearly && <option value="yearly">Tahunan</option>}
            </select>
          </label>
        ) : null}

        {/* Year selector - checklist for line charts, dropdown for bar/pie */}
        {axes.hasTime && availableYears.length >= 2 ? (
          selectedXMode === "time" ? (
            // Checklist dropdown for line charts (multi-select)
            <div className="relative text-xs text-gray-600 dark:text-gray-300" data-year-dropdown="1">
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap font-medium">📆 Tahun</span>
                <button
                  type="button"
                  onClick={() => setYearDropdownOpen((v) => !v)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {selectedYears.length === 0 || selectedYears.length === availableYears.length 
                    ? `Semua (${availableYears.length})` 
                    : `${selectedYears.length} dari ${availableYears.length}`}
                </button>
              </div>

              {yearDropdownOpen ? (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-3rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                      onClick={() => {
                        setApexBroken(false);
                        setYearFilterTouched(true);
                        setSelectedYears(availableYears.slice());
                      }}
                    >
                      Pilih semua
                    </button>
                    <button
                      type="button"
                      className="text-xs text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                      onClick={() => {
                        setApexBroken(false);
                        setYearFilterTouched(true);
                        setSelectedYears([]);
                      }}
                    >
                      Hapus semua
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {availableYears.map((y) => (
                      <label key={y} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={selectedYears.includes(y)}
                          onChange={(e) => {
                            setApexBroken(false);
                            setYearFilterTouched(true);
                            if (e.target.checked) {
                              setSelectedYears((prev) => [...prev, y].sort((a, b) => Number(a) - Number(b)));
                            } else {
                              setSelectedYears((prev) => prev.filter((yy) => yy !== y));
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span>{y}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            // Simple dropdown for bar/pie charts (single select)
            <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="whitespace-nowrap font-medium">📆 Tahun</span>
              <select
                value={selectedYears.length === 1 ? selectedYears[0] : availableYears[availableYears.length - 1]}
                onChange={(e) => {
                  setApexBroken(false);
                  setYearFilterTouched(true);
                  setSelectedYears([e.target.value]);
                }}
                className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )
        ) : null}

        {selectedXMode === "time" && axes.hasTime && availableYears.length >= 2 ? (
          <div className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap font-medium">⏱️ Rentang</span>
            <select
              value={rangeStart}
              onChange={(e) => {
                setApexBroken(false);
                setRangeStart(e.target.value);
              }}
              className="h-8 min-w-[96px] max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="">Awal</option>
              {availableYears.map((y) => (
                <option key={`range-start-${y}`} value={y}>{y}</option>
              ))}
            </select>
            <span className="text-gray-400">-</span>
            <select
              value={rangeEnd}
              onChange={(e) => {
                setApexBroken(false);
                setRangeEnd(e.target.value);
              }}
              className="h-8 min-w-[96px] max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="">Akhir</option>
              {availableYears.map((y) => (
                <option key={`range-end-${y}`} value={y}>{y}</option>
              ))}
            </select>
            {(rangeStart || rangeEnd) && (
              <button
                type="button"
                onClick={() => {
                  setApexBroken(false);
                  setRangeStart("");
                  setRangeEnd("");
                  setYearFilterTouched(false);
                  setSelectedYears([]);
                }}
                className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Reset
              </button>
            )}
          </div>
        ) : null}

        {selectedXMode === "time" && axes.hasTime && effectiveChartType === "line" ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap font-medium">📈 Perbandingan</span>
            <select
              value={comparisonMode}
              onChange={(e) => {
                setApexBroken(false);
                setComparisonMode(e.target.value as ComparisonMode);
              }}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="none">Tidak ada</option>
              <option value="yoy" disabled={!canYoY}>YoY (%)</option>
              <option value="mom" disabled={!canMoM}>MoM (%)</option>
            </select>
          </label>
        ) : null}

        {/* Period selector for bar/pie charts - show quarters and yearly */}
        {selectedXMode === "geo" && availableGeoPeriods.length > 0 ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap font-medium">📅 Periode</span>
            <select
              value={selectedGeoPeriod || availableGeoPeriods[availableGeoPeriods.length - 1].key}
              onChange={(e) => {
                setApexBroken(false);
                setSelectedGeoPeriod(Number(e.target.value));
              }}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              {availableGeoPeriods.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        {axes.hasTime && axes.hasGeo && selectedXMode === "time" && geoOptions.length >= 2 && (effectiveChartType === "line" || effectiveChartType === "bar") ? (
          <div className="relative text-xs text-gray-600 dark:text-gray-300" data-geo-dropdown="1">
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap">{dimensionMeta.label}</span>
              <button
                type="button"
                onClick={() => setGeoDropdownOpen((v) => !v)}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
              >
                {Math.min(selectedGeoKeys.length, 99)} dipilih
              </button>
            </div>

            {geoDropdownOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-xs text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                    onClick={() => {
                      const all = geoOptions.map((g) => g.key);
                      setApexBroken(false);
                      setSelectedGeoKeys(all);
                    }}
                  >
                    Pilih semua
                  </button>
                  <button
                    type="button"
                    className="text-xs text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                    onClick={() => {
                      setApexBroken(false);
                      setSelectedGeoKeys([]);
                    }}
                  >
                    Kosongkan
                  </button>
                </div>
                <div className="max-h-56 overflow-auto pr-2">
                  <div className="space-y-2">
                    {geoOptions.slice(0, 24).map((g) => {
                      const checked = selectedGeoKeys.includes(g.key);
                      return (
                        <label key={g.key} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? Array.from(new Set([...selectedGeoKeys, g.key]))
                                : selectedGeoKeys.filter((k) => k !== g.key);
                              setApexBroken(false);
                              setSelectedGeoKeys(next);
                            }}
                          />
                          <span className="min-w-0 truncate" title={g.label}>
                            {g.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {valueCandidates.length > 1 ? (
          <label className="flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap">Y</span>
            <select
              value={selectedValueKey}
              onChange={(e) => {
                setApexBroken(false);
                setSelectedValueKey(e.target.value);
              }}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              {valueCandidates.slice(0, 10).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Height toggle for non-fullscreen mode */}
        {!isFullscreen && (
          <label className="ml-auto flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="whitespace-nowrap">Tinggi</span>
            <select
              value={chartHeight}
              onChange={(e) => setChartHeight(e.target.value as ChartHeight)}
              className="h-8 min-w-0 max-w-full truncate rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 shadow-theme-xs outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="compact">Kompak</option>
              <option value="normal">Normal</option>
              <option value="expanded">Besar</option>
            </select>
          </label>
        )}
      </div>

      <div className="mt-4">
        {!canRender ? (
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {needsGeoSelection ? (
                <>
                  <span className="font-medium">📍 Pilih Wilayah:</span> Pilih minimal 1 wilayah dari dropdown di atas untuk menampilkan grafik.
                </>
              ) : hasEmptyData && selectedXMode === "geo" ? (
                <>
                  <span className="font-medium">📊 Tidak Ada Data:</span> Kombinasi tahun dan periode yang dipilih tidak memiliki data.
                  <span className="mt-1 block text-xs">
                    💡 Tip: Coba pilih tahun atau periode lain dari dropdown di atas.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium">ℹ️ Data Tidak Mencukupi:</span> Grafik memerlukan data dalam rentang periode yang berurutan.
                  {/* DEBUG: visible debug info */}
                  <span className="mt-1 block text-xs text-red-500 font-mono">
                    DEBUG: multiSeries={String(prepared.multiSeries)}, valueKey={prepared.valueKey || 'null'}, 
                    categories={prepared.categories?.length || 0}, series={prepared.series?.length || 0}, 
                    selectedGeoKeys={selectedGeoKeys.length}, geoOptions={geoOptions.length},
                    safeRows={safeRows.length}, <strong>apexBroken={String(apexBroken)}</strong>
                  </span>
                  {availableYears.length > 1 && selectedYears.length === 0 && (
                    <span className="mt-1 block text-xs">
                      💡 Tip: Pilih tahun tertentu dari filter &quot;Tahun&quot; di atas, atau coba ubah tipe periode.
                    </span>
                  )}
                  {selectedXMode === "time" && (
                    <span className="mt-1 block text-xs">
                      💡 Tip: Coba ganti sumbu X ke &quot;{dimensionMeta.label}&quot; atau pilih metrik lain.
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        ) : chartBooting ? (
          <CircularSpinner label="Memuat grafik" />
        ) : (
          <>
            <div
              ref={chartAreaRef}
              className="w-full overflow-hidden select-none transition-all duration-300"
              style={{ touchAction: "pan-y", WebkitTapHighlightColor: "transparent" as any }}
            >
              <ApexChartErrorBoundary>
                <div className="w-full">
                  {(() => {
                    // DEBUG: Log chart data being passed to ApexCharts
                    const seriesPreview = Array.isArray(chart.series) 
                      ? chart.series.map((s: any) => ({
                          name: s.name,
                          dataLength: Array.isArray(s.data) ? s.data.length : 'not-array',
                          firstPoint: Array.isArray(s.data) && s.data.length > 0 ? s.data[0] : null,
                          lastPoint: Array.isArray(s.data) && s.data.length > 0 ? s.data[s.data.length - 1] : null,
                        }))
                      : chart.series;
                    console.log('🎨 [SearchInsightsChart] Rendering ApexChart:', {
                      type: chart.type,
                      height: chart.height,
                      seriesLength: Array.isArray(chart.series) ? chart.series.length : 'not-array',
                      seriesPreview,
                      optionsKeys: chart.options ? Object.keys(chart.options) : [],
                      xaxisType: chart.options?.xaxis?.type,
                      categoriesLength: chart.options?.xaxis?.categories?.length,
                      colors: chart.options?.colors,
                    });
                    return null;
                  })()}
                  <ReactApexChart
                    key={renderKey}
                    options={chart.options}
                    series={chart.series as any}
                    type={chart.type as any}
                    height={chart.height}
                    width="100%"
                  />
                </div>
              </ApexChartErrorBoundary>
            </div>
            {/* Helpful hint for mobile users */}
            {effectiveChartType === "line" && !isFullscreen && (
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 md:hidden">
                💡 Tip: Gunakan <span className="font-medium">pinch zoom</span> untuk memperbesar grafik
              </p>
            )}
          </>
        )}
      </div>
    </>
  );

  // Render fullscreen modal if active
  if (isFullscreen) {
    return (
      <>
        {/* Regular card placeholder */}
        <div
          ref={containerRef}
          className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
            <span>Grafik ditampilkan dalam mode fullscreen</span>
          </div>
        </div>

        {/* Fullscreen modal */}
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[95vh] w-full max-w-6xl overflow-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="absolute right-4 top-4 z-10 rounded-full bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              title="Tutup (Esc)"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {chartContent}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
    >
      {/* Comparison mode: side-by-side layout */}
      {comparisonData && (comparisonRows.length > 0 || comparisonLoading || comparisonError) ? (
        <div className="space-y-4">
          {/* Comparison header */}
          <div className="flex items-center justify-between rounded-lg bg-brand-50 px-4 py-2 dark:bg-brand-900/20">
            <div className="flex items-center gap-2">
              <CompareIcon className="h-4 w-4 text-brand-500" />
              <span className="text-sm font-medium text-brand-700 dark:text-brand-400">
                Mode Perbandingan
              </span>
              <span className="text-xs text-brand-600 dark:text-brand-500">
                {comparisonData.type === "period" 
                  ? `vs ${comparisonData.secondYear}` 
                  : `vs ${comparisonData.secondSourceName?.slice(0, 30)}${(comparisonData.secondSourceName?.length || 0) > 30 ? '...' : ''}`}
              </span>
            </div>
            <button
              type="button"
              onClick={clearComparison}
              className="rounded-md p-1 text-brand-500 hover:bg-brand-100 dark:hover:bg-brand-900/30"
              title="Tutup perbandingan"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Side by side charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Original chart */}
            <div className="min-w-0">
              <div className="mb-2 rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {title || "Grafik Utama"} 
              </div>
              {chartContent}
            </div>

            {/* Comparison chart */}
            <div className="min-w-0">
              <div className="mb-2 rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {comparisonData.type === "period" 
                  ? `Periode: ${comparisonData.secondYear}` 
                  : comparisonData.secondSourceName || "Pembanding"}
              </div>
              {comparisonLoading ? (
                <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                    <span>Memuat data pembanding...</span>
                  </div>
                </div>
              ) : comparisonError ? (
                <div className="flex h-64 items-center justify-center rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20">
                  <p className="text-sm text-red-600 dark:text-red-400">{comparisonError}</p>
                </div>
              ) : (
                <ComparisonChart
                  rows={comparisonRows}
                  columns={comparisonColumns}
                  sourceId={comparisonData.type === "indicator" ? comparisonData.secondSourceId : sourceId}
                  sourceType={sourceType}
                  chartType={effectiveChartType}
                  isDark={isDark}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        chartContent
      )}

      {/* Comparison Modal */}
      <ChartComparisonModal
        isOpen={showCompareModal}
        onClose={() => setShowCompareModal(false)}
        currentSourceId={sourceId || 0}
        currentSourceName={title || "Indikator"}
        currentYear={title?.match(/\d{4}/)?.[0]}
        onCompare={handleCompare}
      />
    </div>
  );
}
