import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie } from "./db";

// v1.61.0 (D-367, PM phase A part 1): tabs for every view (add, rename, set
// default, reorder by keyboard, remove), Save view / Reset, the List as a
// keyboard treegrid, a 1,500-task section drawn smoothly, and axe scans.
// "pm_foundations" is ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E tabs ${stamp}`;
let projectUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const tabNames = (page: Page) => page.getByTestId("view-tabs").getByTestId("view-tab").locator("a").allInnerTexts();
async function openTabMenu(page: Page, name: string) {
  const tab = page.getByTestId("view-tab").filter({ has: page.getByRole("link", { name, exact: false }) });
  await tab.getByTestId("tab-menu").locator("button[aria-haspopup]").click(); // v1.72.0 (D-387): menus are ARIA menus (button[aria-haspopup]), not <details>.
  return tab.getByTestId("tab-menu");
}

test("a project starts with the five views; an editor adds, renames, sets default, reorders by keyboard and removes a tab", async ({ page, context }) => {
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

  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", "Timeline", "Calendar"]);
  await expect(page.getByTestId("view-tabs").getByRole("link", { name: /List/ })).toHaveAttribute("aria-current", "page");

  // Add a Board tab from the catalogue: it opens, last in the strip, with a unique name.
  await page.getByTestId("add-tab").locator("button[aria-haspopup]").click();
  await page.getByTestId("add-tab-board").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", "Timeline", "Calendar", "Board (2)"]);

  // Rename it.
  const menu = await openTabMenu(page, "Board (2)");
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("tab-rename").fill(`Team board ${stamp}`);
  await page.getByTestId("tab-rename").press("Enter");
  await expect(page.getByTestId("view-tabs").getByRole("link", { name: `Team board ${stamp}` })).toBeVisible();

  // Set as default: it carries the star, and the bare project address opens it.
  await (await openTabMenu(page, `Team board ${stamp}`)).getByRole("menuitem", { name: "Set as default" }).click();
  await expect(page.getByTestId("view-tabs").getByRole("link", { name: `Team board ${stamp} (default)` })).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.getByTestId("view-tabs").getByRole("link", { name: `Team board ${stamp} (default)` })).toHaveAttribute("aria-current", "page");

  // Reorder with the keyboard: Alt + ← twice moves it two places left (announced).
  const link = page.getByTestId("view-tabs").getByRole("link", { name: new RegExp(`Team board ${stamp}`) });
  await link.focus();
  await link.press("Alt+ArrowLeft");
  await expect(page.getByTestId("tabs-live")).toContainText("moved to position 5 of 6");
  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", "Timeline", `Team board ${stamp}`, "Calendar"]);
  await page.getByTestId("view-tabs").getByRole("link", { name: new RegExp(`Team board ${stamp}`) }).press("Alt+ArrowLeft");
  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", `Team board ${stamp}`, "Timeline", "Calendar"]);
  // The order is saved on the server (the strip is drawn at once; wait for the save).
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", `Team board ${stamp}`, "Timeline", "Calendar"]);
  expect(await axe(page)).toEqual([]);

  // Copy link works for everyone; Remove (after confirming) takes the tab away.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await (await openTabMenu(page, "Timeline")).getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied.")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await (await openTabMenu(page, "Timeline")).getByRole("menuitem", { name: "Remove" }).click();
  await expect.poll(() => tabNames(page)).toEqual(["Overview", "List", "Board", `Team board ${stamp}`, "Calendar"]);
  await page.screenshot({ path: "test-results/v161-tabs.png" });
});

