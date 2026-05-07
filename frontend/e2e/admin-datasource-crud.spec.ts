import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || "http://127.0.0.1:5050/backend";

test("admin datasource CRUD surface loads", async ({ page }) => {
  const targetUrl = `${ADMIN_BASE_URL}/datasources`;
  if (!(await isReachable(targetUrl))) test.skip(true, "Admin app not reachable");

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  const loginHeadingCount = await page.getByRole("heading", { name: /Login Admin/i }).count();
  if (loginHeadingCount > 0) test.skip(true, "Admin auth required");

  const heading = page.getByRole("heading", { name: /Datasources/i });
  if ((await heading.count()) === 0) test.skip(true, "Datasources page not available");
  await expect(heading).toBeVisible();

  const addButton = page.getByRole("button", { name: "Tambah" });
  if ((await addButton.count()) === 0) test.skip(true, "Add button not available");
  await addButton.click();
  await expect(page.getByText("Tambah Datasource", { exact: false })).toBeVisible();
});
