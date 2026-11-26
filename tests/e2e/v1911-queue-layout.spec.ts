import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.91.1 (26 Nov 2026, D-435), the owner on Waiting for me: "I want the 1st line to be
// available and the 2nd line is not needed and remove the header, bring the pagination
// below the table and remove the link and text." Checked in the Compact and Classic views,
// on a desktop and on a 390 px phone.
test.describe.configure({ mode: "serial" });
test.setTimeout(6 * 60_000);

const stamp = Date.now().toString(36);
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
async function waitingFor(loginId: string): Promise<number> {
  const conn = await db();
  try {
    const id = await userIdByLogin(loginId);
    const [rows] = await conn.query("SELECT COUNT(*) AS n FROM approval_tasks WHERE approver_id = ? AND status = 'PENDING'", [id]);
    return Number((rows as { n: number }[])[0]!.n);
  } catch {
    return 0;
  } finally {
    await conn.end();
  }
}

let requestNo = "";

test.afterAll(async () => {
  await view("E2E_MGR", false);
});

test("setup: one request sent back, and more than one page waiting for the manager", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const sentBackPath = await raisePurchase(page, `Layout sent back ${stamp}`);
  const firstPath = await raisePurchase(page, `Layout row ${stamp}`);
  const conn = await db();
  try {
    const [rows] = await conn.query("SELECT request_no FROM approval_requests WHERE id = ?", [Number(firstPath.split("/").pop())]);
    requestNo = String((rows as { request_no: string }[])[0]!.request_no);
  } finally {
    await conn.end();
  }
  expect(requestNo).not.toBe("");
  await as(context, "E2E_MGR");
  await page.goto(sentBackPath);
  await page.getByLabel(/Comment/).fill("Attach the quote");
  await page.getByRole("button", { name: "Ask for changes", exact: true }).click();
  await expect(page.locator("main")).toContainText(/Changes required|changes/i);
  // Page 2 needs more than 25 waiting (the default page size).
  const pending = await waitingFor("E2E_MGR");
  if (pending < 26) {
    await as(context, "E2E_REQ");
    for (let i = pending; i < 26; i += 1) await raisePurchase(page, `Layout fill ${i} ${stamp}`);
  }
});

