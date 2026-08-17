"use client";

import Link from "next/link";
import React, { type CSSProperties } from "react";
import { Map as MapIcon } from "lucide-react";
import { getCategoryDesign } from "../../kategori/_lib/categoryIcons";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";
import {
  CalendarIcon,
  CategoryChip,
  ChevronLeftIcon,
  ClockIcon,
  GlobeIcon,
  Sparkline,
  SourceTypeBadge,
} from "./atoms";

export type HeroProps = {
  sourceId: number;
  sourceName: string;
  sourceType: SourceType;
  unit: string | null | undefined;
  lastUpdate: string | null | undefined;
  availableYears: string[];
  regionsCount: number;
  parentCategoryName: string | null;
  parentCategorySlug: string | null;
  totalSeries: number[]; // one number per year (oldest → newest) for the sparkline summary
  /** Server-resolved: true if this indikator appears in /peta-tematik/public/indikator-list.
   *  When true, Hero renders a deep-link chip to /peta-tematik?ind=<sourceId>. */
  petaTematikEligible?: boolean;
};

export default function Hero(props: HeroProps) {
  const {
    sourceId,
    sourceName,
    sourceType,
    unit,
    lastUpdate,
    availableYears,
    regionsCount,
    parentCategoryName,
    parentCategorySlug,
    totalSeries,
    petaTematikEligible,
  } = props;

  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];
  const catDesign = parentCategoryName ? getCategoryDesign(parentCategoryName) : null;

  const yrSpan =
    availableYears.length > 1
      ? `${availableYears[availableYears.length - 1]}–${availableYears[0]}`
      : availableYears[0] ?? "";

  // Use the first / last *valid* (non-NaN) points so a single sparse year at
  // the edges of the time range doesn't blank the whole sparkline summary card
  // (audit-finding B1). availableYears is descending; totalSeries is built
  // ascending in the parent, so we walk indices to recover the year labels.
  // Filter NaN only — genuine zero values (e.g. zero exports in a month) are
  // real data and shouldn't be silently dropped (audit C4, second pass).
  const yearsAsc = availableYears.slice().sort((a, b) => Number(a) - Number(b));
  const validIdx: number[] = [];
  totalSeries.forEach((v, i) => {
    if (Number.isFinite(v)) validIdx.push(i);
  });
  const firstValidIdx = validIdx[0];
  const lastValidIdx = validIdx[validIdx.length - 1];
  const showSparkline =
    validIdx.length >= 2 &&
    firstValidIdx !== undefined &&
    lastValidIdx !== undefined &&
    firstValidIdx !== lastValidIdx;
  const firstTotal = showSparkline ? totalSeries[firstValidIdx] : 0;
  const lastTotal = showSparkline ? totalSeries[lastValidIdx] : 0;
  // Guard division-by-zero when firstTotal is exactly 0 (audit C3, second pass).
  // Returns null so callers can render an em-dash instead of "Infinity%".
  const pct: number | null =
    showSparkline && firstTotal !== 0
      ? ((lastTotal - firstTotal) / Math.abs(firstTotal)) * 100
      : null;
  const sparkLabelStart = showSparkline ? yearsAsc[firstValidIdx] : "";
  const sparkLabelEnd = showSparkline ? yearsAsc[lastValidIdx] : "";

  // dark variant doesn't expose its own accent — use the icon hue (which is the
  // saturated swatch in the dark palette) so the rail stays visible in dark mode.
  const accentVars: CSSProperties = catDesign
    ? ({
        ["--cat-accent-light" as string]: catDesign.light.accent,
        ["--cat-accent-dark" as string]: catDesign.dark.icon,
      } as CSSProperties)
    : {};

  return (
    <section
      style={accentVars}
      className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
    >
      {/* category accent rail */}
      {catDesign && (
        <div
          aria-hidden
          className="absolute bottom-0 left-0 top-0 w-1 bg-[color:var(--cat-accent-light)] dark:bg-[color:var(--cat-accent-dark)]"
        />
      )}

      <div className="px-5 py-5 md:px-7 md:py-6">
        {/* Breadcrumb (desktop) / back link (mobile) */}
        {parentCategorySlug && parentCategoryName && (
          <>
            <div className="mb-3 hidden items-center gap-2 text-[12.5px] text-gray-500 dark:text-gray-400 md:flex">
              <Link href="/kategori" className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white">
                <ChevronLeftIcon size={13} />
                Kategori
              </Link>
              <span className="text-gray-300 dark:text-gray-700">/</span>
              <Link href={`/kategori/${parentCategorySlug}`} className="hover:text-gray-900 dark:hover:text-white">
                {parentCategoryName}
              </Link>
            </div>
            <Link
              href={`/kategori/${parentCategorySlug}`}
              className="mb-2.5 inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white md:hidden"
            >
              <ChevronLeftIcon size={13} />
              Kembali ke {parentCategoryName.split(",")[0]}
            </Link>
          </>
        )}

        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            {/* chip cluster */}
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              {parentCategoryName && <CategoryChip name={parentCategoryName} size="sm" />}
              <SourceTypeBadge type={sourceType} size="sm" />
              <span className="hidden text-xs text-gray-400 dark:text-gray-500 md:inline">·</span>
              <span className="hidden text-xs text-gray-500 dark:text-gray-400 md:inline">
                ID #{sourceId}
              </span>
            </div>

            <h1 className="m-0 text-balance text-[18px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-white md:text-[22px]">
              {sourceName}
            </h1>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-gray-500 dark:text-gray-400 md:mt-3 md:gap-x-5 md:text-[12.5px]">
              {lastUpdate && (
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon size={13} />
                  Diperbarui {lastUpdate}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon size={13} />
                {availableYears.length} tahun{yrSpan && ` (${yrSpan})`}
              </span>
              {regionsCount > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <GlobeIcon size={13} />
                  {regionsCount} wilayah
                  {unit && ` · satuan ${unit}`}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 md:hidden">#{sourceId}</span>
            </div>

            {/* Peta Tematik CTA — only renders when this indikator has kabkota
                data in /peta-tematik/public/indikator-list (server-resolved). */}
            {petaTematikEligible && (
              <Link
                href={`/peta-tematik?ind=${sourceId}`}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-400 bg-emerald-500 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-600 hover:shadow dark:border-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                title="Lihat indikator ini sebagai peta choropleth per kabupaten/kota"
              >
                <MapIcon className="h-4 w-4" />
                Lihat di Peta Tematik
                <span aria-hidden className="text-base leading-none">→</span>
              </Link>
            )}
          </div>

          {/* desktop sparkline summary card */}
          {showSparkline && (
            <div className="hidden w-[260px] shrink-0 rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/40 lg:block">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <span>Total provinsi · {unit || "—"}</span>
                {pct === null ? (
                  <span className="font-semibold tabular-nums text-gray-400 dark:text-gray-500">—</span>
                ) : (
                  <span
                    className={`font-semibold tabular-nums ${
                      pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-end justify-between">
                <div className="text-[26px] font-semibold leading-none tabular-nums text-gray-900 dark:text-white">
                  {unit === "Persen"
                    ? lastTotal.toFixed(2)
                    : lastTotal.toLocaleString("id-ID")}
                </div>
                <Sparkline
                  values={totalSeries}
                  color={stype.bar}
                  fill={stype.bar}
                  width={120}
                  height={36}
                  strokeWidth={1.75}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
                <span>{sparkLabelStart}</span>
                <span>{sparkLabelEnd}</span>
              </div>
            </div>
          )}
        </div>

        {/* mobile inline sparkline (compact) */}
        {showSparkline && (
          <div className="mt-3 flex items-center justify-between gap-3 lg:hidden">
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400">
              Total provinsi:{" "}
              <strong className="font-bold text-gray-900 dark:text-white">
                {unit === "Persen" ? lastTotal.toFixed(2) : lastTotal.toLocaleString("id-ID")}
              </strong>{" "}
              {pct !== null && (
                <span
                  className={`tabular-nums ${
                    pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  ({pct >= 0 ? "+" : ""}
                  {pct.toFixed(1)}%)
                </span>
              )}
            </div>
            <Sparkline
              values={totalSeries}
              color={stype.bar}
              fill={stype.bar}
              width={88}
              height={24}
              strokeWidth={1.4}
            />
          </div>
        )}
      </div>
    </section>
  );
}
