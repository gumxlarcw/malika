/**
 * SVG path maths for the dashboard panels.
 *
 * Kept out of the components so the charts stay pure markup: every panel draws
 * into a fixed viewBox and scales with CSS, which means no measurement pass, no
 * resize listener, and identical output on the server and the client.
 */

/** The trend panel's coordinate system. Ticks and gridlines are pinned to it. */
export const PLOT = {
  width: 640,
  height: 240,
  left: 46,
  top: 16,
  plotHeight: 208,
  baseline: 224,
} as const;

export type Scale = { min: number; max: number };

/**
 * Vertical scale with headroom, so a line never grazes the top gridline.
 *
 * A flat series has no span to pad, and padding it by a fraction of zero would
 * collapse min and max onto the same value and divide by zero downstream — so
 * it gets an absolute band around the value instead.
 */
export function scaleOf(values: number[], padFraction = 0.12): Scale {
  if (!values.length) return { min: 0, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const pad = span === 0 ? Math.max(Math.abs(hi) * 0.1, 0.5) : span * padFraction;
  return { min: lo - pad, max: hi + pad };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Line through `values` across the full plot width; `close` adds the area skirt. */
export function linePath(values: number[], scale: Scale, close = false): string {
  if (values.length < 2) return "";
  const span = scale.max - scale.min || 1;
  const step = (PLOT.width - PLOT.left) / (values.length - 1);
  const points = values.map((v, i) => [
    round(PLOT.left + step * i),
    round(PLOT.top + PLOT.plotHeight - ((v - scale.min) / span) * PLOT.plotHeight),
  ]);

  let d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  if (close) {
    d += ` L${points[points.length - 1][0]} ${PLOT.baseline} L${points[0][0]} ${PLOT.baseline} Z`;
  }
  return d;
}

/** Evenly spaced gridline positions, top-down, matching `tickValues`. */
export const TICK_FRACTIONS = [1, 0.75, 0.5, 0.25, 0] as const;

export function tickValues(scale: Scale): number[] {
  return TICK_FRACTIONS.map((f) => scale.min + (scale.max - scale.min) * f);
}

export function tickY(index: number): number {
  return PLOT.top + (PLOT.plotHeight / (TICK_FRACTIONS.length - 1)) * index;
}

/** Sparkline inside the KPI card's 88×30 box. */
export function sparkPath(values: number[], close = false): string {
  if (values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = 86 / (values.length - 1);
  const points = values.map((v, i) => [round(1 + step * i), round(25 - ((v - lo) / span) * 20)]);

  let d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  if (close) d += " L87 29 L1 29 Z";
  return d;
}

/**
 * Bar heights as percentages of the tallest bar.
 *
 * Negative values are real here — monthly inflation goes below zero — so bars
 * are sized from the largest absolute value and the sign is carried separately,
 * letting the panel draw deflation downward instead of silently flipping it up.
 */
export function barScale(values: number[]): { pct: (v: number) => number; hasNegative: boolean } {
  const peak = Math.max(...values.map((v) => Math.abs(v)), 0) * 1.12;
  return {
    pct: (v: number) => (peak === 0 ? 0 : Math.round((Math.abs(v) / peak) * 100)),
    hasNegative: values.some((v) => v < 0),
  };
}
