import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || "http://127.0.0.1:6060";
const TEST_UID = "test-verify-vc-live";

// Verifies that ChatTableModal renders <sup title> for real value_codes during
// LIVE streaming. We avoid persisted-replay because chat.service.js:3157 caps
// the stored assistant content at 8000 chars, which can truncate the embedded
// `````malika_ui ... ``` ``` fence and break replay parsing for large payloads.
// During live streaming, malika_ui is delivered as its own SSE event and is not
// affected by that cap.
test("ChatTableModal renders <sup title> for value_codes during live stream", async ({ page }) => {
  if (!(await isReachable(FRONTEND_BASE))) test.skip(true, "Frontend not reachable");

  await page.addInitScript((uid) => {
    try {
      localStorage.setItem("malika_uid", uid);
      localStorage.setItem("malika_tour_completed_v1", "1");
    } catch { /* ignore */ }
  }, TEST_UID);

  await page.goto(`${FRONTEND_BASE}/chat`, { waitUntil: "domcontentloaded" });

  // Wait for splash to fade
  await page.waitForFunction(() => {
    const splash = document.querySelector('[aria-hidden="true"].fixed.inset-0[class*="z-"]');
    return !splash || parseFloat(getComputedStyle(splash as Element).opacity || "1") < 0.05;
  }, { timeout: 15_000 }).catch(() => {});

  // The composer is a textarea with placeholder "Tulis pertanyaan…". Click "New Chat" first
  // if a thread is auto-selected and that thread doesn't show the composer in the same state.
  const newChatBtn = page.getByRole("button", { name: /new chat/i });
  if (await newChatBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await newChatBtn.click();
  }

  const composer = page.locator('textarea[placeholder*="ulis"], textarea[placeholder*="ertanyaan"]').first();
  await composer.waitFor({ state: "visible", timeout: 30_000 }).catch(async () => {
    await page.screenshot({ path: "/tmp/chat-no-composer.png", fullPage: true });
    throw new Error("composer never appeared — see /tmp/chat-no-composer.png");
  });
  await composer.fill("data produksi perikanan budidaya 2020");
  await composer.press("Enter");

  // Wait for streaming to deliver the result_table bubble (LLM + read can take 30s+)
  const tableCard = page.locator("button", { hasText: /Perikanan Budidaya|Produksi dan Nilai/i }).first();
  await tableCard.waitFor({ state: "visible", timeout: 60_000 });
  await tableCard.click();

  // Modal renders virtualized + non-virtualized branches; both call renderCellWithCode
  // (ChatTableModal.tsx:288 and :419)
  const modal = page.locator('[role="dialog"]').or(page.locator("section.fixed.inset-0"));
  await modal.first().waitFor({ state: "visible", timeout: 10_000 });

  await page.waitForSelector("sup", { timeout: 10_000 }).catch(() => {});
  const supCount = await modal.locator("sup").count();
  expect.soft(supCount, "ChatTableModal renders at least one <sup>").toBeGreaterThan(0);

  await expect.soft(
    modal.locator('sup[title="Angka sementara"]').first(),
    "in-whitelist `*` → 'Angka sementara' tooltip in modal"
  ).toBeVisible();

  await expect.soft(
    modal.locator('sup[title="Data nihil atau tidak ada"]').first(),
    "extended whitelist `–` → 'Data nihil atau tidak ada' tooltip in modal"
  ).toBeVisible();

  await modal.first().screenshot({ path: "/tmp/chat-modal-value-codes.png" });

  const sampleHTML = await modal.first().evaluate((m) => {
    const sups = Array.from(m.querySelectorAll("sup")).slice(0, 5);
    return sups.map((s) => s.outerHTML).join("\n");
  });
  console.log("FIRST_5_MODAL_SUPS:\n" + sampleHTML);
});
