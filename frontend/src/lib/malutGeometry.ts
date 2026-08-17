/**
 * Pre-projected kabupaten/kota geometry for Maluku Utara.
 *
 * The real GeoJSON is 11 MB / 302,583 points, far too heavy to ship to a
 * browser for a thumbnail. `scripts/generate-landing-map.mjs` projects it into a
 * 100×95 viewBox and simplifies it (Douglas–Peucker, ε 0.05) down to 4,088
 * points, which is what both the landing preview and the peta-tematik small
 * multiples draw.
 *
 * The generated file still lives under the landing route because that is where
 * the generator writes it. This module is the single seam that depends on that
 * location: if the file moves, only this import changes rather than every panel
 * that draws a map.
 *
 * Not a replacement for the Leaflet map on /peta-tematik — that one loads the
 * full-resolution GeoJSON, because a map you can zoom into needs the detail a
 * thumbnail can throw away.
 */

export { MAP_W, MAP_H } from "@/app/(landing)/_lib/landingMap";
export type { RegionShape, PartBox } from "@/app/(landing)/_lib/landingMap";
export { REGION_SHAPES } from "@/app/(landing)/_lib/regionShapes.generated";

import { REGION_SHAPES } from "@/app/(landing)/_lib/regionShapes.generated";

/**
 * `/peta-tematik/public/data` returns `kdkab` as the two-digit suffix ("01",
 * "71"); the geometry is keyed by the full BPS code ("8201", "8271").
 *
 * Verified 2026-08-17 across all ten regions: the two agree exactly, including
 * the three codes that are transposed in some other sources — 8203 is Kepulauan
 * Sula, 8205 Halmahera Utara, 8206 Halmahera Timur. Anything that hardcodes a
 * different order will silently colour the wrong islands.
 */
export function kdkabToKode(kdkab: string): string {
  const s = String(kdkab).trim();
  return s.length >= 4 ? s : `82${s.padStart(2, "0")}`;
}

const BY_KODE = new Map(REGION_SHAPES.map((s) => [s.kode, s]));

export function shapeForKdkab(kdkab: string) {
  return BY_KODE.get(kdkabToKode(kdkab)) ?? null;
}
