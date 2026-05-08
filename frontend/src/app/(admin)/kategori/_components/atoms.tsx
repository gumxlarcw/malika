"use client";

import React from "react";
import { TYPE_PALETTE_DARK, TYPE_PALETTE_LIGHT } from "../_lib/typeColors";
import {
  SOURCE_TYPE_LABEL,
  SOURCE_TYPES,
  type SourceType,
  type TypeCounts,
} from "../_lib/types";

// `auto` follows the document's dark class (Tailwind classes).
// `dark` forces the dark palette (used on always-dark surfaces like the brand band).
type Palette = "auto" | "dark";

// Tailwind class maps for `auto` mode. Match the hex in typeColors.ts.
const AUTO_BADGE: Record<SourceType, string> = {
  dynamic: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  interop: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  exim:    "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  static:  "bg-gray-200 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
};

const AUTO_DOT: Record<SourceType, string> = {
  dynamic: "bg-blue-500 dark:bg-blue-400",
  interop: "bg-violet-500 dark:bg-violet-400",
  exim:    "bg-orange-500 dark:bg-orange-400",
  static:  "bg-gray-500 dark:bg-gray-400",
};

function asType(t: SourceType | string): SourceType {
  return (t as SourceType) in AUTO_BADGE ? (t as SourceType) : "static";
}

