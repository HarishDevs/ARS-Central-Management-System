import { expect, test, type BrowserContext } from "@playwright/test";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.92.0 (26 Nov 2026), collaborators on tickets through the real screens.
// Owner (answering Q-036): "tickets get collaborators, like requests"; then
// the Collaborating screen's Tickets tab and the Commenter rule (D-434) apply
// (D-438..D-441). E2E_REQ raises a ticket and adds E2E_STAFF; E2E_STAFF finds
// it on Collaborating → Tickets, opens it (Back returns to the tab) and
// comments, as a Commenter without the Ticketing module and with full
// collaborator rights with it; removal takes it away at once.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const subject = `Shared ticket ${stamp}`;
let ticketId = 0;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
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
const BASE = "APPROVAL,TASK,PROJECT,INFORMATION,MEETING";
const setModules = (loginId: string, modules: string) => query("UPDATE users SET module_access = ? WHERE login_id = ?", [modules, loginId]);

test.beforeAll(async () => {
  // A published ticket form (IT Hardware, coordinator E2E_MGR) and a ticket raised by E2E_REQ.
  const req = await userIdByLogin("E2E_REQ");
  const mgr = await userIdByLogin("E2E_MGR");
  const conn = await db();
  try {
    const [type] = await conn.query<import("mysql2/promise").ResultSetHeader>("INSERT INTO module_types (module, code, name, created_by) VALUES ('TICKET', ?, ?, ?)", [`E2E_V192_${stamp.toUpperCase()}`, `E2E printer ${stamp}`, req]);
    const [version] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      "INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, published_at) VALUES (?, 1, 'PUBLISHED', '[]', ?, CURRENT_TIMESTAMP)",
      [type.insertId, JSON.stringify({ access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, defaultPriority: "NORMAL", requesterPriority: true })],
    );
    const [[category]] = await conn.query<import("mysql2/promise").RowDataPacket[]>("SELECT id FROM ticket_categories WHERE code = 'IT_HARDWARE'");
    await conn.query("INSERT INTO ticket_request_types (type_id, category_id) VALUES (?, ?)", [type.insertId, category!.id]);
    await conn.query("INSERT INTO ticket_coordinators (type_id, user_id, added_by) VALUES (?, ?, ?)", [type.insertId, mgr, req]);
    const [ticket] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      "INSERT INTO tickets (ticket_no, category_id, type_version_id, title, description, form_data_json, requester_id, priority, required_on, status, submission_key, submitted_at) VALUES (?, ?, ?, ?, 'The printer jams.', '{}', ?, 'HIGH', DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY), 'NEW', ?, UTC_TIMESTAMP())",
      [`IT-HW-E2E-${stamp}`.slice(0, 40), category!.id, version.insertId, subject, req, `e2e-${stamp}`],
    );
    ticketId = ticket.insertId;
  } finally {
    await conn.end();
  }
  await setModules("E2E_REQ", `${BASE},TICKET`);
  await setModules("E2E_STAFF", BASE);
});
test.afterAll(async () => {
  await setModules("E2E_REQ", BASE);
  await setModules("E2E_STAFF", BASE);
});

test("the raiser adds a collaborator on the ticket page with the people picker", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`/users/tickets/${ticketId}`);
  const card = page.getByTestId("ticket-collaborators");
  await expect(card.getByRole("heading", { name: "Collaborators" })).toBeVisible();
  await expect(card.getByText("Nobody yet.")).toBeVisible();
  await card.getByRole("combobox").fill("Sita");
  await page.getByRole("option", { name: /Sita Staff/ }).first().click();
  await card.getByRole("button", { name: "Add" }).click();
  // v1.80.0 (D-407): the result shows as a toast.
  await expect(page.getByText(/Added 1 collaborator; they have been told\./).first()).toBeVisible();
  await expect(card.getByText("Sita Staff", { exact: true })).toBeVisible();
  // The timeline records it.
  await expect(page.getByTestId("ticket-timeline")).toContainText("Collaborators added");
});

