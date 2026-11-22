import { expect, test, type BrowserContext } from "@playwright/test";
import { db, sessionCookie } from "./db";
import { pickPerson } from "./people";

// v1.55.0 (owner's ticketing brief): the whole journey on the real screens.
// IT sets up a form (shared Form Builder, category, coordinators) →
// the requester raises a ticket → the coordinator assigns it (a linked task) →
// the assignee starts and completes the task with remarks → the requester
// confirms with a rating → the category dashboard counts it.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const formName = `E2E Laptop issue ${stamp}`;
const subject = `Laptop won't boot ${stamp}`;
let ticketPath = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
// v1.55.1 (D-329): Ticketing is a module. The e2e people get it for this
// suite and lose it afterwards, so other suites see their usual sidebar.
async function ticketModule(give: boolean) {
  const conn = await db();
  try {
    if (give) await conn.query("UPDATE users SET module_access = CONCAT_WS(',', NULLIF(module_access, ''), 'TICKET') WHERE login_id LIKE 'E2E%' AND NOT FIND_IN_SET('TICKET', module_access)");
    else await conn.query("UPDATE users SET module_access = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', module_access, ','), ',TICKET,', ',')) WHERE login_id LIKE 'E2E%' AND FIND_IN_SET('TICKET', module_access)");
  } finally {
    await conn.end();
  }
}

test.beforeAll(async () => {
  await ticketModule(true);
});
test.afterAll(async () => {
  await ticketModule(false);
});

test("IT sets up a ticket form: the shared Form Builder, its category and its coordinators", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.goto("/admin/ticket-forms");
  await page.getByLabel("Name", { exact: true }).fill(formName);
  await page.getByLabel(/^Code/).fill(`E2E_LAPTOP_${stamp.toUpperCase()}`);
  await page.getByRole("button", { name: "Create type" }).click();
  await expect(page).toHaveURL(/\/admin\/ticket-forms\/\d+/);
  // Category and coordinators (kept with the form).
  const setup = page.getByTestId("ticket-form-setup");
  await setup.getByLabel("Category").selectOption({ label: "IT Hardware" });
  await setup.getByRole("combobox", { name: "Coordinators" }).fill("Manoj");
  await setup.getByRole("option", { name: /Manoj Manager/ }).first().click();
  await setup.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("toast-region").getByText(/Saved: IT Hardware, 1 coordinator/)).toBeVisible(); // v1.80.0 (D-407): a toast
  // The same builder as approvals: add a field, then publish.
  await page.getByRole("button", { name: /Short text/ }).first().click();
  await page.getByLabel("Field label").last().fill("Asset tag");
  // v1.57.0 (D-335): an Item list (item + qty, ticked when provided).
  await page.getByRole("button", { name: /Item list/ }).first().click();
  await page.getByLabel("Field label").last().fill("Accessories needed");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved. It passes every check/)).toBeVisible();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText(/Version 1 is live/)).toBeVisible();
});

test("the requester raises a ticket: own details filled in, a number by its category", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/tickets/new");
  await page.getByRole("link", { name: new RegExp(formName) }).click();
  const form = page.getByTestId("raise-ticket");
  await expect(form.getByRole("region", { name: "Your details" })).toContainText("Ravi Requester");
  await expect(form.getByRole("region", { name: "Your details" })).toContainText("E2E_REQ");
  await form.getByLabel(/^Subject/).fill(subject);
  await form.getByRole("textbox", { name: /Issue Description/ }).fill("It shows a blue screen at start-up.");
  await form.getByLabel("Priority").selectOption("HIGH");
  await form.getByLabel("Required date").fill(new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10));
  await form.getByLabel("Asset tag").fill("LT-0042");
  await form.getByLabel("Item 1", { exact: true }).fill("USB mouse");
  await form.getByLabel("Item 1 quantity").fill("2");
  await form.getByRole("button", { name: "Raise ticket" }).click();
  await expect(page).toHaveURL(/\/users\/tickets\/\d+\?raised=1/);
  ticketPath = new URL(page.url()).pathname;
  await expect(page.getByRole("status").filter({ hasText: /IT-HW-\d{4}-\d{5} raised/ })).toBeVisible();
  await expect(page.getByText("LT-0042")).toBeVisible();
  await page.goto("/users/tickets");
  await expect(page.getByTestId("ticket-table")).toContainText(subject);
});

