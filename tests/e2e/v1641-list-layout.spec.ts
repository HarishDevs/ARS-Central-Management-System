import { expect, test, type BrowserContext } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.64.1 (owner's screenshot of a project List scrolled sideways): section
// headings and "Add task" lines stay in view when the table is wider than the
// card, and the table fills the card when it is narrower.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
let projectUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}

test("a project with two sections and a task", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/projects");
  await page.getByTestId("create-project").click();
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill(`E2E layout ${stamp}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Section 1", { exact: true }).fill("To do");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/users\/work\/projects\/\d+\?created=1/);
  projectUrl = page.url().split("?")[0]!;
  const add = page.getByLabel(/Add a task/).first();
  await add.fill(`Wide task ${stamp}`);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: `Wide task ${stamp}` })).toBeVisible();
});

test("scrolled sideways on a narrow window, the section heading and Add task line stay in view", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(projectUrl);
  const grid = page.getByRole("treegrid", { name: "Tasks" });
  await expect(grid).toBeVisible();
  const scroller = grid.locator("..");
  const wide = await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 20);
  test.skip(!wide, "the table fits this window, nothing to scroll");
  await scroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
  const box = (await scroller.boundingBox())!;
  const heading = page.getByTestId("group-heading").first();
  const head = (await heading.boundingBox())!;
  expect(head.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(head.x + head.width).toBeLessThanOrEqual(box.x + box.width + 1);
  await expect(heading.getByText("To do").or(heading.locator("input[value='To do']"))).toBeInViewport();
  const addLine = page.getByLabel(/Add a task/).first();
  const line = (await addLine.boundingBox())!;
  expect(line.x).toBeGreaterThanOrEqual(box.x - 1);
});

test("on a wide window the table fills the card (no empty area on the right)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1900, height: 900 });
  await page.goto(projectUrl);
  const grid = page.getByRole("treegrid", { name: "Tasks" });
  await expect(grid).toBeVisible();
  const [gridWidth, cardWidth] = await grid.evaluate((element) => [element.getBoundingClientRect().width, element.parentElement!.clientWidth]);
  expect(gridWidth).toBeGreaterThanOrEqual(cardWidth - 1);
  const row = page.getByTestId("task-row").first();
  const rowWidth = (await row.boundingBox())!.width;
  expect(rowWidth).toBeGreaterThanOrEqual(cardWidth - 1);
  // v1.66.2 (owner): the section name box fits its words; the count sits right beside it.
  const name = page.getByTestId("section-name").first();
  const nameBox = (await name.boundingBox())!;
  expect(nameBox.width).toBeLessThan(200);
  const heading = page.getByTestId("group-heading").first();
  const count = heading.getByText("1", { exact: true });
  const countBox = (await count.boundingBox())!;
  expect(countBox.x - (nameBox.x + nameBox.width)).toBeLessThan(40);
  await page.screenshot({ path: "test-results/v1641-list-wide.png" });
});

test("v1.66.3: a section's ⋯ menu opens on top, fully visible, and its items work", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(projectUrl);
  const last = page.getByTestId("group-menu-more").last();
  await last.locator("summary").click();
  const panel = last.locator("[data-floating]");
  await expect(panel).toBeVisible();
  await expect(panel).toBeInViewport({ ratio: 1 });
  // Nothing else is drawn over the menu: the element at its centre belongs to it.
  const onTop = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !!hit && element.contains(hit);
  });
  expect(onTop).toBe(true);
  await panel.getByRole("button", { name: "Collapse all groups" }).click();
  await expect(page.getByTestId("task-row")).toHaveCount(0);
  await expect(panel).toBeHidden();
});
