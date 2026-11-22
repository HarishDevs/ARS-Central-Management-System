import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.78.0 (D-405, Task Summary release 3): Ravi (E2E_REQ) adds Dashboard,
// Files and Notes tabs; Sita (E2E_STAFF), refused, asks for access; Ravi
// grants it from the notice's Share dialog; Sita sees his Dashboard and Files
// limited to what she may see and his Notes stay private. His manager Manoj
// (E2E_MGR) sees the Tasks card on Ravi's profile; Hari (E2E_HOD) doesn't.
// The Create task draft survives a reload; person groups show the employee
// code; the Sort menu has no Assignee. Axe light/dark and phone width.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const T = (name: string) => `TS3 ${name} ${stamp}`;
const istDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
let ravi = 0;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
async function addTab(page: Page, type: "dashboard" | "files" | "notes") {
  await page.getByTestId("add-tab").locator("button[aria-haspopup]").click();
  await page.getByTestId(`add-tab-${type}`).click();
  await expect(page).toHaveURL(/my-tasks\?tab=\d+/);
}

async function cleanUp() {
  const conn = await db();
  try {
    const ids = await Promise.all(["E2E_REQ", "E2E_STAFF"].map((login) => userIdByLogin(login)));
    await conn.query("DELETE FROM task_summary_shares WHERE owner_id IN (?) OR viewer_id IN (?)", [ids, ids]);
    await conn.query("DELETE FROM task_summary_access_requests WHERE owner_id IN (?) OR requester_id IN (?)", [ids, ids]);
    await conn.query("DELETE FROM task_summary_notes WHERE user_id IN (?)", [ids]);
    // v1.80.0: the two stand-in files have no bytes on disk; leave none behind for the site audit's download check.
    await conn.query("DELETE FROM record_files WHERE stored_path LIKE 'e2e/%' AND sha256 = REPEAT('0', 64)");
    for (const id of ids) {
      await conn.query("DELETE FROM work_views WHERE scope = 'MY_TASKS' AND scope_id = ?", [id]);
      await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.my_tabs_set'", [id]);
    }
  } finally {
    await conn.end();
  }
}

test.beforeAll(async () => {
  await cleanUp();
  ravi = await userIdByLogin("E2E_REQ");
  const sita = await userIdByLogin("E2E_STAFF");
  const elena = await userIdByLogin("E2E_ADMIN");
  const conn = await db();
  try {
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    for (const [index, [name, from]] of ([["from Sita", sita], ["private from Elena", elena]] as [string, number][]).entries()) {
      const [created] = await conn.query<{ insertId: number } & RowDataPacket[]>(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), ?, JSON_OBJECT())",
        [`TS3${stamp}-${index}`, Number(version!.id), T(name), from, ravi, from, new Date(`${istDay(-1)}T12:00:00+05:30`)],
      );
      await conn.query("INSERT INTO record_files (entity_type, entity_id, purpose, uploaded_by, original_name, stored_path, content_type, size_bytes, sha256) VALUES ('TASK', ?, 'GENERAL', ?, ?, ?, 'text/plain', 10, ?)", [
        (created as unknown as { insertId: number }).insertId,
        from,
        `${name.replace(/\s+/g, "-")}-${stamp}.txt`,
        `e2e/${stamp}-${index}`,
        "0".repeat(64),
      ]);
    }
  } finally {
    await conn.end();
  }
});
test.afterAll(cleanUp);

test("Ravi adds Dashboard, Files and Notes tabs; notes save by themselves and stay after a reload", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await addTab(page, "dashboard");
  const dashboard = page.getByTestId("summary-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(dashboard.getByTestId("dash-number-overdue")).not.toContainText(/^0/);
  await expect(dashboard.getByTestId("dash-chart-due")).toBeVisible();
  await dashboard.getByTestId("dash-range-90d").click();
  await expect(page).toHaveURL(/range=90d/);
  await expect(dashboard.getByTestId("dash-chart-completed")).toContainText("each week");
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500); // the theme's colour transition settles
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });

  await addTab(page, "files");
  const files = page.getByTestId("files-tab");
  await expect(files).toContainText(`from-Sita-${stamp}.txt`);
  await expect(files).toContainText(`private-from-Elena-${stamp}.txt`);
  expect(await axe(page)).toEqual([]);

  await addTab(page, "notes");
  const notes = page.getByTestId("summary-notes");
  await expect(notes).toContainText("Only you can read these");
  const editor = notes.getByRole("textbox", { name: "My notes" });
  await editor.click();
  await editor.pressSequentially(`Call the supplier ${stamp}`);
  await expect(page.getByTestId("summary-notes-state")).toContainText("All changes saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("summary-notes")).toContainText(`Call the supplier ${stamp}`);
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500); // the theme's colour transition settles
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 812 });
  await noSideScroll(page);
});

