import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, raisePurchase, sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.90.0 (25 Nov 2026), the owner's four requests through the real screens:
// D-427 every status count on Ticket dashboards; D-428 a repeating task's
// Complete → Undo → Complete makes the next day's task once; D-429 select and
// bulk Approve on Waiting for me (table and phone cards, keyboard); D-430
// TODAY() and NOW() in formulas ("[NFD] − TODAY").
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await db();
  try {
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}
const serious = async (page: Page, selector: string) =>
  (await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id);

test("D-427 Ticket dashboards: every status count, zeros included, each opens the filtered list", async ({ page, context }) => {
  // Ticketing is a module (D-329): IT gets it for this test only, as v1550 does for its suite.
  const hadTicket = (await query<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE login_id = 'E2E_ADMIN' AND FIND_IN_SET('TICKET', module_access)"))[0]!.n > 0;
  if (!hadTicket) await query("UPDATE users SET module_access = CONCAT_WS(',', NULLIF(module_access, ''), 'TICKET') WHERE login_id = 'E2E_ADMIN'");
  try {
    await ticketDashboards(page, context);
  } finally {
    if (!hadTicket) await query("UPDATE users SET module_access = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', module_access, ','), ',TICKET,', ',')) WHERE login_id = 'E2E_ADMIN'");
  }
});
async function ticketDashboards(page: Page, context: BrowserContext) {
  await as(context, "E2E_ADMIN");
  await page.goto("/users/tickets/dashboards");
  const card = page.getByTestId("ticket-dashboard-card").first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/open · \d+ to assign · \d+ overdue/);
  const counts = card.getByTestId("ticket-status-counts");
  const labels = await counts.getByRole("link").evaluateAll((links) => links.filter((link) => link.hasAttribute("data-status")).map((link) => link.getAttribute("data-status")));
  expect(labels).toEqual(["NEW", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION", "REOPENED", "CLOSED", "overdue"]);
  for (const link of await counts.locator("a[data-status]").all()) await expect(link).toContainText(/\d/);
  expect(await serious(page, "[data-testid='ticket-dashboards']")).toEqual([]);
  await counts.locator("a[data-status='CLOSED']").click();
  await expect(page).toHaveURL(/\/users\/tickets\/dashboards\/\d+\?status=CLOSED$/);
  await expect(page.locator("#tf-status")).toHaveValue("CLOSED");
  // Phone: the cards stack and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users/tickets/dashboards");
  await expect(page.getByTestId("ticket-status-counts").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("D-428 a repeating task: Complete, Undo, Complete again makes the next day's task once", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const title = `Daily stock check ${stamp}`;
  await createProject(page, `E2E periodic ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(title);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: title }).first()).toBeVisible();
  const [task] = await query<{ id: number }>("SELECT id FROM tasks WHERE title = ?", [title]);
  await query("UPDATE tasks SET recurrence_json = ?, due_at = DATE_ADD(UTC_DATE(), INTERVAL 2 DAY) + INTERVAL 12 HOUR WHERE id = ?", [JSON.stringify({ kind: "DAILY", every: 1, weekdays: [] }), task!.id]);
  await page.reload();
  const live = () => query<{ id: number }>("SELECT id FROM tasks WHERE series_id = ? AND id <> ? AND deleted_at IS NULL", [task!.id, task!.id]);

  await page.getByRole("checkbox", { name: `Complete ${title}` }).first().click();
  const toast = page.getByTestId("toast-region");
  await expect(toast.getByText(`Completed: ${title}`)).toBeVisible();
  await expect.poll(async () => (await live()).length).toBe(1);
  const first = (await live())[0]!.id;
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast.getByText("Reopened.")).toBeVisible();
  // The untouched next task went with the Undo; the task repeats again.
  await expect.poll(async () => (await live()).length).toBe(0);
  const [own] = await query<{ recurrence_json: unknown }>("SELECT recurrence_json FROM tasks WHERE id = ?", [task!.id]);
  expect(own!.recurrence_json).not.toBeNull();

  await page.reload();
  await page.getByRole("checkbox", { name: `Complete ${title}` }).first().click();
  await expect(toast.getByText(`Completed: ${title}`).first()).toBeVisible();
  await expect.poll(async () => (await live()).map((row) => row.id)).toHaveLength(1);
  expect((await live())[0]!.id).not.toBe(first);
});

test("D-429 Waiting for me: select rows, one comment, Approve with a confirmation and a summary", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const titles = [`Bulk A ${stamp}`, `Bulk B ${stamp}`, `Bulk C ${stamp}`];
  for (const title of titles) await raisePurchase(page, title);

  await as(context, "E2E_MGR");
  await page.goto(`/users/queue?q=${encodeURIComponent(stamp)}`);
  const bar = page.getByTestId("queue-bulk-bar");
  await expect(bar).toContainText("Select approvals to approve several at once");
  await expect(page.getByTestId("queue-select")).toHaveCount(3);
  // Keyboard: Tab to a row's box and Space ticks it.
  const rowBox = page.getByTestId("queue-select").first();
  await rowBox.focus();
  await page.keyboard.press("Space");
  await expect(rowBox).toBeChecked();
  await expect(bar).toContainText("1 selected");
  // Select all on this page (this filter), then Clear, then all again.
  await page.getByTestId("queue-select-all").check();
  await expect(bar).toContainText("3 selected");
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toContainText("Select approvals");
  await page.getByTestId("queue-select").nth(0).check();
  await page.getByTestId("queue-select").nth(1).check();
  await expect(bar).toContainText("2 selected");
  await page.getByTestId("queue-bulk-comment").fill(`Checked together ${stamp}`);
  expect(await serious(page, "main")).toEqual([]);
  await page.getByTestId("queue-bulk-approve").click();
  const confirm = page.getByRole("alertdialog", { name: "Approve 2 requests?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`Checked together ${stamp}`);
  await confirm.getByRole("button", { name: "Approve 2" }).click();
  const summary = page.getByTestId("queue-bulk-summary");
  await expect(summary).toContainText("Approved 2 · Skipped 0");
  // Each went through the engine on its own: recorded, with the comment, now with the HOD.
  await expect(page.getByTestId("queue-select")).toHaveCount(1);
  const decided = await query<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REQUEST_DECIDED' AND entity_id IN (SELECT CAST(id AS CHAR) FROM approval_requests WHERE title IN (?, ?))", [titles[0], titles[1]]);
  expect(Number(decided[0]!.n)).toBe(2);
  const states = await query<{ state_json: unknown }>("SELECT state_json FROM approval_requests WHERE title IN (?, ?)", [titles[0], titles[1]]);
  for (const row of states) expect(JSON.stringify(row.state_json)).toContain(`Checked together ${stamp}`);

  // Phone: the cards have a box each; the same bar approves.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/users/queue?q=${encodeURIComponent(stamp)}`);
  const cardBox = page.getByTestId("queue-select-card");
  await expect(cardBox).toHaveCount(1);
  await cardBox.check();
  await expect(page.getByTestId("queue-bulk-bar")).toContainText("1 selected");
  await page.getByTestId("queue-bulk-approve").click();
  await page.getByRole("alertdialog", { name: "Approve 1 request?" }).getByRole("button", { name: "Approve 1" }).click();
  await expect(page.getByTestId("queue-bulk-summary")).toContainText("Approved 1 · Skipped 0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("D-430 formulas: [NFD] − TODAY reads, TODAY() and NOW() are in the Functions list", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const projectUrl = await createProject(page, `E2E today ${stamp}`);
  await page.goto(`${projectUrl}/settings`);
  const openAdd = async (name: string) => {
    await page.getByTestId("add-field").click();
    const dialog = page.getByTestId("field-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Field title").fill(name);
    return dialog;
  };
  let dialog = await openAdd("NFD");
  await dialog.getByLabel("Field type").selectOption("DATE");
  await page.getByTestId("field-dialog-save").click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText("NFD");

  dialog = await openAdd("NFD left");
  await dialog.getByLabel("Field type").selectOption("FORMULA");
  const box = dialog.getByRole("textbox", { name: "Formula" });
  await box.fill("[NFD] − TODAY"); // what the owner typed
  await expect(page.getByTestId("formula-check")).toContainText("Looks right: the result is a number");
  await box.fill("ROUND([NFD] − now(), 1)");
  await expect(page.getByTestId("formula-check")).toContainText("NOW() includes the time");
  await dialog.getByTestId("formula-functions").locator("summary").click();
  await dialog.getByRole("button", { name: "TODAY", exact: true }).click();
  await expect(page.getByTestId("function-help")).toContainText("TODAY()");
  await expect(page.getByTestId("function-help")).toContainText("[NFD] − TODAY()");
  await box.fill("[NFD] − ");
  await page.getByTestId("function-help").getByRole("button", { name: "Insert TODAY" }).click();
  await expect(box).toHaveValue("[NFD] − TODAY()");
  await expect(page.getByTestId("formula-check")).toContainText("the result is a number");
  await dialog.getByRole("button", { name: "NOW", exact: true }).click();
  await expect(page.getByTestId("function-help")).toContainText("days with decimals");
  await page.getByTestId("field-dialog-save").click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText("NFD left");

  // Help has them too.
  await page.goto("/users/help");
  await page.locator("#help-search").fill("NOW()");
  await expect(page.getByText("Formulas", { exact: true }).first()).toBeVisible();
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const word of ["TODAY()", "NOW()", "NFD Delay = DAYS(TODAY(), [NFD])"]) expect(text).toContain(word);
});