async function checkLayout(page: Page, label: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  const main = page.locator("main");
  // 2. No visible header; one h1, for screen readers.
  const h1 = main.locator("h1");
  await expect(h1, label).toHaveCount(1);
  await expect(h1, label).toHaveText("Waiting for me");
  await expect(h1, label).toHaveClass(/sr-only/);
  await expect(main.locator('[data-tour="page-header"]'), label).toHaveCount(0);
  await expect(page).toHaveTitle(/Waiting for me/);
  // 4. No Sent back for changes link or its text (a request is sent back).
  await expect(page.getByTestId("sent-back-link"), label).toHaveCount(0);
  await expect(main, label).not.toContainText("back here when they resubmit");
  await expect(main.getByRole("link", { name: /Sent back for changes \(\d+\)/ }), label).toHaveCount(0);
  // 1. The Request cell is the title only: no second line with the record number.
  const table = main.locator("table.data-table");
  await expect(table, label).toBeVisible();
  const cells = table.locator("tbody tr td:has(a[data-queue-link])");
  expect(await cells.count(), label).toBeGreaterThan(0);
  for (const cell of await cells.all()) await expect(cell.locator("p"), label).toHaveCount(0);
  await expect(table, label).not.toContainText(requestNo);
  // 3. The select bar, then the count and the pager, are below the table; nothing between the toolbar and the table.
  const footer = page.getByTestId("queue-footer");
  const bar = page.getByTestId("queue-bulk-bar");
  await expect(bar, label).toContainText("Select approvals to approve several at once");
  const order = await page.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector)!;
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const toolbar = at("[data-testid=list-toolbar]");
    const table = at("main table.data-table");
    const bar = at("[data-testid=queue-bulk-bar]");
    const footer = at("[data-testid=queue-footer]");
    return { toolbarThenTable: follows(toolbar, table), tableThenBar: follows(table, bar), barThenFooter: follows(bar, footer) };
  });
  expect(order, label).toEqual({ toolbarThenTable: true, tableThenBar: true, barThenFooter: true });
  // Select all at the top of the tick column, in step with the bar's box.
  const headerAll = table.getByTestId("queue-select-all-header");
  const barAll = bar.getByTestId("queue-select-all");
  await headerAll.check();
  await expect(barAll, label).toBeChecked();
  await expect(bar, label).toContainText(/^\s*\d+ selected/);
  await barAll.uncheck();
  await expect(headerAll, label).not.toBeChecked();
  await expect(bar, label).toContainText("Select approvals");
  // With a row ticked the bar sticks to the bottom of the screen (Approve without scrolling), clear of Pico Bot.
  await page.getByTestId("queue-select").first().check();
  await expect(bar, label).toHaveAttribute("data-sticky", "1");
  await page.getByTestId("queue-select").first().scrollIntoViewIfNeeded();
  await expect(bar.getByTestId("queue-bulk-approve"), label).toBeInViewport();
  const stuck = (await bar.boundingBox())!;
  expect(stuck.y + stuck.height, label).toBeLessThanOrEqual(900);
  // (On a computer the table scrolls inside its own box, so the bar is in view anyway; the phone check below, where the page scrolls, proves the sticking.)
  const launcher = page.getByTestId("picbot-launcher");
  if (await launcher.isVisible()) {
    const pico = (await launcher.boundingBox())!;
    expect(stuck.x + stuck.width <= pico.x || stuck.y + stuck.height <= pico.y, label).toBe(true);
  }
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar, label).not.toHaveAttribute("data-sticky", "1");
  await expect(footer.getByRole("status"), label).toHaveText(/^\d+ waiting · page 1 of \d+$/);
  const pager = footer.getByRole("navigation", { name: "Pages" });
  await expect(pager.getByRole("link", { name: "Later →" }), label).toBeVisible();
  const pagerBox = (await pager.boundingBox())!;
  const countBox = (await footer.getByRole("status").boundingBox())!;
  expect(pagerBox.x, label).toBeGreaterThan(countBox.x);
  await expect(main.locator("[role=status]").filter({ hasText: /waiting/ }), label).toHaveCount(1);
  // Search by the record number still finds the request.
  await page.goto(`/users/queue?q=${encodeURIComponent(requestNo)}`);
  await expect(main.locator("table a[data-queue-link]"), label).toHaveText([`Layout row ${stamp}`]);
  await expect(page.getByTestId("queue-footer").getByRole("status"), label).toHaveText(/^1 of \d+ waiting$/);
  // Page 2 has Earlier below the table too.
  await page.goto("/users/queue?page=2");
  await expect(page.getByTestId("queue-footer").getByRole("link", { name: "← Earlier" }), label).toBeVisible();
  // Phone (390): cards show the title and "from …", no number, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users/queue");
  const card = page.getByTestId("queue-card-meta").first();
  await expect(card, label).toBeVisible();
  await expect(card, label).toHaveText(/^from /);
  await expect(page.getByTestId("queue-footer"), label).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), label).toBe(true);
  // Phone: tick a card; the bar sticks above the tab bar, clear of Pico Bot, and nothing scrolls sideways.
  await page.getByTestId("queue-select-card").first().check();
  const phoneBar = page.getByTestId("queue-bulk-bar");
  await expect(phoneBar, label).toHaveAttribute("data-sticky", "1");
  await page.getByTestId("queue-select-card").first().scrollIntoViewIfNeeded();
  // The first card is at the top; the bar's own place is far below the 25 cards, yet Approve is on screen.
  const restsBelow = await page.evaluate(() => document.querySelector("[data-testid=queue-footer]")!.getBoundingClientRect().top > window.innerHeight);
  expect(restsBelow, label).toBe(true);
  await expect(phoneBar.getByTestId("queue-bulk-approve"), label).toBeInViewport();
  const phoneBox = (await phoneBar.boundingBox())!;
  expect(phoneBox.y + phoneBox.height, label).toBeLessThanOrEqual(844 - 80);
  const phonePico = page.getByTestId("picbot-launcher");
  if (await phonePico.isVisible()) {
    const pico = (await phonePico.boundingBox())!;
    expect(phoneBox.x + phoneBox.width <= pico.x || phoneBox.y + phoneBox.height <= pico.y || phoneBox.y >= pico.y + pico.height, label).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), label).toBe(true);
  await phoneBar.getByRole("button", { name: "Clear" }).click();
}

test("Compact view: title only, no header (h1 for screen readers), pager below, no sent-back link", async ({ page, context }) => {
  await view("E2E_MGR", false);
  await as(context, "E2E_MGR");
  await checkLayout(page, "compact");
  // The sidebar item and breadcrumb name the page; Sent back for changes is still in the sidebar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  await expect(page.getByTestId("sidebar-scroll").getByRole("link", { name: /^Waiting for me/ })).toHaveAttribute("aria-current", "page");
  await page.getByTestId("sidebar-scroll").getByRole("link", { name: "Sent back for changes", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/queue\/sent-back$/);
  await expect(page.getByTestId("sent-back-row").filter({ hasText: `Layout sent back ${stamp}` })).toBeVisible();
});

test("Classic view: the same, and the active tab names the page", async ({ page, context }) => {
  await view("E2E_MGR", true);
  await as(context, "E2E_MGR");
  await checkLayout(page, "classic");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  await expect(page.getByTestId("classic-tabs").locator('a[aria-current="page"]').filter({ hasText: /Waiting for me/ })).toBeVisible();
});

test("Home keeps the record number under the title (only Waiting for me changed)", async ({ page, context }) => {
  await view("E2E_MGR", false);
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  const row = page.locator("main table a[data-queue-link]").first();
  if ((await row.count()) === 0) test.skip(true, "Home shows no Waiting for me table for this user");
  await expect(row.locator("xpath=ancestor::td[1]").locator("p").first()).toHaveText(/\S+-\d+/);
});
