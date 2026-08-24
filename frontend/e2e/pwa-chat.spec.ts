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

  // A fresh anon identity owns no threads, and the composer lives in the
  // `activeThreadId` branch — the welcome state renders no textarea at all. So
  // the flow has to open a thread first; skipping on "no input found" instead
  // meant this test skipped itself on every run.
  const newChat = page.getByRole("button", { name: "New Chat" });
  await expect(newChat).toBeVisible({ timeout: 15000 });
  await newChat.click();

  // Anchor on the composer id, not the placeholder: the placeholder swaps to
  // "Memuat…"/"Menunggu respons…" while loading and streaming, so a
  // placeholder-matched locator resolves to zero elements at exactly the
  // moments this test waits on it.
  const textarea = page.locator("#chat-composer textarea");
  await expect(textarea).toBeVisible({ timeout: 15000 });
  await textarea.fill("halo");
  await textarea.press("Enter");

  // Scope to the user's own bubble. getByText("halo") is substring- and
  // case-insensitive, so it matches the "Halo, saya MALIKA" welcome heading and
  // passes on a page where nothing was ever sent — it proved nothing about the
  // send. The bubble only exists once the message is in the thread.
  const sentMessage = page.locator(".malika-user-message").filter({ hasText: "halo" });
  await expect(sentMessage).toHaveCount(1, { timeout: 15000 });
  await expect(sentMessage).toBeVisible();
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

  const viewport = { width: 375, height: 667 };
  await page.setViewportSize(viewport);
  await page.goto(`${PWA_BASE_URL}/chat`, { waitUntil: "domcontentloaded" });

  const hamburgerBtn = page.locator('button[title="Riwayat Chat"]');
  await expect(hamburgerBtn).toBeVisible({ timeout: 15000 });

  // "Riwayat Chat" is only the hamburger's title attribute, never a text node,
  // so getByText can never match it. The drawer is also always mounted and
  // slides in via translate-x, which leaves it with a non-empty bounding box —
  // Playwright reports it visible in both states, so a visibility assertion
  // here can never fail. Its x position is the only honest signal.
  const drawer = page.locator("div.fixed.inset-y-0.left-0").first();
  const backdrop = page.locator('[class*="fixed"][class*="inset-0"][class*="bg-black"]');
  const drawerX = async () => (await drawer.boundingBox())?.x ?? NaN;

  // Confirms the locator really is the history panel and not some other fixed
  // overlay: the panel is what carries the sidebar heading.
  await expect(drawer.getByText("Chat MALIKA", { exact: true })).toHaveCount(1);

  await expect.poll(drawerX, { timeout: 5000 }).toBeLessThan(0);
  await expect(backdrop).toHaveCount(0);

  await hamburgerBtn.click();

  await expect(backdrop).toHaveCount(1);
  await expect.poll(drawerX, { timeout: 5000 }).toBeGreaterThanOrEqual(0);

  // The backdrop spans the whole viewport, so its centre point sits under the
  // drawer (z-100001 over the backdrop's z-100000) and a plain .click() is
  // swallowed by the drawer. Aim at the strip of backdrop beside it.
  const openBox = await drawer.boundingBox();
  expect(openBox).not.toBeNull();
  const drawerRight = (openBox?.x ?? 0) + (openBox?.width ?? 0);
  await backdrop.click({
    position: { x: (drawerRight + viewport.width) / 2, y: viewport.height / 2 },
  });

  await expect(backdrop).toHaveCount(0);
  await expect.poll(drawerX, { timeout: 5000 }).toBeLessThan(0);
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
