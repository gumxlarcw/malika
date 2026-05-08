import type { SourceType } from "./types";

// Light-mode palette: bg, fg (text), dot (bar/dot)
export const TYPE_PALETTE_LIGHT: Record<SourceType, { bg: string; fg: string; dot: string }> = {
  dynamic: { bg: "#dbeafe", fg: "#1d4ed8", dot: "#3b82f6" },
  interop: { bg: "#ede9fe", fg: "#6d28d9", dot: "#8b5cf6" },
  exim:    { bg: "#ffedd5", fg: "#c2410c", dot: "#f97316" },
  static:  { bg: "#e5e7eb", fg: "#374151", dot: "#6b7280" },
};

export const TYPE_PALETTE_DARK: Record<SourceType, { bg: string; fg: string; dot: string }> = {
  dynamic: { bg: "rgba(59,130,246,0.15)",  fg: "#93c5fd", dot: "#60a5fa" },
  interop: { bg: "rgba(139,92,246,0.15)",  fg: "#c4b5fd", dot: "#a78bfa" },
  exim:    { bg: "rgba(249,115,22,0.15)",  fg: "#fdba74", dot: "#fb923c" },
  static:  { bg: "rgba(107,114,128,0.18)", fg: "#d1d5db", dot: "#9ca3af" },
};
