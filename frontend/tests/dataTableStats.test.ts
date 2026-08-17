import test from "node:test";
import assert from "node:assert/strict";

import {
  nextSortState,
  sortRows,
  describeSort,
  filterRowsByQuery,
  computeMetricStats,
  barPercent,
  buildCompareSeries,
  seriesToPaths,
  compareExtent,
  togglePin,
} from "../src/app/(admin)/data/_lib/tableStats.ts";

const LABEL = "Wilayah";
const numeric = new Set(["Nilai"]);
const toNumber = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};
const isTotalRow = (row: Record<string, unknown>, col: string) =>
  String(row[col] ?? "").toLowerCase() === "maluku utara";

const rows = [
  { Wilayah: "Maluku Utara", Nilai: 1000 },
  { Wilayah: "Halmahera Barat", Nilai: 132 },
  { Wilayah: "Kota Ternate", Nilai: 214 },
  { Wilayah: "Pulau Taliabu", Nilai: 60 },
  { Wilayah: "Pulau Morotai", Nilai: null },
];

test("nextSortState opens measures descending and names ascending", () => {
  assert.deepEqual(nextSortState({ key: null, dir: "desc" }, "Nilai", false), {
    key: "Nilai",
    dir: "desc",
  });
  assert.deepEqual(nextSortState({ key: null, dir: "desc" }, LABEL, true), {
    key: LABEL,
    dir: "asc",
  });
});

test("nextSortState flips direction when the active column is clicked again", () => {
  const first = nextSortState({ key: null, dir: "desc" }, "Nilai", false);
  const second = nextSortState(first, "Nilai", false);
  assert.deepEqual(second, { key: "Nilai", dir: "asc" });
  assert.deepEqual(nextSortState(second, "Nilai", false), { key: "Nilai", dir: "desc" });
});

test("sortRows with no key preserves the source ordering", () => {
  const out = sortRows({
    rows,
    sort: { key: null, dir: "desc" },
    labelColumn: LABEL,
    numericColumns: numeric,
    toNumber,
    isTotalRow,
  });
  assert.deepEqual(
    out.map((r) => r.Wilayah),
    rows.map((r) => r.Wilayah),
  );
});

test("sortRows keeps the provincial total on top in both directions", () => {
  for (const dir of ["asc", "desc"] as const) {
    const out = sortRows({
      rows,
      sort: { key: "Nilai", dir },
      labelColumn: LABEL,
      numericColumns: numeric,
      toNumber,
      isTotalRow,
    });
    assert.equal(out[0].Wilayah, "Maluku Utara", `total row moved when dir=${dir}`);
  }
});

test("sortRows ranks measures and sinks blanks to the bottom either way", () => {
  const desc = sortRows({
    rows,
    sort: { key: "Nilai", dir: "desc" },
    labelColumn: LABEL,
    numericColumns: numeric,
    toNumber,
    isTotalRow,
  });
  assert.deepEqual(desc.slice(1).map((r) => r.Wilayah), [
    "Kota Ternate",
    "Halmahera Barat",
    "Pulau Taliabu",
    "Pulau Morotai",
  ]);

  const asc = sortRows({
    rows,
    sort: { key: "Nilai", dir: "asc" },
    labelColumn: LABEL,
    numericColumns: numeric,
    toNumber,
    isTotalRow,
  });
  assert.deepEqual(asc.slice(1).map((r) => r.Wilayah), [
    "Pulau Taliabu",
    "Halmahera Barat",
    "Kota Ternate",
    "Pulau Morotai",
  ]);
});

test("sortRows on the label column sorts alphabetically", () => {
  const out = sortRows({
    rows,
    sort: { key: LABEL, dir: "asc" },
    labelColumn: LABEL,
    numericColumns: numeric,
    toNumber,
    isTotalRow,
  });
  assert.deepEqual(out.slice(1).map((r) => r.Wilayah), [
    "Halmahera Barat",
    "Kota Ternate",
    "Pulau Morotai",
    "Pulau Taliabu",
  ]);
});

test("describeSort names the column and the direction", () => {
  assert.equal(describeSort({ key: null, dir: "desc" }, LABEL), "Urutan bawaan sumber");
  assert.match(describeSort({ key: "Nilai", dir: "desc" }, LABEL), /terbesar/);
  assert.match(describeSort({ key: "Nilai", dir: "asc" }, LABEL), /terkecil/);
  assert.match(describeSort({ key: LABEL, dir: "asc" }, LABEL), /A–Z/);
});

test("filterRowsByQuery matches the label column and keeps the total row", () => {
  const out = filterRowsByQuery({ rows, labelColumn: LABEL, query: "pulau", isTotalRow });
  assert.deepEqual(out.map((r) => r.Wilayah), [
    "Maluku Utara",
    "Pulau Taliabu",
    "Pulau Morotai",
  ]);
});

