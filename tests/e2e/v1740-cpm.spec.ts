import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.74.0 (D-398) through the real screens: the project's dates as From and
// To (settings → header, Overview: working days and estimated hours), a task's
// estimate from its dates in the pane, and the Gantt's critical path (Options
// › Show critical path / Show slack: the expected bars and links highlighted,
// the summary and the ordered list; moving a task by keys changes the path
// while previewing and after saving), with axe. "pm_planning" and
// "pm_extras" are ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const A = `CpA ${stamp}`;
const B = `CpB ${stamp}`;
const C = `CpC ${stamp}`;
const D = `CpD ${stamp}`;
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
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// The Monday after next (India): every task date used is Monday to Thursday.
const monday = (() => {
  const today = indiaToday();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return plus(today, (((8 - weekday) % 7) || 7) + 7);
})();
const bar = (page: Page, title: string) => page.locator(`[data-testid=schedule-bar][aria-label^="${title}"]`);

async function sql(query: string, params: unknown[]) {
  const conn = await db();
  try {
    return (await conn.query<RowDataPacket[] & ResultSetHeader>(query, params))[0];
  } finally {
    await conn.end();
  }
}
const setDates = (title: string, start: string | null, due: string) => sql("UPDATE tasks SET starts_on = ?, due_at = ? WHERE title = ?", [start, `${due} 18:29:00`, title]);
async function linkByTitle(pred: string, succ: string) {
  const rows = (await sql("SELECT id, title, created_by FROM tasks WHERE title IN (?, ?)", [pred, succ])) as RowDataPacket[];
  const id = (title: string) => rows.find((row) => row.title === title)!.id;
  await sql("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, lag_days, created_by) VALUES (?, ?, 'FS', 0, ?)", [id(pred), id(succ), rows[0]!.created_by]);
}

test("From and To: the project's working days and hours in settings, the header and Overview; a task's estimate from its dates (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E critical ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [A, B, C, D]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  // A(3) → B(2) → D(2) and A(3) → C(4) → D(2), all planned from Monday.
  await setDates(A, monday, plus(monday, 2));
  await setDates(B, monday, plus(monday, 1));
  await setDates(C, monday, plus(monday, 3));
  await setDates(D, monday, plus(monday, 1));
  await linkByTitle(A, B);
  await linkByTitle(A, C);
  await linkByTitle(B, D);
  await linkByTitle(C, D);

  await page.goto(`${projectUrl}/settings`);
  // v1.75.0 (D-399): From and To are the date range picker. To typed before From swaps them (with a notice);
  // the server still refuses To before From (integration tests).
  await page.getByTestId("project-dates-picker-button").click();
  const picker = page.getByRole("dialog", { name: "Project dates" });
  await picker.getByTestId("project-dates-picker-add-start").click();
  await picker.getByRole("textbox", { name: "To (due date)" }).fill(monday);
  await picker.getByRole("textbox", { name: "From (start date)" }).fill(plus(monday, 10));
  await expect(picker.getByRole("alert")).toContainText("Swapped");
  await picker.getByRole("textbox", { name: "From (start date)" }).fill(monday);
  await picker.getByRole("textbox", { name: "To (due date)" }).fill(plus(monday, 60));
  expect(await axe(page, "[data-testid=project-dates-picker-panel]")).toEqual([]);
  await picker.getByRole("textbox", { name: "To (due date)" }).press("Enter");
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("settings-duration")).toContainText("working days", { timeout: 15_000 });
  // The changed fields (the privacy radios above them have a known, separate target-size finding).
  for (const part of ["[data-testid=project-dates-picker]", "[data-testid=settings-duration]"]) expect(await axe(page, part)).toEqual([]);

  await page.goto(`${projectUrl}?view=overview`);
  await expect(page.getByTestId("project-dates")).toContainText("Dates: From");
  await expect(page.getByTestId("project-duration")).toContainText(/\d+ working days · \d+(\.\d)? h/);
  await expect(page.getByTestId("about-from")).toContainText(monday);
  await expect(page.getByTestId("about-duration")).toContainText("working days");
  await expect(page.getByTestId("about-hours")).toContainText("h a working day");

  // A task without an estimate is estimated from its dates; a manual one wins; clearing goes back.
  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: B }).getByRole("link").first().click();
  const timeBox = page.getByTestId("task-pane").getByTestId("task-time");
  await expect(timeBox.getByTestId("time-estimate-source")).toContainText("Estimated from dates: 2 working days");
  await expect(timeBox.getByTestId("time-summary")).toContainText("estimated from dates");
  await timeBox.getByTestId("time-estimate").fill("3h");
  await timeBox.getByRole("button", { name: "Set estimate" }).click();
  await expect(timeBox.getByTestId("time-summary")).toContainText("0m of 3h estimated");
  await expect(timeBox.getByTestId("time-estimate-source")).toContainText("Set by hand");
  await timeBox.getByTestId("time-estimate").fill("");
  await timeBox.getByRole("button", { name: "Set estimate" }).click();
  await expect(timeBox.getByTestId("time-summary")).toContainText("estimated from dates");
  expect(await axe(page, "[data-testid=task-time]")).toEqual([]);
});

