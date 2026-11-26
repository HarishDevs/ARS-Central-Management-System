import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.91.2 (26 Nov 2026, D-436), the owner: "Delete the header for Sent back for changes and
// Approved by me as well." The same as Waiting for me (D-435 point 2): no visible title bar,
// one h1 for screen readers, the browser title unchanged. Checked in the Compact and Classic
// views, on a desktop and on a 390 px phone.
// v1.91.3 (26 Nov 2026, D-437), the owner: "All the approval screen layout should match the
// Waiting for me, except the bulk approval part." Every list in My Approvals (My pending
// requests, My approved requests, Sent back for changes, Approved by me): no title bar, the
// Request cell is the title only, the count and pager are below the table, nothing but the
// toolbar (filter chips / saved views when used, quick filter cards, Raised by me / Shared
// with me) above it, no select boxes. New request and Approval templates: the title bar goes,
// their one action stays.
test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60_000);

const stamp = Date.now().toString(36);
type ListTarget = { path: string; name: string; login: string; row: string; rowText: string; count: RegExp; countWord: RegExp; paged: boolean; cardFrom: boolean };
const LISTS: ListTarget[] = [
  { path: "/users/requests", name: "My pending requests", login: "E2E_REQ", row: "request-table", rowText: `Header mine ${stamp}`, count: /^\d+ requests · page 1 of \d+$/, countWord: /requests?\b/, paged: true, cardFrom: false },
  { path: "/users/approved", name: "My approved requests", login: "E2E_REQ", row: "request-table", rowText: `Header approved ${stamp}`, count: /^\d+ requests?( · page 1 of \d+)?$/, countWord: /requests?\b/, paged: false, cardFrom: false },
  { path: "/users/queue/sent-back", name: "Sent back for changes", login: "E2E_MGR", row: "sent-back-row", rowText: `Header sent back ${stamp}`, count: /^\d+ sent back$/, countWord: /sent back/, paged: false, cardFrom: false },
  { path: "/users/approved-by-me", name: "Approved by me", login: "E2E_MGR", row: "request-table", rowText: `Header approved ${stamp}`, count: /^\d+ requests · page 1 of \d+$/, countWord: /requests?\b/, paged: true, cardFrom: true },
];
// Not lists: the title bar goes, the one action stays (on its own line at the right).
const FORMS = [
  { path: "/users/custom", name: "New request", login: "E2E_REQ", action: "Approval templates" },
  { path: "/users/new", name: "Approval templates", login: "E2E_MGR", action: "New request" },
] as const;

const numbers: Record<string, string> = {};
async function requestNo(path: string): Promise<string> {
  const conn = await db();
  try {
    const [rows] = await conn.query("SELECT request_no FROM approval_requests WHERE id = ?", [Number(path.split("/").pop())]);
    return String((rows as { request_no: string }[])[0]!.request_no);
  } finally {
    await conn.end();
  }
}
async function approvedBy(loginId: string): Promise<number> {
  const conn = await db();
  try {
    const id = await userIdByLogin(loginId);
    const [rows] = await conn.query("SELECT COUNT(DISTINCT request_id) AS n FROM approval_tasks WHERE decided_by = ? AND status = 'APPROVED' AND task_type = 'APPROVAL'", [id]);
    return Number((rows as { n: number }[])[0]!.n);
  } finally {
    await conn.end();
  }
}

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
async function views(classic: boolean) {
  for (const login of ["E2E_MGR", "E2E_REQ"]) await view(login, classic);
}
// Firefox aborts a goto that meets the page's own navigation still in flight (KF-06,
// NS_BINDING_ABORTED; New request's draft save is one): let the current page settle first.
async function go(page: Page, path: string) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.goto(path);
}
async function raise(page: Page, title: string) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  return raisePurchase(page, title);
}
async function approve(page: Page, path: string) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.goto(path);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("main")).toContainText(/approved/i);
}

test.afterAll(async () => {
  await views(false);
});

