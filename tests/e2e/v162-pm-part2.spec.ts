import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.62.0 (D-368, PM phase A part 2): the Board from the keyboard (with
// announcements), the right-side task pane (resize kept), completion with
// Undo and celebrations (none with reduced motion), delete with Undo,
// reactions, starring a project into the sidebar, the purge note, and axe.
// "pm_foundations" is ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E part2 ${stamp}`;
let projectUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const card = (page: Page, title: string) => page.getByTestId("board-card").filter({ hasText: title });
async function addOnBoard(page: Page, title: string) {
  const box = page.getByTestId("board-column").first().getByRole("textbox", { name: "Add a task" });
  await box.fill(title);
  await box.press("Enter");
  await expect(card(page, title)).toBeVisible();
}

test.beforeAll(async () => {
  // A clean start for the celebration choice and the pane width of the test person.
  const conn = await db();
  const id = await userIdByLogin("E2E_REQ");
  await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key IN ('work.pane_w', 'work.celebrations', 'work.sidebar_starred_sort')", [id]);
  await conn.end();
});

test("Board: Space lifts a card, arrows move it between cards and columns, Enter drops, Escape cancels; all announced", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, projectName);
  await page.goto(`${projectUrl}?view=board`);
  await expect(page.getByTestId("board")).toBeVisible();
  await addOnBoard(page, `Alpha ${stamp}`);
  await addOnBoard(page, `Bravo ${stamp}`);
  // Column headers show their counts.
  await expect(page.getByTestId("board-column").first()).toHaveAttribute("aria-label", /, 2 tasks$/);

  const live = page.getByRole("toolbar", { name: "View options" }).getByRole("status");
  const alpha = card(page, `Alpha ${stamp}`);
  await alpha.focus();
  await page.keyboard.press("Space");
  await expect(live).toContainText(`Picked up Alpha ${stamp}. Position 1 of 2 in`);
  await expect(alpha).toHaveAttribute("data-lifted", "true");
  await page.keyboard.press("ArrowDown");
  await expect(live).toContainText("Position 2 of 2 in");
  // Escape puts it back.
  await page.keyboard.press("Escape");
  await expect(live).toContainText(`Move cancelled. Alpha ${stamp} is back in`);
  await expect(page.locator("[data-lifted]")).toHaveCount(0);

  // Lift again, move one column right, drop with Enter.
  await card(page, `Alpha ${stamp}`).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(live).toContainText("Position 1 of 1 in");
  await page.keyboard.press("Enter");
  await expect(live).toContainText(`Dropped Alpha ${stamp}.`);
  await page.waitForLoadState("networkidle");
  await page.reload();
  const second = page.getByTestId("board-column").nth(1);
  await expect(second.getByTestId("board-card").filter({ hasText: `Alpha ${stamp}` })).toBeVisible();
  await expect(page.getByTestId("board-column").first()).toHaveAttribute("aria-label", /, 1 task$/);

  // Arrow keys move focus between cards and columns; the Alt shortcut still moves.
  await second.getByTestId("board-card").first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(card(page, `Bravo ${stamp}`)).toBeFocused();
  expect(await axe(page, "[data-testid=board]")).toEqual([]);
  await page.screenshot({ path: "test-results/v162-board.png" });
});

test("the task pane opens on the right, resizes from the keyboard, and keeps the width", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${projectUrl}?view=board`);
  await card(page, `Bravo ${stamp}`).getByRole("link").click();
  const pane = page.getByTestId("task-pane");
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
  await expect(pane.getByTestId("pane-bar")).toBeVisible();
  // v1.75.0 (D-399): a task in one private project says so ("private to members of this project", with Make public for its owner).
  await expect(pane.getByTestId("visibility-banner")).toContainText("This task is private to members of this project.");
  await expect(pane.getByTestId("mark-complete")).toBeVisible();
  await expect(pane.getByTestId("pane-collaborators")).toBeVisible();
  await expect(pane.getByTestId("pane-like")).toBeVisible();
  // The board stays usable beside it.
  await expect(page.getByTestId("board")).toBeVisible();
  const handle = pane.getByTestId("pane-resizer");
  await expect(handle).toHaveAttribute("aria-valuenow", "440");
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "488");
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(488);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("pane-resizer")).toHaveAttribute("aria-valuenow", "488");
  await expect.poll(async () => Math.round((await page.getByTestId("task-pane").boundingBox())?.width ?? 0)).toBe(488);
  expect(await axe(page, "[data-testid=task-pane]")).toEqual([]);
  await page.screenshot({ path: "test-results/v162-pane.png" });

  // On a narrow window the same task is the centred popup.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => Math.round((await page.getByTestId("task-pane").boundingBox())?.width ?? 0)).toBe(900);
});

test("Mark complete offers Undo; reactions on a comment toggle with a clear name", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${projectUrl}?view=board`);
  await card(page, `Bravo ${stamp}`).getByRole("link").click();
  const pane = page.getByTestId("task-pane");
  await pane.getByTestId("mark-complete").click();
  const toast = page.getByRole("status").filter({ hasText: `Completed: Bravo ${stamp}` });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Reopened.")).toBeVisible();
  await expect(pane.getByTestId("mark-complete")).toHaveAttribute("aria-pressed", "false");

  // A comment, then a reaction.
  const box = pane.getByRole("textbox", { name: "Add a comment" });
  await box.click();
  await box.pressSequentially(`Reaction test ${stamp}`);
  await pane.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = pane.getByTestId("comment").filter({ hasText: `Reaction test ${stamp}` });
  await expect(comment).toBeVisible();
  await comment.getByTestId("add-reaction").click();
  await comment.getByTestId("react-THUMBS_UP").click();
  const pill = comment.getByTestId("reaction-pill");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(pill).toHaveAttribute("aria-label", "thumbs up: 1 person (you). Remove your reaction");
  expect(await axe(page, "[data-testid=task-pane]")).toEqual([]);
  await pill.click();
  await expect(comment.getByTestId("reaction-pill")).toHaveCount(0);
});

