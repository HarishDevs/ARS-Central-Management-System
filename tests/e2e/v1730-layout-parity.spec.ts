import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.73.0 (D-396, layout parity part 2; owner: "use the skeleton and layout
// design and options design ... and use dropdowns wherever required"): the
// rest of the PM screens. Keyboard menus (open with ↓, item order, Escape
// gives focus back), the header's inline title, the task ⋯ follow-up and
// duplicate, Create and add another, My Tasks, Home's widget menus, the
// Timeline's Sort/Group/Options, the Calendar's Filter and search, the
// Dashboard's More actions, Workload's dropdowns, the automation pickers, the
// form builder's header bar, portfolios (cards, toolbar menus, column and row
// menus), the sidebar and the Create menu; axe on each and phone width.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E parity two ${stamp}`;
let projectUrl = "";

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
const trigger = (menu: Locator) => menu.locator("button[aria-haspopup]").first();
// The items' own names (the first line of each item; hints are on a second line).
const names = (menu: Locator) => menu.getByRole("menu").first().locator(":scope > [role^='menuitem'], :scope > [data-menu-row] > [role^='menuitem']").evaluateAll((items) => items.map((item) => (item.querySelector("span.min-w-0 > span") ?? item).textContent?.trim() ?? ""));
const focusedText = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// A Wednesday at least a week ahead (never a weekly off).
const nextWednesday = () => {
  const today = new Date(Date.now() + 330 * 60_000);
  const add = ((3 - today.getUTCDay() + 7) % 7) + 7;
  return new Date(today.getTime() + add * 86_400_000).toISOString().slice(0, 10);
};

test("a project with a section and two tasks", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/projects");
  await page.getByTestId("create-project").click();
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.getByLabel("Project name", { exact: true }).fill(projectName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Section 1", { exact: true }).fill("To do");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/users\/work\/projects\/\d+\?created=1/);
  projectUrl = page.url().split("?")[0]!;
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [`Alpha ${stamp}`, `Bravo ${stamp}`]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
});

test("header: an owner renames the project inline (Enter saves, Escape puts it back)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const title = page.getByTestId("project-title");
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
  await title.click();
  const box = page.getByTestId("project-title-input");
  await expect(box).toBeFocused();
  await box.fill(`${projectName} renamed`);
  await box.press("Escape");
  await expect(title).toHaveText(projectName);
  await expect(title).toBeFocused();
  await title.press("Enter");
  await box.fill(`${projectName} renamed`);
  await box.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: `${projectName} renamed` })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("project-title")).toHaveText(`${projectName} renamed`);
  // Back to the first name for the rest of the file.
  await page.getByTestId("project-title").click();
  await page.getByTestId("project-title-input").fill(projectName);
  await page.getByTestId("project-title-input").press("Enter");
  await expect(page.getByTestId("project-title")).toHaveText(projectName);
  expect(await axe(page, "[data-testid=project-header]")).toEqual([]);
});

test("Create menu and the sidebar: the shared dropdown, spec order, Escape gives focus back", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const create = page.getByTestId("create-menu");
  await trigger(create).focus();
  await page.keyboard.press("ArrowDown");
  const order = await names(create);
  expect(order.indexOf("Task")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("Project")).toBeGreaterThan(order.indexOf("Task"));
  expect(order.indexOf("Portfolio")).toBeGreaterThan(order.indexOf("Project"));
  expect(await focusedText(page)).toContain(order[0]!);
  await page.keyboard.press("End");
  expect(await focusedText(page)).toContain(order.at(-1)!);
  expect(await axe(page, "[data-testid=create-menu]")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(trigger(create)).toBeFocused();

  // Star the project; the Starred section's ⋯ is a radio menu in the spec's order.
  await page.getByTestId("project-header").getByRole("button", { name: `Star ${projectName}` }).click();
  const starredOptions = page.getByTestId("sidebar-sort-starred");
  await trigger(starredOptions).click();
  expect(await names(starredOptions)).toEqual(["A–Z", "Recently opened", "Manual"]);
  await page.keyboard.press("Escape");
  await expect(trigger(starredOptions)).toBeFocused();
  const plus = page.getByTestId("sidebar-new");
  if (await plus.count()) {
    await trigger(plus).click();
    expect((await names(plus))[0]).toBe("New project");
    await page.keyboard.press("Escape");
  }
  expect(await axe(page, "[data-testid=work-sidebar]")).toEqual([]);
});

