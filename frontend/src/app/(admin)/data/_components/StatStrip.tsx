"use client";

import React from "react";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";
import type { MetricStats } from "../_lib/tableStats";

/**
 * Highest / lowest / spread for the active measure in the active year.
 *
 * The design's fourth card — the provincial total with its sparkline — already
 * ships in `Hero`, so it is not repeated here.
 */
export default function StatStrip({
  stats,
  metricColumn,
  selectedYear,
  unit,
  sourceType,
  format,
}: {
  stats: MetricStats;
  metricColumn: string | null;
  selectedYear: string;
  unit: string | null | undefined;
  sourceType: SourceType;
  format: (value: number) => string;
}) {
  // Two regions is the floor for "highest vs lowest" to mean anything; below
  // that the cards would restate the single row already visible in the table.
  if (!metricColumn || stats.count < 2 || !stats.top || !stats.low || stats.mean === null) {
    return null;
  }

  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        eyebrow="Tertinggi"
        accent={stype.bar}
        name={stats.top.label}
        value={`${format(stats.top.value)}${unitSuffix}`}
        note={`peringkat 1 dari ${stats.count} wilayah`}
      />
      <StatCard
        eyebrow="Terendah"
        accent={stype.bar}
        name={stats.low.label}
        value={`${format(stats.low.value)}${unitSuffix}`}
        note={
          stats.ratio === null
            ? `peringkat ${stats.count} dari ${stats.count} wilayah`
            : `selisih ${stats.ratio.toLocaleString("id-ID", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}× dari tertinggi`
        }
      />
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-400 dark:text-gray-500">
          Sebaran {selectedYear}
        </span>
        <div className="mt-1.5 text-[18px] font-semibold leading-6 tabular-nums text-gray-900 dark:text-white">
          {format(stats.mean)}
          {unit && (
            <span className="ml-1 text-[12px] font-normal text-gray-500 dark:text-gray-400">
              {unit}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] leading-[18px] text-gray-500 dark:text-gray-400">
          rata-rata per wilayah
        </div>
        <div className="mt-2 border-t border-dashed border-gray-200 pt-2 text-[12px] leading-[18px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
          {stats.above} wilayah di atas rata-rata, {stats.below} di bawahnya
        </div>
      </div>
    </div>
  );
}

function StatCard({
  eyebrow,
  accent,
  name,
  value,
  note,
}: {
  eyebrow: string;
  accent: string;
  name: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <span className="h-3 w-1 rounded" style={{ background: accent }} aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-400 dark:text-gray-500">
          {eyebrow}
        </span>
      </div>
      <div
        className="mt-1.5 truncate text-[14px] font-semibold leading-5 text-gray-900 dark:text-white"
        title={name}
      >
        {name}
      </div>
      <div className="mt-0.5 text-[18px] font-semibold leading-6 tabular-nums text-gray-700 dark:text-gray-200">
        {value}
      </div>
      <div className="mt-1 text-[12px] leading-[18px] text-gray-500 dark:text-gray-400">{note}</div>
    </div>
  );
}