test("celebrations: Always shows a burst; never with reduced motion", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/profile");
  const choice = page.getByTestId("celebration-choice");
  await expect(choice).toBeVisible();
  await choice.getByLabel("Always").check();
  await expect(page.getByText("Celebrations: Always.")).toBeVisible();
  expect(await axe(page, "[data-testid=celebration-choice]")).toEqual([]);

  await page.goto(`${projectUrl}?view=board`);
  await addOnBoard(page, `Charlie ${stamp}`);
  await addOnBoard(page, `Delta ${stamp}`);
  await card(page, `Charlie ${stamp}`).getByTestId("task-check").click();
  await expect(page.getByTestId("celebration")).toBeAttached();
  await expect(page.getByTestId("celebration")).toHaveCount(0, { timeout: 5000 }); // it cleans itself up

  // The check's animation: on normally, none with reduced motion (the card itself leaves the board once done).
  const checkAnimation = () =>
    page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "pm-check-done pm-check-anim";
      document.body.append(probe);
      const name = getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    });
  expect(await checkAnimation()).toBe("pm-check-pop");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await checkAnimation()).toBe("none");
  const check = card(page, `Delta ${stamp}`).getByTestId("task-check");
  await check.click();
  await expect(page.getByText(`Completed: Delta ${stamp}`, { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("celebration")).toHaveCount(0);
});

test("deleting a task from the pane offers Undo, which brings it back", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${projectUrl}?view=board`);
  await addOnBoard(page, `Echo ${stamp}`);
  await card(page, `Echo ${stamp}`).getByRole("link").click();
  const pane = page.getByTestId("task-pane");
  await pane.getByTestId("pane-more").locator("button[aria-haspopup]").click(); // v1.72.0 (D-387): menus are ARIA menus (button[aria-haspopup]), not <details>.
  await pane.getByTestId("pane-delete").click();
  await pane.getByTestId("pane-delete-confirm").click();
  const toast = page.getByRole("status").filter({ hasText: `Deleted: Echo ${stamp}` });
  await expect(toast).toBeVisible();
  await expect(card(page, `Echo ${stamp}`)).toHaveCount(0);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Task restored.")).toBeVisible();
  await expect(card(page, `Echo ${stamp}`)).toBeVisible();

  // Deleted again: the Deleted page says when it is removed for good.
  await card(page, `Echo ${stamp}`).getByRole("link").click();
  await page.getByTestId("task-pane").getByTestId("pane-more").locator("button[aria-haspopup]").click();
  await page.getByTestId("pane-delete").click();
  await page.getByTestId("pane-delete-confirm").click();
  await expect(page.getByRole("status").filter({ hasText: `Deleted: Echo ${stamp}` })).toBeVisible();
  await page.goto("/users/work/deleted");
  await expect(page.locator("li").filter({ hasText: `Echo ${stamp}` }).getByTestId("purge-note")).toContainText(/Removed for good on .* \(in (30|29) days\)/);
});

test("starring a project puts it in the sidebar's Starred list, which sorts and reorders", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const starred = page.getByTestId("sidebar-starred");
  await expect(starred).toBeVisible();
  await page.getByRole("button", { name: `Star ${projectName}` }).click();
  await expect(starred.getByRole("link", { name: projectName })).toBeVisible();
  // A second starred project, then reorder with Alt + arrow.
  const other = `E2E part2 second ${stamp}`;
  const otherUrl = await createProject(page, other);
  await page.goto(otherUrl);
  await page.getByRole("button", { name: `Star ${other}` }).click();
  await expect(starred.getByRole("link", { name: other })).toBeVisible();
  const names = () => starred.getByTestId("sidebar-project").allInnerTexts();
  const before = await names();
  const first = before.findIndex((name) => name.includes(projectName));
  const second = before.findIndex((name) => name.includes(other));
  expect(first).toBeGreaterThanOrEqual(0);
  const moving = first < second ? projectName : other;
  await starred.getByRole("link", { name: moving }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(starred.getByRole("status")).toContainText(`${moving} moved to position`);
  await expect.poll(async () => (await names()).findIndex((name) => name.includes(moving))).toBeGreaterThan(Math.min(first, second));
  // The sort menu.
  // v1.73.0 (D-396): the section's options are a dropdown menu (radio items).
  const sortMenu = page.getByTestId("sidebar-sort-starred");
  await sortMenu.locator("button[aria-haspopup]").click();
  await sortMenu.getByRole("menuitemradio", { name: "A–Z" }).click();
  await expect(sortMenu.locator("button[aria-haspopup]")).toHaveAttribute("aria-label", /A–Z/);
  await page.keyboard.press("Escape");
  expect(await axe(page, "[data-testid=work-sidebar]")).toEqual([]);
  await page.screenshot({ path: "test-results/v162-sidebar.png" });
});
