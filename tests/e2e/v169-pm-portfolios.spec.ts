import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";
import { pickPerson } from "./people";
import { createProject } from "./work-helpers";

// v1.69.0 (D-382, PM phase D part 3) through the real screens: the
// new-portfolio steps (name, projects, people), the List with task-progress
// roll-ups, Add work with the keyboard, Progress with a status update, the
// Timeline read with the keyboard, the Dashboard's totals, and masking: a
// member who can't see one of the projects gets "Private project" and
// figures without it. Axe on every new screen; light and dark.
// "pm_portfolios" is ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const open = `Pf open ${stamp}`;
const secret = `Pf secret ${stamp}`;
let portfolioUrl = "";
let openId = 0;

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light") {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary ?? ""})`).join(" | ")}`);
}
async function sql<T extends RowDataPacket[] | ResultSetHeader>(text: string, params: unknown[]): Promise<T> {
  const conn = await db();
  try {
    const [rows] = await conn.query<T>(text, params);
    return rows;
  } finally {
    await conn.end();
  }
}
const row = (page: Page, name: string) => page.getByTestId("portfolio-row").filter({ hasText: name });

test("New portfolio steps: name, projects, people; the List rolls up task progress (axe, light)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  const openUrl = await createProject(page, open);
  openId = Number(openUrl.split("/").pop());
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of ["One", "Two", "Three"].map((name) => `Pf ${name} ${stamp}`)) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  await sql("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE title = ?", [`Pf One ${stamp}`]);
  await sql("UPDATE projects SET start_on = DATE(UTC_TIMESTAMP()), due_on = DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL 60 DAY) WHERE id = ?", [openId]);
  await createProject(page, secret);

  // The Create menu offers Portfolio; the sidebar has Portfolios.
  await page.getByTestId("create-menu").getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: /Portfolio/ }).click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios\/new/);
  await expect(page.getByTestId("wizard-continue")).toBeDisabled();
  expect(await axe(page, "[data-testid=new-portfolio]")).toEqual([]);
  await page.getByTestId("portfolio-name").fill(`Plant upgrades ${stamp}`);
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-search").fill(stamp);
  await page.getByRole("checkbox", { name: open }).check();
  await page.getByRole("checkbox", { name: secret }).check();
  await expect(page.getByText("2 chosen")).toBeVisible();
  await page.getByTestId("wizard-continue").click();
  await pickPerson(page, page.getByRole("button", { name: /^Person to add/ }), "Sita Staff");
  await page.getByLabel("Role").selectOption("VIEWER");
  await page.getByTestId("wizard-add-person").click();
  await expect(page.getByRole("list", { name: "People to add" })).toContainText("Sita Staff");
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios\/\d+\?created=1/);
  portfolioUrl = page.url().split("?")[0]!;

  await expect(page.getByTestId("portfolio-row")).toHaveCount(2);
  await expect(row(page, open).getByTestId("task-progress")).toHaveText("1 of 3 tasks done (33%)");
  await expect(row(page, secret).getByTestId("task-progress")).toHaveText("No tasks yet");
  await expect(page.getByTestId("portfolio-header")).toContainText("1 of 3 tasks done (33%)");
  expect(await axe(page, "main")).toEqual([]);

  // Sort and filter.
  // v1.73.0 (D-396): Filter, Sort and Group are dropdown menus (spec PORTFOLIOS §3.9-§3.11).
  await page.getByTestId("portfolio-list-tab").getByTestId("sort-menu").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitemradio", { name: "Task progress" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("portfolio-row").first()).toContainText(secret);
  await page.getByTestId("portfolio-filter").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitemradio", { name: "Has overdue tasks" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("portfolio-row")).toHaveCount(0);
  await page.getByTestId("portfolio-filter").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitem", { name: "Clear" }).click();

  // Remove one and add it back with the keyboard (Add work combobox).
  await row(page, secret).getByTestId("row-menu").locator("button[aria-haspopup]").click();
  await row(page, secret).getByTestId("remove-work").click();
  await expect(page.getByTestId("portfolio-row")).toHaveCount(1);
  const input = page.getByTestId("add-work-input");
  await input.fill(secret);
  await expect(page.getByRole("option", { name: secret })).toBeVisible();
  await input.press("Enter");
  await expect(page.getByTestId("portfolio-row")).toHaveCount(2);

  // A column of its own, with a value.
  await page.getByTestId("portfolio-customize").click();
  await page.getByTestId("column-name").fill("Phase");
  await page.getByTestId("column-kind").selectOption("SELECT");
  await page.getByTestId("column-options").fill("Plan, Build");
  await page.getByTestId("column-add").click();
  await expect(page.getByTestId("portfolio-columns")).toContainText("Phase");
  await page.keyboard.press("Escape");
  await row(page, open).getByLabel(`Phase for ${open}`).selectOption("Build");
  await page.reload();
  await expect(row(page, open).getByLabel(`Phase for ${open}`)).toHaveValue("Build");
  // Starred: in the sidebar.
  await page.getByTestId("portfolio-header").getByTestId("portfolio-star").click();
  await expect(page.getByTestId("sidebar-portfolio").filter({ hasText: `Plant upgrades ${stamp}` })).toBeVisible();
});

