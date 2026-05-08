"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  asSourceType,
  SOURCE_TYPE_PALETTE,
  type SourceType,
} from "../_lib/sourceTypePalette";
import {
  CalendarIcon,
  ChevronDownIcon,
  CloseIcon,
  ColumnsIcon,
  DownloadIcon,
  PinIcon,
  PrintIcon,
} from "./atoms";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export type DownloadFormat = "excel" | "csv" | "pdf" | "json";

export type FilterBarProps = {
  sourceType: SourceType;
  availableYears: string[];   // descending order (e.g. ["2026","2025",…,"2020"])
  selectedYear: string;
  onYearChange: (y: string) => void;

  monthNo: number | null;
  geo: string | null;
  geoApplied: boolean;

  // tool-cluster wiring
  columns: string[];
  hiddenColumns: string[];
  onToggleColumn: (col: string) => void;
  onShowAllColumns: () => void;
  onHideAllColumns: () => void;

  onDownload: (format: DownloadFormat) => void;
  onPrint: () => void;

  rowsCount: number;
};

export default function FilterBar(props: FilterBarProps) {
  const {
    sourceType,
    availableYears,
    selectedYear,
    onYearChange,
    monthNo,
    geo,
    geoApplied,
    columns,
    hiddenColumns,
    onToggleColumn,
    onShowAllColumns,
    onHideAllColumns,
    onDownload,
    onPrint,
    rowsCount,
  } = props;

  const stype = SOURCE_TYPE_PALETTE[asSourceType(sourceType)];

  // years asc for the scrubber rail
  const yearsAsc = [...availableYears].sort((a, b) => Number(a) - Number(b));
  const idx = Math.max(0, yearsAsc.indexOf(selectedYear));
  const progressPct = yearsAsc.length > 1 ? (idx / (yearsAsc.length - 1)) * 100 : 100;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-theme-xs backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90 md:px-5 md:py-3.5">
      {/* DESKTOP: scrubber + chips + tools, all in one row */}
      <div className="hidden items-center gap-5 lg:flex">
        <YearScrubber
          yearsAsc={yearsAsc}
          selectedYear={selectedYear}
          progressPct={progressPct}
          activeBg={stype.bar}
          onYearChange={onYearChange}
        />
        <div className="h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-800" />
        <ActiveFilterChips
          monthNo={monthNo}
          geo={geo}
          geoApplied={geoApplied}
          accentBg={stype.bar}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <ColumnsButton
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggle={onToggleColumn}
            onShowAll={onShowAllColumns}
            onHideAll={onHideAllColumns}
          />
          <DownloadButton onDownload={onDownload} accentBg={stype.bar} accentBgDark={stype.barDark} />
          <button
            type="button"
            onClick={onPrint}
            disabled={rowsCount === 0}
            aria-label="Cetak"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2 text-[12.5px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <PrintIcon size={14} />
          </button>
        </div>
      </div>

      {/* TABLET / MOBILE: stacked rows */}
      <div className="lg:hidden">
        {/* Year pills */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {availableYears.map((y) => {
            const active = y === selectedYear;
            return (
              <button
                key={y}
                type="button"
                onClick={() => onYearChange(y)}
                className={`shrink-0 rounded-full px-3 text-[12.5px] font-semibold tabular-nums transition-colors ${
                  active
                    ? "text-white"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                }`}
                style={active ? { background: stype.bar, height: 30 } : { height: 30 }}
              >
                {y}
              </button>
            );
          })}
        </div>
        {/* Active filter chips */}
        {(monthNo || (geo && geoApplied)) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ActiveFilterChips
              monthNo={monthNo}
              geo={geo}
              geoApplied={geoApplied}
              accentBg={stype.bar}
              alwaysShow={false}
            />
          </div>
        )}
        {/* Tools row */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <ColumnsButton
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggle={onToggleColumn}
            onShowAll={onShowAllColumns}
            onHideAll={onHideAllColumns}
            compact
          />
          <DownloadButton onDownload={onDownload} accentBg={stype.bar} accentBgDark={stype.barDark} compact />
          <button
            type="button"
            onClick={onPrint}
            disabled={rowsCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <PrintIcon size={13} />
            Cetak
          </button>
          <span className="ml-auto text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
            {rowsCount} baris
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop year scrubber — timeline rail with brand-tinted progress + dot per year
// ─────────────────────────────────────────────────────────────────────────────
function YearScrubber({
  yearsAsc,
  selectedYear,
  progressPct,
  activeBg,
  onYearChange,
}: {
  yearsAsc: string[];
  selectedYear: string;
  progressPct: number;
  activeBg: string;
  onYearChange: (y: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Tahun
        </span>
        <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
          {yearsAsc[0]} → {yearsAsc[yearsAsc.length - 1]}
        </span>
      </div>
      <div className="relative">
        <div
          className="absolute left-2 right-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gray-100 dark:bg-gray-800"
          aria-hidden
        />
        <div
          className="absolute left-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ width: `calc(${progressPct}% - 4px)`, background: activeBg }}
          aria-hidden
        />
        <div className="relative flex justify-between">
          {yearsAsc.map((y) => {
            const active = y === selectedYear;
            return (
              <button
                key={y}
                type="button"
                onClick={() => onYearChange(y)}
                className={`group relative flex flex-col items-center gap-1.5 px-2 py-1 transition-colors ${
                  active ? "" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
                aria-label={`Tahun ${y}`}
                aria-pressed={active}
              >
                <span
                  className={`rounded-full transition-all ${
                    active
                      ? "h-3 w-3 ring-4 ring-white dark:ring-gray-900"
                      : "h-2 w-2 bg-gray-300 group-hover:h-2.5 group-hover:w-2.5 dark:bg-gray-700"
                  }`}
                  style={active ? { background: activeBg } : undefined}
                />
                <span
                  className={`text-[12px] font-medium tabular-nums ${
                    active ? "text-gray-900 dark:text-white" : ""
                  }`}
                >
                  {y}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveFilterChips — region/month chips, or italic placeholder when none active
// ─────────────────────────────────────────────────────────────────────────────
function ActiveFilterChips({
  monthNo,
  geo,
  geoApplied,
  accentBg,
  alwaysShow = true,
}: {
  monthNo: number | null;
  geo: string | null;
  geoApplied: boolean;
  accentBg: string;
  alwaysShow?: boolean;
}) {
  const chips: React.ReactNode[] = [];
  if (geo && geoApplied) {
    chips.push(
      <FilterChip key="geo" icon={<PinIcon size={11} />} label={`Wilayah · ${geo}`} />,
    );
  }
  if (monthNo) {
    chips.push(
      <FilterChip
        key="month"
        icon={<CalendarIcon size={11} />}
        label={`Bulan · ${MONTHS[monthNo - 1]}`}
        accentBg={accentBg}
      />,
    );
  }
  if (chips.length === 0 && alwaysShow) {
    return (
      <span className="px-1 text-[11.5px] italic text-gray-400 dark:text-gray-500">
        Semua wilayah · Tahun penuh
      </span>
    );
  }
  if (chips.length === 0) return null;
  return <div className="flex shrink-0 items-center gap-2">{chips}</div>;
}

function FilterChip({
  icon,
  label,
  accentBg,
}: {
  icon: React.ReactNode;
  label: string;
  accentBg?: string;
}) {
  if (accentBg) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium"
        style={{
          background: "rgba(70,95,255,0.08)",
          borderColor: "rgba(70,95,255,0.25)",
          color: "#2a31d8",
        }}
      >
        <span style={{ color: accentBg }}>{icon}</span>
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 py-1 pl-2.5 pr-2.5 text-[11.5px] font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
      <span>{icon}</span>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool buttons — reusable dropdowns
// ─────────────────────────────────────────────────────────────────────────────
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return { open, setOpen, ref };
}

function ColumnsButton({
  columns,
  hiddenColumns,
  onToggle,
  onShowAll,
  onHideAll,
  compact = false,
}: {
  columns: string[];
  hiddenColumns: string[];
  onToggle: (col: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  compact?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  const visibleCount = columns.length - hiddenColumns.length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={columns.length === 0}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 ${
          compact ? "px-2.5 py-1.5 text-[12px]" : "px-2.5 py-2 text-[12.5px]"
        } font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800`}
      >
        <ColumnsIcon size={compact ? 13 : 14} />
        Kolom
        <span className="text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
          ({visibleCount}/{columns.length})
        </span>
        <ChevronDownIcon size={11} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <button type="button" onClick={onShowAll} className="hover:text-gray-700 dark:hover:text-gray-200">
              Tampilkan semua
            </button>
            <button type="button" onClick={onHideAll} className="hover:text-gray-700 dark:hover:text-gray-200">
              Sembunyikan semua
            </button>
          </div>
          <div className="max-h-60 overflow-auto px-2 py-2">
            {columns.map((c) => {
              const checked = !hiddenColumns.includes(c);
              return (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(c)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="min-w-0 truncate" title={c}>
                    {c}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadButton({
  onDownload,
  accentBg,
  accentBgDark,
  compact = false,
}: {
  onDownload: (format: DownloadFormat) => void;
  accentBg: string;
  accentBgDark: string;
  compact?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg ${
          compact ? "px-2.5 py-1.5 text-[12px]" : "px-3 py-2 text-[12.5px]"
        } font-medium text-white shadow-sm transition-[filter] hover:brightness-110`}
        style={{ background: accentBg }}
      >
        <DownloadIcon size={compact ? 13 : 14} />
        Unduh
        <ChevronDownIcon size={11} className="opacity-90" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
          {(
            [
              { k: "excel" as const, label: "Excel (.xlsx)", sub: "Semua tahun" },
              { k: "csv" as const,   label: "CSV (.csv)",    sub: "Tahun aktif" },
              { k: "pdf" as const,   label: "PDF (.pdf)",    sub: "Format laporan" },
              { k: "json" as const,  label: "JSON (.json)",  sub: "Lengkap dengan kode" },
            ]
          ).map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() => {
                setOpen(false);
                onDownload(opt.k);
              }}
              className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">
                {opt.label}
              </div>
              <div className="text-[10.5px] text-gray-500 dark:text-gray-400">{opt.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
