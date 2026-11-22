import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.76.0 (D-401, owner's Task Summary decisions, release 1): the owner's
// screenshot set up end to end: tabs "Pending Today", "Overdue", "Pending
// Tasks" (All my open tasks) and "Assigner" (grouped by Created by); the
// Filters / Sorts / Groups chips; My sections with the rules and the pane's
// section picker; the CSV download; duplicate personal tab names; axe in light
// and dark; the phone layout. "pm_foundations" is ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const T = (name: string) => `TS ${name} ${stamp}`;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const tabNames = (page: Page) => page.getByTestId("view-tabs").getByTestId("view-tab").locator("a").allInnerTexts();
const istDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

async function cleanUp() {
  const conn = await db();
  try {
    const id = await userIdByLogin("E2E_STAFF");
    await conn.query("DELETE FROM work_views WHERE scope = 'MY_TASKS' AND scope_id = ?", [id]);
    await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.my_tabs_set'", [id]);
    await conn.query("DELETE FROM my_task_placements WHERE user_id = ?", [id]);
    await conn.query("DELETE FROM my_task_rules WHERE user_id = ?", [id]);
    await conn.query("DELETE FROM my_task_sections WHERE user_id = ?", [id]);
  } finally {
    await conn.end();
  }
}

test.beforeAll(async () => {
  await cleanUp();
  const conn = await db();
  try {
    const me = await userIdByLogin("E2E_STAFF");
    const from = await userIdByLogin("E2E_REQ");
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const tasks: [string, number][] = [
      ["late", -2],
      ["today", 0],
      ["soon", 3],
      ["far", 40],
    ];
    for (const [index, [name, offset]] of tasks.entries())
      await conn.query(
        // Given 10 days ago, so D-369's "Recently assigned (3 days)" doesn't pull the far one into the summary window.
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY), ?, JSON_OBJECT())",
        [`TS${stamp}-${index}`, Number(version!.id), T(name), from, me, from, new Date(`${istDay(offset)}T12:00:00+05:30`)],
      );
  } finally {
    await conn.end();
  }
});
test.afterAll(cleanUp);

async function addListTab(page: Page, name: string) {
  const before = page.url();
  await page.getByTestId("add-tab").locator("button[aria-haspopup]").click();
  await page.getByTestId("add-tab-list").click();
  await expect.poll(() => page.url()).not.toBe(before);
  await expect(page).toHaveURL(/my-tasks\?tab=\d+/);
  const id = new URL(page.url()).searchParams.get("tab")!;
  // The new tab, found by its address (names may repeat).
  const tab = page.getByTestId("view-tab").filter({ has: page.locator(`a[href$="?tab=${id}"]`) });
  await expect(tab).toBeVisible();
  await tab.getByTestId("tab-menu").locator("button[aria-haspopup]").click();
  await tab.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("tab-rename").fill(name);
  await page.getByTestId("tab-rename").press("Enter");
  await expect(tab.getByRole("link")).toHaveText(new RegExp(`^${name}`));
  await expect(page.getByTestId("my-grid")).toBeVisible();
  return id;
}

