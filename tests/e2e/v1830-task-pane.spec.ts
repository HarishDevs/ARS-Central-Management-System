import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.83.0 (D-410, owner: "i want all tasks to be opened like this instead of
// full page; if they want they can open it in a separate dialog box, and if
// needed a new page"): a task clicked anywhere in the signed-in app opens in
// the side pane beside the screen (My Tasks, Home, the /users/tasks list,
// Search, a notification); ⤢ opens the centred dialog and its button goes
// back; Open full page and a Ctrl-click open the task's own page; a direct
// visit is still the full page; axe in light, dark and at phone width.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const title = `Pane everywhere ${stamp}`;
let taskId = 0;

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
async function resetMode() {
  const conn = await db();
  try {
    await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.pane_mode'", [await userIdByLogin("E2E_STAFF")]);
  } finally {
    await conn.end();
  }
}

test.beforeAll(async () => {
  await resetMode();
  const conn = await db();
  try {
    const me = await userIdByLogin("E2E_STAFF");
    const from = await userIdByLogin("E2E_REQ");
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const [made] = await conn.query<ResultSetHeader>(
      "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), JSON_OBJECT())",
      [`TP${stamp}`, Number(version!.id), title, from, me, from],
    );
    taskId = made.insertId;
    await conn.query("INSERT INTO notifications (event_type, category, user_id, title, message, deep_link) VALUES ('WORK_TASK_ASSIGNED', 'TASK', ?, ?, 'A task for you', ?)", [me, `New task: ${title}`, `/users/tasks/${taskId}`]);
  } finally {
    await conn.end();
  }
});
test.afterAll(resetMode);

const taskLink = (page: Page) => page.locator(`#main a[href="/users/tasks/${taskId}"]`).first();

// Click the task on a screen: the pane opens beside it, the screen stays, and
// closing puts focus back on the link.
async function opensBeside(page: Page, url: string) {
  await page.goto(url);
  const link = taskLink(page);
  await link.scrollIntoViewIfNeeded();
  const path = new URL(page.url()).pathname;
  await link.click();
  await expect(page).toHaveURL(new RegExp(`[?&]task=${taskId}(&|$)`));
  expect(new URL(page.url()).pathname).toBe(path);
  const pane = page.getByTestId("task-pane");
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
  await expect(pane).toContainText(title);
  await expect(pane.locator("[data-pane-focus]")).toBeFocused();
  // The screen behind stays in place and usable.
  await expect(page.locator("#main")).toBeVisible();
  await pane.getByTestId("close-pane").click();
  await expect(pane).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("task")).toBeNull();
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(taskLink(page)).toBeFocused();
}

test("a task opens in the side pane from My Tasks, Home, the tasks list, Search and a notification", async ({ page, context }) => {
  test.setTimeout(120_000);
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await opensBeside(page, "/users/work/my-tasks");
  await opensBeside(page, "/users?home=tasks");
  await opensBeside(page, "/users/tasks");
  await opensBeside(page, `/users/work/search?q=${encodeURIComponent(title)}`);
  await opensBeside(page, "/users/inbox");
  // Escape closes it on a screen outside the Tasks area too.
  await page.goto("/users/inbox");
  await taskLink(page).click();
  await expect(page.getByTestId("task-pane")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  await expect(page).toHaveURL(/\/users\/inbox$/);
  // The pane's close address is the screen's own, on a screen with an id in its address too.
  await page.goto(`/users/work/search?q=${encodeURIComponent(title)}`);
  await taskLink(page).click();
  await expect(page.getByTestId("task-pane")).toHaveAttribute("data-close-href", /^\/users\/work\/search\?q=Pane/);
});

test("⤢ opens the centred dialog, which goes back to the side pane (kept for the person)", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/tasks?task=${taskId}`);
  const pane = page.getByTestId("task-pane");
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
  await pane.getByTestId("pane-expand").click();
  await expect(pane).toHaveAttribute("data-pane-mode", "dialog");
  await expect(pane).toHaveAttribute("aria-modal", "true");
  await expect(pane).toContainText(title);
  // Remembered: another screen opens it in the dialog too.
  await page.goto(`/users/work/my-tasks?task=${taskId}`);
  await expect(pane).toHaveAttribute("data-pane-mode", "dialog");
  await pane.getByTestId("pane-to-side").click();
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
});

test("Open full page, a Ctrl-click and a direct visit open the task's own page", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/tasks?task=${taskId}`);
  await page.getByTestId("task-pane").getByTestId("pane-full").click();
  await expect(page).toHaveURL(new RegExp(`/users/tasks/${taskId}$`));
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);

  // Ctrl-click on a list's link: a new tab with the full page; this one is unchanged.
  await page.goto("/users/tasks");
  const [tab] = await Promise.all([context.waitForEvent("page"), taskLink(page).click({ modifiers: ["Control"] })]);
  await tab.waitForURL(new RegExp(`/users/tasks/${taskId}$`));
  await expect(tab.getByTestId("task-pane")).toHaveCount(0);
  await tab.close();
  expect(new URL(page.url()).searchParams.get("task")).toBeNull();

  // A direct visit (an email or a copied link) and a refresh stay on the full page.
  await page.goto(`/users/tasks/${taskId}`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
});

test("Back and refresh keep the pane; axe in light, dark and at phone width", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/tasks");
  await taskLink(page).click();
  const pane = page.getByTestId("task-pane");
  await expect(pane).toBeVisible();
  await page.reload();
  await expect(pane).toContainText(title);
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axe(page)).toEqual([]);
  await page.goBack();
  await expect(pane).toHaveCount(0);
  await page.goForward();
  await expect(pane).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  // Phone width: the pane fills the screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/users/tasks?task=${taskId}`);
  await expect(pane).toContainText(title);
  const box = await page.getByTestId("task-pane-body").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(370);
  expect(await axe(page)).toEqual([]);
});