test("Gantt: Show critical path highlights A, C and D; Show slack; the summary and the list (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await page.getByTestId("add-tab").locator("button[aria-haspopup]").click();
  await page.getByTestId("add-tab-gantt").click();
  await expect(page).toHaveURL(/tab=\d+/);
  ganttUrl = page.url();
  const gantt = page.getByTestId("gantt");
  await expect(gantt).toBeVisible();
  await expect(gantt.getByTestId("project-bar-row")).toBeVisible();
  await expect(gantt.getByTestId("project-bar-label")).toContainText("working days");
  await expect(gantt.getByTestId("critical-summary")).toHaveCount(0);

  await page.getByTestId("schedule-options").locator("button[aria-haspopup]").click();
  await page.getByTestId("show-critical").click();
  await page.keyboard.press("Escape");
  const summary = gantt.getByTestId("critical-summary");
  await expect(summary).toContainText("Critical path: 3 tasks");
  await expect(page.getByTestId("schedule-live")).toContainText("Critical path: 3 tasks");
  for (const title of [A, C, D]) await expect(bar(page, title)).toHaveAttribute("data-critical", "1");
  await expect(bar(page, B)).toHaveAttribute("data-critical", "0");
  await expect(bar(page, C)).toHaveAttribute("aria-label", /, critical, no slack$/);
  await expect(gantt.locator("[data-testid=connector][data-critical='1']")).toHaveCount(2);
  await summary.getByText(/Critical tasks in order/).click();
  await expect(summary.getByTestId("critical-list").getByRole("listitem")).toHaveText([new RegExp(A), new RegExp(C), new RegExp(D)]);

  await page.getByTestId("schedule-options").locator("button[aria-haspopup]").click();
  await page.getByTestId("show-slack").click();
  await page.keyboard.press("Escape");
  const bRow = page.getByTestId("schedule-row").filter({ has: page.getByRole("link", { name: B, exact: true }) });
  await expect(bRow.getByTestId("gantt-slack")).toHaveText("2 d");
  await expect(bRow.getByTestId("slack-bar")).toHaveCount(1);
  await expect(bar(page, B)).toHaveAttribute("aria-label", /2 working days of slack$/);
  expect(await axe(page, "[data-testid=gantt]")).toEqual([]);
  await page.screenshot({ path: "test-results/v1740-gantt-critical.png", fullPage: true }); // for a look (not committed)
});

test("Gantt: shortening C by keys changes the path while previewing and after saving", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(ganttUrl);
  await page.getByTestId("schedule-options").locator("button[aria-haspopup]").click();
  await page.getByTestId("show-critical").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("critical-summary")).toContainText("Critical path: 3 tasks");
  await page.getByTestId("schedule-zoom").locator("button[aria-haspopup]").click();
  await page.getByTestId("zoom-days").click();
  await page.keyboard.press("Escape");
  const charlie = bar(page, C);
  await charlie.focus();
  // Shift + ← twice: the due date two days earlier (C becomes 2 days, like B).
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(bar(page, B)).toHaveAttribute("data-critical", "1");
  await expect(page.getByTestId("critical-summary")).toContainText("Critical path: 4 tasks");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("schedule-live")).toContainText(`Saved: ${C}`);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("critical-summary")).toContainText("Critical path: 4 tasks");
  await expect(bar(page, B)).toHaveAttribute("data-critical", "1");
});