test("the owner's tabs: range per tab, chips, grouping by Created by, duplicate names, auto-save", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await expect.poll(() => tabNames(page)).toEqual(["List", "Board", "Calendar"]);
  const grid = page.getByTestId("my-grid");
  // The default window: the far task isn't listed.
  await expect(grid.getByText(T("soon"))).toBeVisible();
  await expect(grid.getByText(T("far"))).toHaveCount(0);

  await addListTab(page, "Pending Today");
  await addListTab(page, "Overdue");
  await addListTab(page, "Pending Tasks");
  // "Pending Tasks" shows All my open tasks: the far task appears, under Due later.
  await expect(page).toHaveURL(/tab=\d+/);
  await page.getByTestId("tab-range").selectOption("all");
  await expect(grid.getByText(T("far"))).toBeVisible();
  await expect(grid.getByRole("rowgroup", { name: "Due later" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("tab-range")).toHaveValue("all");

  await addListTab(page, "Assigner");
  await expect(page.getByTestId("tab-range")).toHaveValue("summary");
  // Group by Created by: "Groups: 1" with × (spec §3.8); saved by itself.
  await grid.getByTestId("group-menu").locator("summary").click();
  await grid.getByTestId("group-by").selectOption("createdBy");
  await page.keyboard.press("Escape");
  await expect(grid.getByTestId("group-menu").locator("summary")).toContainText("Groups: 1");
  await expect(grid.getByRole("rowgroup", { name: "Ravi Requester" })).toBeVisible();
  await expect(grid.getByTestId("auto-save")).toContainText("Saved");
  // Filters and Sorts chips, each with a ×.
  await grid.getByTestId("sort-menu").locator("button[aria-haspopup]").click();
  await grid.getByRole("menuitemradio", { name: "Alphabetical" }).click();
  await page.keyboard.press("Escape");
  await expect(grid.getByTestId("sort-menu")).toContainText("Sorts: 1");
  await grid.getByRole("button", { name: "Clear sort" }).click();
  await expect(grid.getByTestId("sort-menu").locator("button[aria-haspopup]")).toHaveText("Sort");
  await expect(grid.getByTestId("auto-save")).toContainText("Saved");
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(grid.getByTestId("group-menu").locator("summary")).toContainText("Groups: 1");
  await grid.getByRole("button", { name: "Clear groups" }).click();
  await expect(grid.getByTestId("group-menu").locator("summary")).toContainText("Group");
  // Reset goes back to the starting view.
  await grid.getByTestId("reset-view").click();
  await expect(grid.getByRole("rowgroup", { name: "Overdue" })).toBeVisible();

  // Task visibility: a task in no project reads "Collaborators", with the hierarchy tooltip.
  await expect(grid.getByTestId("visibility-cell").first()).toHaveAttribute("title", /managers above the assignee/);

  // A second "Overdue" tab: personal tab names may repeat.
  await addListTab(page, "Overdue");
  await expect.poll(async () => (await tabNames(page)).filter((name) => name.startsWith("Overdue")).length).toBe(2);
  expect(await axe(page)).toEqual([]);
});

test("My sections with rules, the pane's section picker, and the CSV download", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await page.getByTestId("view-tabs").getByRole("link", { name: /^Pending Tasks/ }).click();
  const grid = page.getByTestId("my-grid");
  await expect(grid).toBeVisible();
  // Rules first (Customise ▸ Rules): Upcoming within 5 working days.
  await page.getByTestId("my-customise").click();
  const panel = page.getByTestId("my-customise-panel");
  await expect(panel).toBeVisible();
  await panel.getByTestId("rule-upcoming-days").fill("5");
  await panel.getByTestId("my-rules-save").click();
  await expect(page.getByText(/Rules saved/)).toBeVisible();
  // Group by My sections: Add ▸ Section is offered only then.
  await grid.getByTestId("group-menu").locator("summary").click();
  await grid.getByTestId("group-by").selectOption("mySection");
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("rowgroup", { name: "Recently assigned" })).toBeVisible();
  await expect(grid.getByTestId("auto-save")).toContainText("Saved");
  await page.waitForTimeout(1200);
  await page.reload();
  // The rules moved today's task to Today and the soon one to Upcoming; the far one stays in Recently assigned; the late one shows in Overdue.
  await expect(grid.getByRole("rowgroup", { name: "Today" })).toContainText(T("today"));
  await expect(grid.getByRole("rowgroup", { name: "Upcoming" })).toContainText(T("soon"));
  await expect(grid.getByRole("rowgroup", { name: "Recently assigned" })).toContainText(T("far"));
  await expect(grid.getByRole("rowgroup", { name: "Overdue" })).toContainText(T("late"));

  // Add a section from Add task ▾.
  page.once("dialog", (dialog) => void dialog.accept(`Waiting ${stamp}`));
  await page.getByTestId("add-task-more").locator("button[aria-haspopup]").click();
  await page.getByTestId("add-section-menu").click();
  await expect(grid.getByRole("rowgroup", { name: `Waiting ${stamp}` })).toBeVisible();

  // The pane's section picker moves the far task to Later.
  await grid.getByRole("link", { name: T("far") }).click();
  const picker = page.getByTestId("task-pane").getByTestId("my-section-picker");
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: "Later" });
  await expect(page.getByText("Moved. Only you see your sections.")).toBeVisible();
  const closed = new URL(page.url());
  closed.searchParams.delete("task");
  await page.goto(closed.toString());
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  await expect(grid.getByRole("rowgroup", { name: "Later" })).toContainText(T("far"));
  // The activity note of a rule's move is there for the person.
  expect(await axe(page)).toEqual([]);

  // CSV of this tab: Title ▾ ▸ Sync / export ▸ CSV downloads at once.
  const actions = page.getByTestId("my-tasks-actions");
  await actions.locator("button[aria-haspopup]").first().click();
  await actions.getByRole("menuitem", { name: /Sync \/ export/ }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), actions.getByRole("menuitem", { name: /^CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^task-summary-Pending-Tasks-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("Task no.,Task,Due date");
  expect(text).toContain(T("far"));
  expect(text).toContain("Later");
});

test("dark mode and the phone layout", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await page.getByTestId("view-tabs").getByRole("link", { name: /^Pending Tasks/ }).click();
  await expect(page.getByTestId("my-grid")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByTestId("my-customise").click();
  await expect(page.getByTestId("my-customise-panel")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/users/work/my-tasks");
  await expect(page.locator("body")).toContainText(T("today"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
