import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.67.0 (D-375, PM phase D part 1) through the real screens: a Dashboard
// tab with the 8 default widgets, a chart of each family made in the chart
// builder, "View as table", a chart read with the keyboard (tooltip), a
// widget moved with the keyboard (pick up, move, drop) and kept after a
// reload, the Workload tab with an over-capacity cell and a reassignment,
// axe on both, and the light and dark themes (chart colours from the tokens).
// "pm_foundations", "pm_planning" and "pm_reporting" are ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
let projectUrl = "";
let dashboardUrl = "";
let projectId = 0;

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light") {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary ?? ""})`).join(" | ")}`);
}
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (() => {
  const today = indiaToday();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return plus(today, ((8 - weekday) % 7) || 7);
})();
async function sql<T extends RowDataPacket[] | ResultSetHeader>(text: string, params: unknown[]): Promise<T> {
  const conn = await db();
  try {
    const [rows] = await conn.query<T>(text, params);
    return rows;
  } finally {
    await conn.end();
  }
}
const widget = (page: Page, title: string) => page.getByTestId("dashboard-widget").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("Dashboard tab: 8 default widgets, figures, View as table, keyboard tooltip (axe, light)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  projectUrl = await createProject(page, `E2E reporting ${stamp}`);
  projectId = Number(projectUrl.split("/").pop());
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of ["Rep one", "Rep two", "Rep three"].map((name) => `${name} ${stamp}`)) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  await sql("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE title = ?", [`Rep one ${stamp}`]);

  await page.getByTestId("add-tab").click();
  await page.getByTestId("add-tab-dashboard").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  dashboardUrl = page.url();
  await expect(page.getByTestId("dashboard-widget")).toHaveCount(8);
  await expect(widget(page, "Total tasks").getByTestId("chart-number")).toHaveText("3");
  await expect(widget(page, "Total completed tasks").getByTestId("chart-number")).toHaveText("1");
  await expect(widget(page, "Total completed tasks").getByTestId("widget-filters")).toHaveText("1 filter");
  await expect(widget(page, "Total tasks").getByTestId("widget-filters")).toHaveText("No filters");

  // View as table.
  const bySection = widget(page, "Incomplete tasks by section");
  await bySection.getByTestId("widget-table-toggle").click();
  await expect(bySection.getByTestId("chart-table")).toContainText("To do");
  await expect(bySection.getByTestId("chart-table")).toContainText("2");

  // The donut read with the keyboard: a tooltip per part.
  const donut = widget(page, "Tasks by completion status").getByTestId("chart-plot");
  await donut.focus();
  await expect(widget(page, "Tasks by completion status").getByTestId("chart-tooltip")).toContainText("Completed");
  await page.keyboard.press("ArrowRight");
  await expect(widget(page, "Tasks by completion status").getByTestId("chart-tooltip")).toContainText("Incomplete");

  // Full size.
  await widget(page, "Tasks by completion status").getByTestId("widget-full-open").click();
  await expect(page.getByTestId("widget-full").getByTestId("chart-table")).toContainText("Incomplete");
  await page.getByRole("button", { name: "Close", exact: true }).last().click();

  expect(await axe(page, "[data-testid=dashboard]")).toEqual([]);
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-chart-1").trim());
  expect(light).toBe("#2a78d6");
  await page.getByTestId("dashboard").screenshot({ path: test.info().outputPath("dashboard-light.png") });
});

test("the chart builder makes a chart of each family", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(dashboardUrl);
  const styles = ["Bar", "Stacked bar", "Grouped bar", "Line", "Burnup", "Burndown", "Donut", "Number", "Lollipop"];
  for (const style of styles) {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("menuitem", { name: "Chart" }).click();
    const builder = page.getByTestId("chart-builder");
    await expect(builder).toBeVisible();
    await builder.getByTestId("chart-style").selectOption({ label: style });
    if (style === "Line") await builder.getByTestId("chart-x").selectOption({ label: "Date" });
    if (style === "Bar") {
      await builder.getByTestId("chart-add-metric").click();
      await expect(builder.getByTestId("chart-metric")).toHaveCount(2);
      await builder.getByTestId("chart-benchmark-on").check();
      await builder.getByTestId("chart-benchmark").fill("2");
    }
    await builder.getByTestId("chart-title").fill(`${style} ${stamp}`);
    await expect(builder.getByTestId("chart-preview-error")).toHaveCount(0);
    await expect(builder.locator("[data-testid=chart-plot], [data-testid=chart-empty], [data-testid=chart-number]").first()).toBeVisible();
    await page.getByTestId("chart-save").click();
    await expect(widget(page, `${style} ${stamp}`)).toBeVisible();
  }
  await expect(page.getByTestId("dashboard-widget")).toHaveCount(17);
  await expect(widget(page, `Bar ${stamp}`).getByTestId("chart-benchmark")).toBeVisible();
  // A text widget.
  await page.getByRole("button", { name: "Add widget" }).click();
  await page.getByRole("menuitem", { name: "Text" }).click();
  await page.getByTestId("text-title").fill(`Read me ${stamp}`);
  await page.getByTestId("text-body").fill("Weekly numbers for the review.");
  await page.getByTestId("text-save").click();
  await expect(widget(page, `Read me ${stamp}`)).toContainText("Weekly numbers");
  // Every chart has a table.
  await widget(page, `Stacked bar ${stamp}`).getByTestId("widget-table-toggle").click();
  await expect(widget(page, `Stacked bar ${stamp}`).getByTestId("chart-table")).toBeVisible();
  // Back to the top: a widget scrolled under the sticky app bar reads as "obscured" to axe.
  await expect(page.getByText("Text added.")).toHaveCount(0, { timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await axe(page, "[data-testid=dashboard]")).toEqual([]);
});

