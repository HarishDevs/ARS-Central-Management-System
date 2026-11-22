import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.63.0 (D-369, PM phase A part 3): My Tasks tabs (add, rename, reorder by
// keyboard, Save view / Reset, per person), Recently assigned, and Home: the
// greeting, customising widgets with the keyboard (pick up, move, drop),
// width, remove and add back, the private notepad, and axe scans.
// "pm_foundations" is ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const tabNames = (page: Page) => page.getByTestId("view-tabs").getByTestId("view-tab").locator("a").allInnerTexts();
const widgetKinds = (page: Page) => page.getByTestId("home-widget").evaluateAll((items) => items.map((item) => item.getAttribute("data-kind")));

async function cleanUp() {
  const conn = await db();
  try {
    for (const login of ["E2E_REQ", "E2E_STAFF"]) {
      const id = await userIdByLogin(login);
      await conn.query("DELETE FROM home_layouts WHERE user_id = ?", [id]);
      await conn.query("DELETE FROM home_notes WHERE user_id = ?", [id]);
      await conn.query("DELETE FROM work_views WHERE scope = 'MY_TASKS' AND scope_id = ?", [id]);
      await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.my_tabs_set'", [id]);
    }
  } finally {
    await conn.end();
  }
}
test.beforeAll(cleanUp);
test.afterAll(cleanUp);

test("My Tasks: the person's own tabs, added, renamed, reordered by keyboard, saved and reset; Recently assigned", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await expect.poll(() => tabNames(page)).toEqual(["List", "Board", "Calendar"]);
  await expect(page.getByRole("navigation", { name: "Task Summary views" })).toBeVisible();
  // The new section is there, after Overdue.
  await expect(page.getByRole("rowgroup", { name: "Recently assigned" })).toBeVisible();

  // Add a Board tab: it opens, last. v1.76.0 (D-401): personal tab names may repeat (was "Board (2)").
  await page.getByTestId("add-tab").locator("button[aria-haspopup]").click(); // v1.72.0 (D-387): menus are ARIA menus (button[aria-haspopup]), not <details>.
  await expect(page.getByTestId("add-tab-timeline")).toHaveCount(0);
  await page.getByTestId("add-tab-board").click();
  await expect(page).toHaveURL(/my-tasks\?tab=\d+/);
  await expect(page.getByTestId("my-board")).toBeVisible();
  await expect.poll(() => tabNames(page)).toEqual(["List", "Board", "Calendar", "Board"]);

  // Rename it, then move it left with Alt + ← (announced, kept after reload).
  const tab = page.getByTestId("view-tab").filter({ has: page.getByRole("link", { name: "Board" }) }).last();
  await tab.getByTestId("tab-menu").locator("button[aria-haspopup]").click();
  await tab.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("tab-rename").fill(`Mine ${stamp}`);
  await page.getByTestId("tab-rename").press("Enter");
  const link = page.getByTestId("view-tabs").getByRole("link", { name: new RegExp(`Mine ${stamp}`) });
  await expect(link).toBeVisible();
  await link.focus();
  await link.press("Alt+ArrowLeft");
  await expect(page.getByTestId("tabs-live")).toContainText("moved to position 3 of 4");
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect.poll(() => tabNames(page)).toEqual(["List", "Board", `Mine ${stamp}`, "Calendar"]);

  // The List: v1.76.0 (D-401, owner) a personal tab saves itself (no Save
  // view, no Unsaved changes); Reset goes back to the tab's starting view.
  await page.getByTestId("view-tabs").getByRole("link", { name: /^List/ }).click();
  const grid = page.getByTestId("my-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId("unsaved-view")).toHaveCount(0);
  await expect(grid.getByTestId("save-view")).toHaveCount(0);
  await grid.getByTestId("group-menu").locator("summary").click();
  await grid.getByTestId("group-by").selectOption("priority");
  await expect(grid.getByTestId("auto-save")).toContainText("Saved");
  await grid.getByTestId("reset-view").click();
  await expect(grid.getByTestId("reset-view")).toHaveCount(0);
  await grid.getByTestId("sort-menu").locator("button[aria-haspopup]").click();
  await grid.getByRole("menuitemradio", { name: "Last modified" }).click();
  await page.keyboard.press("Escape");
  await expect(grid.getByTestId("auto-save")).toContainText("Saved");
  await page.waitForTimeout(1500);
  await page.reload();
  // v1.76.0 (D-401): the chip shows the count; the sort's name is its tooltip.
  await expect(page.getByTestId("my-grid").getByTestId("sort-menu")).toContainText("Sorts: 1");
  await expect(page.getByTestId("my-grid").getByTestId("sort-menu").locator("button[aria-haspopup]")).toHaveAttribute("title", "Sorted by Last modified");
  expect(await axe(page)).toEqual([]);

  // Someone else sees only their own three tabs.
  await as(context, "E2E_STAFF");
  await page.goto("/users/work/my-tasks");
  await expect.poll(() => tabNames(page)).toEqual(["List", "Board", "Calendar"]);
});

test("Home: greeting with the date; customise widgets with the keyboard; width, remove, add back; notepad; axe", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users?home=tasks");
  const greeting = page.getByTestId("home-greeting");
  await expect(greeting).toContainText(/Good (morning|afternoon|evening), Ravi Requester/);
  await expect(greeting).toContainText(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  // Existing Home content stays (as widgets).
  await expect(page.getByRole("heading", { level: 1, name: /My Work/ })).toBeVisible();
  for (const key of ["total", "upcoming", "overdue", "completed"]) await expect(page.getByTestId(`work-kpi-${key}`)).toBeVisible();
  const start = await widgetKinds(page);
  // v1.66.0 (D-374): Forms joined the default widgets (pm_forms is ON in the e2e seed).
  expect(start).toEqual(["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people", "forms"]);
  await expect(page.getByTestId("people-widget")).toContainText("You report to Manoj Manager");

  // Customise: pick up Private notepad with Space, ↑ twice, drop with Enter.
  await page.getByTestId("customise-home").click();
  await expect(page.getByTestId("customise-home")).toHaveAttribute("aria-pressed", "true");
  const handle = page.getByRole("button", { name: "Move Private notepad", exact: true });
  await handle.focus();
  await handle.press("Space");
  await expect(page.getByTestId("home-live")).toContainText("Picked up Private notepad, position 4 of 8");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("home-live")).toContainText("Private notepad, position 2 of 8");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("home-live")).toContainText("dropped at position 2 of 8");
  // Escape puts a picked-up widget back.
  await page.getByRole("button", { name: "Move People", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("home-live")).toContainText("Move cancelled");
  // Alt + ↓ moves at once.
  await page.getByRole("button", { name: "Move My Tasks", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("home-live")).toContainText("My Tasks moved to position 2 of 8");

  // Full width for the notepad; remove Workload.
  const notepad = page.getByTestId("home-widget").filter({ has: page.getByTestId("home-notepad") });
  await notepad.getByTestId("widget-size-full").click();
  await expect(notepad).toHaveAttribute("data-size", "full");
  await page.getByRole("button", { name: "Remove My weekly workload" }).click();
  await expect(page.getByTestId("home-widget").and(page.locator('[data-kind="workload"]'))).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(await axe(page)).toEqual([]);

  // Kept after a reload.
  await page.reload();
  await expect.poll(() => widgetKinds(page)).toEqual(["notepad", "my_tasks", "projects", "status_updates", "assigned", "people", "forms"]);
  await expect(page.getByTestId("home-widget").and(page.locator('[data-kind="notepad"]'))).toHaveAttribute("data-size", "full");

  // Add it back from the menu: it comes last.
  await page.getByTestId("customise-home").click();
  await page.getByTestId("add-widget").locator("button[aria-haspopup]").click(); // v1.73.0 (D-396): a dropdown menu
  await page.getByTestId("add-widget-workload").click();
  await expect.poll(() => widgetKinds(page)).toEqual(["notepad", "my_tasks", "projects", "status_updates", "assigned", "people", "forms", "workload"]);
  await expect(page.getByTestId("workload-chart")).toBeVisible();
  await page.getByTestId("customise-home").click();

  // The notepad saves by itself and only its owner sees it.
  const editor = page.getByTestId("home-notepad").getByRole("textbox", { name: "Private notepad" });
  await editor.click();
  await page.keyboard.type(`Call the vendor ${stamp}`);
  await expect(page.getByTestId("note-status")).toHaveText("Saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("home-notepad")).toContainText(`Call the vendor ${stamp}`);
  expect(await axe(page)).toEqual([]);

  await as(context, "E2E_STAFF");
  await page.goto("/users?home=tasks");
  await expect(page.getByTestId("home-notepad")).toBeVisible();
  await expect(page.getByTestId("home-notepad")).not.toContainText(stamp);
  expect(await widgetKinds(page)).toEqual(start);

  // The approvals Home keeps its tables and gets the greeting.
  await as(context, "E2E_MGR");
  await page.goto("/users?home=approvals");
  await expect(page.getByTestId("home-greeting")).toContainText("Manoj Manager");
  await expect(page.getByRole("heading", { level: 1, name: "Approvals – Overview" })).toBeVisible(); // v1.79.0 (D-406): one title pattern on all three overviews
  await expect(page.locator('[data-tour="overview-tiles"]')).toBeVisible();
});

test("Home at phone-like width: one column, nothing cut off", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/users?home=tasks");
  await expect(page.getByTestId("home-widgets")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
