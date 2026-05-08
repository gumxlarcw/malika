import React from "react";

type IconRenderer = (size: number, color: string) => React.ReactElement;

type CategoryIcon = {
  render: IconRenderer;
  // Hex tones used for the color-tinted hero/featured cards.
  // bg = light surface tint, accent = saturated dot/splash color, text = AA-contrast on bg.
  light: { bg: string; text: string; icon: string; accent: string };
  dark:  { bg: string; text: string; icon: string };
  paletteName: string;
};

const stroke = (size: number, color: string, path: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

const icons = {
  sprout: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M7 20h10" />
      <path d="M10 20c5.5-2.5.8-6.4 3-10" />
      <path d="M9.5 9.4C7 8.5 5.5 6 5.5 4c2 0 5 .5 6.5 2" />
      <path d="M14.1 6a7 7 0 00-1.1 4c1.9-.4 3.7-1.6 4.5-3.5C18 3.5 17 1 17 1c-1.6.4-3.4 2-3.4 4.5" />
    </>),
  coins: (s: number, c: string) =>
    stroke(s, c, <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1115.63 18" />
      <path d="M7 6h1v4" />
      <path d="M16.71 13.88l.7.71-2.82 2.82" />
    </>),
  bank: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M3 21h18" /><path d="M3 10h18" /><path d="M5 6l7-3 7 3" />
      <path d="M4 10v11" /><path d="M20 10v11" />
      <path d="M8 14v3" /><path d="M12 14v3" /><path d="M16 14v3" />
    </>),
  tag: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill={c} />
    </>),
  book: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </>),
  heart: (s: number, c: string) =>
    stroke(s, c, <path d="M3.5 12.5L12 21l8.5-8.5a5.5 5.5 0 00-7.78-7.78L12 5.45l-.72-.73a5.5 5.5 0 00-7.78 7.78z" />),
  factory: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M2 20h20V8l-6 4V8l-6 4V4H6v16" />
      <path d="M9 16h2" /><path d="M14 16h2" /><path d="M19 16h.01" />
    </>),
  users: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </>),
  briefcase: (s: number, c: string) =>
    stroke(s, c, <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
    </>),
  truck: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </>),
  bolt: (s: number, c: string) =>
    stroke(s, c, <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />),
  palette: (s: number, c: string) =>
    stroke(s, c, <>
      <circle cx="13.5" cy="6.5" r=".5" fill={c} />
      <circle cx="17.5" cy="10.5" r=".5" fill={c} />
      <circle cx="8.5" cy="7.5" r=".5" fill={c} />
      <circle cx="6.5" cy="12.5" r=".5" fill={c} />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125 0-.946.75-1.688 1.688-1.688H16.5c3 0 5.5-2.5 5.5-5.5C22 6.04 17.523 2 12 2z" />
    </>),
  handHeart: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M11 14h2a2 2 0 002-2 2 2 0 00-2-2h-3.5L7 12.5" />
      <path d="M5 12L2 15l4 4 3-3M5 12l3-3 5 1" />
      <path d="M14 7l-1.5-1.5a2.83 2.83 0 014-4L18 3l1.5-1.5a2.83 2.83 0 014 4L18 11l-4-4z" />
    </>),
  leaf: (s: number, c: string) =>
    stroke(s, c, <>
      <path d="M11 20A7 7 0 014 13V6h7a7 7 0 017 7 7 7 0 01-7 7z" />
      <path d="M2 22l10-10" />
    </>),
  shield: (s: number, c: string) =>
    stroke(s, c, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  plane: (s: number, c: string) =>
    stroke(s, c, <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />),
} as const;

const FALLBACK: CategoryIcon = {
  render: icons.briefcase,
  light: { bg: "#dde9ff", text: "#252dae", icon: "#3641f5", accent: "#465fff" },
  dark:  { bg: "rgba(70,95,255,0.18)", text: "#9cb9ff", icon: "#7592ff" },
  paletteName: "brand",
};

