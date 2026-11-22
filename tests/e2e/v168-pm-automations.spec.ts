import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.68.0 (D-380, PM phase D part 2): project automations through the real
// screens. Build a rule with a path in the builder by keyboard (trigger card,
// a step, Paths with a condition, Otherwise), publish it, trigger it by
// moving a task on the Board with the keyboard, see the activity story
// "<rule> (automation)" and the run log; a "Run by hand" rule from the task
// pane's ⋯ menu; axe on the panel and the builder. "pm_automations" is ON in
// the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E automations ${stamp}`;
const ruleName = `Start work ${stamp}`;
let projectUrl = "";
let ruleUrl = "";

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

test("build a rule with a path by keyboard and publish it (with axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, projectName);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(`Alpha ${stamp}`);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: `Alpha ${stamp}` })).toBeVisible();

  await page.goto(`${projectUrl}/settings`);
  await expect(page.getByTestId("automations-panel")).toContainText("No automations yet");
  expect(await axe(page, "[data-testid=automations-panel]")).toEqual([]);
  await page.getByTestId("add-automation").press("Enter");
  await expect(page).toHaveURL(/\/automations\/\d+$/);
  ruleUrl = page.url();
  await expect(page.getByRole("heading", { name: "Add automation" })).toBeVisible();
  // BR-PROJ-081: an untitled draft; Publish stays off while anything needs setting up.
  await expect(page.getByLabel("Automation name")).toHaveValue("Untitled automation");
  await expect(page.getByTestId("rule-publish")).toBeDisabled();
  await expect(page.getByTestId("trigger-card")).toContainText("Requires setup");

  await page.getByLabel("Automation name").fill(ruleName);
  // v1.73.0 (D-396): the trigger and each step's action are dropdown menus (spec PC §2.3-§2.5), by keyboard.
  const triggerButton = page.getByTestId("trigger-type").locator("button[aria-haspopup]");
  await triggerButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("trigger-type").getByRole("menu").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitemradio", { name: "Task is moved to a section" }).focus();
  await page.keyboard.press("Enter");
  await expect(triggerButton).toBeFocused();
  await expect(triggerButton).toContainText("Task is moved to a section");
  await page.getByLabel("Section", { exact: true }).selectOption({ label: "In progress" });
  await expect(page.getByTestId("trigger-card")).not.toContainText("Requires setup");

  // A step: add a comment.
  await page.getByTestId("add-step").locator("button[aria-haspopup]").press("Enter");
  await page.getByRole("menuitem", { name: "Add a comment" }).click();
  await page.getByLabel(/^Comment \(posted by ARS-CMS Automation/).fill("Picked up by the rule.");

  // Paths: Critical ones get a note to the owners; Otherwise the priority becomes High.
  await page.getByTestId("add-paths").press("Enter");
  const path = page.getByTestId("path-card");
  await path.getByLabel("Path 1 name").fill("Critical ones");
  await path.getByLabel("Value").selectOption({ label: "Critical" });
  await path.getByRole("button", { name: "Add path 1 step" }).press("Enter");
  await path.getByRole("menuitem", { name: "Notify people" }).click();
  await path.getByLabel("Message", { exact: true }).fill("A critical task has started.");
  await path.getByLabel("The project's owners").check();
  const otherwise = page.getByTestId("otherwise");
  await otherwise.getByRole("button", { name: "Add otherwise step" }).press("Enter");
  await otherwise.getByRole("menuitem", { name: "Add a comment" }).click();
  // A step's action changes from its own dropdown.
  await otherwise.getByTestId("step-type").locator("button[aria-haspopup]").click();
  await otherwise.getByRole("menuitemradio", { name: "Change priority" }).click();
  await otherwise.getByLabel("Priority", { exact: true }).selectOption({ label: "High" });
  // Cards move with buttons too (no drag needed).
  await expect(page.getByRole("button", { name: "Move Step 1 up" })).toBeDisabled();
  await expect(page.locator("#rule-problems")).toContainText("Ready to publish.");
  expect(await axe(page, "[data-testid=automation-builder]")).toEqual([]);

  await page.getByTestId("rule-publish").press("Enter");
  await expect(page.getByTestId("rule-status")).toContainText("Published (version 1)");
  await page.goto(`${projectUrl}/settings`);
  await expect(page.getByTestId("automation-row").filter({ hasText: ruleName })).toContainText("Task is moved to “In progress” · Never run");
});

test("moving a task runs it: the activity story and the run log", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=board`);
  const live = page.getByRole("toolbar", { name: "View options" }).getByRole("status");
  await card(page, `Alpha ${stamp}`).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(live).toContainText(`Dropped Alpha ${stamp}.`);
  await page.waitForLoadState("networkidle");

  // The rule runs just after the move's answer; open the task's own page.
  await card(page, `Alpha ${stamp}`).getByRole("link").first().click();
  await page.getByTestId("task-pane").getByRole("link", { name: "Open full page" }).click();
  await expect(page).toHaveURL(/\/users\/tasks\/\d+$/);
  // The comment is posted by ARS-CMS Automation for the rule.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Picked up by the rule.").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("tabpanel").getByText("ARS-CMS Automation").first()).toBeVisible();
  // The story: "<rule> (automation)" changed the priority.
  await page.getByRole("tab", { name: "All activity" }).click();
  await expect(page.getByRole("tabpanel").getByText(`${ruleName} (automation)`).first()).toBeVisible();

  await page.goto(ruleUrl);
  const log = page.getByTestId("run-log");
  await expect(log.getByTestId("run-row")).toHaveCount(1);
  await expect(log.getByTestId("run-row").first()).toContainText("Done");
  await expect(log.getByTestId("run-row").first()).toContainText("No path matched: Otherwise");
  await expect(log.getByTestId("run-row").first()).toContainText("Priority High");
  expect(await axe(page, "[data-testid=run-log]")).toEqual([]);
});

test("a \"Run by hand\" rule from the task pane's ⋯ menu", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("add-automation").click();
  await expect(page).toHaveURL(/\/automations\/\d+$/);
  await page.getByLabel("Automation name").fill(`By hand ${stamp}`);
  await page.getByTestId("trigger-type").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitemradio", { name: "Run by hand (from a task's menu)" }).click();
  await page.getByTestId("add-step").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitem", { name: "Create subtasks" }).click();
  await page.getByLabel(/^Subtask names/).fill("Check the drawings\nSign off");
  await page.getByTestId("rule-publish").click();
  await expect(page.getByTestId("rule-status")).toContainText("Published (version 1)");

  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: `Alpha ${stamp}` }).getByRole("link").first().click();
  const pane = page.getByTestId("task-pane");
  await pane.getByTestId("pane-more").locator("button[aria-haspopup]").click(); // v1.72.0 (D-387): menus are ARIA menus (button[aria-haspopup]), not <details>.
  await pane.getByTestId("pane-more").getByRole("menuitem", { name: `Run “By hand ${stamp}”` }).click();
  await expect(page.getByText(`“By hand ${stamp}” ran.`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("task-pane")).toContainText("Check the drawings");
});
