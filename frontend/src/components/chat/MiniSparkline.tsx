/**
 * MiniSparkline - Lightweight SVG sparkline for inline chat data visualization.
 * No external chart library needed — pure SVG for fast rendering and small bundle.
 */

"use client";

import React, { useId, useMemo } from "react";

interface SparklineProps {
  /** Numeric values to plot */
  values: number[];
  /** Labels for each data point (shown on hover) */
  labels?: string[];
  /** Chart width in px */
  width?: number;
  /** Chart height in px */
  height?: number;
  /** Line color */
  color?: string;
  /** Whether to show the area fill under the line */
  showArea?: boolean;
  /** Title shown above the chart */
  title?: string;
  /**
   * Show the built-in first-vs-last trend percentage. Callers that display their
   * own period-over-period delta should turn this off: the two measure different
   * things and can disagree in direction on the same card.
   */
  showTrendPct?: boolean;
  /**
   * Strip the surrounding card chrome — border, background, padding, header and
   * the min/max footer — and render just the line. For callers that already
   * supply their own container and labels.
   */
  bare?: boolean;
}

export function MiniSparkline({
  values,
  labels,
  width = 280,
  height = 80,
  color = "#6366f1",
  showArea = true,
  title,
  showTrendPct = true,
  bare = false,
}: SparklineProps) {
  const { path, areaPath, points, yMin, yMax } = useMemo(() => {
    if (values.length < 2) return { path: "", areaPath: "", points: [], yMin: 0, yMax: 0 };

    const padding = { top: 8, bottom: 16, left: 4, right: 4 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // If all values are the same, create a small range
    const yMin = rawMin === rawMax ? rawMin - 1 : rawMin;
    const yMax = rawMin === rawMax ? rawMax + 1 : rawMax;
    const range = yMax - yMin;

    const pts = values.map((v, i) => ({
      x: padding.left + (i / (values.length - 1)) * chartW,
      y: padding.top + chartH - ((v - yMin) / range) * chartH,
      value: v,
      label: labels?.[i] || String(i),
    }));

    // Build SVG path
    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    // Area path (line + close to bottom)
    const areaP = linePath + ` L${pts[pts.length - 1].x.toFixed(1)},${padding.top + chartH} L${pts[0].x.toFixed(1)},${padding.top + chartH} Z`;

    return { path: linePath, areaPath: areaP, points: pts, yMin: rawMin, yMax: rawMax };
  }, [values, labels, width, height]);

  // Gradient ids must be unique: several sparklines share one page, and a
  // hardcoded id makes every instance resolve to the first one's gradient.
  const gradientId = `spark-grad-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  if (values.length < 2) return null;

  // Determine trend: up, down, or flat
  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const trendPct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal)) * 100 : 0;
  const trendUp = lastVal > firstVal;
  const trendFlat = Math.abs(trendPct) < 0.5;

  return (
    <div className={bare ? "" : "rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900"}>
      {/* Header */}
      {!bare && (title || showTrendPct) && (
      <div className="flex items-center justify-between mb-1.5">
        {title && (
          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 truncate max-w-[70%]">
            📈 {title}
          </span>
        )}
        {showTrendPct && (
        <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${
          trendFlat ? "text-gray-500" : trendUp ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        }`}>
          {!trendFlat && (
            <svg className={`h-3 w-3 ${trendUp ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          )}
          {trendFlat ? "—" : `${trendUp ? "+" : ""}${trendPct.toFixed(1)}%`}
        </div>
        )}
      </div>
      )}

      {/* SVG Sparkline */}
      <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {/* Gradient for area fill */}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        {showArea && <path d={areaPath} fill={`url(#${gradientId})`} />}

        {/* Line */}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* End points — first and last */}
        {points.length > 0 && (
          <>
            <circle cx={points[0].x} cy={points[0].y} r="3" fill="white" stroke={color} strokeWidth="1.5" />
            <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} stroke="white" strokeWidth="1.5" />
          </>
        )}
      </svg>

      {/* Min/Max labels */}
      {!bare && (
      <div className="flex justify-between text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 px-1">
        <span>{labels?.[0] || ""}: {formatSparkValue(firstVal)}</span>
        <span>{labels?.[labels.length - 1] || ""}: {formatSparkValue(lastVal)}</span>
      </div>
      )}
    </div>
  );
}

/** Format number for sparkline labels */
function formatSparkValue(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + " Jt";
  if (Math.abs(v) >= 10_000) return (v / 1_000).toFixed(1) + "K";
  if (Number.isInteger(v)) return v.toLocaleString("id-ID");
  return v.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

/**
 * Detect if table data is suitable for a sparkline chart.
 * Requirements:
 * - At least 3 rows (2 data points minimum, but 3+ is useful)
 * - First column is a text label (period/year)
 * - At least one other column has mostly numeric values
 * Returns the extracted data or null if not suitable.
 */
export function detectSparklineData(
  cols: string[],
  rows: Array<Record<string, unknown>>
): { values: number[]; labels: string[]; title: string } | null {
  if (!cols || !rows || cols.length < 2 || rows.length < 3) return null;

  const labelKey = cols[0];
  if (!labelKey) return null;

  // Find the best numeric column (first one with majority numeric values)
  let bestCol: string | null = null;
  let bestTitle = "";

  for (let c = 1; c < cols.length; c++) {
    const colName = cols[c];
    if (!colName) continue;

    let numCount = 0;
    for (const row of rows) {
      const val = row[colName];
      if (val !== null && val !== undefined && val !== "" && val !== "-") {
        const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[,\s]/g, ""));
        if (!isNaN(num)) numCount++;
      }
    }

    // At least 70% of rows should be numeric
    if (numCount / rows.length >= 0.7) {
      bestCol = colName;
      bestTitle = colName;
      break;
    }
  }

  if (!bestCol) return null;

  // Extract labels and values
  const labels: string[] = [];
  const values: number[] = [];

  for (const row of rows) {
    const label = String(row[labelKey] || "").trim();
    const rawVal = row[bestCol];
    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal || "").replace(/[,\s]/g, ""));
    
    if (label && !isNaN(num)) {
      labels.push(label);
      values.push(num);
    }
  }

  if (values.length < 3) return null;

  return { values, labels, title: bestTitle };
}

export default MiniSparkline;
