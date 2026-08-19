import { test, expect } from "@playwright/test";
const BASE = process.env.PWA_BASE_URL || "https://malika.bpsmalut.com";
test("footer contact line renders intact", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const txt = await page.evaluate(() => {
    const p = [...document.querySelectorAll("footer p, p")].find((e) =>
      (e.textContent || "").includes("3121190"),
    );
    return (p?.textContent || "").replace(/\s+/g, " ").trim();
  });
  console.log("FOOTER:", JSON.stringify(txt));
  expect(txt).toContain("bps8200@bps.go.id");
  expect(txt).toContain("(0921) 3121190");
  expect(txt).not.toContain("[email");
});
