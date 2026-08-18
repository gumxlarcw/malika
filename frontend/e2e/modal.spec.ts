import { test, expect } from "@playwright/test";
const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:6060";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("malika_tour_completed_v1", "1");
    localStorage.setItem("malika_tour_dismissed_v1", "1");
  });
});

test("nav chat opens a dialog instead of navigating", async ({ page }) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.locator('a[href="/chat"]').first().click();
  const dlg = page.locator('[role="dialog"][aria-label="Chat MALIKA"]');
  await expect(dlg).toBeVisible({ timeout: 15000 });
  expect(page.url()).toContain("/dashboard");
  const box = await dlg.boundingBox();
  console.log("DLG:", JSON.stringify({ url: page.url().replace(BASE, ""), box: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null }));
});

test("dialog closes on Escape and restores the page", async ({ page }) => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.locator('a[href="/chat"]').first().click();
  const dlg = page.locator('[role="dialog"][aria-label="Chat MALIKA"]');
  await expect(dlg).toBeVisible({ timeout: 15000 });
  const locked = await page.evaluate(() => document.body.style.overflow);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0, { timeout: 8000 });
  const after = await page.evaluate(() => document.body.style.overflow);
  console.log("ESC:", JSON.stringify({ lockedWhileOpen: locked, afterClose: after }));
});

test("/chat still resolves as a deep link", async ({ page }) => {
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const txt = await page.evaluate(() => (document.querySelector("main") as HTMLElement)?.innerText?.slice(0, 60) ?? "");
  console.log("DEEP:", JSON.stringify({ url: page.url().replace(BASE, ""), head: txt.replace(/\n/g, " ") }));
  expect(txt.length).toBeGreaterThan(0);
});
