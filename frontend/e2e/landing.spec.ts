import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

/**
 * Smoke coverage for the public landing page at "/".
 *
 * Point PWA_BASE_URL at whichever server is serving the current build, e.g.
 *   PWA_BASE_URL=http://127.0.0.1:6199 npx playwright test landing
 */
const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";
const URL = `${BASE}/`;

test.describe("Landing page (/)", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) {
      test.skip(true, `Landing page not reachable at ${URL}`);
    }
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    // A first visit shortly after a deploy navigates twice while the service
    // worker takes control. Anything located before that settles gets detached
    // mid-action, so wait for the load event rather than just DOM content.
    await page.waitForLoadState("load");
  });

  test("renders the hero and every section the nav jumps to", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("data Maluku Utara");

    for (const id of ["menu", "peta", "konsultasi", "kategori", "brs", "layanan"]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    // Header anchors jump within the page; the menu tiles link out to real routes.
    await expect(
      page.locator("header").getByRole("link", { name: "Peta Tematik", exact: true })
    ).toHaveAttribute("href", "#peta");
    await expect(
      page.locator("#menu").getByRole("link", { name: /Peta Tematik/ })
    ).toHaveAttribute("href", "/peta-tematik");
  });

  test("language toggle swaps the copy", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Semua menu, di halaman ini" })).toBeVisible();

    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Every menu, right on this page" })).toBeVisible();

    await page.getByRole("button", { name: "ID", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Semua menu, di halaman ini" })).toBeVisible();
  });

  test("theme toggle flips the dark class on <html>", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: /Ubah tema|Switch theme/ }).click();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: /Ubah tema|Switch theme/ }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("consultation tile opens the booking dialog; Escape closes it", async ({ page }) => {
    await page.getByRole("button", { name: /Konsultasi Langsung/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Ajukan reservasi konsultasi");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("notification bell opens the notifications dialog", async ({ page }) => {
    await page.getByRole("button", { name: /Notifikasi|Notifications/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/BRS Indeks Harga Konsumen|Consumer Price Index/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("map draws all ten kabupaten/kota with a value tooltip", async ({ page }) => {
    const mapSvg = page.locator("#peta svg").first();

    // Assertions only, no imperative scroll: `expect` re-resolves the locator on
    // every retry, so a service-worker re-navigation can't detach it mid-action.
    // Geometry is pre-projected into the bundle, so it is present on first paint —
    // no fetch, and no dependency on the backend being up.
    await expect(mapSvg).toBeVisible();
    await expect(mapSvg.locator("path")).toHaveCount(10);
    await expect(page.locator("#peta").getByText(/Peringkat \d+ dari 10/)).toBeVisible();

    // Every polygon is labelled from its own `nama_kab`, so labels track shapes.
    await expect(mapSvg.locator("path > title")).toHaveCount(10);
    await expect(mapSvg.locator("title", { hasText: "Kota Ternate" })).toHaveCount(1);
  });

  test("loads without pulling the 11MB peta-tematik geojson", async ({ page }) => {
    const geojsonRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/peta-tematik/geojson")) geojsonRequests.push(req.url());
    });

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#peta")).toBeVisible();
    await page.waitForTimeout(1500);

    expect(geojsonRequests).toEqual([]);
  });
});

/**
 * Dialog behaviour and responsiveness.
 *
 * Openers are declared once and exercised at several viewports. Each opener
 * scrolls its section into view first — the consultation controls sit far down a
 * ~4900px page, and the splash screen covers the viewport for ~3s after load, so
 * clicking blind is unreliable.
 */
const DIALOGS: Array<{ name: string; open: (page: import("@playwright/test").Page) => Promise<void>; expect: RegExp }> = [
  {
    name: "reservasi",
    expect: /Ajukan reservasi konsultasi/,
    open: async (page) => {
      await page.locator("#menu").scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: /Konsultasi Langsung/ }).click();
    },
  },
  {
    // Booking is gated: every control inside #konsultasi opens the coming-soon
    // dialog, so "Sudah punya akun? Masuk" no longer reaches the sign-in sheet.
    name: "coming soon — masuk",
    expect: /Reservasi konsultasi belum dibuka/,
    open: async (page) => {
      await page.locator("#konsultasi").scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: /Sudah punya akun\? Masuk/ }).click();
    },
  },
  {
    name: "notifikasi",
    expect: /Notifikasi/,
    open: async (page) => {
      await page.getByRole("button", { name: /^Notifikasi$/ }).click();
    },
  },
  {
    name: "coming soon — lihat profil",
    expect: /Reservasi konsultasi belum dibuka/,
    open: async (page) => {
      await page.locator("#konsultasi").scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: /Lihat profil/ }).first().click();
    },
  },
];