test("setup: one request sent back, one fully approved, one pending; two pages of the requester's and the manager's lists", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const sentBackPath = await raise(page, `Header sent back ${stamp}`);
  const approvedPath = await raise(page, `Header approved ${stamp}`);
  numbers["/users/queue/sent-back"] = await requestNo(sentBackPath);
  numbers["/users/approved-by-me"] = numbers["/users/approved"] = await requestNo(approvedPath);
  expect(numbers["/users/queue/sent-back"]).not.toBe("");
  await as(context, "E2E_MGR");
  await page.goto(sentBackPath);
  await page.getByLabel(/Comment/).fill("Attach the quote");
  await page.getByRole("button", { name: "Ask for changes", exact: true }).click();
  await expect(page.locator("main")).toContainText(/Changes required|changes/i);
  // v1.91.3: page 2 of Approved by me needs more than 25 approved by the manager (the default page size);
  // the same requests give the requester more than 25 raised (page 2 of My pending requests).
  const approved = await approvedBy("E2E_MGR");
  const more: string[] = [];
  if (approved < 26) {
    await as(context, "E2E_REQ");
    for (let i = approved; i < 26; i += 1) more.push(await raise(page, `Header fill ${i} ${stamp}`));
    await as(context, "E2E_MGR");
    for (const path of more) await approve(page, path);
  }
  // Approved last, so the newest approval (the first rows of Approved by me) is this one; then the
  // HOD (level 2) approves it too, so it is on the requester's My approved requests.
  await approve(page, approvedPath);
  expect(await approvedBy("E2E_MGR")).toBeGreaterThanOrEqual(26);
  await as(context, "E2E_HOD");
  await approve(page, approvedPath);
  // Raised last: the newest row of My pending requests.
  await as(context, "E2E_REQ");
  const minePath = await raise(page, `Header mine ${stamp}`);
  numbers["/users/requests"] = await requestNo(minePath);
});

// No visible header (title, ⓘ, rule); exactly one h1, for screen readers, with the page's name.
async function hiddenHeader(page: Page, name: string, at: string) {
  const main = page.locator("main");
  const h1 = main.locator("h1");
  await expect(h1, at).toHaveCount(1);
  await expect(h1, at).toHaveText(name);
  await expect(h1, at).toHaveClass(/sr-only/);
  await expect(page.locator("h1"), at).toHaveCount(1);
  await expect(main.locator('[data-tour="page-header"]'), at).toHaveCount(0);
  // The heading is still found by role (screen readers), but takes no room on screen.
  await expect(page.getByRole("heading", { level: 1, name }), at).toHaveCount(1);
  const box = await h1.boundingBox();
  expect(box === null || (box.width <= 1 && box.height <= 1), at).toBe(true);
  // The browser title is unchanged.
  await expect(page, at).toHaveTitle(new RegExp(name));
}

