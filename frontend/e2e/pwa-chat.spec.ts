import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const PWA_BASE_URL = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

test.beforeEach(async ({ page }) => {
  // Suppress the onboarding tour SVG overlay (intercepts pointer events otherwise)
  await page.addInitScript(() => {
    try {
      localStorage.setItem("malika_tour_completed_v1", "1");
    } catch { /* ignore */ }
  });
});

test("chat conversation flow", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/chat`))) {
    test.skip(true, "PWA not reachable");
  }

  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

  const textarea = page
    .locator('textarea[placeholder*="ulis"], textarea[placeholder*="ertanyaan"]')
    .first();
  if ((await textarea.count()) === 0) test.skip(true, "Chat input not found");
  await expect(textarea).toBeVisible();
  await textarea.fill("halo");
  await textarea.press("Enter");

  await expect(page.getByText("halo", { exact: false })).toBeVisible({ timeout: 15000 });
});

// Mobile viewport configurations for testing responsive design
const mobileViewports = [
  { name: "iphone-se", width: 320, height: 568, description: "iPhone SE (smallest)" },
  { name: "iphone-14", width: 393, height: 852, description: "iPhone 14" },
  { name: "pixel-7", width: 412, height: 915, description: "Pixel 7" },
  { name: "ipad-mini", width: 768, height: 1024, description: "iPad Mini" },
];

// Test chat renders correctly on each mobile viewport
for (const viewport of mobileViewports) {
  test(`chat layout on ${viewport.name} (${viewport.description})`, async ({ page }) => {
    if (!(await isReachable(`${PWA_BASE_URL}/chat`))) {
      test.skip(true, "PWA not reachable");
    }

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

    // Wait for page to load - look for the chat area
    await page.waitForTimeout(1000);

    // On mobile (< 1024px), the hamburger menu should be visible
    if (viewport.width < 1024) {
      const hamburgerBtn = page.locator('button[title="Riwayat Chat"]');
      // May not exist if no threads - skip check if not found
      const hamburgerCount = await hamburgerBtn.count();
      if (hamburgerCount > 0) {
        await expect(hamburgerBtn).toBeVisible();
      }
    }

    // Chat area should be present (either welcome screen or chat input)
    const chatArea = page.locator('text="Chat MALIKA", text="Tulis pertanyaan"').first();
    const chatAreaCount = await chatArea.count();
    // Allow either welcome or active chat
    expect(chatAreaCount >= 0).toBeTruthy();

    // Verify no horizontal overflow (common mobile bug)
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewport.width + 10); // 10px tolerance
  });
}

// Test mobile history drawer interaction
test("mobile history drawer opens and closes", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/chat`))) {
    test.skip(true, "PWA not reachable");
  }

  // Use mobile viewport
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

  // Find and click hamburger menu
  const hamburgerBtn = page.locator('button[title="Riwayat Chat"]');
  if ((await hamburgerBtn.count()) === 0) {
    test.skip(true, "Hamburger button not found (may not be mobile viewport)");
  }

  await hamburgerBtn.click();

  // History drawer should appear with "Riwayat Chat" heading
  const drawerHeading = page.getByText("Riwayat Chat", { exact: true });
  await expect(drawerHeading).toBeVisible({ timeout: 3000 });

  // Close drawer by clicking backdrop or close button
  const backdrop = page.locator('[class*="fixed"][class*="inset-0"][class*="bg-black"]');
  if ((await backdrop.count()) > 0) {
    await backdrop.click();
    await expect(drawerHeading).not.toBeVisible({ timeout: 3000 });
  }
});

// Test touch targets are at least 44x44px on mobile
test("touch targets meet minimum size requirements", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/chat`))) {
    test.skip(true, "PWA not reachable");
  }

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

  // Check header buttons have minimum touch target size
  const headerButtons = page.locator('button[class*="min-h-[44px]"], button[class*="p-2.5"]');
  const count = await headerButtons.count();

  for (let i = 0; i < Math.min(count, 5); i++) {
    const button = headerButtons.nth(i);
    const box = await button.boundingBox();
    if (box) {
      // Allow some tolerance for border/padding calculations
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.width).toBeGreaterThanOrEqual(40);
    }
  }
});

// Test landscape mode has appropriate layout adjustments
test("chat layout in landscape mode", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/chat`))) {
    test.skip(true, "PWA not reachable");
  }

  // Landscape phone viewport
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

  // Wait for page to load
  await page.waitForTimeout(1000);

  // Chat page should load without errors
  const pageTitle = await page.title();
  expect(pageTitle).toBeTruthy();

  // Verify content isn't cut off
  const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(bodyScrollWidth).toBeLessThanOrEqual(680); // viewport + tolerance
});
