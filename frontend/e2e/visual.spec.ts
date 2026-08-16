import { test, expect } from "@playwright/test";
import { disableAnimations, isReachable } from "./utils";

const PWA_BASE_URL = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

test("visual snapshots: homepage, search, data, chat", async ({ page }) => {
  if (!(await isReachable(`${PWA_BASE_URL}/`))) {
    test.skip(true, "PWA not reachable");
  }

  // "/" is the public landing page. It types a rotating question into the ask box
  // and cycles the highlighted region on the map, both driven by JS timers that
  // `disableAnimations` (CSS only) cannot stop. The page honours
  // prefers-reduced-motion by settling both to a fixed first frame, which is what
  // makes this snapshot deterministic. Scoped to this shot so the snapshots below
  // keep the rendering they were captured with.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${PWA_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  // AppSplashScreen covers the viewport at z-index 2147483647 for ~2s after load
  // and then unmounts. Screenshotting before that captures the splash, not the page.
  await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
    timeout: 15_000,
  });
  // Landing sections are hidden until they scroll into view, so a full-page shot
  // would capture most of them unrevealed. Force them visible — the same override
  // globals.css applies for print — so the baseline covers the whole page.
  await page.addStyleTag({
    content: ".landing-reveal { opacity: 1 !important; transform: none !important; }",
  });
  await disableAnimations(page);
  await expect(page).toHaveScreenshot("homepage.png", { fullPage: true });
  await page.emulateMedia({ reducedMotion: null });

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
