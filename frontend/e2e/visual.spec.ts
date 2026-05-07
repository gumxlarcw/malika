import { test, expect } from "@playwright/test";
import { disableAnimations, isReachable } from "./utils";

const PWA_BASE_URL = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

test("visual snapshots: homepage, search, data, chat", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/`))) {
    test.skip(true, "PWA not reachable");
  }

  await page.goto(`${PWA_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await disableAnimations(page);
  await expect(page).toHaveScreenshot("homepage.png", { fullPage: true });

  await page.goto(`${PWA_BASE_URL}/search?q=inflasi`, { waitUntil: "domcontentloaded" });
  await disableAnimations(page);
  await expect(page).toHaveScreenshot("search-results.png", { fullPage: true });

  const firstLink = page.locator('a[href^="/data?"]').first();
  if (await firstLink.count()) {
    const href = await firstLink.getAttribute("href");
    if (href) {
      await page.goto(`${PWA_BASE_URL}${href}`, { waitUntil: "domcontentloaded" });
      await disableAnimations(page);
      await expect(page).toHaveScreenshot("data-viewer.png", { fullPage: true });
    }
  }

  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });
  await disableAnimations(page);
  await expect(page).toHaveScreenshot("chat.png", { fullPage: true });
});
