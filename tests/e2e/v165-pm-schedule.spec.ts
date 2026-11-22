import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader } from "mysql2/promise";
import { db, sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.65.0 (D-373, PM phase B part 2) through the real screens: project
// settings (Dependencies, Scheduling), a dependency added in the task pane by
// name, the Gantt tab (scale, today line, Blocked by, connectors), keyboard
// and drag rescheduling with "N dependent tasks moved" and Undo, a link made
// by dragging a bar's handle, the Calendar week view with a keyboard move,
// the status update with highlights, PM-A14 Home, and axe.
// "pm_foundations" and "pm_planning" are ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const A = `Alpha ${stamp}`;
const B = `Bravo ${stamp}`;
const C = `Charlie ${stamp}`;
let projectUrl = "";
let ganttUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
// The next Monday (India), and days after it: every date used is a weekday.
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (() => {
  const today = indiaToday();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return plus(today, ((8 - weekday) % 7) || 7);
})();
const short = (day: string) => `${Number(day.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day.slice(5, 7)) - 1]}${day.slice(0, 4) === indiaToday().slice(0, 4) ? "" : ` ${day.slice(0, 4)}`}`;
// A row by its own name link (another row's "Blocked by" chip can name the task too).
const ganttRow = (page: Page, title: string) => page.getByTestId("schedule-row").filter({ has: page.getByRole("link", { name: title, exact: true }) });
const bar = (page: Page, title: string) => page.locator(`[data-testid=schedule-bar][aria-label^="${title}"]`);

async function setDates(title: string, start: string | null, due: string) {
  const conn = await db();
  try {
    // 23:59 India = 18:29 UTC.
    await conn.query<ResultSetHeader>("UPDATE tasks SET starts_on = ?, due_at = ? WHERE title = ?", [start, `${due} 18:29:00`, title]);
  } finally {
    await conn.end();
  }
}

test("settings, a dependency by name in the pane, and the Gantt tab with connectors (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E schedule ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [A, B, C]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  await setDates(A, null, monday);
  await setDates(B, plus(monday, 2), plus(monday, 3));
  await setDates(C, null, plus(monday, 1));

  // Project settings → Dependencies (keep the gap) and Scheduling (count every day).
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("dependencies-settings").getByLabel(/Keep the gap/).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved." }).first()).toBeVisible();
  await page.getByTestId("scheduling-settings").getByRole("checkbox").uncheck();
  await expect(page.getByTestId("scheduling-settings").getByRole("checkbox")).not.toBeChecked();
  expect(await axe(page, "#dependencies-section")).toEqual([]);

  // The pane: Blocked by → find "Alpha" by name (with its project), Finish to start.
  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: B }).getByRole("link").first().click();
  const editor = page.getByTestId("dependency-editor");
  await expect(editor).toBeVisible();
  await editor.getByTestId("dependency-search").fill(`Alpha ${stamp}`);
  const option = page.getByTestId("dependency-option").filter({ hasText: A });
  await expect(option).toContainText(`E2E schedule ${stamp}`);
  await option.click();
  await expect(editor.getByTestId("dependency-row")).toContainText(A);
  expect(await axe(page, "[data-testid=dependency-editor]")).toEqual([]);

  // Add a Gantt tab from the catalogue.
  await page.goto(projectUrl);
  await page.getByTestId("add-tab").locator("summary").click();
  await page.getByTestId("add-tab-gantt").click();
  await expect(page).toHaveURL(/tab=\d+/);
  ganttUrl = page.url();
  const gantt = page.getByTestId("gantt");
  await expect(gantt).toBeVisible();
  await expect(gantt.getByTestId("today-line")).toHaveCount(1);
  await expect(ganttRow(page, B).getByTestId("blocked-by")).toContainText(A);
  await expect(ganttRow(page, B).getByTestId("blocked-by")).toContainText("FS");
  await expect(gantt.getByTestId("connector")).toHaveCount(1);
  expect(await axe(page, "[data-testid=gantt]")).toEqual([]);
});