test("filterRowsByQuery is case-insensitive and returns everything when empty", () => {
  assert.equal(filterRowsByQuery({ rows, labelColumn: LABEL, query: "  ", isTotalRow }).length, 5);
  assert.equal(
    filterRowsByQuery({ rows, labelColumn: LABEL, query: "TERNATE", isTotalRow }).length,
    2,
  );
});

test("computeMetricStats excludes the provincial total from the ranking and the mean", () => {
  const s = computeMetricStats({
    rows,
    labelColumn: LABEL,
    metricColumn: "Nilai",
    toNumber,
    isTotalRow,
  });
  assert.equal(s.count, 3);
  assert.equal(s.top?.label, "Kota Ternate");
  assert.equal(s.low?.label, "Pulau Taliabu");
  assert.equal(s.mean, (132 + 214 + 60) / 3);
  assert.equal(s.above, 1);
  assert.equal(s.below, 2);
  assert.equal(s.maxAbs, 214);
  assert.ok(s.ratio !== null && Math.abs(s.ratio - 214 / 60) < 1e-9);
});

test("computeMetricStats returns an empty shape when no column carries numbers", () => {
  const s = computeMetricStats({
    rows,
    labelColumn: LABEL,
    metricColumn: "Tidak ada",
    toNumber,
    isTotalRow,
  });
  assert.equal(s.count, 0);
  assert.equal(s.top, null);
  assert.equal(s.mean, null);
  assert.equal(s.maxAbs, 0);
});

test("computeMetricStats withholds the ratio when the floor is zero or negative", () => {
  const withZero = computeMetricStats({
    rows: [
      { Wilayah: "A", Nilai: 10 },
      { Wilayah: "B", Nilai: 0 },
    ],
    labelColumn: LABEL,
    metricColumn: "Nilai",
    toNumber,
    isTotalRow,
  });
  assert.equal(withZero.ratio, null);
});

test("barPercent scales against the widest magnitude and clamps", () => {
  assert.equal(barPercent(50, 200), 25);
  assert.equal(barPercent(-200, 200), 100);
  assert.equal(barPercent(null, 200), null);
  assert.equal(barPercent(5, 0), null);
});

test("buildCompareSeries yields null for years a region is absent from", () => {
  const series = buildCompareSeries({
    labels: ["Kota Ternate", "Pulau Taliabu"],
    yearsAsc: [
      { year: "2023", rows: [{ Wilayah: "Kota Ternate", Nilai: 200 }] },
      {
        year: "2024",
        rows: [
          { Wilayah: "Kota Ternate", Nilai: 214 },
          { Wilayah: "Pulau Taliabu", Nilai: 60 },
        ],
      },
    ],
    labelColumn: LABEL,
    metricColumn: "Nilai",
    toNumber,
  });
  assert.deepEqual(series[0].points.map((p) => p.value), [200, 214]);
  assert.deepEqual(series[1].points.map((p) => p.value), [null, 60]);
});

test("seriesToPaths breaks the stroke at a gap instead of bridging it", () => {
  const paths = seriesToPaths({
    points: [
      { year: "2021", value: 1 },
      { year: "2022", value: 2 },
      { year: "2023", value: null },
      { year: "2024", value: 3 },
      { year: "2025", value: 4 },
    ],
    min: 0,
    max: 4,
    width: 100,
    height: 100,
  });
  assert.equal(paths.length, 2);
  assert.ok(paths.every((d) => d.startsWith("M")));
});

test("seriesToPaths puts the highest value at the top of the box", () => {
  const [d] = seriesToPaths({
    points: [
      { year: "2024", value: 0 },
      { year: "2025", value: 10 },
    ],
    min: 0,
    max: 10,
    width: 100,
    height: 100,
  });
  assert.equal(d, "M0.0 100.0 L100.0 0.0");
});

test("compareExtent pads the range and survives an all-empty series", () => {
  const e = compareExtent([
    { label: "A", points: [{ year: "2024", value: 100 }, { year: "2025", value: 200 }] },
  ]);
  assert.ok(e.min < 100 && e.max > 200);

  const blank = compareExtent([{ label: "A", points: [{ year: "2024", value: null }] }]);
  assert.deepEqual(blank, { min: 0, max: 1 });
});

test("togglePin adds, removes, and refuses past the limit", () => {
  assert.deepEqual(togglePin([], "A", 4), ["A"]);
  assert.deepEqual(togglePin(["A", "B"], "A", 4), ["B"]);

  const full = ["A", "B", "C", "D"];
  assert.equal(togglePin(full, "E", 4), full, "returns the same array so React can skip a render");
  assert.deepEqual(togglePin(full, "B", 4), ["A", "C", "D"], "removal still works when full");
});

test("togglePin holds the cap across a burst of clicks on stale state", () => {
  // Three clicks in one task all start from the same rendered value. Folding
  // them the way React folds queued updaters must still stop at the limit.
  let pinned: string[] = ["A", "B", "C"];
  for (const label of ["D", "E", "F"]) pinned = togglePin(pinned, label, 4);
  assert.deepEqual(pinned, ["A", "B", "C", "D"]);
});
