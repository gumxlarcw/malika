"use client";

import React from "react";
import { getCategoryDesign } from "../../kategori/_lib/categoryIcons";
import {
  SOURCE_TYPE_PALETTE,
  asSourceType,
  type SourceType,
} from "../_lib/sourceTypePalette";
import { describeValueCode, VALUE_CODE_CHIP_CLASS } from "../_lib/valueCodeStyle";

type Palette = "auto" | "dark";

// ─────────────────────────────────────────────────────────────────────────────
// SourceTypeBadge — the always-visible Dinamis/Interop/EXIM/Statis pill.
// `palette="dark"` forces dark palette for use on always-dark surfaces (rare here).
// ─────────────────────────────────────────────────────────────────────────────
export function SourceTypeBadge({
  type,
  size = "md",
  palette = "auto",
  pulse = true,
}: {
  type: SourceType | string;
  size?: "sm" | "md";
  palette?: Palette;
  pulse?: boolean;
}) {
  const t = asSourceType(typeof type === "string" ? type : "dynamic");
  const p = SOURCE_TYPE_PALETTE[t];
  const small = size === "sm";

  if (palette === "dark") {
    const c = p.dark;
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight"
        style={{
          background: c.bg,
          color: c.text,
          boxShadow: `inset 0 0 0 1px ${c.ring}`,
          padding: small ? "2px 8px 2px 6px" : "4px 10px 4px 8px",
          fontSize: small ? 11 : 12,
        }}
      >
        <span
          className={`${pulse ? "malika-pulse-slow " : ""}inline-block rounded-full ${
            small ? "h-1.5 w-1.5" : "h-2 w-2"
          }`}
          style={{ background: c.dot }}
        />
        {p.label}
      </span>
    );
  }

  // auto: render with light palette + dark: overrides via inline style on the same element
  // Using inline style so dynamic colors stay correct; for dark mode we render a sibling
  // hidden in light mode. Simpler than CSS-vars for this small element.
  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight dark:hidden"
        style={{
          background: p.light.bg,
          color: p.light.text,
          boxShadow: `inset 0 0 0 1px ${p.light.ring}`,
          padding: small ? "2px 8px 2px 6px" : "4px 10px 4px 8px",
          fontSize: small ? 11 : 12,
        }}
      >
        <span
          className={`${pulse ? "malika-pulse-slow " : ""}inline-block rounded-full ${
            small ? "h-1.5 w-1.5" : "h-2 w-2"
          }`}
          style={{ background: p.light.dot }}
        />
        {p.label}
      </span>
      <span
        className="hidden items-center gap-1.5 rounded-full font-medium tracking-tight dark:inline-flex"
        style={{
          background: p.dark.bg,
          color: p.dark.text,
          boxShadow: `inset 0 0 0 1px ${p.dark.ring}`,
          padding: small ? "2px 8px 2px 6px" : "4px 10px 4px 8px",
          fontSize: small ? 11 : 12,
        }}
      >
        <span
          className={`${pulse ? "malika-pulse-slow " : ""}inline-block rounded-full ${
            small ? "h-1.5 w-1.5" : "h-2 w-2"
          }`}
          style={{ background: p.dark.dot }}
        />
        {p.label}
      </span>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryChip — uses the kategori folder's per-category palette + SVG icon.
// CSS-vars + dark: arbitrary-value pattern (same as kategori detail hero).
// ─────────────────────────────────────────────────────────────────────────────
export function CategoryChip({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  const design = getCategoryDesign(name);
  const small = size === "sm";
  const tintVars = {
    ["--cat-bg-light" as string]: design.light.bg,
    ["--cat-bg-dark" as string]: design.dark.bg,
    ["--cat-text-light" as string]: design.light.text,
    ["--cat-text-dark" as string]: design.dark.text,
    ["--cat-icon-light" as string]: design.light.icon,
    ["--cat-icon-dark" as string]: design.dark.icon,
  } as React.CSSProperties;

  return (
    <span
      style={tintVars}
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cat-bg-light)] font-medium tracking-tight text-[color:var(--cat-text-light)] dark:bg-[var(--cat-bg-dark)] dark:text-[color:var(--cat-text-dark)]"
    >
      <span
        className="inline-flex text-[color:var(--cat-icon-light)] dark:text-[color:var(--cat-icon-dark)]"
        style={{ marginLeft: small ? 7 : 8, marginRight: -2 }}
      >
        {design.render(small ? 12 : 14, "currentColor")}
      </span>
      <span
        style={{
          paddingRight: small ? 9 : 11,
          paddingTop: small ? 2 : 4,
          paddingBottom: small ? 2 : 4,
          fontSize: small ? 11 : 12,
        }}
      >
        {name}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline — tiny SVG line + optional area fill.
// ─────────────────────────────────────────────────────────────────────────────
export function Sparkline({
  values,
  color,
  fill,
  width = 90,
  height = 22,
  strokeWidth = 1.5,
}: {
  values: number[];
  color: string;
  fill?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  if (!values.length) return null;
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pad = 1.5;
  const stepX = (width - pad * 2) / (values.length - 1 || 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = Number.isFinite(v)
      ? height - pad - ((v - min) / span) * (height - pad * 2)
      : height / 2;
    return [x, y] as const;
  });
  const linePath = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M ${points[0][0]} ${height} ` +
    points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") +
    ` L ${points[points.length - 1][0]} ${height} Z`;
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      {fill && <path d={areaPath} fill={fill} opacity={0.6} />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CellValue — number formatted id-ID + optional value-code chip with tooltip.
// ─────────────────────────────────────────────────────────────────────────────
export function CellValue({
  value,
  code,
}: {
  value: string | number | null | undefined;
  code?: string | null;
}) {
  const def = describeValueCode(code ?? null);
  const formatted =
    typeof value === "number"
      ? value.toLocaleString("id-ID", { maximumFractionDigits: 2 })
      : (value ?? "");
  return (
    <span className="inline-flex items-baseline tabular-nums">
      {formatted}
      {def && (
        <sup
          className={VALUE_CODE_CHIP_CLASS}
          style={{
            fontSize: 9.5,
            lineHeight: 1,
            paddingTop: 1,
            paddingBottom: 1,
            transform: "translateY(-3px)",
            display: "inline-block",
          }}
          title={`${def.code} — ${def.label}`}
        >
          {def.code}
        </sup>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon set — small, Lucide-style strokes.
// ─────────────────────────────────────────────────────────────────────────────
export function ChevronLeftIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
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
export function ChevronDownIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
export function CloseIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
export function ColumnsIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}
export function DownloadIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />
    </svg>
  );
}
export function PrintIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 9V3h12v6M6 18H3v-9h18v9h-3" />
      <rect x="6" y="14" width="12" height="7" rx="1" />
    </svg>
  );
}
export function ClockIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
export function CalendarIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 9h18" />
    </svg>
  );
}
export function PinIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M12 2c-3.5 0-6 2.5-6 6 0 4.5 6 12 6 12s6-7.5 6-12c0-3.5-2.5-6-6-6z" />
      <circle cx="12" cy="8" r="2" />
    </svg>
  );
}
export function GlobeIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 8 0 0 0 0 18M12 3a14 8 0 0 1 0 18" />
    </svg>
  );
}
export function MoreIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}