export function TypeBadge({
  type,
  small = false,
  palette = "auto",
}: {
  type: SourceType | string;
  small?: boolean;
  palette?: Palette;
}) {
  const t = asType(type);
  const sizeStyle = { padding: small ? "1px 7px" : "2px 7px", fontSize: small ? 10 : 11 };

  if (palette === "dark") {
    const p = TYPE_PALETTE_DARK[t];
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-semibold tracking-tight"
        style={{ ...sizeStyle, background: p.bg, color: p.fg }}
      >
        <span className="inline-block h-[5px] w-[5px] flex-shrink-0 rounded-full" style={{ background: p.dot }} />
        {SOURCE_TYPE_LABEL[t]}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-semibold tracking-tight ${AUTO_BADGE[t]}`}
      style={sizeStyle}
    >
      <span className={`inline-block h-[5px] w-[5px] flex-shrink-0 rounded-full ${AUTO_DOT[t]}`} />
      {SOURCE_TYPE_LABEL[t]}
    </span>
  );
}

export function DistributionBar({
  counts,
  height = 6,
  showLegend = false,
  gap = 2,
  palette = "auto",
}: {
  counts: TypeCounts;
  height?: number;
  showLegend?: boolean;
  gap?: number;
  palette?: Palette;
}) {
  const total = SOURCE_TYPES.reduce((a, t) => a + counts[t], 0) || 1;
  const isDark = palette === "dark";

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className="flex w-full overflow-hidden rounded-full"
        style={{ height, gap }}
      >
        {SOURCE_TYPES.map((t) => {
          if (!counts[t]) return null;
          const pct = (counts[t] / total) * 100;
          if (isDark) {
            return (
              <div key={t} className="rounded-sm" style={{ flex: pct, background: TYPE_PALETTE_DARK[t].dot }} />
            );
          }
          return <div key={t} className={`rounded-sm ${AUTO_DOT[t]}`} style={{ flex: pct }} />;
        })}
      </div>
      {showLegend && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px]"
          style={isDark ? { color: "rgba(255,255,255,0.75)" } : undefined}
        >
          <span className={isDark ? "" : "text-gray-500 dark:text-gray-400"} style={{ display: "contents" }}>
            {SOURCE_TYPES.map((t) =>
              counts[t] > 0 ? (
                <span key={t} className="inline-flex items-center gap-1.5">
                  {isDark ? (
                    <span
                      className="inline-block h-[7px] w-[7px] rounded-full"
                      style={{ background: TYPE_PALETTE_DARK[t].dot }}
                    />
                  ) : (
                    <span className={`inline-block h-[7px] w-[7px] rounded-full ${AUTO_DOT[t]}`} />
                  )}
                  <span>
                    {SOURCE_TYPE_LABEL[t]}{" "}
                    <span style={isDark ? { color: "rgba(255,255,255,0.5)" } : undefined} className={isDark ? "" : "text-gray-400 dark:text-gray-500"}>
                      {counts[t]}
                    </span>
                  </span>
                </span>
              ) : null,
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export function CompositionDonut({
  counts,
  size = 100,
  strokeWidth = 14,
  centerLabel,
  centerSubLabel,
  className,
  palette = "auto",
  trackColor,
}: {
  counts: TypeCounts;
  size?: number;
  strokeWidth?: number;
  centerLabel: React.ReactNode;
  centerSubLabel?: React.ReactNode;
  className?: string;
  palette?: Palette;
  // Override the unfilled-track color (defaults to a low-alpha black/white based on palette).
  trackColor?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = SOURCE_TYPES.reduce((a, t) => a + counts[t], 0) || 1;

  // Compute slice lengths first, then derive offsets via prefix-sum (pure, no mutation).
  const lens = SOURCE_TYPES.map((t) => (counts[t] / total) * circ);
  const slices = SOURCE_TYPES.map((t, i) => ({
    type: t,
    len: lens[i],
    offset: lens.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  const isDark = palette === "dark";
  const sliceClass: Record<SourceType, string> = {
    dynamic: "stroke-blue-500 dark:stroke-blue-400",
    interop: "stroke-violet-500 dark:stroke-violet-400",
    exim:    "stroke-orange-500 dark:stroke-orange-400",
    static:  "stroke-gray-500 dark:stroke-gray-400",
  };

  return (
    <div
      className={`relative flex-shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={trackColor ?? (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)")}
          strokeWidth={strokeWidth}
        />
        {slices.map((sl) =>
          sl.len > 0 ? (
            isDark ? (
              <circle
                key={sl.type}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                strokeWidth={strokeWidth}
                strokeDasharray={`${sl.len} ${circ - sl.len}`}
                strokeDashoffset={-sl.offset}
                stroke={TYPE_PALETTE_DARK[sl.type as SourceType].dot}
              />
            ) : (
              <circle
                key={sl.type}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                strokeWidth={strokeWidth}
                strokeDasharray={`${sl.len} ${circ - sl.len}`}
                strokeDashoffset={-sl.offset}
                className={sliceClass[sl.type as SourceType]}
              />
            )
          ) : null,
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div
          className="font-bold leading-none tabular-nums tracking-tight"
          style={{ fontSize: Math.round(size * 0.22) }}
        >
          {centerLabel}
        </div>
        {centerSubLabel && (
          <div
            className="mt-1 font-bold uppercase opacity-70"
            style={{ fontSize: Math.max(9, Math.round(size * 0.09)), letterSpacing: 0.4 }}
          >
            {centerSubLabel}
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionHeader({
  icon,
  label,
  count,
  subtitle,
  size = "md",
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  subtitle?: string;
  size?: "md" | "lg";
}) {
  const labelClass =
    size === "lg"
      ? "text-base font-bold tracking-tight"
      : "text-sm font-bold tracking-tight";
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span className="flex text-brand-500 dark:text-brand-400">{icon}</span>}
          <span className={`${labelClass} text-gray-900 dark:text-white/95`}>{label}</span>
          {typeof count === "number" && (
            <span className="rounded-full bg-gray-100 px-2 py-[2px] text-[11px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  query,
  onClear,
  message,
  size = "md",
}: {
  query?: string;
  onClear: () => void;
  message?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={`mx-auto rounded-2xl border border-dashed border-gray-200 bg-white text-center dark:border-gray-800 dark:bg-gray-900 ${
        size === "sm" ? "p-7" : "p-9"
      }`}
      style={{ maxWidth: 480 }}
    >
      <div
        className={`mx-auto mb-3 flex items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-300 ${
          size === "sm" ? "h-12 w-12" : "h-14 w-14"
        }`}
      >
        <SearchIcon size={size === "sm" ? 22 : 26} />
      </div>
      <div className={`font-bold text-gray-900 dark:text-white/95 ${size === "sm" ? "text-sm" : "text-base"}`}>
        {message ?? `Tidak ada hasil untuk "${query ?? ""}"`}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Coba kata kunci lain, atau lihat semua kategori.
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
      >
        Hapus Filter
      </button>
    </div>
  );
}

// Tiny icon set used inside the redesign (kept here so the kategori folder is self-contained)
export function SearchIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function ChartIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 5-5" />
    </svg>
  );
}

export function FolderIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

export function HomeIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 9.5L12 3l9 6.5V21H3V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  );
}

export function SortIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 6h18M6 12h12M10 18h4" />
    </svg>
  );
}