test("the coordinator assigns it: a linked task in the assignee's Tasks", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto(ticketPath);
  const assign = page.getByTestId("assign-ticket");
  await pickPerson(page, assign.getByTestId("assign-person"), "Sita");
  await assign.getByLabel("Remarks for the assignee").fill("Check the disk first");
  await assign.getByRole("button", { name: "Assign", exact: true }).click();
  // v1.59.3 (D-362, owner): no task is made; the assignee updates the ticket.
  await expect(page.getByTestId("toast-region").getByText(/Assigned to Sita Staff\. They update the ticket's status here\./)).toBeVisible();
  await page.reload();
  await expect(page.locator("main")).toContainText("Assigned");
  await expect(page.getByRole("link", { name: /^TSK-/ })).toHaveCount(0);
  // v1.57.0 (D-335): the coordinator ticks the item as provided.
  const items = page.getByTestId("item-checklists");
  await expect(items).toContainText("USB mouse");
  await expect(items.getByTestId("item-progress")).toHaveText("0 of 1 provided");
  await items.getByLabel("USB mouse: provided").check();
  await expect(items.getByTestId("item-progress")).toHaveText("1 of 1 provided");
  await expect(items).toContainText("Manoj Manager");
  await page.reload();
  await expect(page.getByTestId("item-checklists").getByLabel("USB mouse: provided")).toBeChecked();
  await page.screenshot({ path: "test-results/v1570-item-checklist.png", fullPage: true });
});

test("the assignee starts it from Assigned to me and resolves it on the ticket; the ticket awaits confirmation", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  // v1.59.3 (D-362, owner): Assigned to me updates the ticket from its row (no task).
  await page.goto("/users/tickets?view=assigned");
  const row = page.getByTestId("ticket-table").locator("tr", { hasText: subject });
  await row.getByTestId("ticket-work-row").getByRole("button", { name: "Start work" }).click();
  await expect(page.getByTestId("toast-region").getByText("Work started. The requester has been told.")).toBeVisible(); // v1.80.0 (D-407): a toast
  await page.reload();
  await expect(page.getByTestId("ticket-table").locator("tr", { hasText: subject })).toContainText("In progress");
  // Then on the ticket page: Mark resolved with what was done.
  await page.goto(ticketPath);
  const work = page.getByTestId("ticket-work");
  await expect(work.getByRole("button", { name: "Start work" })).toHaveCount(0);
  await work.getByLabel(/What was done/).fill("Replaced the SSD and reinstalled Windows");
  await work.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByTestId("toast-region").getByText("Marked resolved. The requester has been asked to confirm.")).toBeVisible(); // v1.80.0 (D-407): a toast
  await page.reload();
  await expect(page.locator("main")).toContainText(/Waiting for Ravi Requester to confirm/);
  await expect(page.getByTestId("ticket-work")).toHaveCount(0);
});

test("the requester confirms with a rating; the ticket closes", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(ticketPath);
  const confirm = page.getByTestId("confirm-ticket");
  await expect(page.getByRole("region", { name: /please confirm/ })).toContainText("Replaced the SSD and reinstalled Windows");
  await confirm.getByRole("radio", { name: "5 out of 5" }).click();
  await confirm.getByRole("button", { name: "Confirm and close" }).click();
  await expect(page.getByTestId("toast-region").getByText("Thank you. The ticket is closed.")).toBeVisible(); // v1.80.0 (D-407): a toast
  await page.reload();
  await expect(page.getByTestId("ticket-closed")).toContainText("Rated 5/5");
  await page.screenshot({ path: "test-results/v1550-ticket-closed.png", fullPage: true });
});

test("the coordinator's IT Hardware dashboard counts it; filters work", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto("/users/tickets/dashboards");
  await page.getByTestId("ticket-dashboards").getByRole("link", { name: /IT Hardware/ }).click();
  const kpis = page.getByTestId("ticket-kpis");
  await expect(kpis.getByRole("link", { name: /Total tickets/ })).toContainText(/[1-9]/);
  await expect(kpis.getByRole("link", { name: /^Closed/ })).toContainText(/[1-9]/);
  await expect(page.getByTestId("ticket-table")).toContainText(subject);
  await page.getByLabel("Priority").selectOption("NORMAL");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/priority=NORMAL/);
  await expect(page.getByTestId("ticket-table")).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1550-ticket-dashboard.png", fullPage: true });
});

// v1.56.0 (D-332, owner): the coordinator board, status-wise.
test("the coordinator board shows where the ticket is now", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto("/users/tickets");
  await page.getByTestId("sidebar").getByRole("link", { name: "Coordinator board" }).click();
  await expect(page).toHaveURL(/\/users\/tickets\/board/);
  for (const status of ["NEW", "REOPENED", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION", "CLOSED"]) await expect(page.getByTestId(`board-column-${status}`)).toBeVisible();
  // The journey's ticket was confirmed and closed: it sits in Closed.
  await expect(page.getByTestId("board-column-CLOSED")).toContainText(subject);
  await page.locator("#board-q").fill(subject);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("board-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/v1560-coordinator-board.png", fullPage: true });
});

// v1.56.0 (D-334, owner): Ticket analytics, by access.
test("Analytics has a Ticket analytics board for the coordinator, with their form's tickets", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto("/users/analytics?board=tickets&period=custom&from=2026-01-01&to=2030-12-31");
  const board = page.getByTestId("ticket-analytics");
  await expect(board).toBeVisible();
  await expect(board.getByTestId("ticket-by-category")).toContainText("IT Hardware");
  // v1.59.4 (D-363, owner): Status by department has a table for each form, named after it.
  await expect(page.getByTestId("ticket-status-by-department")).toContainText(`${formName} issues status`);
  await page.screenshot({ path: "test-results/v1560-ticket-analytics.png", fullPage: true });
});

// v1.55.3 (D-331, owner): Ticket dashboards are for coordinators (and IT) only.
test("someone who coordinates no ticket form doesn't see Ticket dashboards", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/tickets");
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "My tickets" })).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "Ticket dashboards" })).toHaveCount(0);
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "Coordinator board" })).toHaveCount(0);
  const response = await page.goto("/users/tickets/dashboards");
  expect(response?.status()).toBe(404);
  expect((await page.goto("/users/tickets/board"))?.status()).toBe(404);
});

test("someone not involved can't open the ticket", async ({ page, context }) => {
  await as(context, "E2E_HOD");
  const response = await page.goto(ticketPath);
  expect(response?.status()).toBe(404);
});