const RULES: Array<{ pattern: RegExp; ico: IconRenderer; light: CategoryIcon["light"]; dark: CategoryIcon["dark"]; paletteName: string }> = [
  { pattern: /(pertanian|kehutanan|perikanan|pangan|hortikultura|perkebunan|peternakan|tanaman)/i,
    ico: icons.sprout, light: { bg: "#dcfce7", text: "#166534", icon: "#16a34a", accent: "#22c55e" },
    dark: { bg: "rgba(34,197,94,0.14)", text: "#86efac", icon: "#4ade80" }, paletteName: "green" },
  { pattern: /(harga|inflasi)/i,
    ico: icons.tag, light: { bg: "#fef9c3", text: "#854d0e", icon: "#ca8a04", accent: "#eab308" },
    dark: { bg: "rgba(234,179,8,0.14)", text: "#fde68a", icon: "#facc15" }, paletteName: "yellow" },
  { pattern: /(keuangan|perbankan|fiskal|sektor.*publik)/i,
    ico: icons.bank, light: { bg: "#d1fae5", text: "#065f46", icon: "#059669", accent: "#10b981" },
    dark: { bg: "rgba(16,185,129,0.14)", text: "#6ee7b7", icon: "#34d399" }, paletteName: "emerald" },
  { pattern: /(neraca.*ekonomi|ekonomi|perdagangan|pdb|investasi)/i,
    ico: icons.coins, light: { bg: "#dbeafe", text: "#1e40af", icon: "#2563eb", accent: "#3b82f6" },
    dark: { bg: "rgba(59,130,246,0.14)", text: "#93c5fd", icon: "#60a5fa" }, paletteName: "blue" },
  { pattern: /(pendidikan|sekolah)/i,
    ico: icons.book, light: { bg: "#ede9fe", text: "#5b21b6", icon: "#7c3aed", accent: "#8b5cf6" },
    dark: { bg: "rgba(139,92,246,0.14)", text: "#c4b5fd", icon: "#a78bfa" }, paletteName: "purple" },
  { pattern: /(kesehatan)/i,
    ico: icons.heart, light: { bg: "#fee2e2", text: "#991b1b", icon: "#dc2626", accent: "#ef4444" },
    dark: { bg: "rgba(239,68,68,0.14)", text: "#fca5a5", icon: "#f87171" }, paletteName: "red" },
  { pattern: /(industri|manufaktur)/i,
    ico: icons.factory, light: { bg: "#fce7f3", text: "#9d174d", icon: "#db2777", accent: "#ec4899" },
    dark: { bg: "rgba(236,72,153,0.14)", text: "#f9a8d4", icon: "#f472b6" }, paletteName: "pink" },
  { pattern: /(kependudukan|demograf)/i,
    ico: icons.users, light: { bg: "#cffafe", text: "#155e75", icon: "#0891b2", accent: "#06b6d4" },
    dark: { bg: "rgba(6,182,212,0.14)", text: "#67e8f9", icon: "#22d3ee" }, paletteName: "cyan" },
  { pattern: /(tenaga.?kerja|ketenagakerjaan)/i,
    ico: icons.briefcase, light: { bg: "#e0e7ff", text: "#3730a3", icon: "#4f46e5", accent: "#6366f1" },
    dark: { bg: "rgba(99,102,241,0.14)", text: "#a5b4fc", icon: "#818cf8" }, paletteName: "indigo" },
  { pattern: /(transportasi|komunikasi)/i,
    ico: icons.truck, light: { bg: "#ffedd5", text: "#9a3412", icon: "#ea580c", accent: "#f97316" },
    dark: { bg: "rgba(249,115,22,0.14)", text: "#fdba74", icon: "#fb923c" }, paletteName: "orange" },
  { pattern: /(energi|sumber.?daya|tambang)/i,
    ico: icons.bolt, light: { bg: "#fef3c7", text: "#92400e", icon: "#d97706", accent: "#f59e0b" },
    dark: { bg: "rgba(245,158,11,0.14)", text: "#fcd34d", icon: "#fbbf24" }, paletteName: "amber" },
  { pattern: /(sosial|budaya)/i,
    ico: icons.palette, light: { bg: "#fae8ff", text: "#86198f", icon: "#a21caf", accent: "#d946ef" },
    dark: { bg: "rgba(217,70,239,0.14)", text: "#f0abfc", icon: "#e879f9" }, paletteName: "fuchsia" },
  { pattern: /(kemiskinan|kesejahteraan)/i,
    ico: icons.handHeart, light: { bg: "#ffe4e6", text: "#9f1239", icon: "#e11d48", accent: "#f43f5e" },
    dark: { bg: "rgba(244,63,94,0.14)", text: "#fda4af", icon: "#fb7185" }, paletteName: "rose" },
  { pattern: /(lingkungan)/i,
    ico: icons.leaf, light: { bg: "#d1fae5", text: "#065f46", icon: "#10b981", accent: "#34d399" },
    dark: { bg: "rgba(20,184,166,0.14)", text: "#5eead4", icon: "#2dd4bf" }, paletteName: "teal" },
  { pattern: /(pemerintah|hukum|keamanan)/i,
    ico: icons.shield, light: { bg: "#e2e8f0", text: "#334155", icon: "#475569", accent: "#64748b" },
    dark: { bg: "rgba(100,116,139,0.18)", text: "#cbd5e1", icon: "#94a3b8" }, paletteName: "slate" },
  { pattern: /(pariwisata|wisata)/i,
    ico: icons.plane, light: { bg: "#cffafe", text: "#155e75", icon: "#0e7490", accent: "#22d3ee" },
    dark: { bg: "rgba(14,165,233,0.14)", text: "#7dd3fc", icon: "#38bdf8" }, paletteName: "sky" },
];

export function getCategoryDesign(name: string): CategoryIcon {
  const n = (name || "").toLowerCase();
  for (const r of RULES) {
    if (r.pattern.test(n)) {
      return { render: r.ico, light: r.light, dark: r.dark, paletteName: r.paletteName };
    }
  }
  return FALLBACK;
}
