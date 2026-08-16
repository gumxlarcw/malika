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
    await mapSvg.scrollIntoViewIfNeeded();
    await expect(mapSvg).toBeVisible();

    // Geometry is pre-projected into the bundle, so it is present on first paint —
    // no fetch, and no dependency on the backend being up.
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
    await page.locator("#peta").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    expect(geojsonRequests).toEqual([]);
  });
});