async function checkList(page: Page, context: BrowserContext, target: ListTarget, label: string) {
  const at = `${label} ${target.path}`;
  const no = numbers[target.path]!;
  await as(context, target.login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, target.path);
  await hiddenHeader(page, target.name, at);
  const main = page.locator("main");
  await expect(page.getByTestId("list-toolbar"), at).toBeVisible();
  await expect(page.getByTestId(target.row).filter({ hasText: target.rowText }).first(), at).toBeVisible();
  const table = main.locator("table.data-table");
  await expect(table, at).toBeVisible();
  // 1. The Request cell is the title only: no second line, no record number in the table.
  const row = table.locator("tbody tr").filter({ hasText: target.rowText }).first();
  await expect(row, at).toBeVisible();
  const cell = row.locator("td").first();
  await expect(cell.getByRole("link"), at).toHaveText(target.rowText);
  await expect(cell.locator("p, span.block"), at).toHaveCount(0);
  await expect(table, at).not.toContainText(no);
  // Not approvable here: no select boxes (bulk select is Waiting for me's only).
  await expect(main.getByRole("checkbox", { name: /^Select / }), at).toHaveCount(0);
  await expect(page.getByTestId("queue-bulk-bar"), at).toHaveCount(0);
  // 2. The count (and pager) are below the table, toolbar first; one count on the page.
  const footer = page.getByTestId("list-footer");
  await expect(footer.getByRole("status"), at).toHaveText(target.count);
  const order = await page.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector)!;
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const table = at("main table.data-table");
    return { toolbarThenTable: follows(at("[data-testid=list-toolbar]"), table), tableThenFooter: follows(table, at("[data-testid=list-footer]")) };
  });
  expect(order, at).toEqual({ toolbarThenTable: true, tableThenFooter: true });
  await expect(main.locator("[role=status]").filter({ hasText: target.countWord }), at).toHaveCount(1);
  // 3. The old lines are gone: the count above the table, "Showing … of …", "Page 1 of … ·", Previous / Next.
  await expect(main, at).not.toContainText(/Showing \d/);
  await expect(main, at).not.toContainText(/Page \d+ of \d+ ·/);
  await expect(main.getByRole("link", { name: /^(← Previous|Next →|Previous page|Next page)$/ }), at).toHaveCount(0);
  if (target.paged) {
    const pager = footer.getByRole("navigation", { name: "Pages" });
    await expect(pager.getByRole("link", { name: "Later →" }), at).toBeVisible();
    expect((await pager.boundingBox())!.x, at).toBeGreaterThan((await footer.getByRole("status").boundingBox())!.x);
    await pager.getByRole("link", { name: "Later →" }).click();
    await expect(page, at).toHaveURL(/page=2/);
    await expect(page.getByTestId("list-footer").getByRole("status"), at).toHaveText(/ · page 2 of \d+$/);
    await expect(page.getByTestId("list-footer").getByRole("link", { name: "← Earlier" }), at).toBeVisible();
  }
  // Search by the record number still finds the request.
  await page.goto(`${target.path}?q=${encodeURIComponent(no)}`);
  await expect(page.locator("main table.data-table tbody tr").filter({ hasText: target.rowText }), at).toHaveCount(1);
  // Phone (390): the same hidden h1; no number; Approved by me's cards keep "from …"; nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(target.path);
  await expect(main.locator("h1"), at).toHaveClass(/sr-only/);
  await expect(main.locator('[data-tour="page-header"]'), at).toHaveCount(0);
  await expect(page.getByTestId("list-footer"), at).toBeVisible();
  if (target.row === "request-table") {
    const card = page.getByTestId("request-cards").locator("li").filter({ hasText: target.rowText });
    await expect(card, at).toBeVisible();
    if (target.cardFrom) await expect(card.getByTestId("request-card-meta"), at).toHaveText(/^from /);
    else await expect(card.getByTestId("request-card-meta"), at).toHaveCount(0);
    await expect(page.getByTestId("request-cards"), at).not.toContainText(no);
  } else {
    await expect(page.getByTestId("sent-back"), at).not.toContainText(no);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at).toBe(true);
}

async function checkForms(page: Page, context: BrowserContext, label: string) {
  for (const target of FORMS) {
    const at = `${label} ${target.path}`;
    await as(context, target.login);
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, target.path);
    await hiddenHeader(page, target.name, at);
    await expect(page.locator('main [data-tour="page-actions"]').getByRole("link", { name: target.action }), at).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(target.path);
    await expect(page.locator("main h1"), at).toHaveClass(/sr-only/);
    await expect(page.locator('main [data-tour="page-actions"]').getByRole("link", { name: target.action }), at).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), at).toBe(true);
  }
}

test("Compact view: every My Approvals list laid out like Waiting for me; the forms keep their action", async ({ page, context }) => {
  await views(false);
  for (const target of LISTS) await checkList(page, context, target, "compact");
  await checkForms(page, context, "compact");
  // The sidebar item names the page; Raised by me / Shared with me stay on My pending requests.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of [...LISTS, ...FORMS]) {
    await as(context, target.login);
    await go(page, target.path);
    await expect(page.getByTestId("sidebar-scroll").getByRole("link", { name: target.name, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await as(context, "E2E_REQ");
  await go(page, "/users/requests");
  await expect(page.getByTestId("ownership-tabs").getByRole("link", { name: /Raised by me/ })).toHaveAttribute("aria-current", "page");
});

test("Classic view: the same, and the active tab names the page", async ({ page, context }) => {
  await views(true);
  for (const target of LISTS) await checkList(page, context, target, "classic");
  await checkForms(page, context, "classic");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of [...LISTS, ...FORMS]) {
    await as(context, target.login);
    await go(page, target.path);
    await expect(page.getByTestId("classic-tabs").locator('a[aria-current="page"]').filter({ hasText: target.name })).toBeVisible();
  }
});