test("view changes stay unsaved until Save view; Reset goes back", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=list`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [`Alpha ${stamp}`, `Beta ${stamp}`]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  const grid = page.getByTestId("project-grid");
  await expect(grid.getByTestId("unsaved-view")).toHaveCount(0);
  // Group by assignee → unsaved; Reset → back to sections.
  await grid.getByTestId("group-menu").locator("summary").click();
  await grid.getByTestId("group-by").selectOption("assignee");
  await expect(grid.getByTestId("unsaved-view")).toContainText("Unsaved changes");
  await grid.getByTestId("reset-view").click();
  await expect(grid.getByTestId("unsaved-view")).toHaveCount(0);
  await expect(grid.getByRole("rowgroup", { name: "To do" })).toBeVisible();
  // Sort by Last modified and save: it stays after a reload.
  await grid.getByTestId("sort-menu").locator("button[aria-haspopup]").click();
  await grid.getByRole("menuitemradio", { name: "Last modified" }).click();
  await page.keyboard.press("Escape");
  await grid.getByTestId("save-view").click();
  await expect(page.getByText("View saved.")).toBeVisible();
  await page.reload();
  // v1.76.0 (D-401): the chip shows the count; the sort's name is its tooltip.
  await expect(page.getByTestId("project-grid").getByTestId("sort-menu")).toContainText("Sorts: 1");
  await expect(page.getByTestId("project-grid").getByTestId("sort-menu").locator("button[aria-haspopup]")).toHaveAttribute("title", "Sorted by Last modified");
  await expect(page.getByTestId("project-grid").getByTestId("unsaved-view")).toHaveCount(0);
});

test("the List is a treegrid you can walk with the keyboard", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=list`);
  const tree = page.getByRole("treegrid", { name: "Tasks" });
  await expect(tree).toBeVisible();
  expect(Number(await tree.getAttribute("aria-rowcount"))).toBeGreaterThanOrEqual(4);
  const first = tree.locator('[data-line-index="0"]');
  await expect(first).toHaveAttribute("aria-level", "1");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("tabindex", "0");
  await first.focus();
  await page.keyboard.press("ArrowDown");
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.lineIndex ?? null);
  await expect.poll(focused).toBe("1");
  await expect(tree.locator('[data-line-index="1"]')).toHaveAttribute("aria-level", "2");
  await page.keyboard.press("ArrowLeft"); // a task → its section heading
  await expect.poll(focused).toBe("0");
  await page.keyboard.press("ArrowLeft"); // fold the section
  await expect(tree.locator('[data-line-index="0"]')).toHaveAttribute("aria-expanded", "false");
  await expect(tree.getByTestId("task-row")).toHaveCount(0);
  await page.keyboard.press("ArrowRight"); // and open it again
  await expect(tree.getByTestId("task-row")).toHaveCount(2);
  await page.keyboard.press("End");
  await expect.poll(focused).not.toBe("0");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter"); // opens the task
  await expect(page.getByTestId("task-pane")).toBeVisible();
  await page.goto(`${projectUrl}?view=list`);
  expect(await axe(page)).toEqual([]);
});

