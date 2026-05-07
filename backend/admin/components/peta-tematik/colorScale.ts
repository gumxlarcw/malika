export const SCALE_COLORS = [
  '#DBEAFE',
  '#93C5FD',
  '#3B82F6',
  '#1D4ED8',
  '#1E3A8A',
];
export const NO_DATA_COLOR = '#D1D5DB';

export function quantileBins(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const breaks = [0.2, 0.4, 0.6, 0.8].map(p => sorted[Math.floor(p * n)]);
  return breaks;
}

export function colorForValue(
  value: number | null,
  breaks: number[],
): string {
  if (value == null) return NO_DATA_COLOR;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return SCALE_COLORS[i];
  }
  return SCALE_COLORS[SCALE_COLORS.length - 1];
}

export function formatRangeLabel(min: number, max: number): string {
  return `${formatNumber(min)} – ${formatNumber(max)}`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
}
