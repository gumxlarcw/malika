import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const PWA_BASE_URL = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

test("search to data view flow", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/search?q=test`))) {
    test.skip(true, "PWA not reachable");
  }

  await page.goto(`${PWA_BASE_URL}/search?q=inflasi`, { waitUntil: "domcontentloaded" });

  const firstLink = page.locator('a[href^="/data?"]').first();
  if ((await firstLink.count()) === 0) test.skip(true, "No data link available in search results");
  await expect(firstLink).toBeVisible({ timeout: 15000 });

  await firstLink.click();
  await expect(page).toHaveURL(/\/data\?/);

  await expect(page.locator("table").first()).toBeVisible({ timeout: 15000 });
});