test("a widget moved with the keyboard stays moved", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(dashboardUrl);
  const first = page.getByTestId("dashboard-widget").first();
  await expect(first.getByRole("heading")).toHaveText("Total completed tasks");
  const handle = first.getByTestId("widget-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("dashboard-live")).toContainText("moved to position 2");
  await expect(page.getByTestId("dashboard-widget").nth(1).getByRole("heading")).toHaveText("Total completed tasks");
  await page.reload();
  await expect(page.getByTestId("dashboard-widget").nth(1).getByRole("heading")).toHaveText("Total completed tasks");
  await expect(page.getByTestId("dashboard-widget").first().getByRole("heading")).toHaveText("Total incomplete tasks");
});

test("Workload: over capacity shown with words, reassign from a cell (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const me = await userIdByLogin("E2E_REQ");
  const staff = await userIdByLogin("E2E_STAFF");
  await sql("INSERT IGNORE INTO project_members (project_id, member_type, member_id, role, added_by) VALUES (?, 'USER', ?, 'EDITOR', ?)", [projectId, staff, me]);
  // Six open tasks of mine due on Monday (capacity 5 a day by default).
  await page.goto(projectUrl + "?view=list");
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (let index = 1; index <= 4; index += 1) {
    await add.fill(`Load ${index} ${stamp}`);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: `Load ${index} ${stamp}` })).toBeVisible();
  }
  await sql("UPDATE tasks SET due_at = ?, starts_on = NULL, assignee_id = ? WHERE (title LIKE ? OR title LIKE ?) AND status <> 'COMPLETED'", [`${monday} 12:00:00`, me, `Load % ${stamp}`, `Rep % ${stamp}`]);

  await page.goto(dashboardUrl);
  await page.getByTestId("add-tab").click();
  await page.getByTestId("add-tab-workload").click();
  await expect(page.getByTestId("workload")).toBeVisible();
  await page.goto(`${page.url()}&wfrom=${monday}`);
  const mine = page.getByTestId("workload-row").filter({ hasText: "Capacity 5 a day" }).filter({ has: page.getByTestId("workload-cell-over") });
  const over = mine.getByTestId("workload-cell-over").first();
  await expect(over).toContainText("6");
  await expect(over).toContainText("Over");
  await expect(over).toHaveAttribute("aria-label", /over capacity/);
  expect(await axe(page, "[data-testid=workload]")).toEqual([]);

  await over.press("Enter");
  const tasks = page.getByTestId("workload-tasks");
  await expect(tasks.getByRole("listitem")).toHaveCount(6);
  const firstTask = tasks.getByRole("listitem").first();
  await firstTask.getByTestId("workload-reassign-to").selectOption(String(staff));
  await firstTask.getByTestId("workload-reassign").click();
  await expect(page.getByRole("status").filter({ hasText: "Reassigned." }).first()).toBeVisible();
  await expect(page.getByTestId("workload-cell-over")).toHaveCount(0);
  await expect(page.getByTestId("workload-table").getByRole("button", { name: /: 5 tasks of a capacity of 5/ })).toBeVisible();

  // Capacity: the project's capacity down to 4 a day → over again.
  await page.getByTestId("workload-capacity").click();
  await page.getByTestId("capacity-project").fill("4");
  await page.getByTestId("capacity-save").click();
  await expect(page.getByTestId("workload-cell-over").first()).toBeVisible();
});

test("dark theme: chart colours from the dark tokens (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.goto(dashboardUrl);
  await expect(page.getByTestId("dashboard-widget").first()).toBeVisible();
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-chart-1").trim());
  expect(dark).toBe("#3987e5");
  expect(await axe(page, "[data-testid=dashboard]")).toEqual([]);
  await page.getByTestId("dashboard").screenshot({ path: test.info().outputPath("dashboard-dark.png") });
});
