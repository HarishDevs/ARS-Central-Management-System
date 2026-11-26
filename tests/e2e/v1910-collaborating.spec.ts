import { expect, test, type BrowserContext } from "@playwright/test";
import { db, raisePurchase, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.91.0 (26 Nov 2026), the common Collaborating screen through the real
// screens. D-433 (owner: "Separate the collaborators screen from approvals and
// make it common for all like we have for calendar and analytics ... tasks,
// approvals, tickets as tabs"): a top-level sidebar item beside Calendar, a tab
// per module with its count, rows that open the item the usual way and Back
// to the tab, phone cards. D-434 (owner: "if I am added as a collaborator I
// should be able to open and access that approval" / "in this case I am a
// commenter"): without the module the person opens the item as a Commenter.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const requestTitle = `Shared purchase ${stamp}`;
const taskTitle = `Shared task ${stamp}`;
let requestId = 0;
let taskId = 0;

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
const ALL = "APPROVAL,TASK,PROJECT,INFORMATION,MEETING";
const setModules = (loginId: string, modules: string) => query("UPDATE users SET module_access = ? WHERE login_id = ?", [modules, loginId]);

test("set-up: E2E_REQ shares a request and a task with E2E_STAFF", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const path = await raisePurchase(page, requestTitle);
  requestId = Number(path.split("/").pop());
  await createProject(page, `Collab project ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(taskTitle);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: taskTitle }).first()).toBeVisible();
  taskId = (await query<{ id: number }>("SELECT id FROM tasks WHERE title = ?", [taskTitle]))[0]!.id;
  const staff = await userIdByLogin("E2E_STAFF");
  const req = await userIdByLogin("E2E_REQ");
  await query("INSERT INTO request_collaborators (request_id, user_id, added_by) VALUES (?, ?, ?)", [requestId, staff, req]);
  await query("INSERT INTO task_followers (task_id, user_id, source, added_by) VALUES (?, ?, 'MANUAL', ?)", [taskId, staff, req]);
});

test("the sidebar: Collaborating is a top-level item beside Calendar, not under My Approvals", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users");
  const main = page.getByRole("navigation", { name: "Main" }).first();
  const link = main.getByRole("link", { name: "Collaborating", exact: true });
  await expect(link).toBeVisible();
  await expect(page.getByTestId("nav-group-My Approvals").getByRole("link", { name: "Collaborating" })).toHaveCount(0);
  const hrefs = await main.locator("a[href^='/users/']").evaluateAll((links) => links.map((item) => item.getAttribute("href")));
  expect(hrefs.indexOf("/users/collaborating")).toBe(hrefs.indexOf("/users/calendar") - 1);
});

test("tabs with counts; each tab lists and opens its items; Back returns to the tab", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users/collaborating");
  const tabs = page.getByTestId("collab-tabs");
  await expect(tabs.getByTestId("collab-tab-approvals")).toBeVisible();
  await expect(tabs.getByTestId("collab-tab-tasks")).toBeVisible();
  await expect(page.getByTestId("collab-count-approvals")).toHaveText(/^[1-9]\d*$/);
  await expect(page.getByTestId("collab-count-tasks")).toHaveText(/^[1-9]\d*$/);

  // Tasks: the row opens the task in the side pane; closing it keeps the tab.
  await tabs.getByTestId("collab-tab-tasks").click();
  await expect(page).toHaveURL(/\/users\/collaborating\?tab=tasks$/);
  await expect(tabs.getByTestId("collab-tab-tasks")).toHaveAttribute("aria-current", "page");
  const row = page.getByTestId("collab-task-row").filter({ hasText: taskTitle });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: taskTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/users/collaborating\\?tab=tasks&task=${taskId}$`));
  await expect(page.getByTestId("pane-bar")).toBeVisible();
  await page.getByTestId("close-pane").click();
  await expect(page).toHaveURL(/\/users\/collaborating\?tab=tasks$/);

  // Search on the Tasks tab.
  await page.goto(`/users/collaborating?tab=tasks&q=${encodeURIComponent("no such task anywhere")}`);
  await expect(page.getByText("No task matches")).toBeVisible();

  // Approvals: the request page, and its Back returns to the Approvals tab.
  await page.goto("/users/collaborating?tab=approvals");
  await page.getByRole("link", { name: requestTitle }).first().click();
  await expect(page).toHaveURL(new RegExp(`/users/requests/${requestId}`));
  await page.getByTestId("back-to-list").click();
  await expect(page).toHaveURL(/\/users\/collaborating\?tab=approvals$/);
});

test("phone at 390: the Tasks tab draws cards and nothing scrolls sideways", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users/collaborating?tab=tasks");
  await expect(page.getByTestId("collab-task-row").filter({ hasText: taskTitle })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".table-cards td[data-label='Status']").first()).toBeVisible();
});

test("Tasks switched off for everyone: no Tasks tab, and a forced ?tab=tasks falls back", async ({ page, context }) => {
  await query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.tasks', 'FEATURES', 'STRING', FALSE, 'OFF') ON DUPLICATE KEY UPDATE value = 'OFF'");
  try {
    await as(context, "E2E_STAFF");
    await page.goto("/users/collaborating?tab=tasks");
    await expect(page.getByTestId("collab-tab-approvals")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("collab-tab-tasks")).toHaveCount(0);
    await expect(page.getByText(taskTitle)).toHaveCount(0);
  } finally {
    await query("DELETE FROM system_settings WHERE setting_key = 'features.tasks'");
  }
});

test("without the modules, a collaborator opens the items as a Commenter and nothing else", async ({ page, context }) => {
  await setModules("E2E_STAFF", "");
  try {
    await as(context, "E2E_STAFF");
    await page.goto("/users/collaborating");
    await expect(page.getByTestId("collab-tab-approvals")).toBeVisible();
    await expect(page.getByTestId("collab-tab-tasks")).toBeVisible();

    // The request: read and comment; no file upload, no collaborator changes.
    await page.goto(`/users/requests/${requestId}`);
    await expect(page.getByTestId("commenter-badge")).toBeVisible();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await page.getByLabel("Add a comment").fill(`Commenter note ${stamp}`);
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByTestId("request-comment").filter({ hasText: `Commenter note ${stamp}` })).toBeVisible();

    // The task: its own page (no pane without the module), read and comment.
    await page.goto(`/users/tasks/${taskId}`);
    await expect(page.getByTestId("commenter-badge").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Attach files/i })).toHaveCount(0);

    // Nothing else of the modules opens.
    for (const path of ["/users/requests", "/users/queue", "/users/custom", "/users/tasks"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).not.toHaveText(/My pending requests|Waiting for me|New request|Assigned to me/);
    }
  } finally {
    await setModules("E2E_STAFF", ALL);
  }
});

test("no module and no collaboration: no sidebar item, and the address isn't there", async ({ page, context }) => {
  await setModules("E2E_HOD", "");
  try {
    await as(context, "E2E_HOD");
    await page.goto("/users");
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Collaborating", exact: true })).toHaveCount(0);
    const response = await page.goto("/users/collaborating");
    expect(response?.status()).toBe(404);
  } finally {
    await setModules("E2E_HOD", ALL);
  }
});