test("without the Ticketing module: the Tickets tab, the ticket as a Commenter, a remark, Back to the tab", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users/collaborating");
  const tabs = page.getByTestId("collab-tabs");
  await expect(tabs.getByTestId("collab-tab-tickets")).toBeVisible();
  await expect(page.getByTestId("collab-count-tickets")).toHaveText("1");
  await tabs.getByTestId("collab-tab-tickets").click();
  await expect(page).toHaveURL(/\/users\/collaborating\?tab=tickets$/);
  const row = page.getByTestId("collab-ticket-row").filter({ hasText: subject });
  await expect(row).toBeVisible();
  await expect(page.getByRole("table", { name: "Tickets you collaborate on" })).toContainText("IT Hardware");
  await row.getByRole("link", { name: subject }).click();
  await expect(page).toHaveURL(new RegExp(`/users/tickets/${ticketId}\\?from=`));
  await expect(page.getByTestId("commenter-badge")).toBeVisible();
  // No files, no assigning, no collaborator changes.
  const remark = page.getByTestId("ticket-remark");
  await expect(remark.locator("input[type=file]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Assign" })).toHaveCount(0);
  await expect(page.getByTestId("ticket-collaborators").getByRole("combobox")).toHaveCount(0);
  await expect(page.getByTestId("ticket-collaborators").getByRole("button", { name: /Stop following|Remove/ })).toHaveCount(0);
  await remark.getByRole("textbox", { name: "Remark" }).fill(`Commenter remark ${stamp}`);
  await remark.getByRole("button", { name: "Add remark" }).click();
  await expect(page.getByTestId("ticket-comments")).toContainText(`Commenter remark ${stamp}`);
  // Nothing else of Ticketing opens.
  // (Page access refuses a module's page in the shell, as v1910 checks for requests; the
  // ticket's own lists never show it.)
  for (const path of ["/users/tickets", "/users/tickets/new", "/users/tickets/board"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).not.toHaveText(/My tickets|New ticket|Raise a ticket|Coordinator board/);
    await expect(page.getByText(subject), path).toHaveCount(0);
  }
  await page.goto(`/users/collaborating?tab=tickets`);
  await page.getByTestId("collab-ticket-row").filter({ hasText: subject }).getByRole("link", { name: subject }).click();
  await page.getByTestId("return-to").click();
  await expect(page).toHaveURL(/\/users\/collaborating\?tab=tickets$/);
});

test("with the Ticketing module: no Commenter badge, files may be added, and the collaborator may stop following", async ({ page, context }) => {
  await setModules("E2E_STAFF", `${BASE},TICKET`);
  try {
    await as(context, "E2E_STAFF");
    await page.goto(`/users/tickets/${ticketId}`);
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    await expect(page.getByTestId("commenter-badge")).toHaveCount(0);
    await expect(page.getByTestId("ticket-remark").locator("input[type=file]").first()).toBeAttached();
    await expect(page.getByTestId("ticket-collaborators").getByRole("button", { name: "Stop following this ticket" })).toBeVisible();
    // Never assigns, starts or confirms.
    await expect(page.getByRole("heading", { name: "Assign" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your work on this ticket" })).toHaveCount(0);
  } finally {
    await setModules("E2E_STAFF", BASE);
  }
});

test("phone at 390: the Tickets tab draws cards and nothing scrolls sideways", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users/collaborating?tab=tickets");
  await expect(page.getByTestId("collab-ticket-row").filter({ hasText: subject })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".table-cards td[data-label='Status']").first()).toBeVisible();
});

test("removal takes the ticket and the tab away at once", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`/users/tickets/${ticketId}`);
  const card = page.getByTestId("ticket-collaborators");
  await card.getByRole("button", { name: "Remove Sita Staff" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(card.getByText("Nobody yet.")).toBeVisible();

  await as(context, "E2E_STAFF");
  const response = await page.goto(`/users/tickets/${ticketId}`);
  expect(response?.status()).toBe(404);
  await page.goto("/users/collaborating?tab=tickets");
  await expect(page.getByTestId("collab-tab-tickets")).toHaveCount(0);
  await expect(page.getByText(subject)).toHaveCount(0);
});
