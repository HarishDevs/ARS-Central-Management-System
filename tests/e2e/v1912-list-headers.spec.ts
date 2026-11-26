import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.91.2 (26 Nov 2026, D-436), the owner: "Delete the header for Sent back for changes and
// Approved by me as well." The same as Waiting for me (D-435 point 2): no visible title bar,
// one h1 for screen readers, the browser title unchanged. Checked in the Compact and Classic
// views, on a desktop and on a 390 px phone.
test.describe.configure({ mode: "serial" });
test.setTimeout(4 * 60_000);

const stamp = Date.now().toString(36);
const PAGES = [
  { path: "/users/queue/sent-back", name: "Sent back for changes", row: "sent-back-row", rowText: `Header sent back ${stamp}` },
  { path: "/users/approved-by-me", name: "Approved by me", row: "request-table", rowText: `Header approved ${stamp}` },
] as const;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function view(loginId: string, classic: boolean) {
  const conn = await db();
  try {
    const id = await userIdByLogin(loginId);
    if (classic) await conn.query("INSERT INTO user_settings (user_id, setting_key, value) VALUES (?, 'ui.workspace_view', 'CLASSIC') ON DUPLICATE KEY UPDATE value = 'CLASSIC'", [id]);
    else await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'ui.workspace_view'", [id]);
  } finally {
    await conn.end();
  }
}

test.afterAll(async () => {
  await view("E2E_MGR", false);
});

test("setup: the manager has one request sent back and one approved", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const sentBackPath = await raisePurchase(page, `Header sent back ${stamp}`);
  const approvedPath = await raisePurchase(page, `Header approved ${stamp}`);
  await as(context, "E2E_MGR");
  await page.goto(sentBackPath);
  await page.getByLabel(/Comment/).fill("Attach the quote");
  await page.getByRole("button", { name: "Ask for changes", exact: true }).click();
  await expect(page.locator("main")).toContainText(/Changes required|changes/i);
  await page.goto(approvedPath);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("main")).toContainText(/approved/i);
});

async function checkHeaders(page: Page, label: string) {
  for (const target of PAGES) {
    const at = `${label} ${target.path}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(target.path);
    const main = page.locator("main");
    // No visible header (title, ⓘ, rule); exactly one h1, for screen readers, with the page's name.
    const h1 = main.locator("h1");
    await expect(h1, at).toHaveCount(1);
    await expect(h1, at).toHaveText(target.name);
    await expect(h1, at).toHaveClass(/sr-only/);
    await expect(page.locator("h1"), at).toHaveCount(1);
    await expect(main.locator('[data-tour="page-header"]'), at).toHaveCount(0);
    // The heading is still found by role (screen readers), but takes no room on screen.
    await expect(page.getByRole("heading", { level: 1, name: target.name }), at).toHaveCount(1);
    const box = await h1.boundingBox();
    expect(box === null || (box.width <= 1 && box.height <= 1), at).toBe(true);
    // The browser title is unchanged.
    await expect(page, at).toHaveTitle(new RegExp(target.name));
    // Nothing else changed: the toolbar and the list are there, with the row.
    await expect(page.getByTestId("list-toolbar"), at).toBeVisible();
    await expect(page.getByTestId(target.row).filter({ hasText: target.rowText }).first(), at).toBeVisible();
    // Phone (390): the same h1, and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(target.path);
    await expect(main.locator("h1"), at).toHaveCount(1);
    await expect(main.locator("h1"), at).toHaveClass(/sr-only/);
    await expect(main.locator('[data-tour="page-header"]'), at).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at).toBe(true);
  }
}

test("Compact view: no header on Sent back for changes and Approved by me (h1 for screen readers)", async ({ page, context }) => {
  await view("E2E_MGR", false);
  await as(context, "E2E_MGR");
  await checkHeaders(page, "compact");
  // The sidebar item names the page.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of PAGES) {
    await page.goto(target.path);
    await expect(page.getByTestId("sidebar-scroll").getByRole("link", { name: target.name, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("Classic view: the same, and the active tab names the page", async ({ page, context }) => {
  await view("E2E_MGR", true);
  await as(context, "E2E_MGR");
  await checkHeaders(page, "classic");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of PAGES) {
    await page.goto(target.path);
    await expect(page.getByTestId("classic-tabs").locator('a[aria-current="page"]').filter({ hasText: target.name })).toBeVisible();
  }
});
