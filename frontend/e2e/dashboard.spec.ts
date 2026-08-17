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
