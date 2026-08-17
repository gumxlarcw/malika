import { test, expect, type Page } from "@playwright/test";
import { isReachable } from "./utils";

const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";
const URL = `${BASE}/dashboard`;

/**
 * The first-run tour paints a popover across the viewport and swallows clicks.
 * It is a genuine feature, just not this page's — every context Playwright
 * opens is a first visit, so it is marked seen before the page loads.
 */
async function skipFirstRunTour(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("malika_tour_completed_v1", "1");
    localStorage.setItem("malika_tour_dismissed_v1", "1");
  });
}

test.describe("Dashboard (/dashboard)", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) test.skip(true, `Dashboard not reachable at ${URL}`);
    await skipFirstRunTour(page);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    // AppSplashScreen covers the viewport for ~3s after load.
    await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
      timeout: 20_000,
    });
  });

  test("renders indicator cards, not a Metabase iframe", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Indikator Strategis" })).toBeVisible();
    // The whole point of the phase: no embed left.
    await expect(page.locator('iframe[title="Metabase Dashboard"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/data?source="], a[href="/peta-tematik"]').first()).toBeVisible();
  });

  test("shows at least one headline value with a period label", async ({ page }) => {
    const headline = page.locator('section[aria-label="Angka utama"]');
    await expect(headline).toBeVisible();
    // A province card always carries a period label such as "2026" or "Triwulan II 2026".
    await expect(headline.getByText(/\b(19|20)\d{2}\b/).first()).toBeVisible();
  });

  test("search filters the category sections", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Cari indikator" });
    await search.fill("zzzzznotanindicator");
    await expect(page.getByText("Tidak ada indikator yang cocok dengan pencarian.")).toBeVisible();

    await search.fill("");
    await expect(page.locator("section").first()).toBeVisible();
  });

  test("content scrolls — it must not inherit the iframe's clipped layout", async ({ page }) => {
    // The admin shell is h-screen/overflow-hidden and scrolls inside <main>, so
    // the document itself never scrolls. What matters is that <main> is
    // scrollable rather than `overflow-hidden`, which is what the removed
    // isDashboard gate used to force for the Metabase iframe.
    const main = await page.evaluate(() => {
      const m = document.querySelector("main");
      if (!m) return null;
      return {
        overflowY: getComputedStyle(m).overflowY,
        overflows: m.scrollHeight > m.clientHeight + 1,
      };
    });
    expect(main?.overflowY).toBe("auto");
    expect(main?.overflows).toBe(true);
  });

  test("never scrolls sideways at any width", async ({ page }) => {
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `width ${width}`).toBeLessThanOrEqual(clientWidth + 2);
    }
  });
});

/**
 * The redesign splits the page into two registers: headline cards carry a figure,
 * the long tail is an aligned index. These pin that split down, because the
 * failure it replaced — 118 bordered cards reading "Rincian tersedia" — looked
 * like a styling problem but was a format mismatch.
 */
test.describe("Dashboard layout registers", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) test.skip(true, `Dashboard not reachable at ${URL}`);
    await skipFirstRunTour(page);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
      timeout: 20_000,
    });
  });

  test("indicators without a province figure are rows, not empty cards", async ({ page }) => {
    // The old build rendered these as full cards saying "Rincian tersedia".
    await expect(page.getByText("Rincian tersedia")).toHaveCount(0);

    // A row with no figure shows an em dash rather than a fabricated zero.
    const dashes = page.locator('main a[href^="/data?source="]').getByText("—", { exact: true });
    expect(await dashes.count()).toBeGreaterThan(0);
  });

  test("headline figures are never truncated, however long", async ({ page }) => {
    const overflowing = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('section[aria-label="Angka utama"] a').forEach((card) => {
        const cr = card.getBoundingClientRect();
        card.querySelectorAll("*").forEach((child) => {
          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.right > cr.right + 1) bad.push((child.textContent || "").slice(0, 30));
        });
      });
      return bad;
    });
    expect(overflowing).toEqual([]);
  });

  test("figures use tabular numerals so columns align", async ({ page }) => {
    // Target the figure explicitly: a positional selector broke the moment the
    // card gained a metric-label line above the number.
    const variants = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Angka utama"] [data-figure]')].map(
        (el) => getComputedStyle(el).fontVariantNumeric
      )
    );
    expect(variants.length).toBeGreaterThan(0);
    variants.forEach((v) => expect(v).toContain("tabular-nums"));
  });
});

/**
 * The panels ported from the MALIKA Dasbor design. Each one is pinned to the
 * data that backs it, because the design shipped with placeholder figures and
 * the whole point of the port was to refuse to render those.
 */
test.describe("Dashboard panels", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) test.skip(true, `Dashboard not reachable at ${URL}`);
    await skipFirstRunTour(page);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
      timeout: 20_000,
    });
  });

  test("tabs switch which categories the index lists", async ({ page }) => {
    const tabs = page.getByRole("tablist", { name: "Kelompok indikator" });
    await expect(tabs).toBeVisible();

    const ekonomi = page.getByRole("tab", { name: "Ekonomi" });
    await ekonomi.click();
    await expect(ekonomi).toHaveAttribute("aria-selected", "true");

    // Ekonomi is a strict subset of Ringkasan, which owns every category.
    const narrowed = await page.locator("main section[aria-label]").count();
    await page.getByRole("tab", { name: "Ringkasan" }).click();
    const all = await page.locator("main section[aria-label]").count();
    expect(all).toBeGreaterThan(narrowed);
  });

  test("expanding a headline card shows its figures in a dialog", async ({ page }) => {
    await page.locator('section[aria-label="Angka utama"] button[aria-label^="Lihat rincian"]').first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Periode", { exact: true })).toBeVisible();
    // A figure, not a placeholder: the table must carry digits.
    await expect(dialog.getByText(/\d/).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("the inflation heat map compares cities on the same months", async ({ page }) => {
    const heat = page.locator('section[aria-label="Inflasi bulanan menurut kota IHK"]');
    await expect(heat).toBeVisible();

    // Every row must carry the same number of cells, or a column would mean a
    // different month depending on which row you read it from.
    const widths = await heat.evaluate((el) => {
      const rows = [...el.querySelectorAll("div.flex.items-center")];
      return rows.map((r) => r.querySelectorAll("span[title]").length).filter((n) => n > 0);
    });
    expect(widths.length).toBeGreaterThan(1);
    expect(new Set(widths).size).toBe(1);
  });

  test("regional panels resolve to values or say why not", async ({ page }) => {
    const table = page.locator('section[aria-label="Tabel indikator kabupaten/kota"]');
    await expect(table).toBeVisible();

    // The region fetch is client-side, so allow it to land before judging.
    await expect(
      table.locator("table tbody tr").first().or(table.getByText(/tidak tersedia per kabupaten\/kota/i))
    ).toBeVisible({ timeout: 15_000 });
  });

  test("the period filter offers only years the source published", async ({ page }) => {
    const period = page.getByLabel("Periode");
    await expect(period).toBeVisible({ timeout: 15_000 });

    const options = await period.locator("option").allTextContents();
    const years = options.filter((o) => /^\d{4}$/.test(o.trim()));
    expect(years.length).toBeGreaterThan(0);
    // Never offer a future year — the replica cannot hold one.
    const nextYear = new Date().getFullYear() + 1;
    expect(Math.max(...years.map(Number))).toBeLessThan(nextYear);
  });
});
