import { test, expect, type Page } from "@playwright/test";
import { isReachable } from "./utils";

const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

/*
 * Indikator 201 (TPT kabupaten/kota) is a plain BPS dynamic table whose columns
 * arrive as [Tahun, Wilayah, Nilai] — the period comes first, the region second.
 * /data used to treat column 0 as the row's identity, so every derived figure on
 * the page was keyed on the year instead of the region.
 */
const URL = `${BASE}/data?source_id=201`;

async function openDataPage(page: Page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table", { timeout: 30_000 });
  const skip = page.getByRole("button", { name: /lewati tutorial|skip/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Column index of the first header matching `re`, or -1. */
async function headerIndex(page: Page, re: RegExp) {
  const heads = await page.locator("table thead th").allTextContents();
  return heads.findIndex((h) => re.test(h.trim()));
}

test.describe("/data row identity", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(BASE))) test.skip(true, "PWA not reachable");
    await openDataPage(page);
  });

  test("the row label column holds the region, not the period", async ({ page }) => {
    const firstCells = await page.locator("table tbody tr td:first-child").allTextContents();
    expect(firstCells.length).toBeGreaterThan(1);

    // A label column repeating one bare year identifies nothing.
    const bareYears = firstCells.filter((t) => /^\d{4}$/.test(t.trim()));
    expect(bareYears, "no row is labelled by its year").toHaveLength(0);
    expect(new Set(firstCells.map((t) => t.trim())).size, "labels are distinct").toBe(firstCells.length);
  });

  test("every row draws its own trend series", async ({ page }) => {
    const rows = await page.locator("table tbody tr").count();
    // Addressed by test id, not by column position: the trend column stopped
    // being last when the compare-pin column was added beside it.
    const sparks = await page.locator('table tbody tr [data-testid="row-trend"] svg').count();

    // Series are looked up per row across all years; keying them on the period
    // found one point per row and the column collapsed to em dashes.
    expect(sparks, `each of the ${rows} rows renders a sparkline`).toBe(rows);
  });

  test("the provincial card shows the province row, not the sum of every row", async ({ page }) => {
    const wilayahIdx = await headerIndex(page, /wilayah|kabupaten|kota|daerah/i);
    const nilaiIdx = await headerIndex(page, /nilai|value/i);
    expect(wilayahIdx, "table exposes a region column").toBeGreaterThanOrEqual(0);
    expect(nilaiIdx, "table exposes a value column").toBeGreaterThanOrEqual(0);

    const provinceRow = page.locator("table tbody tr", { hasText: /maluku utara/i }).first();
    await expect(provinceRow, "the province row is present").toBeVisible();
    const provinceValue = (await provinceRow.locator("td").nth(nilaiIdx).innerText()).trim();

    // The hero card renders the label and the figure in sibling blocks.
    const heroFigure = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("span")).find((s) =>
        /^Total provinsi/.test((s.textContent || "").trim()),
      );
      const card = label?.closest("div")?.parentElement ?? null;
      return card?.querySelector("div.tabular-nums")?.textContent?.trim() ?? null;
    });

    // Summing a rate across kabupaten/kota — and the province row on top of it —
    // produces a number that is not a statistic of anything.
    expect(heroFigure, "hero shows the province figure").toBe(provinceValue);
  });

  test("the period column reads as a year, not a quantity", async ({ page }) => {
    const periodIdx = await headerIndex(page, /^(tahun|year|periode|period)$/i);
    test.skip(periodIdx < 0, "this source has no period column");

    const cells = await page.locator("table tbody tr").evaluateAll(
      (rows, idx) => rows.map((r) => r.querySelectorAll("td")[idx]?.textContent?.trim() ?? ""),
      periodIdx,
    );

    // Once the period stops being the row label it becomes an ordinary cell, and
    // the id-ID number formatter renders 2025 as "2.025".
    for (const cell of cells) {
      expect(cell, "a year carries no thousands separator").toMatch(/^\d{4}$/);
    }
  });

  test("a falling trend is never drawn as a rise", async ({ page }) => {
    const RISING = "#10b981";
    const trends = await page.locator('table tbody tr [data-testid="row-trend"]').evaluateAll(
      (cells, rising) =>
        cells
          .map((cell) => {
            const text = cell.querySelector("span")?.textContent?.trim() ?? "";
            // The first path is the area fill; the second carries the line colour.
            const stroke = [...cell.querySelectorAll("svg path")][1]?.getAttribute("stroke") ?? "";
            if (!/^-?\d+%$/.test(text) || !stroke) return null;
            return { pct: Number(text.replace("%", "")), rises: stroke === rising };
          })
          .filter((t): t is { pct: number; rises: boolean } => t !== null),
      RISING,
    );

    expect(trends.length, "some rows carry a percentage").toBeGreaterThan(0);

    // The colour was decided from the raw first and last points and defaulted to
    // "rising" whenever the earliest year was missing, while the percentage was
    // computed from the first and last points that actually exist.
    const contradictions = trends.filter((t) => (t.pct < 0) === t.rises);
    expect(contradictions, "no row's colour contradicts its own figure").toEqual([]);
  });

  test("the meta strip counts regions, not periods", async ({ page }) => {
    const wilayahIdx = await headerIndex(page, /wilayah|kabupaten|kota|daerah/i);
    const labels = await page.locator("table tbody tr").evaluateAll(
      (rows, idx) =>
        rows
          .map((r) => r.querySelectorAll("td")[idx]?.textContent?.trim() ?? "")
          .filter((t) => t && !/maluku utara/i.test(t)),
      wilayahIdx,
    );

    const strip = await page.getByText(/\d+\s+wilayah/).first().innerText();
    const counted = Number(strip.match(/(\d+)\s+wilayah/)?.[1]);

    expect(counted, "the strip counts the kabupaten/kota in the table").toBe(labels.length);
  });
});
