import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";
import { pickPerson } from "./people";

// v1.77.0 (D-404, owner's Task Summary decision 3, release 2): Ravi
// (E2E_REQ) shares his Task Summary with Sita (E2E_STAFF), who opens it
// read-only and sees only the task she may see; his manager Manoj (E2E_MGR)
// opens it from Ravi's profile; Ravi removes Sita and she is refused.
// Customise › Fields, and the Board / Calendar tab settings kept per tab.
// Axe in light and dark, and the phone width. "pm_foundations" is ON in e2e.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const T = (name: string) => `TS2 ${name} ${stamp}`;
const istDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
let ravi = 0;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}

async function cleanUp() {
  const conn = await db();
  try {
    const ids = await Promise.all(["E2E_REQ", "E2E_STAFF"].map((login) => userIdByLogin(login)));
    await conn.query("DELETE FROM task_summary_shares WHERE owner_id IN (?) OR viewer_id IN (?)", [ids, ids]);
    await conn.query("DELETE FROM user_settings WHERE user_id IN (?) AND setting_key = 'work.my_tasks.fields'", [ids]);
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
    // One from Sita (she may see it) and one from Elena (Sita may not); due yesterday, so they come first
    // (Overdue) however many tasks earlier specs gave Ravi.
    for (const [index, [name, from]] of ([["from Sita", sita], ["private from Elena", elena]] as [string, number][]).entries())
      await conn.query(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), ?, JSON_OBJECT())",
        [`TSS${stamp}-${index}`, Number(version!.id), T(name), from, ravi, from, new Date(`${istDay(-1)}T12:00:00+05:30`)],
      );
  } finally {
    await conn.end();
  }
});
test.afterAll(cleanUp);

test("Ravi shares his Task Summary with Sita (Invite needs a person); the dialog shows who can see it", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  // The picture opens his profile.
  await expect(page.getByTestId("my-tasks-avatar")).toHaveAttribute("href", `/users/people/${ravi}`);
  await page.getByTestId("my-share").click();
  const dialog = page.getByTestId("my-share-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("share-invite")).toBeDisabled();
  // His manager is listed as always able to open it.
  await expect(dialog.getByTestId("share-manager")).toContainText("Manoj Manager");
  expect(await axe(page)).toEqual([]);
  await pickPerson(page, dialog.getByTestId("share-person"), "Sita Staff");
  await expect(dialog.getByTestId("share-invite")).toBeEnabled();
  await dialog.getByTestId("share-invite").click();
  await expect(page.getByText(/Shared with Sita Staff/)).toBeVisible();
  await expect(dialog.getByTestId("share-person-row")).toContainText("Sita Staff");
});

