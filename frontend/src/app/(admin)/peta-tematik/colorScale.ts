// Choropleth palette options. Each palette ships with:
//   colors[5]      — 5 sequential bin fills, light → dark
//   noData         — gray for null values
//   hoverOutline   — high-contrast stroke used on the map polygon when hovered.
//                    Picked to clash with the fill so the highlighted polygon
//                    is unmistakable regardless of which bin the user lands on.
//   accent         — the "primary" mid color, used for chart bars / accents
//                    where a single color is needed (e.g. dot indicators).
//
// Always 5-bin quantile (no user choice on classification) — pakai angka apa adanya.
export type PaletteId = "blue" | "emerald" | "amber" | "rose" | "purple";

export interface Palette {
  id: PaletteId;
  label: string;
  colors: [string, string, string, string, string];
  noData: string;
  hoverOutline: string;
  accent: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  // Default: aligned with Malika brand palette (--color-brand-*)
  blue: {
    id: "blue",
    label: "Biru",
    colors: ["#ecf3ff", "#c2d6ff", "#7592ff", "#3641f5", "#262e89"],
    noData: "#e5e7eb",
    hoverOutline: "#dc2626", // red-600 — clashes with all 5 blues
    accent: "#3641f5",
  },
  emerald: {
    id: "emerald",
    label: "Hijau",
    colors: ["#ecfdf5", "#a7f3d0", "#34d399", "#059669", "#064e3b"],
    noData: "#e5e7eb",
    hoverOutline: "#dc2626", // red-600
    accent: "#059669",
  },
  amber: {
    id: "amber",
    label: "Kuning",
    colors: ["#fffbeb", "#fde68a", "#fbbf24", "#d97706", "#78350f"],
    noData: "#e5e7eb",
    hoverOutline: "#1d4ed8", // blue-700 — strong contrast vs warm tones
    accent: "#d97706",
  },
  rose: {
    id: "rose",
    label: "Merah",
    colors: ["#fff1f2", "#fecdd3", "#fb7185", "#e11d48", "#881337"],
    noData: "#e5e7eb",
    hoverOutline: "#15803d", // green-700 — clashes with reds
    accent: "#e11d48",
  },
  purple: {
    id: "purple",
    label: "Ungu",
    colors: ["#faf5ff", "#e9d5ff", "#c084fc", "#9333ea", "#581c87"],
    noData: "#e5e7eb",
    hoverOutline: "#16a34a", // green-600
    accent: "#9333ea",
  },
};

export const DEFAULT_PALETTE: PaletteId = "blue";

export function getPalette(id: PaletteId | string | null | undefined): Palette {
  if (id && id in PALETTES) return PALETTES[id as PaletteId];
  return PALETTES[DEFAULT_PALETTE];
}

// Backwards-compat exports — equal to the default brand-blue palette.
export const SCALE_COLORS = PALETTES.blue.colors;
export const NO_DATA_COLOR = PALETTES.blue.noData;

export type BinningMethod = "quantile" | "jenks" | "equal";

export const BINNING_LABELS: Record<BinningMethod, string> = {
  quantile: "Kuantil",
  jenks: "Natural Breaks",
  equal: "Sama Interval",
};

export const BINNING_DESCRIPTIONS: Record<BinningMethod, string> = {
  quantile: "Tiap kelas isi kab/kota dengan jumlah seimbang",
  jenks: "Kelompok alami berdasarkan kemiripan nilai",
  equal: "Rentang nilai sama tiap kelas",
};

/**
 * Quantile classification: divides values into N equal-population bins.
 * Returns N-1 breakpoints (for 5 bins → 4 breaks at 20/40/60/80 percentile).
 */
export function quantileBins(values: number[], nBins = 5): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const breaks: number[] = [];
  for (let i = 1; i < nBins; i++) {
    breaks.push(sorted[Math.floor((i / nBins) * n)]);
  }
  return breaks;
}

/**
 * Equal-interval classification: divides value range into N equal-width bins.
 * Sensitive to outliers (e.g. Ternate-skew). Use with caution.
 */
export function equalIntervalBins(values: number[], nBins = 5): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / nBins;
  const breaks: number[] = [];
  for (let i = 1; i < nBins; i++) {
    breaks.push(min + i * step);
  }
  return breaks;
}

/**
 * Jenks Natural Breaks classification.
 * Minimizes within-class variance, maximizes between-class variance.
 * Implementation adapted from Wikipedia's algorithm description.
 *
 * Time complexity: O(N²·k), fine for our N=10 polygons.
 */
export function jenksBins(values: number[], nBins = 5): number[] {
  if (values.length <= nBins) return quantileBins(values, nBins);
  const data = [...values].sort((a, b) => a - b);
  const n = data.length;

  // Initialize matrices
  const lowerClassLimits: number[][] = Array.from(
    { length: n + 1 }, () => new Array(nBins + 1).fill(0)
  );
  const varianceCombinations: number[][] = Array.from(
    { length: n + 1 }, () => new Array(nBins + 1).fill(0)
  );
  for (let i = 1; i <= nBins; i++) {
    lowerClassLimits[1][i] = 1;
    varianceCombinations[1][i] = 0;
    for (let j = 2; j <= n; j++) varianceCombinations[j][i] = Infinity;
  }

  for (let l = 2; l <= n; l++) {
    let sum = 0;
    let sumSquares = 0;
    let w = 0;
    for (let m = 1; m <= l; m++) {
      const lowerClassLimit = l - m + 1;
      const val = data[lowerClassLimit - 1];
      w += 1;
      sum += val;
      sumSquares += val * val;
      const variance = sumSquares - (sum * sum) / w;
      const i4 = lowerClassLimit - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= nBins; j++) {
          if (varianceCombinations[l][j] >= variance + varianceCombinations[i4][j - 1]) {
            lowerClassLimits[l][j] = lowerClassLimit;
            varianceCombinations[l][j] = variance + varianceCombinations[i4][j - 1];
          }
        }
      }
    }
    lowerClassLimits[l][1] = 1;
    varianceCombinations[l][1] = sumSquares - (sum * sum) / w;
  }

  // Extract break values
  const breaks: number[] = [];
  let k = n;
  for (let countNum = nBins; countNum >= 2; countNum--) {
    const idx = lowerClassLimits[k][countNum] - 2;
    breaks.unshift(data[idx]);
    k = lowerClassLimits[k][countNum] - 1;
  }
  return breaks;
}

/** Pick binning method by name. */
export function computeBins(
  values: number[],
  method: BinningMethod = "quantile",
  nBins = 5,
): number[] {
  switch (method) {
    case "jenks": return jenksBins(values, nBins);
    case "equal": return equalIntervalBins(values, nBins);
    case "quantile":
    default:      return quantileBins(values, nBins);
  }
}

/**
 * Map a value to its bin color. Pass an explicit palette to switch the choropleth
 * scale; if omitted, falls back to the default brand-blue ramp.
 */
export function colorForValue(
  value: number | null,
  breaks: number[],
  palette: Palette = PALETTES[DEFAULT_PALETTE],
): string {
  if (value == null) return palette.noData;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return palette.colors[i];
  }
  return palette.colors[palette.colors.length - 1];
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
}
