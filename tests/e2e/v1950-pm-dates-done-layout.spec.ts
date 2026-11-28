import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.95.0 (owner 28 Nov 2026, D-471..D-476) through the real screens: PM dates
// show the date itself (no weekday names; Yesterday / Today / Tomorrow stay),
// a completed task is faded and never struck through (axe colour contrast),
// and a changed column layout stays: into the tab for an editor, kept for the
// person on a tab they may only view and on task search. Chromium; the layout
// test runs in Firefox too.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const NEAR = `Near ${stamp}`;
const DONE = `Done ${stamp}`;
let projectUrl = "";
const WEEKDAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page, include: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5000 }).catch(() => undefined);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include(include).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const short = (day: string) => `${Number(day.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day.slice(5, 7)) - 1]}${day.slice(0, 4) === indiaToday().slice(0, 4) ? "" : ` ${day.slice(0, 4)}`}`;
const headers = (page: Page, testId: string) => page.getByTestId(testId).locator('[role="columnheader"][data-column]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column")));
async function sql(query: string, params: unknown[]) {
  const conn = await db();
  try {
    await conn.query(query, params);
  } finally {
    await conn.end();
  }
}

test("PM dates: a day in the coming week shows the date, never a weekday name", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E dates ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [NEAR, DONE]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  // Due in 3 days and starting in 2 (both inside the coming week): written as dates.
  const due = plus(indiaToday(), 3);
  await sql("UPDATE tasks SET due_at = ?, starts_on = NULL WHERE title = ?", [`${due} 18:29:00`, NEAR]);
  await sql("UPDATE tasks SET starts_on = ?, due_at = ? WHERE title = ?", [plus(indiaToday(), 2), `${plus(indiaToday(), 1)} 18:29:00`, DONE]);
  await page.reload();
  const near = page.getByTestId("task-row").filter({ hasText: NEAR });
  await expect(near.locator("[data-due]")).toHaveText(short(due));
  await expect(near).not.toContainText(WEEKDAY);
  // The start date column and the task pane's dates: no weekday names either.
  const other = page.getByTestId("task-row").filter({ hasText: DONE });
  await expect(other.getByTestId("start-cell")).toHaveText(short(plus(indiaToday(), 2)));
  await near.getByRole("link", { name: NEAR }).click();
  const pane = page.getByTestId("task-pane");
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId("task-dates-text")).toHaveText(short(due));
});

test("a completed task is faded, not struck through; the tick stays; axe passes", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await sql("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE title = ?", [DONE]);
  await page.goto(projectUrl);
  const grid = page.getByTestId("project-list");
  await grid.getByTestId("filter-menu").locator("summary").click();
  await page.getByTestId("show-completed").click();
  await page.keyboard.press("Escape");
  const row = grid.getByTestId("task-row").filter({ hasText: DONE });
  await expect(row).toHaveClass(/task-done-row/);
  const title = row.getByRole("link", { name: DONE });
  await expect(title).toHaveClass(/task-done/);
  expect(await title.evaluate((element) => getComputedStyle(element).textDecorationLine)).not.toContain("line-through");
  await expect(row.getByRole("checkbox", { name: new RegExp(DONE) })).toBeChecked();
  expect(await axe(page, "[data-testid=project-list]")).toEqual([]);
});

test("column layout: an editor's change is saved to the tab; a viewer's is kept for them", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const grid = page.getByTestId("project-list");
  const due = grid.locator('[role="columnheader"][data-column="due"] [data-testid="grid-sort"]');
  await due.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowLeft");
  expect((await headers(page, "project-list")).slice(0, 3)).toEqual(["name", "due", "assignee"]);
  // Saved to the tab a second later (the built-in tab is stored first, so the table may
  // redraw before the short "Columns saved to this view" note is read): no Unsaved changes.
  await expect(grid.getByTestId("unsaved-view")).toHaveCount(0);
  await expect.poll(async () => {
    const conn = await db();
    try {
      const [rows] = await conn.query("SELECT COUNT(*) AS n FROM work_views WHERE scope = 'PROJECT' AND scope_id = ? AND JSON_CONTAINS(config_json, '\"due\"', '$.columnOrder')", [Number(projectUrl.match(/projects\/(\d+)/)![1])]);
      return Number((rows as { n: number }[])[0]!.n);
    } finally {
      await conn.end();
    }
  }).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  await page.reload();
  expect((await headers(page, "project-list")).slice(0, 3)).toEqual(["name", "due", "assignee"]);

  // A viewer: their own order, kept on their account; the tab itself doesn't change.
  const projectId = Number(projectUrl.match(/projects\/(\d+)/)![1]);
  await sql("INSERT INTO project_members (project_id, member_type, member_id, role, added_by) VALUES (?, 'USER', ?, 'VIEWER', ?)", [projectId, await userIdByLogin("E2E_STAFF"), await userIdByLogin("E2E_REQ")]);
  await as(context, "E2E_STAFF");
  await page.goto(projectUrl);
  const tags = grid.locator('[role="columnheader"][data-column="tags"] [data-testid="grid-sort"]');
  await expect(tags).toBeVisible();
  await tags.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  const viewerOrder = await headers(page, "project-list");
  await expect(grid.getByTestId("columns-kept")).toContainText("Columns kept for you");
  await page.waitForLoadState("networkidle");
  await page.reload();
  expect(await headers(page, "project-list")).toEqual(viewerOrder);
  // The editor still sees the tab's own order.
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  expect((await headers(page, "project-list")).indexOf("tags")).not.toBe(viewerOrder.indexOf("tags"));
});

test("task search keeps the person's column order every time they open it", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`/users/work/search?q=${stamp}`);
  const grid = page.getByTestId("work-search-results");
  await expect(grid).toBeVisible();
  const priority = grid.locator('[role="columnheader"][data-column="priority"] [data-testid="grid-sort"]');
  await priority.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  const order = await headers(page, "work-search-results");
  await expect(grid.getByTestId("columns-kept")).toContainText("Columns kept for you");
  await page.waitForLoadState("networkidle");
  await page.goto("/users/work/search");
  await page.goto(`/users/work/search?q=${stamp}`);
  expect(await headers(page, "work-search-results")).toEqual(order);
});

// The cross-cutting check (date words and faded completed tasks touch every task
// screen): axe (WCAG 2.2 AA, serious and critical) on each, light and dark, with
// completed tasks shown, plus no weekday name in a due-date cell.
test("axe on the task screens (light and dark), no weekday names in due cells", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const screens = [`${projectUrl}`, `${projectUrl}?view=board`, "/users/work/my-tasks", `/users/work/search?q=${stamp}`];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of screens) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await axe(page, "main"), `${url} (${scheme})`).toEqual([]);
      for (const text of await page.locator("[data-due]").allTextContents()) expect(text, url).not.toMatch(WEEKDAY);
    }
    await page.goto(projectUrl);
    await page.getByTestId("task-row").filter({ hasText: NEAR }).getByRole("link", { name: NEAR }).click();
    await expect(page.getByTestId("task-pane")).toBeVisible();
    expect(await axe(page, "[data-testid=task-pane]"), `task pane (${scheme})`).toEqual([]);
  }
});
