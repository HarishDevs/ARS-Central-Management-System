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
async function setting(key: string, value: string) {
  const conn = await db();
  try {
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
  } finally {
    await conn.end();
  }
}

test.beforeAll(async () => {
  await setting("features.tickets", "ON");
});
// The switch is Off by default: put it back so other suites see the usual sidebar.
test.afterAll(async () => {
  await setting("features.tickets", "OFF");
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
  await expect(setup.getByText(/Saved: IT Hardware, 1 coordinator/)).toBeVisible();
  // The same builder as approvals: add a field, then publish.
  await page.getByRole("button", { name: /Short text/ }).first().click();
  await page.getByLabel("Field label").last().fill("Asset tag");
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
  await form.getByRole("textbox", { name: /Description/ }).fill("It shows a blue screen at start-up.");
  await form.getByLabel("Priority").selectOption("HIGH");
  await form.getByLabel("Asset tag").fill("LT-0042");
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
  await expect(assign.getByText(/Assigned to Sita Staff\. Task TSK-/)).toBeVisible();
  await page.reload();
  await expect(page.locator("main")).toContainText("Assigned");
  await expect(page.getByRole("link", { name: /^TSK-/ })).toBeVisible();
});

test("the assignee starts and completes the task with remarks; the ticket awaits confirmation", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto(ticketPath);
  await page.getByRole("link", { name: /^TSK-/ }).click();
  await expect(page).toHaveURL(/\/users\/tasks\/\d+/);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(/Done: /).first()).toBeVisible();
  await page.getByRole("textbox", { name: "Remarks" }).fill("Replaced the SSD and reinstalled Windows");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByText(/Done: /).first()).toBeVisible();
  await page.goto(ticketPath);
  await expect(page.locator("main")).toContainText(/Waiting for Ravi Requester to confirm/);
});

test("the requester confirms with a rating; the ticket closes", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(ticketPath);
  const confirm = page.getByTestId("confirm-ticket");
  await expect(page.getByRole("region", { name: /please confirm/ })).toContainText("Replaced the SSD and reinstalled Windows");
  await confirm.getByRole("radio", { name: "5 out of 5" }).click();
  await confirm.getByRole("button", { name: "Confirm and close" }).click();
  await expect(confirm.getByText("Thank you. The ticket is closed.")).toBeVisible();
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
  await page.getByLabel("Priority").selectOption("LOW");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/priority=LOW/);
  await expect(page.getByTestId("ticket-table")).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1550-ticket-dashboard.png", fullPage: true });
});

test("someone not involved can't open the ticket", async ({ page, context }) => {
  await as(context, "E2E_HOD");
  const response = await page.goto(ticketPath);
  expect(response?.status()).toBe(404);
});
