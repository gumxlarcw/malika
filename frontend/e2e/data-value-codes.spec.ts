import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || "http://127.0.0.1:6060";
const TARGET = `${FRONTEND_BASE}/data?source_id=404&period=2020&type=interop`;

test("renders <sup title> for in-whitelist (*) and out-of-whitelist (–) value_codes", async ({ page }) => {
  if (!(await isReachable(FRONTEND_BASE))) test.skip(true, "Frontend not reachable");

  await page.goto(TARGET, { waitUntil: "domcontentloaded" });

  // Wait for the indicator unit / table region to appear
  await page.waitForSelector("table", { timeout: 20_000 });

  // Wait until at least one <sup> renders so the screenshot captures real data
  await page.waitForSelector("sup", { timeout: 10_000 }).catch(() => {});

  // Dismiss any first-visit Joyride/welcome overlay if present
  const skip = page.getByRole("button", { name: /lewati tutorial|skip/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  const supCount = await page.locator("sup").count();
  expect.soft(supCount, "at least one <sup> rendered").toBeGreaterThan(0);

  // The tooltip leads with the code itself ("* — Angka sementara"), so match on
  // the definition rather than pinning the whole string.
  const angkaSementara = page.locator('sup[title*="Angka sementara"]').first();
  await expect.soft(angkaSementara, "in-whitelist `*` renders 'Angka sementara' tooltip").toBeVisible();
  await expect.soft(angkaSementara, "in-whitelist text is '*'").toHaveText("*");

  const dataNihil = page.locator('sup[title*="Data nihil atau tidak ada"]').first();
  await expect.soft(dataNihil, "`–` resolves to 'Data nihil atau tidak ada'").toBeVisible();
  await expect.soft(dataNihil, "`–` text is the en-dash itself").toHaveText("–");

  // Visual proof — screenshot the table region specifically (splash overlay may still be visible at viewport level)
  await page.locator("table").first().scrollIntoViewIfNeeded();
  await page.locator("table").first().screenshot({ path: "/tmp/data-value-codes.png" });

  // Console summary
  const sampleHTML = await page
    .locator("table")
    .first()
    .evaluate((t) => {
      const sups = Array.from(t.querySelectorAll("sup")).slice(0, 5);
      return sups.map((s) => `${s.outerHTML}`).join("\n");
    });
  console.log("FIRST_5_SUPS:\n" + sampleHTML);
});
