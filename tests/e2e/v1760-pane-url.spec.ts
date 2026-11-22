import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.76.0 (D-401, lead's report after v1.75.0): a task opened from its address
// (…?task=N) stays open: the 15-second refresh and a filter change never
// rewrite the address without task=N (or drop the pane), on a project and on
// Task Summary.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
let projectUrl = "";
let taskId = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
const taskParam = (page: Page) => new URL(page.url()).searchParams.get("task");

test("a project with a task", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/projects");
  await page.getByTestId("create-project").click();
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill(`E2E pane url ${stamp}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Section 1", { exact: true }).fill("To do");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/users\/work\/projects\/\d+\?created=1/);
  projectUrl = page.url().split("?")[0]!;
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(`Pane ${stamp}`);
  await add.press("Enter");
  const row = page.getByTestId("task-row").filter({ hasText: `Pane ${stamp}` });
  await expect(row).toBeVisible();
  taskId = (await row.getAttribute("data-task-id"))!;
});

for (const where of ["project", "Task Summary"] as const) {
  test(`${where}: opened by address, the task stays open through a refresh and a filter change`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await as(context, "E2E_REQ");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(where === "project" ? `${projectUrl}?task=${taskId}` : `/users/work/my-tasks?task=${taskId}`);
    const pane = page.getByTestId("task-pane");
    await expect(pane).toBeVisible();
    // One poll (15 s) and a little more.
    await page.waitForTimeout(16_500);
    await expect(pane).toBeVisible();
    expect(taskParam(page)).toBe(taskId);
    // Change a filter in the view behind the pane (keyboard: the pane may cover the toolbar).
    const grid = page.getByTestId(where === "project" ? "project-grid" : "my-grid");
    await grid.getByTestId("filter-menu").locator("summary").evaluate((element: HTMLElement) => element.click());
    await grid.getByText("Due this week").first().evaluate((element: HTMLElement) => element.click());
    await page.waitForTimeout(2_500);
    await expect(pane).toBeVisible();
    expect(taskParam(page)).toBe(taskId);
    await page.waitForTimeout(16_000);
    await expect(pane).toBeVisible();
    expect(taskParam(page)).toBe(taskId);
  });
}