const VIEWPORTS = [
  { label: "mobile 360", width: 360, height: 740 },
  { label: "mobile 390", width: 390, height: 844 },
  { label: "tablet 768", width: 768, height: 1024 },
  { label: "desktop 1440", width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Landing dialogs — ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      if (!(await isReachable(URL))) test.skip(true, `Landing page not reachable at ${URL}`);
      await page.goto(URL, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      // AppSplashScreen covers everything at z-index 2147483647 for ~3s and would
      // otherwise swallow the first click.
      await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
        timeout: 20_000,
      });
    });

    for (const dialog of DIALOGS) {
      test(`${dialog.name}: opens, traps focus, locks scroll, closes three ways`, async ({ page }) => {
        const dlg = page.getByRole("dialog");

        await dialog.open(page);
        await expect(dlg).toBeVisible();
        await expect(dlg).toContainText(dialog.expect);

        // Labelled for assistive tech, and focus moved inside.
        await expect(dlg).toHaveAttribute("aria-modal", "true");
        const labelledBy = await dlg.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        await expect(page.locator(`#${labelledBy}`)).toHaveCount(1);
        expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);

        // Never wider or taller than the viewport, and scrollable if content is tall.
        const box = await dlg.boundingBox();
        expect(box!.width).toBeLessThanOrEqual(vp.width + 1);
        expect(box!.height).toBeLessThanOrEqual(vp.height + 1);
        await expect(dlg).toHaveCSS("overflow-y", "auto");

        // Bottom sheet on phones, centred card from md up: the sheet is flush with
        // the bottom edge and square-cornered there.
        const radiusBottom = await dlg.evaluate((d) => getComputedStyle(d).borderBottomLeftRadius);
        if (vp.width < 768) {
          expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 2);
          expect(radiusBottom).toBe("0px");
        } else {
          expect(radiusBottom).not.toBe("0px");
        }

        // Background scroll is locked while open.
        await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

        // Tab stays inside the dialog.
        await page.keyboard.press("Tab");
        expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);

        // 1. Escape closes and releases the scroll lock.
        await page.keyboard.press("Escape");
        await expect(dlg).toBeHidden();
        await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

        // 2. Backdrop click closes.
        await dialog.open(page);
        await expect(dlg).toBeVisible();
        await page.mouse.click(3, 3);
        await expect(dlg).toBeHidden();

        // 3. The close button closes. Exactly one control is labelled "Tutup" —
        // the backdrop is aria-hidden, so this cannot resolve to it.
        await dialog.open(page);
        await expect(dlg).toBeVisible();
        const closeButton = page.getByRole("button", { name: /Tutup|Close/ });
        await expect(closeButton).toHaveCount(1);
        await closeButton.click();
        await expect(dlg).toBeHidden();
      });
    }

    test("page never scrolls sideways, at any scroll position", async ({ page }) => {
      // Reveal every section so the full page is measured, not just what is on screen.
      await page.addStyleTag({
        content: ".landing-reveal { opacity: 1 !important; transform: none !important; }",
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Allow 2px for sub-pixel rounding at breakpoint edges.
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });

    test("header fits without the wordmark colliding with the nav", async ({ page }) => {
      const collision = await page.evaluate(() => {
        const header = document.querySelector("header")!;
        const mark = header.querySelector("span.flex.flex-col");
        const firstNavLink = header.querySelector("nav a");
        if (!mark || !firstNavLink) return false;
        const a = mark.getBoundingClientRect();
        const b = firstNavLink.getBoundingClientRect();
        return b.width > 0 && a.right > b.left + 1;
      });
      expect(collision).toBe(false);
    });
  });
}
