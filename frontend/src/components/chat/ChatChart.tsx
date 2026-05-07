/**
 * ChatChart — Agentic LLM chart component for chat bubbles.
 *
 * Receives a `ChartAgentOutput` from the backend Chart Agent (Stage 5.5)
 * and renders a compact, mobile-first Recharts visualization inside
 * the DataSummaryBubble.
 *
 * Migrated from ApexCharts to Recharts (pure React SVG components) to
 * eliminate the fatal getBoundingClientRect() crash on mobile fullscreen.
 *
 * Features:
 * - 6 chart types: line, bar, pie, area, stacked-bar, grouped-bar
 * - Dark mode via ThemeContext
 * - Chart type toggle (switch to LLM's alternative suggestion)
 * - Mobile: compact 140px preview → tap to expand fullscreen overlay
 * - Desktop: 280px inline chart (no change)
 * - Error boundary for graceful fallback
 */

"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/context/ThemeContext";
import type { ChartAgentOutput } from "@/types/chat";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  AreaChart,
  PieChart,
  Line,
  Bar,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// ── Error Boundary — catch chart runtime errors gracefully ─────────────

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn("[ChatChart] Recharts error caught:", error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-[100px] gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            📊 Grafik tidak dapat ditampilkan
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Coba muat ulang halaman
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── useIsMobile hook (matches sm: breakpoint at 640px) ─────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// ── Color Schemes ──────────────────────────────────────────────────────

const COLOR_SCHEMES: Record<string, string[]> = {
  default: ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"],
  categorical: ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"],
  sequential: ["#dbeafe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"],
  diverging: ["#ef4444", "#f87171", "#fca5a5", "#d1d5db", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb"],
};

// ── Value Formatters ───────────────────────────────────────────────────

function formatValue(val: number, format: string): string {
  if (val == null || isNaN(val)) return "-";
  switch (format) {
    case "percentage":
      return val.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
    case "currency":
      if (Math.abs(val) >= 1e9) return "Rp" + (val / 1e9).toFixed(1) + " M";
      if (Math.abs(val) >= 1e6) return "Rp" + (val / 1e6).toFixed(1) + " Jt";
      return "Rp" + val.toLocaleString("id-ID");
    case "index":
      return val.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      if (Number.isInteger(val)) return val.toLocaleString("id-ID");
      return val.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  }
}

// ── Chart Type Icons ───────────────────────────────────────────────────

const ChartTypeIcon: Record<string, string> = {
  line: "📈",
  bar: "📊",
  pie: "🍩",
  area: "📉",
  "stacked-bar": "📊",
  "grouped-bar": "📊",
};

// ── Custom Recharts Tooltip ────────────────────────────────────────────

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  yFormat,
  isDark,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  yFormat: string;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs shadow-lg border ${
        isDark
          ? "bg-gray-800 border-gray-700 text-gray-200"
          : "bg-white border-gray-200 text-gray-700"
      }`}
    >
      <div className="font-medium mb-1">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="truncate">{entry.name}:</span>
          <span className="font-medium">
            {formatValue(entry.value, yFormat)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────

export interface ChatChartProps {
  /** LLM-generated chart configuration */
  config: ChartAgentOutput;
  /** Table rows from dataPreview */
  rows: Array<Record<string, unknown>>;
  /** Table columns (for validation) */
  columns: string[];
}

// ── Component ──────────────────────────────────────────────────────────

export const ChatChart = React.memo(function ChatChart({ config, rows, columns }: ChatChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const isMobile = useIsMobile();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useAlternative, setUseAlternative] = useState(false);

  const activeChartType = useMemo(() => {
    if (useAlternative && config.alternative) {
      return config.alternative.chart_type;
    }
    return config.chart_type;
  }, [useAlternative, config]);

  const colors = useMemo(
    () =>
      COLOR_SCHEMES[config.options?.color_scheme || "default"] ||
      COLOR_SCHEMES.default,
    [config.options?.color_scheme]
  );

  const yFormat = config.y_axis?.format || "number";
  const isStacked =
    activeChartType === "stacked-bar" || config.options?.stacked;
  const isHorizontal = config.options?.orientation === "horizontal";

  // Build Recharts data array (shared for all Cartesian chart types)
  const chartData = useMemo(() => {
    const xCol = config.x_axis?.column;
    const built = rows.map((r) => {
      const item: Record<string, unknown> = {
        name: String(r[xCol ?? ""] ?? ""),
      };
      for (const s of config.series || []) {
        const v = r[s.column];
        item[s.label] =
          typeof v === "number"
            ? v
            : parseFloat(String(v || "0").replace(/[,\s]/g, "")) || 0;
      }
      return item;
    });

    // Sort by canonical Maluku Utara geo order when data looks like kab/kota names
    const GEO_ORDER: Record<string, number> = {
      "halmahera barat": 0, "halmahera tengah": 1, "kepulauan sula": 2,
      "halmahera selatan": 3, "halmahera utara": 4, "halmahera timur": 5,
      "pulau morotai": 6, "pulau taliabu": 7, "ternate": 8, "kota ternate": 8,
      "tidore kepulauan": 9, "kota tidore kepulauan": 9, "maluku utara": 10,
    };
    const names = built.map((d) => String(d.name || "").toLowerCase().replace(/^kab\.?\s*/, "").trim());
    const geoMatches = names.filter((n) => GEO_ORDER[n] !== undefined).length;
    // If majority of labels match geo names, apply canonical sort
    if (geoMatches >= Math.min(3, built.length) && geoMatches >= built.length * 0.5) {
      built.sort((a, b) => {
        const na = String(a.name || "").toLowerCase().replace(/^kab\.?\s*/, "").trim();
        const nb = String(b.name || "").toLowerCase().replace(/^kab\.?\s*/, "").trim();
        return (GEO_ORDER[na] ?? 99) - (GEO_ORDER[nb] ?? 99);
      });
    }

    return built;
  }, [config, rows]);

  // For pie chart: transform data
  const pieData = useMemo(() => {
    if (activeChartType !== "pie") return [];
    const firstSeries = config.series?.[0];
    if (!firstSeries) return [];
    return chartData.map((d) => ({
      name: String(d.name),
      value: Number(d[firstSeries.label]) || 0,
    }));
  }, [activeChartType, config.series, chartData]);

  const seriesKeys = useMemo(
    () => (config.series || []).map((s) => s.label),
    [config.series]
  );

  const handleToggleAlternative = useCallback(
    () => setUseAlternative((v) => !v),
    []
  );
  const openFullscreen = useCallback(() => setIsFullscreen(true), []);
  const closeFullscreen = useCallback(() => setIsFullscreen(false), []);

  // Fullscreen: lock scroll, remove transform, escape key
  useEffect(() => {
    if (!isFullscreen) return;
    document.body.style.overflow = "hidden";
    const viewport = document.querySelector(
      ".malika-viewport"
    ) as HTMLElement | null;
    const prevTransform = viewport?.style.transform;
    const prevWebkit = viewport?.style.webkitTransform;
    if (viewport) {
      viewport.style.transform = "none";
      viewport.style.webkitTransform = "none";
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      document.body.style.overflow = "";
      if (viewport) {
        viewport.style.transform = prevTransform || "";
        viewport.style.webkitTransform = prevWebkit || "";
      }
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isFullscreen]);

  // Don't render if config says no
  if (!config.should_render) return null;
  if (!rows.length || !config.series?.length) return null;

  // Accessible description for screen readers
  const chartAriaLabel = `Grafik ${activeChartType}: ${config.chart_title || "Data Statistik"}. ${rows.length} titik data, ${seriesKeys.length} seri (${seriesKeys.join(", ")}).${config.chart_subtitle ? ` ${config.chart_subtitle}` : ""}`;

  // ── Pre-compute dynamic heights (used by both renderChart and container) ──
  const compactH = isHorizontal ? Math.max(140, chartData.length * 22 + 40) : 140;
  const fullH = isHorizontal ? Math.max(280, chartData.length * 35 + 40) : 280;

  // ── Render chart content (shared between compact/full/desktop) ─────

  const renderChart = (mode: "compact" | "full") => {
    const isCompact = mode === "compact";
    const height = isCompact ? compactH : fullH;
    // Always show axis labels — even in compact mode, use small but visible font
    const showAxis = true;
    const showLegend =
      !isCompact && (config.options?.show_legend ?? seriesKeys.length > 1);
    const showGrid = !isCompact;
    const showTooltip = !isCompact;
    const tickFontSize = isCompact ? 9 : 11;
    const gridColor = isDark ? "#1f2937" : "#f3f4f6";
    const axisColor = isDark ? "#9ca3af" : "#6b7280";

    // Truncate long labels
    const truncLabel = (val: string) => {
      const maxLen = isCompact ? 10 : 24;
      return val && val.length > maxLen
        ? val.slice(0, maxLen - 2) + "…"
        : val;
    };

    // PIE CHART
    if (activeChartType === "pie") {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={isCompact ? "30%" : "40%"}
              outerRadius={isCompact ? "70%" : "80%"}
              paddingAngle={2}
              label={
                isCompact
                  ? false
                  : (props: any) =>
                      `${truncLabel(props.name || '')} ${((props.percent || 0) * 100).toFixed(0)}%`
              }
              labelLine={!isCompact}
              animationDuration={isCompact ? 0 : 600}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            {showTooltip && (
              <Tooltip
                content={
                  <CustomTooltip yFormat={yFormat} isDark={isDark} />
                }
              />
            )}
            {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          </PieChart>
        </ResponsiveContainer>
      );
    }

    // Determine chart type
    const isArea = activeChartType === "area";
    const isLine = activeChartType === "line";

    // Common axis/grid props
    // Auto-rotate and auto-interval for X labels
    const needsRotation = !isHorizontal && chartData.length > 4;
    const xAxisProps = {
      dataKey: "name" as const,
      tick: { fontSize: tickFontSize, fill: axisColor },
      tickLine: false,
      axisLine: false,
      angle: isHorizontal ? 0 : needsRotation ? -35 : 0,
      textAnchor: (needsRotation && !isHorizontal ? "end" : "middle") as "end" | "middle",
      height: isCompact
        ? (needsRotation ? 35 : 20)
        : (needsRotation ? 55 : 30),
      tickFormatter: truncLabel,
      // preserveStartEnd always shows first + last label, auto-hides middle ones
      interval: ("preserveStartEnd" as const),
    };

    // Format numeric value with abbreviation
    const fmtYVal = (v: number): string => {
      const abs = Math.abs(v);
      if (abs >= 1e9) return (v / 1e9).toFixed(1) + "M";
      if (abs >= 1e6) return (v / 1e6).toFixed(1) + "jt";
      if (abs >= 1e3) return (v / 1e3).toFixed(isCompact ? 0 : 1) + "rb";
      return formatValue(v, yFormat);
    };

    // Custom Y-axis tick that wraps long text to 2 lines
    const WrappingYTick = (props: any) => {
      const { x, y, payload } = props;
      const formatted = fmtYVal(payload.value as number);
      const fs = tickFontSize;
      const maxChars = isCompact ? 5 : 7;
      if (formatted.length <= maxChars) {
        return (
          <text x={x} y={y} textAnchor="end" fill={axisColor} fontSize={fs}>
            <tspan dy="0.35em">{formatted}</tspan>
          </text>
        );
      }
      // Wrap to 2 lines — split near the middle, prefer after . or ,
      const mid = Math.ceil(formatted.length / 2);
      let splitAt = mid;
      for (let i = mid; i > Math.max(0, mid - 3); i--) {
        if (".,-".includes(formatted[i] || "")) { splitAt = i + 1; break; }
      }
      const lh = fs + 1;
      return (
        <text x={x} y={y} textAnchor="end" fill={axisColor} fontSize={fs}>
          <tspan x={x} dy={-lh / 2 + 1}>{formatted.slice(0, splitAt)}</tspan>
          <tspan x={x} dy={lh}>{formatted.slice(splitAt)}</tspan>
        </text>
      );
    };

    const yAxisProps = {
      tick: <WrappingYTick />,
      tickLine: false,
      axisLine: false,
      width: isCompact ? 42 : 70,
    };

    const marginCompact = { top: 2, right: 4, left: 0, bottom: 0 };
    const marginFull = { top: 5, right: 15, left: 5, bottom: 5 };
    const margin = isCompact ? marginCompact : marginFull;

    // LINE CHART
    if (isLine) {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={margin}>
            {showGrid && (
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            )}
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            {showTooltip && (
              <Tooltip
                content={
                  <CustomTooltip yFormat={yFormat} isDark={isDark} />
                }
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4, overflowX: "auto" as any }}
                iconSize={10}
              />
            )}
            {seriesKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={isCompact ? 2 : 2.5}
                dot={
                  isCompact
                    ? false
                    : { r: 3, fill: colors[i % colors.length] }
                }
                activeDot={isCompact ? false : { r: 5 }}
                animationDuration={isCompact ? 0 : 600}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    // AREA CHART
    if (isArea) {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData} margin={margin}>
            {showGrid && (
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            )}
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            {showTooltip && (
              <Tooltip
                content={
                  <CustomTooltip yFormat={yFormat} isDark={isDark} />
                }
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4, overflowX: "auto" as any }}
                iconSize={10}
              />
            )}
            {seriesKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                fill={colors[i % colors.length]}
                fillOpacity={0.25}
                strokeWidth={2}
                dot={isCompact ? false : { r: 3 }}
                animationDuration={isCompact ? 0 : 600}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    // BAR CHART (default: also handles stacked-bar, grouped-bar)
    if (isHorizontal) {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={chartData} layout="vertical" margin={margin}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={gridColor}
                horizontal={false}
              />
            )}
            <XAxis
              type="number"
              tick={<WrappingYTick />}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={(props: any) => {
                const { x, y, payload } = props;
                const raw: string = payload.value || "";
                const fs = tickFontSize;
                const maxCharsPerLine = isCompact ? 8 : 14;
                // Fits in one line
                if (raw.length <= maxCharsPerLine) {
                  return (
                    <text x={x - 4} y={y} textAnchor="end" fill={axisColor} fontSize={fs}>
                      <tspan dy="0.35em">{raw}</tspan>
                    </text>
                  );
                }
                // Split into 2 lines at nearest space near the middle
                const mid = Math.ceil(raw.length / 2);
                let splitAt = -1;
                // Search outward from middle for a space
                for (let d = 0; d <= mid; d++) {
                  if (raw[mid + d] === " ") { splitAt = mid + d; break; }
                  if (mid - d >= 0 && raw[mid - d] === " ") { splitAt = mid - d; break; }
                }
                if (splitAt < 0) splitAt = maxCharsPerLine; // no space, force split
                const line1 = raw.slice(0, splitAt).trim();
                const line2 = raw.slice(splitAt).trim();
                const lh = fs + 2;
                return (
                  <text x={x - 4} y={y} textAnchor="end" fill={axisColor} fontSize={fs}>
                    <tspan x={x - 4} dy={-lh / 2 + 1}>{line1}</tspan>
                    <tspan x={x - 4} dy={lh}>{line2}</tspan>
                  </text>
                );
              }}
              tickLine={false}
              axisLine={false}
              width={isCompact ? 65 : 110}
              interval={0}
            />
            {showTooltip && (
              <Tooltip
                content={
                  <CustomTooltip yFormat={yFormat} isDark={isDark} />
                }
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4, overflowX: "auto" as any }}
                iconSize={10}
              />
            )}
            {seriesKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                stackId={isStacked ? "stack" : undefined}
                radius={[0, isCompact ? 2 : 3, isCompact ? 2 : 3, 0]}
                animationDuration={isCompact ? 0 : 600}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Vertical bar (default)
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={margin}>
          {showGrid && (
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          )}
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          {showTooltip && (
            <Tooltip
              content={
                <CustomTooltip yFormat={yFormat} isDark={isDark} />
              }
            />
          )}
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4, overflowX: "auto" as any }}
              iconSize={10}
            />
          )}
          {seriesKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              stackId={isStacked ? "stack" : undefined}
              radius={[isCompact ? 2 : 3, isCompact ? 2 : 3, 0, 0]}
              animationDuration={isCompact ? 0 : 600}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Desktop: full inline chart (unchanged behavior)
  if (!isMobile) {
    return (
      <ChartErrorBoundary>
        <div className="rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900" role="img" aria-label={chartAriaLabel}>
          <ChartHeader
            activeChartType={activeChartType}
            config={config}
            useAlternative={useAlternative}
            onToggleAlternative={handleToggleAlternative}
          />
          <div className="-mx-1" aria-hidden="true" style={{ height: fullH }}>{renderChart("full")}</div>
          <div className="text-[9px] text-gray-400 dark:text-gray-600 mt-1 truncate">
            {config.render_reason}
          </div>
        </div>
      </ChartErrorBoundary>
    );
  }

  // ── Mobile: compact / fullscreen ────────────────────────────────────
  // Recharts is pure React — mount/unmount is safe, no getBoundingClientRect crash
  // Fullscreen uses createPortal to document.body — breaks out of any ancestor
  // transform/stacking-context so fixed positioning works relative to viewport.
  const fullscreenOverlay = isFullscreen
    ? createPortal(
        <div
          className="fixed inset-0 z-[999999] flex flex-col bg-white dark:bg-gray-950"
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
          role="dialog"
          aria-modal
          aria-label={`Grafik layar penuh: ${config.chart_title || "Data Statistik"}`}
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={closeFullscreen}
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 active:scale-95 transition-transform"
              aria-label="Tutup"
            >
              <svg
                className="w-[18px] h-[18px] text-gray-600 dark:text-gray-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <ChartHeader
              activeChartType={activeChartType}
              config={config}
              useAlternative={useAlternative}
              onToggleAlternative={handleToggleAlternative}
              size="large"
            />
          </div>

          {/* Chart */}
          <div
            className="flex-1 min-h-0 px-1 py-1 overflow-y-auto overscroll-contain"
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {renderChart("full")}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[10px] text-gray-400 dark:text-gray-600 truncate flex-1">
              {config.render_reason}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                />
              </svg>
              Putar HP untuk lebih lebar
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <ChartErrorBoundary>
      {/* Compact preview (always inline in chat bubble) */}
      <div
        className="w-full rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900 cursor-pointer active:scale-[0.98] transition-transform"
        onClick={openFullscreen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFullscreen(); } }}
        role="button"
        aria-label={`${chartAriaLabel} — Ketuk untuk perbesar`}
        tabIndex={0}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-200 truncate flex-1 text-left">
            {ChartTypeIcon[activeChartType] || "📊"}{" "}
            {config.chart_title || "Grafik"}
          </div>
          <div className="flex items-center gap-1 text-[9px] text-brand-500 dark:text-brand-400 font-medium flex-shrink-0">
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
              />
            </svg>
            Perbesar
          </div>
        </div>

        {/* Chart preview */}
        <div className="-mx-0.5 pointer-events-none" aria-hidden="true" style={{ height: compactH }}>
          {renderChart("compact")}
        </div>
      </div>

      {/* Fullscreen overlay — portaled to document.body */}
      {fullscreenOverlay}
    </ChartErrorBoundary>
  );
});

// ── Chart Header (shared between desktop and fullscreen) ───────────────

function ChartHeader({
  activeChartType,
  config,
  useAlternative,
  onToggleAlternative,
  size = "normal",
}: {
  activeChartType: string;
  config: ChartAgentOutput;
  useAlternative: boolean;
  onToggleAlternative: () => void;
  size?: "normal" | "large";
}) {
  const isLarge = size === "large";
  return (
    <div className="flex items-start justify-between gap-2 mb-1">
      <div className="flex-1 min-w-0">
        <div
          className={`font-semibold text-gray-700 dark:text-gray-200 truncate ${
            isLarge ? "text-sm" : "text-[11px]"
          }`}
        >
          {ChartTypeIcon[activeChartType] || "📊"}{" "}
          {config.chart_title || "Grafik"}
        </div>
        {config.chart_subtitle && (
          <div
            className={`text-gray-500 dark:text-gray-400 truncate ${
              isLarge ? "text-xs" : "text-[10px]"
            }`}
          >
            {config.chart_subtitle}
          </div>
        )}
      </div>
      {config.alternative && (
        <button
          type="button"
          onClick={onToggleAlternative}
          className={`flex-shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/30 transition-colors border border-transparent hover:border-brand-200 dark:hover:border-brand-800 ${
            isLarge ? "text-xs" : "text-[10px]"
          }`}
          title={
            useAlternative
              ? `Kembali ke ${config.chart_type}`
              : config.alternative.reason
          }
        >
          {useAlternative
            ? `${ChartTypeIcon[config.chart_type]} ${capitalize(
                config.chart_type
              )}`
            : `${ChartTypeIcon[config.alternative.chart_type]} ${capitalize(
                config.alternative.chart_type
              )}`}
        </button>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default ChatChart;