test("Progress: status counts and a status update; Timeline with the keyboard; Dashboard totals (axe, dark)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.goto(`${portfolioUrl}?tab=progress`);
  await expect(page.getByTestId("count-total")).toContainText("2");
  await page.getByRole("radio", { name: "At risk" }).check();
  await page.getByTestId("post-status").click();
  await expect(page.getByTestId("portfolio-progress").getByRole("alert")).toContainText("headline or a summary");
  await page.getByTestId("status-title").fill("Vendor quotes late");
  await page.getByTestId("post-status").click();
  await expect(page.getByTestId("portfolio-updates")).toContainText("Vendor quotes late");
  await expect(page.getByTestId("portfolio-header")).toContainText("At risk");
  expect(await axe(page, "main")).toEqual([]);

  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByTestId("timeline-row")).toHaveCount(2);
  await expect(page.getByTestId("timeline-bar")).toHaveCount(1);
  const range = await page.getByTestId("timeline-range").textContent();
  const first = page.getByTestId("timeline-rows").locator("[data-row-focus]").first();
  await first.focus();
  await expect(first).toHaveAttribute("aria-label", new RegExp(`^${open}: `));
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("timeline-rows").locator("[data-row-focus]").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timeline-range")).not.toHaveText(range ?? "");
  await expect(page.getByRole("status").filter({ hasText: /^Showing Q/ })).toBeAttached();
  expect(await axe(page, "main")).toEqual([]);

  await page.getByRole("link", { name: "Dashboard" }).click();
  const total = page.getByTestId("dashboard-widget").filter({ has: page.getByRole("heading", { name: "Total tasks", exact: true }) });
  await expect(total.getByTestId("chart-number")).toHaveText("3");
  const done = page.getByTestId("dashboard-widget").filter({ has: page.getByRole("heading", { name: "Total completed tasks", exact: true }) });
  await expect(done.getByTestId("chart-number")).toHaveText("1");
  const byProject = page.getByTestId("dashboard-widget").filter({ has: page.getByRole("heading", { name: "Incomplete tasks by project" }) });
  await byProject.getByTestId("widget-table-toggle").click();
  await expect(byProject.getByTestId("chart-table")).toContainText(open);
  expect(await axe(page, "main")).toEqual([]);
  await page.screenshot({ path: "test-results/v169-portfolio-dashboard-dark.png", fullPage: true });
});

test("Masking: a member who can't see a project gets a private row and figures without it (axe)", async ({ page, context }) => {
  // Sita sees the open project (a viewer of it), not the secret one.
  const staff = await userIdByLogin("E2E_STAFF");
  const req = await userIdByLogin("E2E_REQ");
  await sql("INSERT INTO project_members (project_id, member_type, member_id, role, added_by) VALUES (?, 'USER', ?, 'VIEWER', ?)", [openId, staff, req]);
  await as(context, "E2E_STAFF", "light");
  await page.goto("/users/work/portfolios");
  await page.getByRole("link", { name: `Plant upgrades ${stamp}` }).click();
  await expect(page.getByTestId("portfolio-row")).toHaveCount(2);
  const hidden = page.locator('[data-testid="portfolio-row"][data-masked="true"]');
  await expect(hidden).toHaveCount(1);
  await expect(hidden).toContainText("Private project");
  await expect(hidden).toContainText("ask Ravi Requester or the project's owner for access");
  await expect(page.getByTestId("private-work-notice")).toContainText("1 item you can't see");
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(row(page, open).getByTestId("task-progress")).toHaveText("1 of 3 tasks done (33%)");
  // A viewer changes nothing.
  await expect(page.getByTestId("add-work")).toHaveCount(0);
  await expect(page.getByTestId("remove-work")).toHaveCount(0);
  expect(await axe(page, "main")).toEqual([]);
  // The secret project itself stays closed.
  const [secretRow] = await sql<RowDataPacket[]>("SELECT id FROM projects WHERE name = ?", [secret]);
  const response = await page.goto(`/users/work/projects/${secretRow!.id}`);
  expect(response?.status()).toBe(404);
  // Ctrl K finds the portfolio.
  await page.goto("/users/work/portfolios");
  const quick = await page.request.get(`/api/me/quick?q=${encodeURIComponent(`Plant upgrades ${stamp}`)}`);
  expect(((await quick.json()) as { portfolios: { name: string }[] }).portfolios.map((item) => item.name)).toContain(`Plant upgrades ${stamp}`);
});
