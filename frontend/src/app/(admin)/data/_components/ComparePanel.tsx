"use client";

import React, { useMemo } from "react";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";
import {
  barPercent,
  compareExtent,
  seriesToPaths,
  type CompareSeries,
  type MetricStats,
} from "../_lib/tableStats";

export type CompareMode = "wilayah" | "tren";

// Four hues that stay distinguishable side by side and in dark mode. The pin
// limit is four for the same reason: a fifth line would have to reuse one.
const LINE_COLORS = ["#465fff", "#0891b2", "#f79009", "#7c3aed"];

const CHART_W = 540;
const CHART_H = 210;
const PAD_Y = 8;

export default function ComparePanel({
  mode,
  onModeChange,
  stats,
  series,
  yearsAsc,
  pinned,
  onClearPins,
  onRemovePin,
  pinLimit,
  metricColumn,
  selectedYear,
  unit,
  sourceType,
  format,
}: {
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  stats: MetricStats;
  series: CompareSeries[];
  yearsAsc: string[];
  pinned: string[];
  onClearPins: () => void;
  onRemovePin: (label: string) => void;
  pinLimit: number;
  metricColumn: string | null;
  selectedYear: string;
  unit: string | null | undefined;
  sourceType: SourceType;
  format: (value: number) => string;
}) {
  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];
  const unitSuffix = unit ? ` · satuan ${unit}` : "";
  const yearSpan =
    yearsAsc.length > 1 ? `${yearsAsc[0]}–${yearsAsc[yearsAsc.length - 1]}` : yearsAsc[0] ?? "";

  const extent = useMemo(() => compareExtent(series), [series]);

  const lines = useMemo(
    () =>
      series.map((s, i) => ({
        label: s.label,
        color: LINE_COLORS[i % LINE_COLORS.length],
        paths: seriesToPaths({
          points: s.points,
          min: extent.min,
          max: extent.max,
          width: CHART_W,
          height: CHART_H,
          padY: PAD_Y,
        }),
        last: [...s.points].reverse().find((p) => p.value !== null) ?? null,
      })),
    [series, extent],
  );

  const gridLines = useMemo(() => {
    const span = extent.max - extent.min || 1;
    const inner = CHART_H - PAD_Y * 2;
    return [0, 1, 2, 3].map((k) => {
      const value = extent.min + (span * k) / 3;
      return { value, y: PAD_Y + inner - (inner * k) / 3 };
    });
  }, [extent]);

  if (!metricColumn) return null;

  const title =
    mode === "wilayah"
      ? `${metricColumn} per wilayah · ${selectedYear}`
      : `${metricColumn} · tren ${yearSpan}`;
  const subtitle =
    mode === "wilayah"
      ? `Diurutkan dari nilai tertinggi${unitSuffix}`
      : `${pinned.length} wilayah dibandingkan${unitSuffix}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800 md:px-5">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-gray-900 dark:text-white md:text-[14px]">
            {title}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pinned.length > 0 && (
            <button
              type="button"
              onClick={onClearPins}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
              </svg>
              Kosongkan
            </button>
          )}
          <div
            role="tablist"
            aria-label="Mode perbandingan"
            className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
          >
            <ModeTab
              active={mode === "wilayah"}
              accent={stype.bar}
              onClick={() => onModeChange("wilayah")}
            >
              Per wilayah
            </ModeTab>
            <ModeTab
              active={mode === "tren"}
              accent={stype.bar}
              onClick={() => onModeChange("tren")}
            >
              Tren tahun
            </ModeTab>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 md:px-5">
        {mode === "wilayah" ? (
          stats.ranked.length === 0 ? (
            <EmptyNote>Tidak ada angka pada kolom ini untuk {selectedYear}.</EmptyNote>
          ) : (
            <ul className="space-y-1.5">
              {stats.ranked.map((r) => {
                const pct = barPercent(r.value, stats.maxAbs) ?? 0;
                const isPinned = pinned.includes(r.label);
                return (
                  <li key={r.label} className="flex items-center gap-3">
                    <span
                      className={`w-[104px] shrink-0 truncate text-[11.5px] md:w-[168px] ${
                        isPinned
                          ? "font-semibold text-gray-900 dark:text-white"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                      title={r.label}
                    >
                      {r.label}
                    </span>
                    <span className="h-[18px] min-w-0 flex-1 rounded bg-gray-100 dark:bg-gray-800">
                      <span
                        className="block h-full rounded transition-[width] duration-500"
                        style={{
                          width: `${pct.toFixed(1)}%`,
                          background: stype.bar,
                          opacity: isPinned ? 1 : 0.55,
                        }}
                      />
                    </span>
                    <span className="w-[86px] shrink-0 text-right text-[11.5px] tabular-nums text-gray-700 dark:text-gray-300">
                      {format(r.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : pinned.length === 0 ? (
          <EmptyNote>
            Belum ada wilayah yang dibandingkan.
            <span className="mt-1 block text-gray-400 dark:text-gray-500">
              Tekan ikon tren di kolom terakhir tabel untuk menambahkan (maksimal {pinLimit}).
            </span>
          </EmptyNote>
        ) : (
          <div>
            <div className="relative">
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="none"
                className="h-[210px] w-full"
                role="img"
                aria-label={`Tren ${metricColumn} untuk ${pinned.join(", ")}`}
              >
                {gridLines.map((g) => (
                  <line
                    key={g.y}
                    x1={0}
                    x2={CHART_W}
                    y1={g.y}
                    y2={g.y}
                    className="stroke-gray-200 dark:stroke-gray-700"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {lines.map((l) =>
                  l.paths.map((d, i) => (
                    <path
                      key={`${l.label}-${i}`}
                      d={d}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )),
                )}
              </svg>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-between py-1 text-right">
                {[...gridLines].reverse().map((g) => (
                  <span
                    key={g.value}
                    className="bg-white/80 px-1 text-[10.5px] tabular-nums text-gray-400 dark:bg-gray-900/80 dark:text-gray-500"
                  >
                    {format(g.value)}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
              {yearsAsc.map((y) => (
                <span key={y}>{y}</span>
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
              {lines.map((l) => (
                <li key={l.label} className="flex items-center gap-2 text-[11.5px]">
                  <span
                    aria-hidden
                    className="inline-block h-[3px] w-4 rounded"
                    style={{ background: l.color }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">{l.label}</span>
                  {l.last?.value !== null && l.last !== null && (
                    <span className="tabular-nums text-gray-400 dark:text-gray-500">
                      {format(l.last.value as number)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemovePin(l.label)}
                    aria-label={`Hapus ${l.label} dari perbandingan`}
                    className="text-gray-300 transition-colors hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeTab({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        active
          ? "text-white"
          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      }`}
      style={active ? { background: accent } : undefined}
    >
      {children}
    </button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-10 text-center text-[13px] text-gray-500 dark:text-gray-400">{children}</div>
  );
}
