import { test, expect, type Page } from "@playwright/test";
import { isReachable } from "./utils";

const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";

/*
 * /brs and /publikasi both render the shared ArchiveBrowser, which reads the
 * BPS webapi live. These assertions deliberately avoid pinning titles or counts
 * — the archive gains a release most weeks — and check the behaviours the
 * MALIKA BRS Publikasi design added instead.
 */

/*
 * The app leaves a second copy of the page in the DOM — the outgoing view of a
 * route transition, still holding its loading skeletons. Its controls are real
 * elements laid out at 0x0, so an unscoped `.first()` picks them and every
 * click times out.
 *
 * `:visible` cannot separate them: the live `.archive-root` is itself
 * `width: 0` (its children overflow it), so Playwright counts it as hidden
 * too. Absence of skeletons is not reliable either — the stale copy loses
 * them once it settles. The copy showing a real result count is the live one.
 */
function root(page: Page) {
  return page
    .locator(".archive-root")
    .filter({ has: page.locator(".ar-section-count", { hasText: /dari\s/ }) })
    .first();
}

async function openArchive(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // Page-wide wait first: `root()` cannot resolve until one copy has settled.
  await expect.poll(() => totalFromCount(page), { timeout: 45_000 }).not.toBeNull();
}

/**
 * The settled list count, e.g. "10 dari 774" → 774.
 *
 * Read page-wide and filtered on the text itself rather than through `root()`:
 * the stale copy reads "Memuat…", so matching the shape of a real count picks
 * the live one without needing to identify its container first.
 */
async function totalFromCount(page: Page): Promise<number | null> {
  // Read straight from the DOM: with two copies of the page mounted, locator
  // filtering on this element proved unreliable, and every count on the page
  // is inspected here instead of trusting one to be picked correctly.
  return page.evaluate(() => {
    const texts = [...document.querySelectorAll(".ar-section-count")].map(
      (e) => e.textContent || "",
    );
    for (const t of texts) {
      const m = t.match(/dari\s+([\d.]+)/);
      if (m) return Number(m[1].replace(/\./g, ""));
    }
    return null;
  });
}

/** First real result card, never a loading skeleton. */
function firstResult(page: Page) {
  return root(page).locator(".ar-feat, .ar-card:not(.ar-card--sk)").first();
}