test("task ⋯: Create follow-up task and Duplicate task fill the Create window; Create and add another keeps it open", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: `Alpha ${stamp}` }).getByRole("link").first().click();
  const pane = page.getByTestId("task-pane");
  const more = pane.getByTestId("pane-more");
  await trigger(more).click();
  const items = await names(more);
  expect(items.slice(0, 9)).toEqual(["Add to another project", "Add subtask", "Add tags", "Attach files", "Create follow-up task", "Duplicate task", "Copy task link", "Open full page", "Print"]);
  await more.getByRole("menuitem", { name: "Duplicate task" }).click();
  const dialog = page.getByTestId("create-dialog");
  await expect(dialog).toContainText("Duplicate task");
  await expect(dialog.getByLabel("Task name")).toHaveValue(`Alpha ${stamp} (copy)`);
  await dialog.getByRole("button", { name: "Close" }).click();

  await trigger(more).click();
  await more.getByRole("menuitem", { name: "Create follow-up task" }).click();
  await expect(dialog).toContainText("Create follow-up task");
  await expect(dialog.getByLabel("Task name")).toHaveValue(`Follow-up: Alpha ${stamp}`);
  await dialog.locator("#create-due").fill(nextWednesday());
  // The ▾ beside Create task: Create and add another (the window stays, emptied).
  const split = dialog.getByTestId("create-split");
  await trigger(split).click();
  expect(await names(split)).toEqual(["Create task", "Create and add another"]);
  await split.getByRole("menuitem", { name: "Create and add another" }).click();
  await expect(dialog.getByLabel("Task name")).toHaveValue("");
  await expect(dialog).toBeVisible();
  // The + menu of the window is the same dropdown.
  const plusMenu = dialog.getByTestId("create-more");
  await trigger(plusMenu).click();
  expect(await names(plusMenu)).toEqual(["Add to a project", "Set a due date", "Repeat (periodic)", "Attach a file", "Add collaborators"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.goto(projectUrl);
  await expect(page.getByTestId("task-row").filter({ hasText: `Follow-up: Alpha ${stamp}` })).toBeVisible();
});

