import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.84.0 (D-411, owner's Admin and Super Admin redesign): the Super Admin
// panel in five groups. The Health console (status cards with icon and word,
// Needs action), the Connections pages (status, settings and Test together),
// Feature switches on their own page, Search settings, the Danger zone's
// typed confirmation, the old addresses redirecting, and phone width; axe on
// every new screen.
async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}

test("the sidebar has the five groups, folds them, and goes back to the app", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin/connections/email");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  for (const group of ["Health", "Connections", "Security & access", "Data", "Monitoring"]) await expect(nav.getByRole("button", { name: group })).toBeVisible();
  // The current page's group is open and its entry lit.
  await expect(nav.getByRole("link", { name: "Email" })).toHaveAttribute("aria-current", "page");
  // Folding a group is remembered.
  await nav.getByRole("button", { name: "Monitoring" }).click();
  await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
  await page.reload();
  await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
  await expect(page.getByTestId("back-to-app").first()).toHaveAttribute("href", "/users");
});

test("Health console: a card per provider, job, backup and delivery, Needs action, axe", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin");
  await expect(page.getByRole("heading", { level: 1, name: "Health console" })).toBeVisible();
  for (const key of ["email", "whatsapp", "push", "google_signin", "google_calendar", "salesforce", "ai", "jobs", "backup", "offsite", "storage", "origin", "deliveries"]) {
    const card = page.getByTestId(`health-${key}`);
    await expect(card).toBeVisible();
    // Never colour alone: a word (OK / Warning / Failed / Not set up) is on every card.
    await expect(card.locator("[data-health]").first()).toHaveText(/OK|Warning|Failed|Not set up/);
  }
  await expect(page.getByTestId("needs-action")).toBeVisible();
  // The provider keys show only Configured / Not configured.
  await expect(page.getByRole("heading", { name: "Provider keys" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("Connections pages: status, settings and Test on one page; axe", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  const pages: [string, string, string][] = [
    ["/superadmin/connections/email", "Email", "status-email"],
    ["/superadmin/connections/whatsapp", "WhatsApp", "status-whatsapp"],
    ["/superadmin/connections/push", "Phone & desktop notifications", "status-push"],
    ["/superadmin/connections/google", "Google sign-in & calendar", "status-google_signin"],
    ["/superadmin/connections/salesforce", "Salesforce", "status-salesforce"],
    ["/superadmin/connections/ai", "AI providers", "status-ai"],
  ];
  for (const [url, title, status] of pages) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId(status)).toBeVisible();
    expect(await axe(page), url).toEqual([]);
  }
  await page.goto("/superadmin/connections/email");
  await expect(page.getByTestId("settings-email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test email" })).toBeVisible();
  await page.goto("/superadmin/connections/whatsapp");
  await expect(page.getByRole("button", { name: "Send test WhatsApp" })).toBeVisible();
  await expect(page.getByTestId("template-reminder").getByRole("link", { name: "Open templates" })).toHaveAttribute("href", "/superadmin/connections/whatsapp/templates");
  await page.goto("/superadmin/connections/push");
  await expect(page.getByTestId("push-keys")).toBeVisible();
});

test("Feature switches on their own page, unsaved changes marked; backup and retention take over their settings", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin/security/features");
  await expect(page.getByRole("heading", { level: 1, name: "Feature switches" })).toBeVisible();
  const form = page.getByTestId("settings-features");
  await expect(form.getByRole("button", { name: "Save" })).toHaveCount(1);
  // Feature switches are On / Off / IT team only choices.
  const choice = form.locator("select").first();
  await choice.selectOption((await choice.inputValue()) === "OFF" ? "ON" : "OFF");
  await expect(form.getByText("Unsaved changes")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // Leaving with a change asks first (UnsavedGuard).
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "General" }).click();
  await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toBeVisible();
  await page.getByRole("button", { name: /Leave without saving/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();

  await page.goto("/superadmin/data/backup");
  await expect(page.locator("#settings-BACKUP")).toBeVisible();
  await expect(page.locator("#settings-GDRIVE_BACKUP")).toBeVisible();
  await expect(page.getByTestId("gdrive-backup-test")).toBeVisible();
  await page.goto("/superadmin/data/retention");
  await expect(page.locator("#settings-RETENTION")).toBeVisible();
});

