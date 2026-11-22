import { expect, test } from "@playwright/test";
import { sessionCookie } from "./db";

// Route protection (P1-30a) as a browser sees it.
test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("a plain user gets a 404 for /admin and /superadmin, and lands on their own space", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_STAFF")]);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  expect((await page.goto("/superadmin"))?.status()).toBe(404);
  await page.goto("/users");
  // D-265: Home's heading names the overview; the welcome is beneath it.
  // v1.74.1 (D-397): the Tasks home greets by the time of day (D-396), the Approvals home says "Welcome back".
  await expect(page.getByText(/(Welcome back|Good (morning|afternoon|evening)), Sita/).first()).toBeVisible();
});

test("an IT Admin reaches /admin but not /superadmin", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_ADMIN")]);
  expect((await page.goto("/admin"))?.status()).toBe(200);
  expect((await page.goto("/superadmin"))?.status()).toBe(404);
});

test("every page carries the security headers", async ({ page }) => {
  const response = await page.goto("/login");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("nonce-");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});
