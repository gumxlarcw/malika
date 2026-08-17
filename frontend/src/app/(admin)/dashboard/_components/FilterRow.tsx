"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, TEXT_2, TEXT_4, TEXT_5 } from "@/lib/surfaceTokens";
import { FilterSummary } from "./DashboardChrome";
import type { EligibleIndicator } from "../_lib/regions";

/**
 * Filters for the regional panels.
 *
 * Scoped deliberately: the summary endpoint reports each indicator's latest
 * published period and nothing else, so a period control cannot rewind the KPI
 * cards. It can and does drive the rank, table and profile panels, which read
 * per-year kabupaten/kota values. The meta line says exactly which panels are
 * affected, so the controls never appear to do more than they do.
 */

function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={cn("inline-flex h-9 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2.5", BORDER, SURFACE)}>
      <span className={cn("shrink-0 text-xs", TEXT_5)}>{label}</span>
      {children}
    </label>
  );
}

/*
 * Indicator names run long ("Tingkat Pengangguran Terbuka (TPT) Kabupaten/Kota")
 * and a native select clips at its box edge, which reads as a broken border
 * rather than as truncation. Ellipsis makes the cut deliberate.
 */
const selectClass = (extra = "max-w-[9rem] sm:max-w-[13rem]") =>
  cn("min-w-0 cursor-pointer truncate border-0 bg-transparent text-[13px] font-medium outline-none", TEXT_2, extra);

export function FilterRow({
  indicators,
  indicator,
  onIndicator,
  years,
  year,
  onYear,
  regions,
  region,
  onRegion,
  onReset,
  canReset,
}: {
  indicators: EligibleIndicator[];
  indicator: number | null;
  onIndicator: (id: number) => void;
  years: number[];
  year: number | null;
  onYear: (year: number) => void;
  regions: string[];
  region: string | null;
  onRegion: (region: string | null) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.02em]", TEXT_5)}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M3 5.5h14M5.5 10h9M8.5 14.5h3" />
        </svg>
        Filter
      </span>

      <Pill label="Indikator">
        <select
          aria-label="Indikator wilayah"
          value={indicator ?? ""}
          onChange={(e) => onIndicator(Number(e.target.value))}
          className={selectClass()}
        >
          {!indicators.length ? <option value="">Memuat…</option> : null}
          {indicators.map((it) => (
            <option key={it.sourceId} value={it.sourceId}>
              {it.sourceName}
            </option>
          ))}
        </select>
      </Pill>

      <Pill label="Periode">
        <select
          aria-label="Periode"
          value={year ?? ""}
          onChange={(e) => onYear(Number(e.target.value))}
          className={selectClass("max-w-[6rem]")}
        >
          {!years.length ? <option value="">—</option> : null}
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Pill>

      <Pill label="Wilayah">
        <select
          aria-label="Wilayah"
          value={region ?? "all"}
          onChange={(e) => onRegion(e.target.value === "all" ? null : e.target.value)}
          className={selectClass()}
        >
          <option value="all">Seluruh provinsi</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Pill>

      {canReset ? (
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
            TEXT_4
          )}
        >
          Atur ulang
        </button>
      ) : null}

      <FilterSummary>
        <span className="ml-auto block">
          {region ?? "seluruh provinsi"} · {year ?? "—"} · memfilter panel wilayah
        </span>
      </FilterSummary>
    </div>
  );
}
