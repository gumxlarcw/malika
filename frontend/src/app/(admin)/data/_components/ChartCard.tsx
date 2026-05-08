"use client";

import React from "react";
import SearchInsightsChart from "@/components/search/SearchInsightsChart";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";

// Wraps the existing SearchInsightsChart in the redesigned card chrome.
// We deliberately don't touch the chart's internals — just add a header strip
// with source-type accent, year pill, and a footnote with the data update time.
export default function ChartCard({
  rows,
  columns,
  sourceId,
  sourceType,
  chartConfig,
  selectedYear,
  unit,
  lastUpdate,
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sourceId: number;
  sourceType: SourceType;
  chartConfig?: unknown;
  selectedYear: string;
  unit: string | null | undefined;
  lastUpdate: string | null | undefined;
}) {
  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];
  const lastCol = columns[columns.length - 1] ?? "";

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800 md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-gray-900 dark:text-white md:text-[14px]">
              Grafik · {lastCol || "Sebaran"}
            </h3>
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: stype.light.bg, color: stype.light.text }}
            >
              {selectedYear}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-gray-500 dark:text-gray-400">
            Sebaran per wilayah{unit && ` · satuan ${unit}`}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3 md:px-5">
        <SearchInsightsChart
          rows={rows}
          columns={columns}
          sourceId={sourceId}
          sourceType={sourceType as "dynamic" | "interop" | "exim"}
          chartConfig={chartConfig as Parameters<typeof SearchInsightsChart>[0]["chartConfig"]}
          allowFullTimeRange={true}
        />
      </div>

      {lastUpdate && (
        <div className="border-t border-gray-100 px-4 py-2 text-[10.5px] text-gray-500 dark:border-gray-800 dark:text-gray-400 md:px-5">
          Bersumber dari publikasi {lastUpdate}
        </div>
      )}
    </div>
  );
}
