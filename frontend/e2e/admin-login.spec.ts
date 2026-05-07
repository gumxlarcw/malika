import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || "http://127.0.0.1:5050/backend";

test("admin login flow renders", async ({ page }) => {
  const loginUrl = `${ADMIN_BASE_URL}/login`;
  if (!(await isReachable(loginUrl))) test.skip(true, "Admin app not reachable");

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Login Admin/i })).toBeVisible();
  await expect(page.getByLabel(/Email/i)).toBeVisible();
  await expect(page.getByLabel(/Password/i)).toBeVisible();
});