test("a 1,500-task section renders smoothly (windowed)", async ({ page, context }, testInfo) => {
  await as(context, "E2E_REQ");
  const conn = await db();
  try {
    const [[project]] = await conn.query<import("mysql2/promise").RowDataPacket[]>("SELECT id FROM projects WHERE name = ?", [projectName]);
    const projectId = Number(project!.id);
    const [[section]] = await conn.query<import("mysql2/promise").RowDataPacket[]>("SELECT id FROM project_sections WHERE project_id = ? ORDER BY position LIMIT 1", [projectId]);
    const [[seed]] = await conn.query<import("mysql2/promise").RowDataPacket[]>(
      "SELECT t.id FROM tasks t JOIN task_projects tp ON tp.task_id = t.id WHERE tp.project_id = ? ORDER BY t.id LIMIT 1",
      [projectId],
    );
    const digits = "(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
    await conn.query(
      `INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, due_at, form_data_json)
       SELECT CONCAT('P', ?, '-', n.i), t.type_version_id, CONCAT('Perf task ', LPAD(n.i, 4, '0')), 'NORMAL', 'OPEN', t.created_by, t.assignee_id, t.assigned_by, t.due_at, JSON_OBJECT()
       FROM (SELECT a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 1 AS i FROM ${digits} a, ${digits} b, ${digits} c, ${digits} e) n JOIN tasks t ON t.id = ? WHERE n.i <= 1500`,
      [stamp, Number(seed!.id)],
    );
    await conn.query(
      `INSERT INTO task_projects (task_id, project_id, section_id, position, added_by)
       SELECT t.id, ?, ?, 100000 + CAST(SUBSTRING_INDEX(t.task_no, '-', -1) AS UNSIGNED) * 1024, t.created_by FROM tasks t WHERE t.task_no LIKE CONCAT('P', ?, '-%')`,
      [projectId, Number(section!.id), stamp],
    );
  } finally {
    await conn.end();
  }
  const started = Date.now();
  await page.goto(`${projectUrl}?view=list`);
  const tree = page.getByRole("treegrid", { name: "Tasks" });
  await expect(tree).toHaveAttribute("data-virtual", "on");
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  const firstPaint = Date.now() - started;
  // Only the lines near the screen are drawn, though the table knows all of them.
  expect(Number(await tree.getAttribute("data-line-count"))).toBeGreaterThanOrEqual(1500);
  const drawn = await page.getByTestId("task-row").count();
  expect(drawn).toBeLessThan(150);
  // Scrolling to the end draws the last task; frames stay quick while scrolling.
  const scrollMs = await page.evaluate(async () => {
    const begin = performance.now();
    for (let step = 0; step < 40; step += 1) {
      window.scrollBy(0, 1500);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return performance.now() - begin;
  });
  const lineCount = Number(await tree.getAttribute("data-line-count"));
  await expect(tree.locator(`[data-line-index="${lineCount - 1}"]`)).toBeVisible();
  const longTasks = await page.evaluate(() => performance.getEntriesByType("longtask").length);
  const record = { rows: 1500, firstPaintMs: firstPaint, drawnRows: drawn, scroll40StepsMs: Math.round(scrollMs), longTasks, at: new Date().toISOString() };
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/v161-perf-1500.json", JSON.stringify(record, null, 2));
  testInfo.annotations.push({ type: "perf", description: JSON.stringify(record) });
  console.log(`PERF 1500 rows: ${JSON.stringify(record)}`);
  expect(firstPaint).toBeLessThan(15_000);
  expect(scrollMs).toBeLessThan(6_000);
  // Keyboard End reaches the last line through the window.
  await page.evaluate(() => window.scrollTo(0, 0));
  await tree.locator('[data-line-index="0"]').focus();
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.lineIndex ?? "")).toBe(String(lineCount - 1));
});

test("row density: Compact is remembered for the person", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users/work/my-tasks?view=list");
  const grid = page.getByTestId("my-grid");
  await grid.locator("summary", { hasText: "Options" }).click();
  await grid.getByTestId("options-rows-row").click();
  await grid.getByTestId("density-compact").check();
  await expect(page.locator('[data-density="compact"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-density="compact"]')).toHaveCount(1);
  await page.getByTestId("my-grid").locator("summary", { hasText: "Options" }).click();
  await page.getByTestId("my-grid").getByTestId("options-rows-row").click();
  await page.getByTestId("my-grid").getByTestId("density-comfortable").check();
  await expect(page.locator('[data-density="compact"]')).toHaveCount(0);
});

test("a commenter sees the tabs but can't change them (only Copy link)", async ({ page, context }) => {
  const conn = await db();
  try {
    await conn.query(
      `INSERT INTO project_members (project_id, member_type, member_id, role, added_by)
       SELECT p.id, 'USER', s.id, 'COMMENTER', p.owner_id FROM projects p JOIN users s ON s.login_id = 'E2E_STAFF' WHERE p.name = ?
       ON DUPLICATE KEY UPDATE role = 'COMMENTER'`,
      [projectName],
    );
  } finally {
    await conn.end();
  }
  await as(context, "E2E_STAFF");
  await page.goto(projectUrl);
  await expect(page.getByTestId("view-tabs")).toBeVisible();
  await expect(page.getByTestId("add-tab")).toHaveCount(0);
  const menu = await openTabMenu(page, "Overview");
  await expect(menu.getByRole("menuitem")).toHaveText(["Copy link"]);
});