test("Search settings finds pages and settings across both panels", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin");
  const search = page.getByRole("combobox", { name: "Search settings" }).first();
  await search.fill("lockout");
  await expect(page.getByTestId("settings-search-result").first()).toContainText("Sign-in security");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/superadmin\/security\/sign-in$/);
  await search.fill("departments");
  await expect(page.getByTestId("settings-search-result").filter({ hasText: "Admin" }).first()).toBeVisible();
  await search.fill("zzzz nothing");
  await expect(page.getByText("No setting matches “zzzz nothing”.")).toBeVisible();
  expect(await axe(page)).toEqual([]);

  // An IT admin finds no Super Admin page or setting.
  await as(context, "E2E_ADMIN");
  await page.goto("/admin");
  const adminSearch = page.getByRole("combobox", { name: "Search settings" }).first();
  await adminSearch.fill("smtp");
  await expect(page.getByText("No setting matches “smtp”.")).toBeVisible();
  await adminSearch.fill("Departments");
  await expect(page.getByTestId("settings-search-result").first()).toContainText("Departments");
});

test("Danger zone: bulk delete stays off until DELETE is typed; axe", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin/data/danger-zone");
  await expect(page.getByTestId("danger-requests")).toContainText("There is no undo");
  await expect(page.getByTestId("danger-demo")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: "Open delete requests" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Delete requests" })).toBeVisible();
  const box = page.getByTestId("select-request").first();
  test.skip((await box.count()) === 0, "no requests in the test database");
  await box.check();
  await page.getByTestId("bulk-delete-open").click();
  await page.getByLabel(/Why\?/).fill("Typed confirmation check");
  await expect(page.getByTestId("bulk-delete-confirm")).toBeDisabled();
  await page.getByTestId("typed-confirm").fill("delete");
  await expect(page.getByTestId("bulk-delete-confirm")).toBeDisabled();
  await page.getByTestId("typed-confirm").fill("DELETE");
  await expect(page.getByTestId("bulk-delete-confirm")).toBeEnabled();
  expect(await axe(page)).toEqual([]);
  // Not deleted here: the existing bulk-delete spec deletes.
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("old Super Admin addresses redirect for good (bookmarks, emails, help links)", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  const moved: [string, RegExp][] = [
    ["/superadmin/settings", /\/superadmin\/connections\/email$/],
    ["/superadmin/templates?x=1", /\/superadmin\/connections\/whatsapp\/templates\?x=1$/],
    ["/superadmin/automation", /\/superadmin\/monitoring\/jobs$/],
    ["/superadmin/requests", /\/superadmin\/data\/danger-zone\/requests$/],
    ["/admin/import?kind=users", /\/superadmin\/data\/import\?kind=users$/],
  ];
  for (const [old, now] of moved) {
    const response = await page.request.get(old, { maxRedirects: 0 });
    expect(response.status(), old).toBe(308);
    await page.goto(old);
    await expect(page).toHaveURL(now);
  }
  // Import data is the Super Admin's alone: an IT admin gets the plain 404.
  await as(context, "E2E_ADMIN");
  expect((await page.goto("/superadmin/data/import"))?.status()).toBe(404);
});

test("phone width: the menu has Search settings and Back to the app; no sideways scroll", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 375, height: 800 });
  for (const url of ["/superadmin", "/superadmin/connections/email", "/superadmin/security/features", "/superadmin/data/danger-zone"]) {
    await page.goto(url);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(wide, url).toBe(false);
  }
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("combobox", { name: "Search settings" })).toBeVisible();
  await expect(menu.getByTestId("back-to-app")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
