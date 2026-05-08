// Source-type colors for the data viewer (mirrors `tokens.js` from the design handoff).
// Used by the hero pill, filter-bar primary button, chart fills, and tooltip accents.

export type SourceType = "dynamic" | "interop" | "exim" | "static";

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  dynamic: "Dinamis",
  interop: "Interop",
  exim: "EXIM",
  static: "Statis",
};

type ChipPalette = {
  bg: string;       // chip background
  text: string;     // chip text
  dot: string;      // pulsing dot
  ring: string;     // chip inset ring
};

export type SourceTypePalette = {
  label: string;
  bar: string;       // chart fill (light mode)
  barDark: string;   // chart fill (dark mode)
  light: ChipPalette;
  dark: ChipPalette;
};

export const SOURCE_TYPE_PALETTE: Record<SourceType, SourceTypePalette> = {
  dynamic: {
    label: "Dinamis",
    bar: "#465fff",
    barDark: "#7591ff",
    light: { bg: "rgba(221,229,255,.7)",  text: "#2a31d8", dot: "#465fff", ring: "rgba(70,95,255,.18)" },
    dark:  { bg: "rgba(70,95,255,.18)",   text: "#9cb3ff", dot: "#7591ff", ring: "rgba(117,145,255,.25)" },
  },
  interop: {
    label: "Interop",
    bar: "#7c3aed",
    barDark: "#a78bfa",
    light: { bg: "rgba(237,233,254,.85)", text: "#5b21b6", dot: "#7c3aed", ring: "rgba(124,58,237,.18)" },
    dark:  { bg: "rgba(124,58,237,.22)",  text: "#c4b5fd", dot: "#a78bfa", ring: "rgba(167,139,250,.25)" },
  },
  exim: {
    label: "EXIM",
    bar: "#ea580c",
    barDark: "#fb923c",
    light: { bg: "rgba(255,237,213,.85)", text: "#9a3412", dot: "#ea580c", ring: "rgba(234,88,12,.18)" },
    dark:  { bg: "rgba(234,88,12,.22)",   text: "#fdba74", dot: "#fb923c", ring: "rgba(251,146,60,.25)" },
  },
  static: {
    label: "Statis",
    bar: "#64748b",
    barDark: "#94a3b8",
    light: { bg: "rgba(241,245,249,.9)",  text: "#334155", dot: "#64748b", ring: "rgba(100,116,139,.2)" },
    dark:  { bg: "rgba(100,116,139,.18)", text: "#cbd5e1", dot: "#94a3b8", ring: "rgba(148,163,184,.25)" },
  },
};

export function asSourceType(t: string | undefined | null): SourceType {
  if (t === "dynamic" || t === "interop" || t === "exim" || t === "static") return t;
  return "dynamic";
}
