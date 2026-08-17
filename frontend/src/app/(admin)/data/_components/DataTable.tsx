"use client";

import React, { useMemo, useState, type CSSProperties } from "react";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";
import { describeValueCode } from "../_lib/valueCodeStyle";
import { CellValue, Sparkline, SourceTypeBadge } from "./atoms";

type Row = Record<string, unknown>;

export type DataTableProps = {
  sourceId: number;
  sourceType: SourceType;
  unit: string | null | undefined;
  selectedYear: string;
  availableYears: string[];   // descending
  rows: Row[];
  columns: string[];          // already filtered by hiddenColumns by parent
  allColumns: string[];       // unfiltered (so sparkline can pick the trend column even if hidden)
  labelColumn: string;        // the column naming each row — resolved by the parent, not by position
  totalRowMatcher?: (row: Row, firstCol: string) => boolean;
  // For sparkline column: per-row series across years. Built by parent (has access to allYearsData).
  rowSeries: (regionLabel: string) => number[];
  lastUpdate?: string | null;
};

export default function DataTable(props: DataTableProps) {
  const {
    sourceId,
    sourceType,
    unit,
    selectedYear,
    availableYears,
    rows,
    columns,
    allColumns,
    labelColumn,
    totalRowMatcher,
    rowSeries,
  } = props;

  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];
  const firstCol = labelColumn;
  const dataCols = columns.filter((c) => c !== firstCol);

  const isFirstColVisible = columns.includes(firstCol);

  const yrSpan =
    availableYears.length > 1
      ? `${availableYears[availableYears.length - 1]}–${availableYears[0]}`
      : availableYears[0] ?? "";

  // hover-tooltip state (mouse-anchored, no portal)
  const [hover, setHover] = useState<{
    region: string;
    col: string;
    value: string | number;
    code: string | null;
    x: number;
    y: number;
  } | null>(null);

  const trackVars: CSSProperties = {
    ["--accent-light" as string]: stype.bar,
    ["--accent-dark" as string]: stype.barDark,
  } as CSSProperties;

  const numericColumns = useMemo(() => {
    const set = new Set<string>();
    for (const c of allColumns) {
      if (c === labelColumn) continue;
      const sample = rows.find((r) => typeof r[c] === "number");
      if (sample) set.add(c);
    }
    return set;
  }, [allColumns, labelColumn, rows]);

  return (
    <div
      style={trackVars}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
    >
      {/* sub-toolbar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800 md:px-5">
        <div className="flex flex-wrap items-baseline gap-2 md:gap-3">
          <h2 className="text-[13px] font-semibold text-gray-900 dark:text-white md:text-[14px]">
            Tabel Data · <span className="tabular-nums">{selectedYear}</span>
          </h2>
          <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400 md:text-[12px]">
            {rows.length} baris · {dataCols.length} kolom
            {unit && ` · ${unit}`}
          </span>
        </div>
        <div className="hidden items-center gap-3 text-[11.5px] text-gray-500 dark:text-gray-400 md:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-amber-200 dark:bg-amber-400/40" />
            angka diberi kode
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-500/30" />
            tren naik
          </span>
        </div>
        {/* mobile hint */}
        <span className="text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500 md:hidden">
          geser →
        </span>
      </div>

      <div
        className="relative overflow-x-auto overflow-y-auto"
        style={{ maxHeight: 480 }}
      >
        <table
          className="text-[12px] md:text-[13px]"
          style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}
        >
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900">
              {isFirstColVisible && (
                <th
                  className="sticky left-0 z-20 border-b border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-gray-500 shadow-[1px_0_0_rgba(229,231,235,1)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:shadow-[1px_0_0_rgba(31,41,55,1)] md:px-4 md:text-[11.5px]"
                  style={{ minWidth: 140 }}
                >
                  {firstCol}
                </th>
              )}
              {dataCols.map((c) => (
                <th
                  key={c}
                  className={`whitespace-nowrap border-b border-gray-200 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:text-gray-400 md:px-4 md:text-[11.5px] ${
                    numericColumns.has(c) ? "text-right" : "text-left"
                  }`}
                >
                  {c}
                </th>
              ))}
              <th
                className="border-b border-gray-200 px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:text-gray-400 md:text-[11.5px]"
                style={{ minWidth: 100 }}
              >
                Tren {yrSpan}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const region = String(row[firstCol] ?? "");
              const isTotal = !!totalRowMatcher && totalRowMatcher(row, firstCol);
              const series = rowSeries(region);
              // The colour and the percentage beside it must read the same two
              // points. Judging direction from the raw endpoints made any row
              // whose earliest year is missing fall back to "rising" while its
              // own figure said it had fallen.
              const points = series.filter((v) => Number.isFinite(v));
              const trendUp =
                points.length >= 2 ? points[points.length - 1] >= points[0] : true;
              const baseBg = isTotal ? "bg-gray-50/80 dark:bg-gray-800/60" : "";

              return (
                <tr
                  key={`${region}-${ri}`}
                  className={`group transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/40 ${baseBg}`}
                >
                  {isFirstColVisible && (
                    <td
                      className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2.5 font-medium text-gray-900 shadow-[1px_0_0_rgba(229,231,235,1)] dark:text-gray-100 dark:shadow-[1px_0_0_rgba(31,41,55,1)] md:px-4 ${
                        isTotal ? "font-semibold" : ""
                      } ${baseBg || "bg-white group-hover:bg-gray-50/80 dark:bg-gray-900 dark:group-hover:bg-gray-800/40"}`}
                    >
                      <div className="flex items-center gap-2">
                        {isTotal && (
                          <span
                            className="h-4 w-1 rounded"
                            style={{ background: stype.bar }}
                            aria-hidden
                          />
                        )}
                        <span className={isTotal ? "" : "pl-3"} title={region}>
                          {region}
                        </span>
                      </div>
                    </td>
                  )}
                  {dataCols.map((c) => {
                    const v = row[c];
                    const codes = (row.value_codes as Record<string, string> | undefined) ?? {};
                    const code = codes[c] ?? null;
                    const isNumeric = numericColumns.has(c);
                    const display: string | number =
                      typeof v === "object" && v !== null ? "" : (v as string | number);
                    return (
                      <td
                        key={c}
                        className={`whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-800 dark:text-gray-200 md:px-4 ${
                          isNumeric ? "text-right" : "text-left"
                        } ${isTotal ? "font-semibold" : ""} ${code ? "cursor-help" : ""}`}
                        onMouseMove={
                          code
                            ? (e) =>
                                setHover({
                                  region,
                                  col: c,
                                  value: display,
                                  code,
                                  x: e.clientX,
                                  y: e.clientY,
                                })
                            : undefined
                        }
                        onMouseLeave={code ? () => setHover(null) : undefined}
                      >
                        <CellValue value={display} code={code} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5">
                    {(() => {
                      // Pick first/last *valid* points so a missing boundary
                      // year doesn't blank the trend, and guard division by
                      // zero on `firstValid === 0` (audit C3 + C4, second pass).
                      const validIdx: number[] = [];
                      series.forEach((v, i) => {
                        if (Number.isFinite(v)) validIdx.push(i);
                      });
                      if (validIdx.length < 2) {
                        return <span className="text-[10.5px] text-gray-300 dark:text-gray-600">—</span>;
                      }
                      const first = series[validIdx[0]];
                      const last = series[validIdx[validIdx.length - 1]];
                      const pct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
                      return (
                        <div className="flex items-center gap-2">
                          <Sparkline
                            values={series}
                            color={trendUp ? "#10b981" : "#f04438"}
                            fill={trendUp ? "rgba(16,185,129,.12)" : "rgba(240,68,56,.10)"}
                            width={68}
                            height={20}
                            strokeWidth={1.4}
                          />
                          {pct !== null ? (
                            <span
                              className={`text-[10.5px] tabular-nums ${
                                trendUp
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              }`}
                            >
                              {pct.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-[10.5px] text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* right edge fade so users sense more cols when scrolling */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 top-0 w-8"
          style={{
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,1))",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 top-0 hidden w-8 dark:block"
          style={{
            background:
              "linear-gradient(to right, transparent, rgba(17,24,39,1))",
          }}
        />
      </div>

      {hover && <CellTooltip {...hover} sourceId={sourceId} sourceType={sourceType} unit={unit ?? ""} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CellTooltip — fixed-position, follows mouse. Provenance + value-code defs.
// ─────────────────────────────────────────────────────────────────────────────
function CellTooltip({
  region,
  col,
  value,
  code,
  x,
  y,
  sourceId,
  sourceType,
  unit,
}: {
  region: string;
  col: string;
  value: string | number;
  code: string | null;
  x: number;
  y: number;
  sourceId: number;
  sourceType: SourceType;
  unit: string;
}) {
  const def = describeValueCode(code);
  // pin to the right of the cursor unless near the right edge
  const TOOLTIP_W = 280;
  const left =
    typeof window !== "undefined" && x + TOOLTIP_W + 16 > window.innerWidth
      ? Math.max(8, x - TOOLTIP_W - 8)
      : x + 12;
  const top = y + 12;

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{ top, left, width: TOOLTIP_W }}
    >
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 text-[12px] leading-snug shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SourceTypeBadge type={sourceType} size="sm" pulse={false} />
          <span className="text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
            #{sourceId}
          </span>
        </div>
        <div className="mb-0.5 text-[14.5px] font-semibold tabular-nums text-gray-900 dark:text-white">
          {typeof value === "number" ? value.toLocaleString("id-ID") : value}
          {unit && (
            <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">
              {unit}
            </span>
          )}
        </div>
        <div className="text-gray-600 dark:text-gray-400">{col}</div>
        <div className="mt-2 truncate border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
          📍 {region}
        </div>
        {def && (
          <div className="mt-2 flex items-start gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
              {def.code}
            </span>
            <span className="text-[11px] text-gray-600 dark:text-gray-400">
              <span className="font-medium">{def.label}.</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