test("Timeline: Sort, Group and Options dropdowns; Calendar: Filter and Search this view", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=timeline`);
  const sort = page.getByTestId("schedule-sort");
  await trigger(sort).click();
  expect(await names(sort)).toEqual(["Start date", "Due date", "Alphabetical"]);
  await sort.getByRole("menuitemradio", { name: "Alphabetical" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(sort)).toContainText("Sort: Alphabetical");
  const group = page.getByTestId("schedule-group");
  await trigger(group).click();
  expect(await names(group)).toEqual(["Sections", "None"]);
  await group.getByRole("menuitemradio", { name: "None" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(group)).toContainText("Group: None");
  const options = page.getByTestId("schedule-options");
  await trigger(options).click();
  expect(await names(options)).toEqual(["Expand all sections", "Collapse all sections", "Go to today"]);
  await expect(options.getByRole("menuitem", { name: "Collapse all sections" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  expect(await axe(page, "[data-testid=timeline]")).toEqual([]);

  await page.goto(`${projectUrl}?view=calendar`);
  const filter = page.getByTestId("calendar-filter");
  await trigger(filter).click();
  expect(await names(filter)).toEqual(["Incomplete tasks", "Completed tasks", "All tasks", "Just my tasks"]);
  await filter.getByRole("menuitemradio", { name: "Completed tasks" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(filter)).toContainText("Filters: 1");
  await expect(page.getByTestId("calendar-task")).toHaveCount(0);
  await trigger(filter).click();
  await filter.getByRole("menuitemradio", { name: "All tasks" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search this view" }).click();
  await page.getByRole("searchbox", { name: "Search this view" }).fill(`Bravo ${stamp}`);
  await expect(page.getByTestId("calendar-task").filter({ hasText: `Alpha ${stamp}` })).toHaveCount(0);
  expect(await axe(page, "[data-testid=task-calendar]")).toEqual([]);
});

test("Dashboard: a widget's More actions (View, Edit, Duplicate, Size ›, moves, Remove); Workload: unit and measure dropdowns", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await trigger(page.getByTestId("add-tab")).click();
  await page.getByTestId("add-tab-dashboard").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  const dashboardUrl = page.url();
  await expect(page.getByTestId("dashboard-widget")).toHaveCount(8);
  const first = page.getByTestId("dashboard-widget").first();
  const more = first.getByTestId("widget-more");
  await trigger(more).focus();
  await page.keyboard.press("ArrowDown");
  expect(await names(more)).toEqual(["View chart", "Edit chart", "Duplicate", "Size", "Move later", "Remove widget"]);
  await page.keyboard.press("End");
  expect(await focusedText(page)).toContain("Remove widget");
  // Size ›: Quarter width (a number card) or Full width.
  await more.getByRole("menuitem", { name: "Size" }).focus();
  await page.keyboard.press("ArrowRight");
  const size = more.getByRole("menu", { name: "Size" });
  await expect(size.getByRole("menuitemradio")).toHaveText(["Quarter width", "Full width"]);
  await page.keyboard.press("ArrowLeft");
  await more.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByTestId("dashboard-widget")).toHaveCount(9);
  await expect(page.getByTestId("dashboard-widget").last()).toContainText("(copy)");
  expect(await axe(page, "[data-testid=dashboard]")).toEqual([]);

  await page.goto(dashboardUrl);
  await trigger(page.getByTestId("add-tab")).click();
  await page.getByTestId("add-tab-workload").click();
  await expect(page.getByTestId("workload")).toBeVisible();
  const tools = page.getByRole("toolbar", { name: "Workload tools" });
  await expect(tools.getByTestId("add-task-split")).toBeVisible();
  await expect(tools.getByRole("link", { name: "Previous period" })).toBeVisible();
  const unit = tools.getByTestId("workload-unit");
  await trigger(unit).click();
  expect(await names(unit)).toEqual(["Days (14)", "Weeks (8)"]);
  await unit.getByRole("menuitemradio", { name: "Weeks (8)" }).click();
  await expect(trigger(unit)).toContainText("Weeks (8)");
  await expect(trigger(tools.getByTestId("workload-metric"))).toContainText("Task count");
  expect(await axe(page, "[data-testid=workload]")).toEqual([]);
});

test("automation builder: the trigger and the step's action are dropdown menus (spec PC §2.3-§2.5)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("add-automation").click();
  await expect(page).toHaveURL(/\/automations\/\d+$/);
  const picker = page.getByTestId("trigger-type");
  await trigger(picker).focus();
  await page.keyboard.press("ArrowDown");
  expect(await names(picker)).toEqual(["Something happens to a task", "Run by hand (from a task's menu)", "On a schedule", "Web request received (webhook)"]);
  await page.keyboard.press("ArrowRight");
  const events = picker.getByRole("menu", { name: "Something happens to a task" });
  await expect(events).toBeVisible();
  await expect(events.getByText("Task moved", { exact: true })).toBeVisible();
  expect(await focusedText(page)).toContain("Task is added to this project");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(trigger(picker)).toBeFocused();
  const add = page.getByTestId("add-step");
  await trigger(add).click();
  const steps = await names(add);
  expect(steps[0]).toBe("Move to a section");
  expect(steps.indexOf("Create a task")).toBeGreaterThan(steps.indexOf("Change priority"));
  await add.getByRole("menuitem", { name: "Add a comment" }).click();
  await expect(page.getByTestId("step-card")).toContainText("Add a comment");
  expect(await axe(page, "[data-testid=automation-builder]")).toEqual([]);
});

test("form builder: the header bar (who may submit, Share form, More actions)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("add-form").click();
  const bar = page.getByTestId("form-header-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId("form-access")).toContainText("Who may submit");
  await bar.getByRole("button", { name: "Change" }).click();
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  await bar.getByTestId("form-share").click();
  await expect(page.getByRole("tab", { name: "Share" })).toHaveAttribute("aria-selected", "true");
  const more = bar.getByTestId("form-more");
  await trigger(more).click();
  expect(await names(more)).toEqual(["Duplicate form", "Delete form"]);
  await page.keyboard.press("Escape");
  await expect(trigger(more)).toBeFocused();
  expect(await axe(page, "[data-testid=form-builder]")).toEqual([]);
});

test("portfolios: cards with a New portfolio tile and ⋯ options; the List's toolbar, column and row menus", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/portfolios/new");
  await page.getByTestId("portfolio-name").fill(`Parity portfolio ${stamp}`);
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-search").fill(stamp);
  await page.getByRole("checkbox", { name: projectName }).check();
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios\/\d+\?created=1/);
  const portfolioUrl = page.url().split("?")[0]!;

  // Header: the actions in the spec's order; the status menu with colour dots.
  const actions = page.getByTestId("portfolio-actions");
  await trigger(actions).click();
  expect(await names(actions)).toEqual(["Edit portfolio details", "Copy portfolio link", "Set colour", "Export or sync", "Archive", "Delete portfolio"]);
  await page.keyboard.press("Escape");
  await expect(trigger(actions)).toBeFocused();
  await expect(page.getByTestId("portfolio-members")).toBeVisible();

  // Toolbar: Filter, Sort and Group are dropdowns.
  const list = page.getByTestId("portfolio-list-tab");
  const filter = list.getByTestId("portfolio-filter");
  await trigger(filter).click();
  expect(await names(filter)).toEqual(["Incomplete work", "Closed work", "Just my work", "At risk or off track", "Has overdue tasks", "Clear"]);
  await page.keyboard.press("Escape");
  const sort = list.getByTestId("sort-menu");
  await trigger(sort).click();
  expect(await names(sort)).toEqual(["None (order added)", "Status", "Owner", "Due date", "Alphabetical", "Task progress", "Priority"]);
  await page.keyboard.press("Escape");
  const group = list.getByTestId("portfolio-group");
  await trigger(group).click();
  expect(await names(group)).toEqual(["Owner", "Status", "Priority", "Projects and portfolios", "Clear"]);
  await group.getByRole("menuitemradio", { name: "Status" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(group)).toContainText("Group: Status");
  // A column's options; a row's ⋯.
  const column = list.getByTestId("column-menu").first();
  await trigger(column).click();
  expect(await names(column)).toEqual(["Sort ascending", "Sort descending"]);
  await column.getByRole("menuitemradio", { name: "Sort descending" }).click();
  await expect(list.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
  const row = list.getByTestId("portfolio-row").filter({ hasText: projectName }).getByTestId("row-menu");
  await trigger(row).click();
  expect(await names(row)).toEqual(["Open", "Copy link", "Remove from this portfolio"]);
  await page.keyboard.press("Escape");
  expect(await axe(page, "[data-testid=portfolio-list-tab]")).toEqual([]);

  // The Portfolios page: cards (a New portfolio tile first) or a list.
  await page.goto("/users/work/portfolios");
  const cards = page.getByTestId("portfolio-list");
  await expect(cards).toHaveAttribute("data-layout", "cards");
  await expect(cards.getByTestId("new-portfolio-tile")).toBeVisible();
  const card = cards.getByTestId("portfolio-card").filter({ hasText: `Parity portfolio ${stamp}` });
  await trigger(card.getByTestId("portfolio-card-menu")).click();
  expect((await names(card.getByTestId("portfolio-card-menu")))[0]).toBe("Open portfolio");
  await page.keyboard.press("Escape");
  expect(await axe(page)).toEqual([]);
  await page.getByTestId("portfolio-layout").click();
  await expect(page.getByTestId("portfolio-list")).toHaveAttribute("data-layout", "list");
  await page.goto(portfolioUrl);
});

test("My Tasks: the title's ▾ menu; Home: Add widgets and each widget's Actions menu", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/my-tasks");
  const actions = page.getByTestId("my-tasks-actions");
  await trigger(actions).focus();
  await page.keyboard.press("ArrowDown");
  const items = await names(actions);
  expect(items.slice(0, 3)).toEqual(["Add task", "Morning summary email", "Table with filters"]);
  expect(items.at(-1)).toBe("Print");
  await expect(actions.getByRole("menuitemcheckbox", { name: /Morning summary email/ })).toHaveAttribute("aria-checked", /true|false/);
  await page.keyboard.press("Escape");
  await expect(trigger(actions)).toBeFocused();
  expect(await axe(page, "[data-testid=my-tasks-header]")).toEqual([]);

  await page.goto("/users?home=tasks");
  const widget = page.getByTestId("home-widget").first();
  const menu = widget.getByTestId("widget-actions");
  await trigger(menu).click();
  const entries = await names(menu);
  expect(entries[0]).toBe("Move up");
  expect(entries.at(-1)).toBe("Remove widget");
  await expect(menu.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(trigger(menu)).toBeFocused();
  expect(await axe(page, "[data-testid=home-widgets]")).toEqual([]);
});

test("phone width: the changed screens have no sideways page scroll", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of [projectUrl, `${projectUrl}?view=timeline`, "/users/work/portfolios", `${projectUrl}/settings`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(await noSideScroll(page), url).toBe(true);
  }
});
