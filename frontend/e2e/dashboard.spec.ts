import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";
const URL = `${BASE}/dashboard`;

test.describe("Dashboard (/dashboard)", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) test.skip(true, `Dashboard not reachable at ${URL}`);
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
