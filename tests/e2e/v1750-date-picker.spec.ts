import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, typeCreateDue, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";
import { addDays, addMonths, weekStart } from "../../features/ui/date-range";

// v1.75.0 (D-399, D-400) through the real screens: the shared date range
// picker in Create task (keyboard and mouse, start and due), the project's
// From and To from the header, the holiday question still asked, Escape back
// to the button, the phone's bottom sheet, the task pane's new layout, a
// repeating task for someone else, and axe in light and dark.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
let projectUrl = "";

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light") {
  await context.clearCookies();
  if (theme) {
    const conn = await db();
    await conn.query("DELETE FROM user_settings WHERE setting_key = 'ui.theme' AND user_id = ?", [await userIdByLogin(loginId)]);
    await conn.end();
  }
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
async function rows<T = RowDataPacket>(query: string, params: unknown[]): Promise<T[]> {
  const conn = await db();
  try {
    return (await conn.query<RowDataPacket[]>(query, params))[0] as T[];
  } finally {
    await conn.end();
  }
}
async function openDraft(page: Page): Promise<Locator> {
  const create = page.getByTestId("create-menu");
  await expect(async () => {
    if ((await create.getByRole("button", { name: "Create" }).getAttribute("aria-expanded")) !== "true") await create.getByRole("button", { name: "Create" }).click();
    await expect(create.getByRole("menuitem", { name: /^Task/ })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await create.getByRole("menuitem", { name: /^Task/ }).click();
  const dialog = page.getByTestId("create-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const taskRow = (title: string) => rows<{ id: number; start: string | null; due: string; assignee_id: number; recurrence_json: unknown }>("SELECT id, DATE_FORMAT(starts_on, '%Y-%m-%d') AS start, DATE_FORMAT(DATE_ADD(due_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS due, assignee_id, recurrence_json FROM tasks WHERE title = ?", [title]);

test("Create task: start and due by keyboard, Escape returns to the button, the range is announced (axe light)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/users/work/my-tasks");
  const dialog = await openDraft(page);
  const title = `Keyboard range ${stamp}`;
  await dialog.getByLabel("Task name").fill(title);
  const button = dialog.getByTestId("create-dates-button");
  await button.focus();
  await page.keyboard.press("Enter");
  const picker = dialog.getByRole("dialog", { name: "Task dates" });
  await expect(picker).toBeVisible();
  const grid = picker.getByRole("grid");
  await expect(grid.locator("[role=gridcell][tabindex='0']")).toBeFocused();
  // Monday-first: the first column is Monday.
  expect(await grid.getByRole("columnheader").first().getAttribute("aria-label")).toBe("Monday");
  expect(await axe(page, "[data-testid=create-dates-panel]")).toEqual([]);
  // "+ Start date" by keyboard, then back to the grid: a month on (PageDown), Home (Monday) picks the start, two days on the due date.
  await picker.getByTestId("create-dates-add-start").focus();
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("textbox", { name: "Start date" })).toBeVisible();
  await grid.locator("[role=gridcell][tabindex='0']").focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  const start = weekStart(addMonths(indiaToday(), 1));
  const due = addDays(start, 2);
  await expect(dialog.getByRole("status").filter({ hasText: /^Start / })).toHaveText(/^Start \d+ \w{3}( \d{4})?, due \d+ \w{3}/);
  await expect(grid.locator(`[data-day="${start}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator(`[data-day="${due}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator(`[data-day="${addDays(start, 1)}"]`)).toHaveAttribute("data-role", "inside");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(dialog).toBeVisible(); // Escape closed only the picker
  await page.screenshot({ path: "test-results/date-picker-create.png" });
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect.poll(async () => (await taskRow(title))[0]?.start ?? null).toBe(start);
  expect((await taskRow(title))[0]?.due).toBe(due);
});

test("Create task: start and due by mouse with the hover preview; the pane shows the range in its new layout (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1366, height: 900 });
  projectUrl = await createProject(page, `Dates ${stamp}`);
  await page.goto(projectUrl);
  const dialog = await openDraft(page);
  const title = `Mouse range ${stamp}`;
  await dialog.getByLabel("Task name").fill(title);
  await dialog.getByRole("button", { name: /^Project:/ }).click();
  await dialog.getByRole("combobox", { name: "Project" }).selectOption({ label: `Dates ${stamp}` });
  await dialog.getByTestId("create-dates-button").click();
  const picker = dialog.getByRole("dialog", { name: "Task dates" });
  await picker.getByTestId("create-dates-add-start").click();
  await picker.getByRole("button", { name: "Next month" }).click();
  const shown = await picker.getByRole("heading").textContent();
  const first = weekStart(addMonths(indiaToday(), 1).slice(0, 8) + "15");
  const start = first;
  const due = addDays(first, 3);
  // The grid follows the "Next month" button; pick days of that month's third week.
  expect(shown).toBeTruthy();
  await picker.locator(`[data-day="${start}"]`).click();
  await picker.locator(`[data-day="${addDays(start, 2)}"]`).hover();
  await expect(picker.locator(`[data-day="${addDays(start, 1)}"]`)).toHaveAttribute("data-role", "inside"); // the preview
  await picker.locator(`[data-day="${due}"]`).click();
  await picker.getByTestId("create-dates-done").click();
  await expect(dialog.getByTestId("create-dates-button")).toContainText("–");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(/\?task=\d+/);
  const pane = page.getByTestId("task-pane");
  // The pane's layout (owner's screenshot): bar buttons, banner, title, field rows, Projects with a count, the comment box at the bottom.
  const bar = pane.getByTestId("pane-bar");
  for (const name of [/Mark complete/, /Collaborators/, /^Share$/, /Like/, /Copy/, "Open full page", /More/, "Close task"]) await expect(bar.getByRole("button", { name }).or(bar.getByRole("link", { name })).first()).toBeVisible();
  await expect(pane.getByTestId("visibility-banner")).toContainText("This task is private to members of this project.");
  await expect(pane.getByTestId("make-public")).toBeVisible();
  await expect(pane.getByTestId("pane-title")).toBeVisible();
  const order = await pane.getByTestId("pane-fields").locator("dt").allTextContents();
  expect(order).toEqual(["Assignee", "Due date", "Dependencies"]);
  await expect(pane.getByTestId("task-dates-text")).toHaveText(/\d+ (– \d+ \w{3}|\w{3} – \d+ \w{3})/);
  await expect(pane.getByTestId("projects-count")).toHaveText("1");
  const composer = pane.getByTestId("pane-composer");
  await expect(composer).toBeVisible();
  const paneBox = (await pane.getByTestId("task-pane-body").boundingBox())!;
  const composerBox = (await composer.boundingBox())!;
  expect(Math.abs(paneBox.y + paneBox.height - (composerBox.y + composerBox.height))).toBeLessThan(4); // pinned at the bottom
  await page.screenshot({ path: "test-results/date-picker-pane.png" });
  expect(await axe(page, "[data-testid=task-pane]")).toEqual([]);
  expect((await taskRow(title))[0]).toMatchObject({ start, due });
  // The pane's date row opens the same picker; × on the start clears it and saves on close.
  await pane.getByTestId("task-dates-button").click();
  const panePicker = pane.getByRole("dialog", { name: "Task dates" });
  await panePicker.getByRole("button", { name: "Clear start date" }).click();
  await panePicker.getByTestId("task-dates-done").click();
  await expect.poll(async () => (await taskRow(title))[0]?.start ?? null).toBeNull();
});

test("the project's From and To from the header picker", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(projectUrl);
  await page.getByTestId("project-dates-header-button").click();
  const picker = page.getByRole("dialog", { name: "Project dates" });
  await picker.getByTestId("project-dates-header-add-start").click();
  const from = addDays(weekStart(addMonths(indiaToday(), 2)), 0);
  const to = addDays(from, 11);
  await picker.getByRole("textbox", { name: "From (start date)" }).fill(from);
  await picker.getByRole("textbox", { name: "To (due date)" }).fill(to);
  await picker.getByRole("textbox", { name: "To (due date)" }).press("Enter");
  await expect(page.getByText("Project dates saved.")).toBeVisible();
  await expect.poll(async () => (await rows<{ s: string; d: string }>("SELECT DATE_FORMAT(start_on, '%Y-%m-%d') AS s, DATE_FORMAT(due_on, '%Y-%m-%d') AS d FROM projects WHERE name = ?", [`Dates ${stamp}`]))[0]).toEqual({ s: from, d: to });
  await expect(page.getByTestId("project-dates")).toContainText("Dates:");
});

test("a due date on a holiday still asks before it is kept", async ({ page, context }) => {
  const base = new Date(Date.now() + 75 * 86_400_000);
  while (base.getUTCDay() !== 2) base.setUTCDate(base.getUTCDate() + 1);
  const day = base.toISOString().slice(0, 10);
  const conn = await db();
  await conn.query("INSERT IGNORE INTO holidays (holiday_on, name) VALUES (?, ?)", [day, `Picker holiday ${stamp}`]);
  await conn.end();
  try {
    await as(context, "E2E_REQ");
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/users/work/my-tasks");
    const dialog = await openDraft(page);
    await dialog.getByLabel("Task name").fill(`Holiday pick ${stamp}`);
    await dialog.getByTestId("create-dates-button").click();
    const picker = dialog.getByRole("dialog", { name: "Task dates" });
    await picker.getByRole("textbox", { name: "Due date" }).fill(day);
    // The holiday is dimmed with its name.
    await expect(picker.locator(`[data-day="${day}"]`)).toHaveAttribute("title", `Holiday: Picker holiday ${stamp}`);
    await picker.getByRole("textbox", { name: "Due date" }).press("Enter");
    await dialog.getByRole("button", { name: "Create task" }).click();
    const prompt = page.getByTestId("holiday-prompt");
    await expect(prompt).toContainText(`Picker holiday ${stamp}`);
    await prompt.getByRole("button", { name: `Keep ${day}` }).click();
    await expect.poll(async () => (await taskRow(`Holiday pick ${stamp}`))[0]?.due ?? null).toBe(day);
  } finally {
    const clean = await db();
    await clean.query("DELETE FROM holidays WHERE holiday_on = ? AND name = ?", [day, `Picker holiday ${stamp}`]);
    await clean.end();
  }
});

test("phone: the picker opens as a bottom sheet (axe dark)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/users/work/my-tasks?create=task");
  const dialog = page.getByTestId("create-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-dates-button").click();
  const sheet = dialog.getByTestId("create-dates-panel");
  await expect(sheet).toHaveAttribute("data-sheet", "true");
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(810);
  expect(Math.round(box.width)).toBe(375);
  await page.screenshot({ path: "test-results/date-picker-phone.png" });
  expect(await axe(page, "[data-testid=create-dates-panel]")).toEqual([]);
  await typeCreateDue(dialog, addDays(weekStart(addMonths(indiaToday(), 1)), 1));
  await expect(sheet).toHaveCount(0);
});

test("dark theme: the picker and the pane pass axe", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${projectUrl}?view=list`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("task-row").filter({ hasText: `Mouse range ${stamp}` }).getByRole("link").first().click();
  const pane = page.getByTestId("task-pane");
  await expect(pane.getByTestId("pane-fields")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await pane.getByTestId("task-dates-button").click();
  await expect(pane.getByTestId("task-dates-panel")).toBeVisible();
  await page.screenshot({ path: "test-results/date-picker-dark.png" });
  // The picker stays open through a live refresh (15 s; the poll pauses while a picker is open).
  await page.waitForTimeout(16_500);
  await expect(pane.getByTestId("task-dates-panel")).toBeVisible();
  // axe over the pane with the picker open (the picker is inside it).
  expect(await axe(page, "[data-testid=task-pane]")).toEqual([]);
  await expect(pane.getByTestId("task-dates-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await axe(page, "[data-testid=task-pane]")).toEqual([]);
});

test("D-400: a repeating task for someone else; completing it makes the next one for them", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/users/work/my-tasks");
  const dialog = await openDraft(page);
  const title = `Repeat for Manoj ${stamp}`;
  await dialog.getByLabel("Task name").fill(title);
  await dialog.getByRole("radio", { name: "Others", exact: true }).click();
  const search = dialog.getByRole("combobox", { name: "Search people" });
  await search.fill("manoj man");
  await dialog.getByRole("option", { name: "Manoj Manager" }).click();
  await dialog.getByTestId("create-dates-button").click();
  await dialog.getByRole("button", { name: "Repeat (periodic)" }).click();
  await expect(dialog.getByLabel(/Periodic \(repeats/)).toBeChecked();
  await expect(dialog.getByTestId("assignee-chip")).toHaveCount(1); // Others stays chosen
  await typeCreateDue(dialog, addDays(weekStart(addMonths(indiaToday(), 1)), 2));
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect.poll(async () => (await taskRow(title))[0]?.recurrence_json ?? null).not.toBeNull();
  const made = (await taskRow(title))[0]!;
  expect(made.assignee_id).toBe(await userIdByLogin("E2E_MGR"));
  // As Manoj: the task shows the repeat; completing it makes the next one, his too.
  await as(context, "E2E_MGR");
  await page.goto(`/users/tasks/${made.id}`);
  await expect(page.getByText(/Periodic: Every/).first()).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).first().click();
  await expect.poll(async () => (await taskRow(title)).length).toBe(2);
  const next = (await taskRow(title)).find((row) => row.id !== made.id)!;
  expect(next.assignee_id).toBe(made.assignee_id);
  expect(next.recurrence_json).not.toBeNull();
});