test.describe("Arsip BRS & Publikasi", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(BASE))) test.skip(true, "PWA not reachable");
    // The first-run tour paints a popover across the viewport and swallows
    // clicks — same reason dashboard.spec.ts disables it.
    await page.addInitScript(() => {
      localStorage.setItem("malika_tour_completed_v1", "1");
      localStorage.setItem("malika_tour_dismissed_v1", "1");
    });
  });

  test("the page speaks Indonesian, not the old English chrome", async ({ page }) => {
    await openArchive(page, "/brs");

    // The title moved from the toolbar into the shared PageHero, so this reads
    // the hero rather than the old .ar-brand-* pair.
    await expect(page.locator(".ar-hero h1")).toContainText(/Berita Resmi Statistik/);
    await expect(page.locator(".ar-hero")).toContainText(/Arsip resmi/);
    await expect(root(page).locator(".ar-search input")).toHaveAttribute(
      "placeholder",
      /Cari judul/,
    );

    const body = await root(page).innerText();
    // These were the shipped strings before the design landed.
    for (const stale of ["Latest releases", "Search titles", "All years", "Statistical Report"]) {
      expect(body, `"${stale}" should be gone`).not.toContain(stale);
    }
  });

  test("the subject filter narrows the archive on the server, not just the page", async ({
    page,
  }) => {
    await openArchive(page, "/brs");
    const before = await totalFromCount(page);
    expect(before, "an unfiltered total is shown").not.toBeNull();

    const subject = root(page).locator('.ar-select[aria-label="Subjek"]');
    await expect(subject).toBeVisible({ timeout: 20_000 });
    const value = await subject.locator("option").nth(1).getAttribute("value");
    await subject.selectOption(value!);

    // A page-local filter would leave the total untouched; a server-side one
    // reports a smaller archive.
    await expect.poll(() => totalFromCount(page), { timeout: 30_000 }).toBeLessThan(before!);
    await expect(root(page).locator(".ar-chips-label")).toHaveText("Filter aktif");
    await expect(page).toHaveURL(/subject=\d+/);
  });

  test("Terlama reaches the far end of the archive, not the oldest of page one", async ({
    page,
  }) => {
    await openArchive(page, "/brs");
    const newest = await root(page).locator(".ar-card-meta, .ar-feat-meta").first().innerText();
    const newestYear = Number(newest.match(/(\d{4})/)?.[1]);
    expect(newestYear).toBeGreaterThan(2000);

    await root(page).locator('.ar-select[aria-label="Urutkan"]').selectOption("lama");
    await expect(root(page).locator(".ar-section-h")).toHaveText(/Rilis terlama/, { timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const t = await root(page).locator(".ar-card-meta, .ar-feat-meta").first().innerText();
          return Number(t.match(/(\d{4})/)?.[1] ?? 9999);
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(newestYear);
  });

  test("the year filter reaches back to what the archive actually holds", async ({ page }) => {
    await openArchive(page, "/brs");
    const years = await root(page)
      .locator('.ar-select[aria-label="Tahun"]')
      .locator("option")
      .allTextContents();
    // BRS bottoms out at 2014; stopping at 2020 made a decade unreachable.
    expect(years).toContain("2014");
  });

  test("the view toggle swaps cards for a compact list", async ({ page }) => {
    await openArchive(page, "/brs");
    expect(await root(page).locator(".ar-card:not(.ar-card--sk)").count()).toBeGreaterThan(0);

    await root(page).locator('.ar-view-btn[title="Tampilan daftar"]').click();
    await expect(root(page).locator(".ar-row").first()).toBeVisible();
    expect(await root(page).locator(".ar-card:not(.ar-card--sk)").count()).toBe(0);
  });

  test("a release carries a citation shaped for pasting", async ({ page }) => {
    await openArchive(page, "/brs");
    await firstResult(page).click();

    const cite = page.locator(".ar-pv-cite:visible").first();
    await expect(cite).toBeVisible({ timeout: 15_000 });
    const text = await cite.innerText();
    expect(text).toMatch(/^BPS Provinsi Maluku Utara\. \d{4}\./);
    expect(text).toContain("Sofifi: BPS Provinsi Maluku Utara.");
    // Releases quote their short catalogue number.
    expect(text).toMatch(/BRS-\d+\.$/);
    await expect(page.locator(".ar-pv-cite-copy:visible").first()).toHaveText("Salin");
  });

  test("publications load and never quote an opaque hash in the citation", async ({ page }) => {
    await openArchive(page, "/publikasi");
    await expect(root(page).locator(".ar-empty-h")).toHaveCount(0);
    expect(await totalFromCount(page)).toBeGreaterThan(0);

    await firstResult(page).click();
    const text = await page.locator(".ar-pv-cite:visible").first().innerText();
    expect(text).toContain("Sofifi: BPS Provinsi Maluku Utara.");
    expect(text, "publication ids are 24-char hashes and stay out").not.toMatch(/PUB-[0-9a-f]{8}/);
  });

  test("the closing card routes on to the numbers themselves", async ({ page }) => {
    await openArchive(page, "/brs");
    await expect(root(page).locator(".ar-cta-h")).toHaveText("Butuh angka spesifik?");
    await expect(root(page).locator('.ar-cta-links a[href="/kategori"]')).toBeVisible();
    await expect(root(page).locator('.ar-cta-links a[href="/peta-tematik"]')).toBeVisible();
    await expect(root(page).locator(".ar-source")).toContainText("domain 8200");
  });
});