test("Gantt: keyboard and drag rescheduling move dependents (Undo), and a link by dragging", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(ganttUrl);
  await page.getByTestId("schedule-zoom").selectOption("days");
  await expect(ganttRow(page, B).getByTestId("gantt-due")).toHaveText(short(plus(monday, 3)));

  // Keyboard: focus Alpha's bar, → moves it a day, Enter saves; Bravo keeps the gap.
  const alpha = bar(page, A);
  await alpha.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("schedule-live")).toContainText("Moved");
  await page.keyboard.press("Enter");
  const toast = page.getByRole("status").filter({ hasText: "1 dependent task moved" });
  await expect(toast).toBeVisible();
  await expect(ganttRow(page, A).getByTestId("gantt-due")).toHaveText(short(plus(monday, 1)));
  await expect(ganttRow(page, B).getByTestId("gantt-due")).toHaveText(short(plus(monday, 4)));
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dates put back." })).toBeVisible();
  await expect(ganttRow(page, B).getByTestId("gantt-due")).toHaveText(short(plus(monday, 3)));
  await expect(ganttRow(page, A).getByTestId("gantt-due")).toHaveText(short(monday));

  // Drag: Charlie two days later.
  const charlie = bar(page, C);
  await charlie.scrollIntoViewIfNeeded();
  const box = (await charlie.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(ganttRow(page, C).getByTestId("gantt-due")).toHaveText(short(plus(monday, 3)));
  // Saved on the server (the rows re-sort by date once the page refreshes).
  await expect(page.getByTestId("schedule-live")).toContainText(`Saved: ${C}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("schedule-row").last()).toContainText(C);

  // A link by dragging Charlie's handle onto Bravo: the dialog picks the type.
  await ganttRow(page, C).hover();
  const handle = ganttRow(page, C).getByTestId("link-handle");
  const from = (await handle.boundingBox())!;
  const to = (await bar(page, B).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  const dialog = page.getByTestId("link-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("link-type").selectOption("SS");
  expect(await axe(page, "[data-testid=link-dialog]")).toEqual([]);
  await dialog.getByTestId("link-save").click();
  await expect(page.getByTestId("gantt").getByTestId("connector")).toHaveCount(2);
  await expect(ganttRow(page, B).getByTestId("blocked-by")).toContainText("SS");
});

test("Calendar: a week view, a keyboard move, the No start date panel (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=calendar&cal=week&week=${monday}`);
  const week = page.getByTestId("calendar-week");
  await expect(week).toBeVisible();
  await expect(week.getByRole("gridcell")).toHaveCount(7);
  await expect(page.getByTestId("calendar-week-title")).toContainText(String(Number(monday.slice(8, 10))));
  // Bravo starts on Wednesday: it shows on Wednesday (start) and Thursday (due).
  await expect(page.getByTestId("calendar-task").filter({ hasText: B })).toHaveCount(2);
  const alpha = page.locator(`[data-testid=calendar-task][data-cal-due="1"]`).filter({ hasText: A });
  await alpha.focus();
  await page.keyboard.press(" ");
  await expect(page.getByTestId("calendar-live")).toContainText("Picked up");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /moved/ }).first()).toBeVisible();
  await expect(week.getByRole("gridcell", { name: plus(monday, 1) }).getByTestId("calendar-task").filter({ hasText: A })).toBeVisible();
  await page.getByTestId("no-start-toggle").click();
  await expect(page.getByTestId("no-start-panel")).toContainText(A);
  expect(await axe(page, "[data-testid=task-calendar]")).toEqual([]);
  // Months still works.
  await page.getByTestId("calendar-months").click();
  await expect(page.getByTestId("calendar-week")).toHaveCount(0);
});

test("a status update with highlights, sections and the weekly reminder (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const conn = await db();
  try {
    await conn.query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), is_milestone = TRUE, starts_on = NULL WHERE title = ?", [C]);
  } finally {
    await conn.end();
  }
  await page.goto(`${projectUrl}?view=overview`);
  const composer = page.getByTestId("status-composer");
  await expect(composer).toBeVisible();
  const panel = composer.getByTestId("status-highlights-panel");
  await expect(panel.getByRole("checkbox", { name: new RegExp(C) })).toBeChecked(); // milestones start ticked
  expect(await axe(page, "[data-testid=status-composer]")).toEqual([]);
  await composer.getByLabel("On track").check();
  await composer.getByLabel("Headline").fill(`Week one ${stamp}`);
  const summary = composer.getByRole("textbox", { name: /Summary/ });
  await summary.click();
  await summary.pressSequentially("Foundations are done");
  const next = composer.getByRole("textbox", { name: /Next steps/ });
  await next.click();
  await next.pressSequentially("Start the walls");
  await composer.getByRole("button", { name: "Post status update" }).click();
  const update = page.getByTestId("status-update").first();
  await expect(update).toContainText(`Week one ${stamp}`);
  await expect(update).toContainText("Next steps");
  await expect(update.getByTestId("status-highlights")).toContainText(C);
  await page.getByTestId("status-reminder").check();
  await expect(page.getByRole("status").filter({ hasText: "reminded every Friday" }).first()).toBeVisible();
});

test("PM-A14: someone without the Approval module gets the Home widgets", async ({ page, context }) => {
  const login = `PM14_${stamp}`.toUpperCase();
  const conn = await db();
  try {
    const [result] = await conn.query<ResultSetHeader>(
      "INSERT INTO users (login_id, name, email, sign_in_method, active, last_login_at, module_access) VALUES (?, ?, ?, 'GOOGLE', TRUE, CURRENT_TIMESTAMP, 'TASK,PROJECT')",
      [login, `Tara Tasks ${stamp}`, `${login.toLowerCase()}@example.test`],
    );
    await conn.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'USER'", [result.insertId]);
  } finally {
    await conn.end();
  }
  await as(context, login);
  await page.goto("/users");
  await expect(page.getByTestId("home-greeting")).toContainText("Tara");
  await expect(page.getByTestId("home-widget").first()).toBeVisible();
  await expect(page.getByTestId("modules-home")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