test("Sita opens it read-only: only the task she may see, no edit controls", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  // The switcher lists Ravi under "Shared with you".
  await page.getByTestId("summary-switcher").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitemradio", { name: /Ravi Requester/ }).click();
  await expect(page).toHaveURL(new RegExp(`of=${ravi}`));
  await expect(page.getByTestId("summary-readonly")).toContainText("Viewing: Ravi Requester's Task Summary · read-only");
  const grid = page.getByTestId("my-grid");
  await expect(grid.getByText(T("from Sita"))).toBeVisible();
  await expect(page.locator("body")).not.toContainText(T("private from Elena"));
  // No way to change anything.
  await expect(page.getByTestId("my-share")).toHaveCount(0);
  await expect(page.getByTestId("my-customise")).toHaveCount(0);
  await expect(page.getByTestId("tab-settings")).toHaveCount(0);
  await expect(grid.getByTestId("add-task-split")).toHaveCount(0);
  await expect(page.getByTestId("add-tab")).toHaveCount(0);
  await expect(grid.getByRole("checkbox", { name: new RegExp(T("from Sita")) })).toBeDisabled();
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  // Tabs keep ?of= ; the Board is read-only too.
  await page.getByTestId("view-tabs").getByRole("link", { name: /^Board/ }).click();
  await expect(page).toHaveURL(new RegExp(`of=${ravi}.*view=board|view=board.*of=${ravi}`));
  await expect(page.getByTestId("my-board")).toContainText(T("from Sita"));
  // No selection boxes; the tick is there but can't be used.
  await expect(page.getByTestId("my-board").getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
  await expect(page.getByTestId("my-board").getByRole("checkbox", { name: new RegExp(T("from Sita")) })).toBeDisabled();
  // Back to her own.
  await page.getByTestId("summary-back").click();
  await expect(page.getByTestId("summary-readonly")).toHaveCount(0);
  // Phone width: the read-only page fits.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/users/work/my-tasks?of=${ravi}`);
  await expect(page.getByTestId("summary-readonly")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("his manager opens it from his profile and sees every task", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/people/${ravi}`);
  await page.getByTestId("person-view-summary").click();
  await expect(page.getByTestId("summary-readonly")).toContainText("they report to you");
  await expect(page.getByTestId("my-grid").getByText(T("private from Elena"))).toBeVisible();
  // A colleague without access gets no button on the profile.
  await as(context, "E2E_HOD");
  await page.goto(`/users/people/${ravi}`);
  await expect(page.getByTestId("person-card")).toBeVisible();
  await expect(page.getByTestId("person-view-summary")).toHaveCount(0);
  await page.goto(`/users/work/my-tasks?of=${ravi}`);
  await expect(page.getByTestId("summary-no-access")).toBeVisible();
});

test("Ravi removes Sita; she is refused", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/my-tasks");
  await page.getByTestId("my-share").click();
  const dialog = page.getByTestId("my-share-dialog");
  await dialog.getByTestId("share-remove").click();
  await expect(page.getByText(/can no longer open/)).toBeVisible();
  await expect(dialog.getByTestId("share-person-row")).toHaveCount(0);
  await as(context, "E2E_STAFF");
  await page.goto(`/users/work/my-tasks?of=${ravi}`);
  await expect(page.getByTestId("summary-no-access")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(T("from Sita"));
});

test("Customise › Fields hides a column; Board and Calendar tabs keep their settings", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  const grid = page.getByTestId("my-grid");
  await expect(grid.getByRole("columnheader", { name: /Priority/ })).toBeVisible();
  await page.getByTestId("my-customise").click();
  const panel = page.getByTestId("my-customise-panel");
  await expect(panel.getByTestId("my-fields")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await panel.getByTestId("field-priority").uncheck();
  await panel.getByTestId("my-fields-save").click();
  await expect(page.getByText(/Columns saved/)).toBeVisible();
  await page.reload();
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: /Priority/ })).toHaveCount(0);

  // Board: Filter › Show completed tasks, saved with the tab.
  await page.getByTestId("view-tabs").getByRole("link", { name: /^Board/ }).click();
  const toolbar = page.getByTestId("summary-board-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByTestId("board-filter").locator("summary").click();
  await toolbar.getByTestId("board-show-completed").check();
  await page.keyboard.press("Escape");
  await expect(toolbar.getByTestId("board-filter").locator("summary")).toContainText("Filters: 1");
  await expect(page.getByTestId("my-board")).not.toContainText(T("from Sita"));
  // Saved a second after the change (the first save stores the built-in tabs and refreshes).
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.getByTestId("summary-board-toolbar").getByTestId("board-filter").locator("summary")).toContainText("Filters: 1");
  expect(await axe(page)).toEqual([]);

  // Calendar: Options › Show weekends off, saved with the tab.
  await page.getByTestId("view-tabs").getByRole("link", { name: /^Calendar/ }).click();
  await expect(page.getByTestId("task-calendar")).toBeVisible();
  await page.getByTestId("calendar-options").locator("button[aria-haspopup]").click();
  await page.getByTestId("calendar-weekends").click();
  await expect(page.locator("[data-weekends]")).toHaveAttribute("data-weekends", "off");
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.locator("[data-weekends]")).toHaveAttribute("data-weekends", "off");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axe(page)).toEqual([]);
});
