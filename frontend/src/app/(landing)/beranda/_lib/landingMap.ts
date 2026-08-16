/**
 * Choropleth support for the landing page's Peta Tematik preview.
 *
 * The source design fetched a TopoJSON from raw.githubusercontent.com at runtime.
 * The same geometry is already served locally by `/api/peta-tematik/geojson`, but
 * that file is ~11 MB / 300k coordinate pairs — the right payload for
 * /peta-tematik, where the map is the page, and far too much for a 420px
 * thumbnail. It is also over Next's 2 MB data-cache ceiling, so it gets
 * re-proxied from the backend on every single request.
 *
 * The polygons are static, so they are projected and simplified once, offline,
 * into `regionShapes.generated.ts` (~64 KB) by `scripts/generate-landing-map.mjs`.
 * The landing page therefore draws real regency geometry with no runtime fetch.
 *
 * Region labels are baked in from each polygon's own `nama_kab`, never from a
 * code→name table, so a label can never describe a different shape than the one
 * highlighted.
 */

/** SVG viewBox the geometry is projected into. Matches the design's aspect ratio. */
export const MAP_W = 100;
export const MAP_H = 95;

/** Bounding box of one island, in percent of the map box: [x0, x1, y0, y1]. */
export type PartBox = [number, number, number, number];

export type RegionShape = {
  /** BPS `kode_wilayah`, e.g. "8271". */
  kode: string;
  /** Display name, taken from the polygon itself. */
  name: string;
  /** SVG path data, in viewBox units. */
  d: string;
  /** Visual centre, in percent of the map box. */
  cx: number;
  cy: number;
  /** Overall bounds, in percent of the map box. */
  box: PartBox;
  /** Per-island bounds, so a scattered regency doesn't block the whole panel. */
  parts: PartBox[];
};

/**
 * Illustrative poverty figures, keyed by `kode_wilayah`. Iteration order is the
 * order the preview cycles through and the rank shown in the tooltip.
 * These are sample values for the mockup, not published statistics.
 */
const SAMPLE_BASE: Array<{ kode: string; base: number }> = [
  { kode: "8202", base: 9.04 },
  { kode: "8271", base: 8.21 },
  { kode: "8204", base: 7.12 },
  { kode: "8205", base: 6.95 },
  { kode: "8201", base: 6.48 },
  { kode: "8272", base: 6.03 },
  { kode: "8203", base: 5.71 },
  { kode: "8206", base: 5.12 },
  { kode: "8207", base: 4.86 },
  { kode: "8208", base: 4.39 },
];

export const PERIODS = ["2022", "2023", "2024", "2025", "2026"];

/** Per-period offset applied to a region's base value. */
const DRIFT = [0.62, 0.41, 0.18, 0.07, 0];

/** The order regions are cycled through, as `kode_wilayah` strings. */
export const CYCLE_ORDER = SAMPLE_BASE.map((r) => r.kode);

export function sampleValue(kode: string, periodIndex: number): number {
  const entry = SAMPLE_BASE.find((r) => r.kode === kode);
  return (entry?.base ?? 6) + (DRIFT[periodIndex] ?? 0);
}

export function sampleRank(kode: string): number {
  const i = SAMPLE_BASE.findIndex((r) => r.kode === kode);
  return i < 0 ? SAMPLE_BASE.length : i + 1;
}

export function formatValue(value: number, lang: "id" | "en"): string {
  const s = value.toFixed(2);
  return (lang === "en" ? s : s.replace(".", ",")) + "%";
}

/**
 * Place the value tooltip beside the highlighted region without covering it:
 * try right, left, above, below, then the corners, and keep whichever candidate
 * overlaps the least of that region's islands.
 */
export function placeTooltip(
  shape: RegionShape,
  cardW: number,
  cardH: number
): { left: string; top: string } {
  const gap = 2.5;
  const [rx0, rx1, ry0, ry1] = shape.box;
  const { cx, cy } = shape;
  const clampX = (v: number) => Math.min(Math.max(v, 1), 99 - cardW);
  const clampY = (v: number) => Math.min(Math.max(v, 1), 99 - cardH);

  const candidates: Array<[number, number]> = (
    [
      [rx1 + gap, cy - cardH / 2],
      [rx0 - gap - cardW, cy - cardH / 2],
      [cx - cardW / 2, ry0 - gap - cardH],
      [cx - cardW / 2, ry1 + gap],
      [1, 1],
      [99 - cardW, 1],
      [1, 99 - cardH],
      [99 - cardW, 99 - cardH],
    ] as Array<[number, number]>
  ).map(([x, y]) => [clampX(x), clampY(y)] as [number, number]);

  const overlap = ([x, y]: [number, number]) =>
    shape.parts.reduce((sum, [a, b, c, d]) => {
      const ox = Math.max(0, Math.min(x + cardW, b) - Math.max(x, a));
      const oy = Math.max(0, Math.min(y + cardH, d) - Math.max(y, c));
      return sum + ox * oy;
    }, 0);

  let best: { c: [number, number]; area: number; dist: number } | null = null;
  candidates.forEach((c) => {
    const area = overlap(c);
    const dist = Math.hypot(c[0] + cardW / 2 - cx, c[1] + cardH / 2 - cy);
    if (!best || area < best.area || (area === best.area && dist < best.dist)) {
      best = { c, area, dist };
    }
  });

  const chosen = (best as { c: [number, number] } | null)?.c ?? [1, 1];
  return { left: chosen[0].toFixed(1) + "%", top: chosen[1].toFixed(1) + "%" };
}
