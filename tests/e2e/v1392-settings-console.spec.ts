import { expect, test } from "@playwright/test";
import { sessionCookie } from "./db";

// D-240 (Configuration Studio): unsaved changes marked, one Save per
// category; the AI settings are one form with one Save (they were nine) and
// keep their own search.
test("unsaved marks, and the AI page's single Save with its search", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_SUPER")]);
  await page.setViewportSize({ width: 1440, height: 900 });
  // v1.84.0 (D-411): the categories of the old Providers & security page are
  // pages of their own now (Search settings finds them: v1840-superadmin.spec).
  // A change is still marked until it is saved.
  await page.goto("/superadmin/security/general");
  const general = page.locator("#settings-GENERAL");
  const box = general.locator("input[type=text], textarea").first();
  await box.fill(`${await box.inputValue()} `);
  await expect(general.getByText("Unsaved changes")).toBeVisible();

  // AI: General, the providers and the common settings in one form, one Save.
  await page.goto("/superadmin/connections/ai");
  const ai = page.getByTestId("settings-console");
  await expect(ai.getByRole("button", { name: /^Save/ })).toHaveCount(1);
  await expect(ai.getByRole("button", { name: "Save AI settings" })).toBeVisible();
  await page.getByLabel("Find a setting").fill("Gemini");
  await expect(page.getByTestId("ai-provider-GEMINI")).toBeVisible();
  await expect(page.getByTestId("ai-provider-CLAUDE")).toBeHidden();
  await expect(page.getByTestId("ai-common")).toBeHidden();
  await page.screenshot({ path: "test-results/settings-console.png", fullPage: true });
});
