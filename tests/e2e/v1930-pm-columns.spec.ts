import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.93.0 (owner 27 Nov 2026, D-446..D-449) through the real screens: a
// project List's default columns (Start date, Completed date, Last comment;
// no Created by, which Options > Columns adds back), moving columns (Options
// arrows, Alt+Left / Alt+Right on a title, dragging a title) saved with the
// view, the Last comment cell, and the dependency picker scoped to the
// project with "Whole portfolio". Chromium; the reorder test runs in Firefox too.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const A1 = `Col A1 ${stamp}`;
const A2 = `Col A2 ${stamp}`;
const B1 = `Col B1 ${stamp}`;
let projectUrl = "";
let otherUrl = "";

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
const headers = (page: Page) => page.getByTestId("project-list").locator('[role="columnheader"][data-column]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column")));
async function addTask(page: Page, title: string) {
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(title);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
}
async function openColumns(page: Page) {
  const grid = page.getByTestId("project-list");
  await grid.getByTestId("options-menu").locator("summary").click();
  await grid.getByTestId("options-columns-row").click();
  return grid.getByTestId("options-columns");
}

test("defaults: Start date, Completed date and Last comment shown, Created by in the library only", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E columns ${stamp}`);
  await addTask(page, A1);
  await addTask(page, A2);
  expect(await headers(page)).toEqual(["name", "assignee", "start", "due", "priority", "collaborators", "tags", "completed", "lastComment"]);
  const columns = await openColumns(page);
  const createdBy = columns.getByTestId("column-choice").filter({ hasText: "Created by" }).getByRole("checkbox");
  await expect(createdBy).not.toBeChecked();
  await createdBy.check();
  await expect(page.getByTestId("project-list").locator('[role="columnheader"][data-column="createdBy"]')).toBeVisible();
  expect(await axe(page, "[data-testid=options-columns]")).toEqual([]);
  await createdBy.uncheck();
  await expect(page.getByTestId("project-list").locator('[role="columnheader"][data-column="createdBy"]')).toHaveCount(0);
});

test("move columns: Options arrows, Alt+arrow on a title, dragging a title; saved with the view", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const grid = page.getByTestId("project-list");
  // Options > Columns: Due date one to the left (before Start date).
  const columns = await openColumns(page);
  await columns.getByRole("button", { name: "Move Due date left" }).click();
  expect((await headers(page)).slice(0, 4)).toEqual(["name", "assignee", "due", "start"]);
  await page.keyboard.press("Escape");
  // Keyboard: Priority's title, Alt+Left twice.
  const priority = grid.locator('[role="columnheader"][data-column="priority"] [data-testid="grid-sort"]');
  await priority.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowLeft");
  expect((await headers(page)).slice(0, 5)).toEqual(["name", "assignee", "priority", "due", "start"]);
  await expect(page.getByRole("status").filter({ hasText: "Priority moved to column 2" })).toHaveCount(1);
  await expect(priority).toBeFocused();
  // Drag: Due date's title onto Assignee's (it takes Assignee's place).
  await grid.locator('[role="columnheader"][data-column="due"]').dragTo(grid.locator('[role="columnheader"][data-column="assignee"]'));
  expect((await headers(page)).slice(0, 5)).toEqual(["name", "due", "assignee", "priority", "start"]);
  // The cells follow their titles: the row's third cell sits under the Due date title.
  const row = grid.getByTestId("task-row").filter({ hasText: A1 });
  const titleBox = (await grid.locator('[role="columnheader"][data-column="due"]').boundingBox())!;
  const cellBox = (await row.locator('[role="gridcell"]').nth(2).boundingBox())!;
  expect(Math.abs(titleBox.x - cellBox.x)).toBeLessThan(2);
  // Unsaved view: Save, then a reload keeps the order.
  await grid.getByTestId("save-view").click();
  await expect(grid.getByTestId("unsaved-view")).toHaveCount(0);
  // Let the save's own refresh finish first (Firefox aborts a reload during it: KF-06).
  await page.waitForLoadState("networkidle");
  await page.reload();
  expect((await headers(page)).slice(0, 5)).toEqual(["name", "due", "assignee", "priority", "start"]);
  // Reset column order puts the table's own order back.
  const again = await openColumns(page);
  await again.getByTestId("reset-column-order").click();
  expect((await headers(page)).slice(0, 4)).toEqual(["name", "assignee", "start", "due"]);
});

test("the Last comment cell: the newest comment with its author, full text on hover", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const me = await userIdByLogin("E2E_REQ");
  const conn = await db();
  try {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id FROM tasks WHERE title = ?", [A1]);
    const taskId = Number(rows[0]!.id);
    await conn.query<ResultSetHeader>("INSERT INTO task_comments (task_id, author_id, body, created_at) VALUES (?, ?, 'An older note', UTC_TIMESTAMP() - INTERVAL 2 DAY)", [taskId, me]);
    await conn.query<ResultSetHeader>("INSERT INTO task_comments (task_id, author_id, body) VALUES (?, ?, ?)", [taskId, me, `The **latest** word on this task, long enough to be cut in the cell ${stamp}`]);
  } finally {
    await conn.end();
  }
  await page.goto(projectUrl);
  const cell = page.getByTestId("task-row").filter({ hasText: A1 }).getByTestId("last-comment-cell");
  await expect(cell).toContainText(`The latest word on this task`);
  await expect(cell).toContainText("just now");
  await expect(cell).toHaveAttribute("title", new RegExp(`: The latest word on this task, long enough to be cut in the cell ${stamp}$`));
  await expect(page.getByTestId("task-row").filter({ hasText: A2 }).getByTestId("last-comment-cell")).toHaveText("–");
});

test("dependency picker: this project first, Whole portfolio widens it", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  otherUrl = await createProject(page, `E2E columns other ${stamp}`);
  await addTask(page, B1);
  const me = await userIdByLogin("E2E_REQ");
  const projectId = (url: string) => Number(url.match(/projects\/(\d+)/)![1]);
  const search = async () => {
    await page.goto(projectUrl);
    await page.getByTestId("task-row").filter({ hasText: A1 }).getByRole("link").first().click();
    const editor = page.getByTestId("dependency-editor");
    await expect(editor.getByTestId("dependency-scope")).toContainText("Tasks in this task's project.");
    await editor.getByTestId("dependency-search").fill(`Col `);
    await expect(page.getByTestId("dependency-option").filter({ hasText: A2 })).toBeVisible();
    return editor;
  };
  let editor = await search();
  await expect(page.getByTestId("dependency-option").filter({ hasText: B1 })).toHaveCount(0);
  await expect(editor.getByTestId("dependency-wide")).toHaveCount(0); // no portfolio yet
  // Both projects in one portfolio: the switch appears and widens the list.
  const conn = await db();
  try {
    const [made] = await conn.query<ResultSetHeader>("INSERT INTO portfolios (name, owner_id, created_by) VALUES (?, ?, ?)", [`E2E programme ${stamp}`, me, me]);
    for (const project of [projectId(projectUrl), projectId(otherUrl)]) await conn.query("INSERT INTO portfolio_items (portfolio_id, project_id, added_by) VALUES (?, ?, ?)", [made.insertId, project, me]);
  } finally {
    await conn.end();
  }
  editor = await search();
  await expect(page.getByTestId("dependency-option").filter({ hasText: B1 })).toHaveCount(0);
  await editor.getByTestId("dependency-wide").check();
  await expect(editor.getByTestId("dependency-scope")).toContainText("Tasks in this task's portfolio.");
  await expect(page.getByTestId("dependency-option").filter({ hasText: B1 })).toBeVisible();
  await page.getByTestId("dependency-option").filter({ hasText: B1 }).click();
  await expect(editor.getByTestId("dependency-row")).toContainText(B1);
  expect(await axe(page, "[data-testid=dependency-editor]")).toEqual([]);
});
