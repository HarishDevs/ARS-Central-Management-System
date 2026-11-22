import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.72.0 (D-387, owner: "use the skeleton and layout design and options
// design ... and use dropdowns wherever required"): the project screens'
// menus are ARIA menus in the spec's order (keyboard open/close, item order,
// Escape returns focus), the toolbars have the spec's shape, the Customize
// panel and the settings section list, and axe on each changed screen.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E parity ${stamp}`;
let projectUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const trigger = (menu: Locator) => menu.locator("button[aria-haspopup]").first();
// The items' own names (the first line of each item; hints are on a second line).
const names = (menu: Locator) => menu.getByRole("menu").first().locator(":scope > [role^='menuitem'], :scope > [data-menu-row] > [role^='menuitem']").evaluateAll((items) => items.map((item) => (item.querySelector("span.min-w-0 > span") ?? item).textContent?.trim() ?? ""));
const focusedText = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");

test("a project with two sections and two tasks", async ({ page, context }) => {
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

test("opening a project shows its skeleton (header, tabs, toolbar, rows) until it arrives", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/work/projects");
  const id = projectUrl.split("/").at(-1)!;
  // Hold the page's data back a moment so the skeleton can be seen.
  await page.route((url) => url.pathname === `/users/work/projects/${id}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole("link", { name: projectName }).first().click();
  await expect(page.getByTestId("nav-skeleton").getByTestId("project-skeleton")).toBeVisible();
  await expect(page.getByTestId("project-header")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("nav-skeleton")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("header: the actions menu in the spec's order, by keyboard, with an Export submenu; Escape gives focus back", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const actions = page.getByTestId("project-actions");
  await trigger(actions).focus();
  await page.keyboard.press("ArrowDown");
  await expect(actions.getByRole("menu")).toBeVisible();
  await expect(trigger(actions)).toHaveAttribute("aria-expanded", "true");
  expect(await names(actions)).toEqual(["Edit project settings", "Manage project permissions", "Set colour", "Copy project link", "Duplicate", "Save as template", "Add to portfolio", "Import", "Export or sync", "Archive", "Delete project"]);
  expect(await focusedText(page)).toBe("Edit project settings");
  // ↑ wraps to the last item; End / Home.
  await page.keyboard.press("ArrowUp");
  expect(await focusedText(page)).toBe("Delete project");
  await page.keyboard.press("Home");
  expect(await focusedText(page)).toBe("Edit project settings");
  // A letter jumps: "E" → Export or sync (after Edit project settings).
  await page.keyboard.press("e");
  expect(await focusedText(page)).toContain("Export or sync");
  await page.keyboard.press("ArrowRight");
  const sub = actions.getByRole("menu", { name: "Export or sync" });
  await expect(sub).toBeVisible();
  await expect(sub.getByRole("menuitem")).toHaveText(["Project tasks (CSV)", "Project tasks (Excel)", "Time entries (CSV)", "JSON", "Calendar feed", "Print"]);
  expect(await focusedText(page)).toBe("Project tasks (CSV)");
  await page.keyboard.press("ArrowLeft");
  await expect(sub).toHaveCount(0);
  expect(await focusedText(page)).toContain("Export or sync");
  expect(await axe(page, "[data-testid=project-actions]")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(actions.getByRole("menu")).toHaveCount(0);
  await expect(trigger(actions)).toBeFocused();

  // The status menu: the six statuses.
  await trigger(page.getByTestId("status-menu")).click();
  expect(await names(page.getByTestId("status-menu"))).toEqual(["On track", "At risk", "Off track", "On hold", "Complete", "Dropped"]);
  await page.keyboard.press("Escape");
  await expect(trigger(page.getByTestId("status-menu"))).toBeFocused();

  // The avatars manage members; the tile changes the colour (owner).
  await expect(page.getByTestId("member-stack")).toHaveAttribute("href", /settings#members$/);
  await expect(page.getByRole("link", { name: `Change colour of ${projectName}` })).toHaveAttribute("href", /settings#details$/);
});

test("tabs: the tab menu and the Add tab menu follow the spec", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const listTab = page.getByTestId("view-tab").filter({ has: page.getByRole("link", { name: /^List/ }) });
  const menu = listTab.getByTestId("tab-menu");
  await trigger(menu).click();
  expect(await names(menu)).toEqual(["Rename", "Set as default", "Make a copy", "Copy link", "Move left", "Move right", "Remove"]);
  // The default tab's "Set as default" is shown but off.
  await expect(menu.getByRole("menuitem", { name: /Set as default/ })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(trigger(menu)).toBeFocused();

  const addTab = page.getByTestId("add-tab");
  await trigger(addTab).press("Enter");
  const list = addTab.getByRole("menu");
  await expect(list.getByText("Popular", { exact: true })).toBeVisible();
  await expect(list.getByText("Other", { exact: true })).toBeVisible();
  expect(await names(addTab)).toEqual(["List", "Page", "Gantt", "Board", "Calendar", "Timeline", "Workload", "Dashboard", "Files", "Messages", "Overview"]);
  expect(await axe(page, "[data-testid=add-tab]")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(trigger(addTab)).toBeFocused();
});

test("List toolbar: Add task ▾ (Task, Milestone, Section), a Sort menu in the spec's order, Group by, Options pages", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const grid = page.getByTestId("project-grid");
  // Add task ▾
  const more = grid.getByTestId("add-task-more");
  await trigger(more).click();
  expect(await names(more)).toEqual(["Task", "Milestone", "Section"]);
  await more.getByRole("menuitem", { name: "Milestone" }).click();
  await expect(page.getByTestId("create-dialog")).toContainText("Create milestone");
  await page.getByTestId("create-dialog").getByRole("button", { name: "Close" }).click();
  await trigger(more).click();
  await more.getByRole("menuitem", { name: "Section" }).click();
  await expect(page.getByLabel("New section name")).toBeFocused();

  // Sort: a menu of radio items; picking keeps it open; Escape closes it and gives focus back.
  const sort = grid.getByTestId("sort-menu");
  await trigger(sort).press("Enter");
  const order = await names(sort);
  expect(order.slice(0, 10)).toEqual(["None", "Start date", "Due date", "Assignee", "Created by", "Created on", "Last modified", "Completed on", "Likes", "Alphabetical"]);
  expect(order.at(-1)).toBe("Projects");
  await sort.getByRole("menuitemradio", { name: "Due date" }).click();
  await expect(sort.getByRole("menuitemradio", { name: "Due date" })).toHaveAttribute("aria-checked", "true");
  await expect(sort.getByRole("menuitemradio", { name: "Descending" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger(sort)).toBeFocused();
  // v1.76.0 (D-401): "Sorts: 1" with the sort's name as the tooltip.
  await expect(trigger(sort)).toContainText("Sorts: 1");
  await expect(trigger(sort)).toHaveAttribute("title", "Sorted by Due date");
  await grid.getByRole("button", { name: "Clear sort" }).click();
  await expect(trigger(sort)).toHaveText("Sort");

  // Group: a "Group by" dropdown.
  await grid.getByTestId("group-menu").locator("summary").click();
  await expect(grid.getByTestId("group-by")).toHaveValue("section");
  await page.keyboard.press("Escape");

  // Options: rows in the spec's order; Show/hide columns opens its own page.
  await grid.getByTestId("options-menu").locator("summary").click();
  await expect(grid.getByTestId("options-menu").locator("[data-testid$='-row']")).toHaveText([/^Show\/hide columns/, /^Filters/, /^Sorts/, /^Groups/, /^Rows/]);
  await grid.getByTestId("options-columns-row").click();
  await expect(grid.getByTestId("options-columns")).toContainText("Assignee");
  await grid.getByTestId("options-back").click();
  await grid.getByTestId("options-sorts-row").click();
  await expect(sort.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await axe(page, "[data-testid=project-grid]")).toEqual([]);
});

test("a section's ⋯ menu: spec order, Delete section asks first; ＋ adds a task to the section", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const section = page.getByTestId("section-menu").first();
  await trigger(section).click();
  const items = await names(section);
  const at = (label: string) => items.indexOf(label);
  expect(at("Add automation to section")).toBe(0);
  expect(at("Rename section")).toBeGreaterThan(at("Add automation to section"));
  expect(at("Add section")).toBeGreaterThan(at("Rename section"));
  expect(at("Expand all groups")).toBeGreaterThan(at("Add section"));
  expect(at("Hide empty groups")).toBeGreaterThan(at("Collapse all groups"));
  expect(items.at(-1)).toBe("Delete section");
  await expect(section.getByRole("menuitemcheckbox", { name: "Hide empty groups" })).toHaveAttribute("aria-checked", "false");
  await section.getByRole("menuitem", { name: "Rename section" }).click();
  await expect(page.getByTestId("section-name").first()).toBeFocused();
  await page.getByTestId("section-add-task").first().click();
  await expect(page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task")).toBeFocused();
});

test("Customize opens the panel (counts, Add menu); Escape closes it and gives focus back", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await page.getByTestId("customize").click();
  const panel = page.getByTestId("customize-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Customize" })).toBeVisible();
  await expect(panel.getByTestId("customize-fields")).toBeVisible();
  await expect(panel.getByTestId("customize-automations")).toBeVisible();
  await expect(panel.getByTestId("customize-forms")).toBeVisible();
  await trigger(panel.getByTestId("customize-add")).click();
  expect(await names(panel.getByTestId("customize-add"))).toEqual(["Field", "Form", "Automation"]);
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  expect(await axe(page, "[data-testid=customize-panel]")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("customize")).toBeFocused();
});

test("Board: the List's toolbar shape, a column ⋯ menu; Timeline: a unit dropdown and a Filter menu", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=board`);
  const toolbar = page.getByRole("toolbar", { name: "View options" });
  await expect(toolbar.getByTestId("add-task-split")).toBeVisible();
  await expect(toolbar.getByTestId("filter-menu")).toBeVisible();
  await expect(toolbar.getByTestId("sort-menu")).toBeVisible();
  // Manual order is "no sort": the button just says Sort.
  await expect(trigger(toolbar.getByTestId("sort-menu"))).toHaveText("Sort");
  await expect(toolbar.getByTestId("options-menu")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Search this view" })).toBeVisible();
  const column = page.getByTestId("board-column").first().getByTestId("section-menu");
  await trigger(column).click();
  expect(await names(column)).toEqual(["Add automation to section", "Rename section", "Add section", "Delete section"]);
  await page.keyboard.press("Escape");
  expect(await axe(page)).toEqual([]);

  await page.goto(`${projectUrl}?view=timeline`);
  const zoom = page.getByTestId("schedule-zoom");
  await trigger(zoom).click();
  expect(await names(zoom)).toEqual(["Days", "Weeks", "Months", "Quarters"]);
  await expect(zoom.getByRole("menuitemradio", { name: "Weeks" })).toHaveAttribute("aria-checked", "true");
  await zoom.getByRole("menuitemradio", { name: "Months" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(zoom)).toContainText("Months");
  const filter = page.getByTestId("schedule-filter");
  await trigger(filter).click();
  await filter.getByRole("menuitemradio", { name: "Completed tasks" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("No tasks match this filter.")).toBeVisible();
  await expect(trigger(filter)).toContainText("Filters: 1");
  expect(await axe(page, "[data-testid=timeline]")).toEqual([]);
});

test("task pane: the ⋯ menu in the spec's order; the activity order is a dropdown", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: `Alpha ${stamp}` }).getByRole("link").first().click();
  const pane = page.getByTestId("task-pane");
  const more = pane.getByTestId("pane-more");
  await trigger(more).click();
  const items = await names(more);
  // v1.73.0 (D-396): Create follow-up task and Duplicate task follow Attach files (spec PV §13.3).
  expect(items.slice(0, 9)).toEqual(["Add to another project", "Add subtask", "Add tags", "Attach files", "Create follow-up task", "Duplicate task", "Copy task link", "Open full page", "Print"]);
  expect(items.at(-1)).toBe("Delete task");
  await expect(more.getByRole("menu")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(trigger(more)).toBeFocused();
  // The pane stays open (Escape closed the menu only).
  await expect(pane).toBeVisible();
  await pane.getByRole("tab", { name: "All activity" }).click();
  const order = pane.getByTestId("activity-order");
  await trigger(order).click();
  await order.getByRole("menuitemradio", { name: "Newest first" }).click();
  await page.keyboard.press("Escape");
  await expect(trigger(order)).toContainText("Newest first");
});

test("settings: the section list (wide) and the Jump to dropdown (phone); axe", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}/settings`);
  const nav = page.getByTestId("settings-nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(["Project details", "Dependencies", "Scheduling", "Members", "Permissions", "Fields", "Forms", "Automations", "Duplicate and templates", "Import and export", "Calendar feed", "Archive or delete", "History"]);
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const jump = page.getByTestId("settings-jump");
  await trigger(jump).click();
  await jump.getByRole("menuitem", { name: "Automations" }).click();
  await expect(page).toHaveURL(/#automations$/);
  // Phone width: the project page has no sideways page scroll.
  await page.goto(projectUrl);
  await expect(page.getByTestId("project-header")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
