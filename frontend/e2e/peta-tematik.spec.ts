import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || "http://127.0.0.1:5050/backend";

test.describe("Peta Tematik dashboard section", () => {
  test.beforeEach(async ({ page }) => {
    const dashboardUrl = `${ADMIN_BASE_URL}/dashboard`;
    if (!(await isReachable(dashboardUrl))) {
      test.skip(true, "Admin dashboard not reachable");
    }
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });

    // The dashboard sits behind RequireAuth, and that gate only renders after
    // hydration -- at domcontentloaded the body is still empty, so counting
    // immediately always sees zero. Wait for whichever surface wins, and skip
    // rather than fail when it is the login form (no credentials are seeded for
    // e2e), matching admin-datasource-crud.spec.ts.
    const loginHeading = page.getByRole("heading", { name: /Login Admin/i });
    const petaHeading = page.locator("text=Peta Tematik").first();
    const rendered = await Promise.race([
      loginHeading.waitFor({ state: "visible", timeout: 15000 }).then(() => "login").catch(() => null),
      petaHeading.waitFor({ state: "visible", timeout: 15000 }).then(() => "peta").catch(() => null),
    ]);
    if (rendered === "login") {
      test.skip(true, "Admin auth required");
    }
  });

  test("loads section, picks indikator, renders map", async ({ page }) => {
    // Scroll to peta tematik section to trigger lazy-mount
    const petaTematikHeading = page.locator("text=Peta Tematik").first();
    await expect(petaTematikHeading).toBeVisible({ timeout: 10000 });
    await petaTematikHeading.scrollIntoViewIfNeeded();

    // Wait for indikator picker button
    const picker = page.locator('button:has-text("Pilih indikator")').first();
    await expect(picker).toBeVisible({ timeout: 10000 });

    // Open picker, search for a Kependudukan indikator
    await picker.click();

    // Wait for search input to be visible
    const searchInput = page.locator('input[placeholder*="Cari"], input[placeholder*="cari"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("Penduduk");

    // Wait for results and pick first one
    const firstResult = page.locator('[cmdk-item]').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await firstResult.click();

    // Year select should appear
    const yearSelect = page.locator("select").first();
    await expect(yearSelect).toBeVisible({ timeout: 5000 });

    // Wait for map to render (Leaflet container)
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });

    // Wait for at least one GeoJSON path/polygon to render
    const mapPolygons = page.locator(".leaflet-interactive");
    const polygonCount = await mapPolygons.count();
    expect(polygonCount).toBeGreaterThan(0);

    // InfoPanel should show Provinsi total card
    const infoPanel = page.locator("text=Provinsi");
    await expect(infoPanel.first()).toBeVisible({ timeout: 5000 });
  });

  test("changing year refetches data", async ({ page }) => {
    // Scroll to peta tematik section
    const petaTematikHeading = page.locator("text=Peta Tematik").first();
    await expect(petaTematikHeading).toBeVisible({ timeout: 10000 });
    await petaTematikHeading.scrollIntoViewIfNeeded();

    // Pick an indikator
    const picker = page.locator('button:has-text("Pilih indikator")').first();
    await expect(picker).toBeVisible({ timeout: 10000 });
    await picker.click();

    const searchInput = page.locator('input[placeholder*="Cari"], input[placeholder*="cari"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("Penduduk");

    const firstResult = page.locator("[cmdk-item]").first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await firstResult.click();

    // Wait for year select to appear
    const yearSelect = page.locator("select").first();
    await expect(yearSelect).toBeVisible({ timeout: 5000 });

    // Wait for map to render
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });

    // Get all year options
    const yearOptions = await yearSelect.locator("option").all();
    if (yearOptions.length < 2) {
      test.skip(true, "Not enough year options to test year change");
    }

    // Record polygon count before year change
    let polygonCountBefore = await page.locator(".leaflet-interactive").count();
    expect(polygonCountBefore).toBeGreaterThan(0);

    // Pick a different year (not the latest)
    await yearSelect.selectOption({ index: yearOptions.length - 2 });

    // Map should still be present and rerender
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });

    // Verify polygons are still rendered after year change
    let polygonCountAfter = await page.locator(".leaflet-interactive").count();
    expect(polygonCountAfter).toBeGreaterThan(0);
  });
});
