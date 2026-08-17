import test from "node:test";
import assert from "node:assert/strict";

import { formatValue, formatDelta, parseUnit } from "../src/app/(admin)/dashboard/_lib/format.ts";

test("formatValue uses Indonesian separators", () => {
  assert.equal(formatValue(1234567.891, 2), "1.234.567,89");
  assert.equal(formatValue(5.93, 2), "5,93");
  assert.equal(formatValue(259368, 0), "259.368");
});

test("formatValue falls back to two decimals when decimalPlaces is null", () => {
  assert.equal(formatValue(5.9, null), "5,90");
});

test("formatDelta reports direction and a signed value", () => {
  const up = formatDelta({ absolute: 1.7, previousValue: 18.79, previousLabel: "Triwulan I 2026" }, 2);
  assert.equal(up?.direction, "up");
  assert.equal(up?.text, "1,70");

  const down = formatDelta({ absolute: -0.26, previousValue: 6.19, previousLabel: "Maret 2025" }, 2);
  assert.equal(down?.direction, "down");
  assert.equal(down?.text, "0,26");

  const flat = formatDelta({ absolute: 0, previousValue: 5, previousLabel: "2025" }, 2);
  assert.equal(flat?.direction, "flat");
});

test("formatDelta returns null when there is nothing to compare", () => {
  assert.equal(formatDelta(null, 2), null);
});

// unit_id really contains values like "km<sup>2</sup>"; rendering it as text
// shows literal tags and rendering it as HTML is an injection surface.
test("parseUnit splits a superscript unit into safe parts", () => {
  assert.deepEqual(parseUnit("km<sup>2</sup>"), [
    { text: "km", sup: false },
    { text: "2", sup: true },
  ]);
  assert.deepEqual(parseUnit("Persen"), [{ text: "Persen", sup: false }]);
  assert.deepEqual(parseUnit(null), []);
});

test("parseUnit does not pass through other markup", () => {
  const parts = parseUnit('<img src=x onerror=alert(1)>kg');
  const joined = parts.map((p) => p.text).join("");
  assert.ok(!joined.includes("<"), "angle brackets must not survive");
  assert.ok(!joined.includes("onerror"), "attributes must not survive");
});
