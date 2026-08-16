/**
 * Regenerates the landing page's pre-projected regency/city outlines.
 *
 *   node scripts/generate-landing-map.mjs [sourceUrl]
 *
 * Why this exists: `peta_kabko_malut.geojson` is ~11 MB / 300k coordinate pairs.
 * That is the right payload for /peta-tematik, where the map is the page and the
 * user can zoom, but the landing page draws a 420px decorative thumbnail — and
 * the file is over Next's 2 MB data-cache ceiling, so it gets re-proxied from the
 * backend on every request. The geometry is static (the API route itself caches it
 * for a day with the note "geo polygons are static"), so we project and simplify
 * it once, here, and ship the result as a few kilobytes of SVG path data.
 *
 * Re-run this when the source geometry changes, then commit the generated file.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE =
  process.argv[2] || "http://127.0.0.1:5000/geojson/peta_kabko_malut.geojson";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/app/(landing)/beranda/_lib/regionShapes.generated.ts"
);

const MAP_W = 100;
const MAP_H = 95;
const MAP_PAD = 3;

/** Douglas–Peucker tolerance, in viewBox units. ~0.05 unit ≈ 0.2px at render size. */
const EPSILON = 0.05;
/** Drop rings whose projected bounding box is smaller than this (sub-pixel islets). */
const MIN_RING_EXTENT = 0.12;

/**
 * Read `kode_wilayah` from the `layer` property (`kabkot_8201`, sometimes with a
 * suffix), falling back to `kdkab`, which holds only the two trailing digits.
 *
 * Deliberately narrow: scanning every property would also match the `path`
 * property, whose Windows directory name contains the literal "BPS 8200".
 */
function readKode(props) {
  const layer = typeof props?.layer === "string" ? props.layer : "";
  const fromLayer = /kabkot[_-]?(\d{4})/i.exec(layer);
  if (fromLayer) return fromLayer[1];
  const kdkab = typeof props?.kdkab === "string" ? props.kdkab : "";
  return /^\d{2}$/.test(kdkab) ? `82${kdkab}` : "";
}

function readName(props, kode) {
  const raw = typeof props?.nama_kab === "string" ? props.nama_kab.trim() : "";
  if (!raw) return kode || "—";
  // The published geometry misspells Morotai; correct it for display only.
  return raw.replace(/^Kabupaten\s+/i, "").replace(/\bMorotal\b/i, "Morotai");
}

function ringsOf(geometry) {
  const out = [];
  const pushRing = (ring) => {
    if (!Array.isArray(ring)) return;
    const pts = ring.filter(
      (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
    );
    if (pts.length > 2) out.push(pts);
  };
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return out;
  if (geometry.type === "Polygon") coords.forEach(pushRing);
  else if (geometry.type === "MultiPolygon")
    coords.forEach((poly) => Array.isArray(poly) && poly.forEach(pushRing));
  return out;
}

/** Perpendicular distance from p to the segment a–b. */
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas–Peucker; recursion would blow the stack on 30k-point rings. */
function simplify(points, epsilon) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} → HTTP ${response.status}`);
const geojson = await response.json();

const parsed = (geojson.features ?? [])
  .map((f) => {
    const kode = readKode(f.properties);
    return { kode, name: readName(f.properties, kode), rings: ringsOf(f.geometry) };
  })
  .filter((f) => f.rings.length);

if (!parsed.length) throw new Error("no usable features in source geometry");

let minLon = Infinity;
let maxLon = -Infinity;
let minLat = Infinity;
let maxLat = -Infinity;
for (const f of parsed)
  for (const ring of f.rings)
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

const spanLon = maxLon - minLon || 1;
const spanLat = maxLat - minLat || 1;
const k = Math.min((MAP_W - MAP_PAD * 2) / spanLon, (MAP_H - MAP_PAD * 2) / spanLat);
const offX = MAP_PAD + (MAP_W - MAP_PAD * 2 - spanLon * k) / 2;
const offY = MAP_PAD + (MAP_H - MAP_PAD * 2 - spanLat * k) / 2;
const px = (lon) => offX + (lon - minLon) * k;
const py = (lat) => offY + (maxLat - lat) * k;
const pctY = (v) => (v / MAP_H) * 100;
const round = (v) => Number(v.toFixed(2));

let keptPoints = 0;
let sourcePoints = 0;

const shapes = parsed.map((f) => {
  let d = "";
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let widest = 0;
  let centre = [50, 50];
  const parts = [];

  for (const ring of f.rings) {
    sourcePoints += ring.length;
    const projected = ring.map((p) => [px(p[0]), py(p[1])]);

    let a = Infinity;
    let b = -Infinity;
    let c = Infinity;
    let e = -Infinity;
    for (const [X, Y] of projected) {
      if (X < a) a = X;
      if (X > b) b = X;
      if (Y < c) c = Y;
      if (Y > e) e = Y;
    }
    // Skip islets that would render smaller than a pixel.
    if (b - a < MIN_RING_EXTENT && e - c < MIN_RING_EXTENT) continue;

    const thinned = simplify(projected, EPSILON);
    if (thinned.length < 3) continue;
    keptPoints += thinned.length;

    d +=
      thinned
        .map((p, i) => (i ? "L" : "M") + round(p[0]) + " " + round(p[1]))
        .join("") + "Z";

    const cTop = pctY(c);
    const cBottom = pctY(e);
    parts.push([round(a), round(b), round(cTop), round(cBottom)]);
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
    if (cTop < y0) y0 = cTop;
    if (cBottom > y1) y1 = cBottom;

    if (ring.length > widest) {
      widest = ring.length;
      let sumX = 0;
      let sumY = 0;
      for (const [X, Y] of projected) {
        sumX += X;
        sumY += pctY(Y);
      }
      centre = [sumX / projected.length, sumY / projected.length];
    }
  }

  return {
    kode: f.kode,
    name: f.name,
    d,
    cx: round(centre[0]),
    cy: round(centre[1]),
    box: [round(x0), round(x1), round(y0), round(y1)],
    parts,
  };
});

const banner = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-landing-map.mjs
// Source: ${SOURCE}
// Projected into a ${MAP_W}x${MAP_H} viewBox and simplified (Douglas–Peucker, epsilon ${EPSILON}).
// ${sourcePoints.toLocaleString()} source points -> ${keptPoints.toLocaleString()} kept.

import type { RegionShape } from "./landingMap";

export const REGION_SHAPES: RegionShape[] = ${JSON.stringify(shapes, null, 2)};
`;

writeFileSync(OUT, banner);

const bytes = Buffer.byteLength(banner);
console.log(`regions:       ${shapes.length}`);
console.log(`source points: ${sourcePoints.toLocaleString()}`);
console.log(`kept points:   ${keptPoints.toLocaleString()}`);
console.log(`written:       ${OUT}`);
console.log(`size:          ${(bytes / 1024).toFixed(1)} KB`);
shapes.forEach((s) => console.log(`  ${s.kode}  ${s.name}  (${s.parts.length} parts)`));