test("Sita, refused, asks for access; Ravi grants it from Share; she sees only what she may see, never his notes", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/work/my-tasks?of=${ravi}`);
  await expect(page.getByTestId("summary-no-access")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByLabel(/Note to Ravi Requester/).fill("For the plant review");
  await page.getByTestId("summary-request-access").click();
  await expect(page.getByTestId("summary-request-sent")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("summary-request-sent")).toBeVisible(); // asked already: no second request
  await page.setViewportSize({ width: 375, height: 812 });
  await noSideScroll(page);

  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks?share=requests");
  const dialog = page.getByTestId("my-share-dialog");
  await expect(dialog).toBeVisible();
  const request = dialog.getByTestId("share-request-row");
  await expect(request).toContainText("Sita Staff");
  await expect(request).toContainText("For the plant review");
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500); // the theme's colour transition settles
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  await request.getByTestId("share-request-grant").click();
  await expect(page.getByText(/Shared with Sita Staff/)).toBeVisible();
  await expect(dialog.getByTestId("share-request-row")).toHaveCount(0);
  await expect(dialog.getByTestId("share-person-row")).toContainText("Sita Staff");

  await as(context, "E2E_STAFF");
  await page.goto(`/users/work/my-tasks?of=${ravi}`);
  await expect(page.getByTestId("summary-readonly")).toBeVisible();
  const tabs = page.getByTestId("view-tabs");
  await tabs.getByRole("link", { name: /^Files/ }).click();
  await expect(page.getByTestId("files-tab")).toContainText(`from-Sita-${stamp}.txt`);
  await expect(page.locator("body")).not.toContainText(`private-from-Elena-${stamp}.txt`);
  await tabs.getByRole("link", { name: /^Dashboard/ }).click();
  await expect(page.getByTestId("summary-dashboard")).toContainText("Counts only the tasks you may see");
  expect(await axe(page)).toEqual([]);
  await tabs.getByRole("link", { name: /^Notes/ }).click();
  await expect(page.getByTestId("summary-notes-private")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(`Call the supplier ${stamp}`);
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  await noSideScroll(page);
});

test("the profile's Tasks card: his manager sees it with every task; a colleague without access doesn't", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/people/${ravi}`);
  const card = page.getByTestId("person-tasks-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("person-tasks-all")).toHaveAttribute("href", `/users/work/my-tasks?of=${ravi}`);
  await expect(card).toContainText(T("private from Elena"));
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500); // the theme's colour transition settles
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 812 });
  await noSideScroll(page);

  await as(context, "E2E_HOD");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/people/${ravi}`);
  await expect(page.getByTestId("person-card")).toBeVisible();
  await expect(page.getByTestId("person-tasks-card")).toHaveCount(0);

  // Ravi's own profile: "My tasks".
  await as(context, "E2E_REQ");
  await page.goto(`/users/people/${ravi}`);
  await expect(page.getByTestId("person-tasks-card")).toContainText("My tasks");
});

test("the Create task draft survives a reload; Discard clears it", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await page.getByRole("button", { name: "Add task", exact: true }).first().click();
  const dialog = page.getByTestId("create-dialog");
  await dialog.getByLabel("Task name").fill(T("draft kept"));
  await page.reload();
  const restored = page.getByTestId("create-dialog");
  await expect(restored).toBeVisible();
  await restored.getByRole("button", { name: "Expand" }).click();
  await expect(restored.getByLabel("Task name")).toHaveValue(T("draft kept"));
  expect(await axe(page)).toEqual([]);
  await restored.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByTestId("create-dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("my-grid")).toBeVisible();
  await expect(page.getByTestId("create-dialog")).toHaveCount(0);
});

test("grouped by Created by, a heading shows the employee code; the Sort menu has no Assignee", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks?view=list");
  const grid = page.getByTestId("my-grid");
  await grid.getByTestId("group-menu").locator("summary").click();
  await grid.getByTestId("group-by").selectOption("createdBy");
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("rowgroup", { name: "Sita Staff · E2E_STAFF" })).toBeVisible();
  await grid.getByTestId("sort-menu").locator("button[aria-haspopup]").click();
  await expect(page.getByRole("menuitemradio", { name: "Due date" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Assignee", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await grid.getByRole("button", { name: "Clear groups" }).click();
});
