import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.70.0 (D-383, PM phase E part 1) through the real screens: save a
// project as a template, preview it, find it in the gallery and start a
// project from it; duplicate with choices; import a CSV with a column mapping
// and an error row; export downloads; a My Tasks calendar address. Axe on the
// new screens, light and dark. "pm_extras" is ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const source = `Ex source ${stamp}`;
let sourceUrl = "";

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light") {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5000 }).catch(() => undefined); // v1.80.0 (D-407): menus and dialogs finish fading in first; v1.89.0 stage 4 (D-426): at most 5 s (Firefox can leave a colour transition at currentTime 0 after a theme switch; it never ends)
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary ?? ""})`).join(" | ")}`);
}

test("save as template → preview → gallery → new project from it (axe, light)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  sourceUrl = await createProject(page, source);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [`Ex alpha ${stamp}`, `Ex beta ${stamp}`]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  await page.goto(`${sourceUrl}/settings`);
  await page.getByLabel("Save as a template named").fill(`Ex template ${stamp}`);
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Ex template ${stamp}` })).toBeVisible();
  await expect(page.getByTestId("template-preview")).toContainText(`Ex alpha ${stamp}`);
  await expect(page.getByTestId("template-preview")).toContainText("Day 1");
  expect(await axe(page)).toEqual([]);

  await page.goto("/users/work/templates");
  const card = page.getByTestId("template-card").filter({ hasText: `Ex template ${stamp}` });
  await expect(card).toContainText("2 tasks");
  expect(await axe(page)).toEqual([]);
  await card.getByTestId("use-template").click();
  await expect(page).toHaveURL(/\/users\/work\/projects\/new\?template=\d+/);
  await page.getByLabel("Project name", { exact: true }).fill(`Ex from template ${stamp}`);
  await page.getByRole("button", { name: "Create from template" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Ex from template ${stamp}` })).toBeVisible();
  await expect(page.getByTestId("task-row").filter({ hasText: `Ex beta ${stamp}` })).toBeVisible();
});

test("duplicate with choices and dates moved", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  await page.goto(`${sourceUrl}/settings`);
  const parts = page.getByTestId("duplicate-parts");
  await expect(parts.getByLabel("Status updates")).not.toBeChecked();
  await parts.getByLabel("Members").uncheck();
  await page.getByLabel("New project name").fill(`Ex copy ${stamp}`);
  await page.getByLabel("Move every date by (days)").fill("7");
  await page.getByRole("button", { name: "Copy project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Ex copy ${stamp}` })).toBeVisible();
  await expect(page.getByTestId("task-row").filter({ hasText: `Ex alpha ${stamp}` })).toBeVisible();
});

test("import a CSV with a mapping and an error row; export downloads (axe, dark)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.goto(`${sourceUrl}/settings`);
  const wizard = page.getByTestId("import-wizard");
  await wizard.locator('input[type="file"]').setInputFiles({ name: "tasks.csv", mimeType: "text/csv", buffer: Buffer.from(`Task name,Deadline,Notes\nEx imported ${stamp},15/12/2030,From the file\nEx broken ${stamp},someday,\n`) });
  await wizard.getByRole("button", { name: "Read the file" }).click();
  // "Deadline" is guessed as the due date; Notes → Description by hand.
  await expect(wizard.getByTestId("map-1")).toHaveValue("due");
  await wizard.getByTestId("map-2").selectOption("description");
  await wizard.getByRole("button", { name: "3. Check the rows" }).click();
  const report = page.getByTestId("import-report");
  await expect(report).toContainText("1 row ready, 1 with problems");
  await expect(report).toContainText("isn't a date");
  expect(await axe(page, "[data-testid=import-wizard]")).toEqual([]);
  await expect(report.getByRole("button", { name: "Import 1 task" })).toBeDisabled();
  await report.getByLabel("Skip rows with problems").check();
  await report.getByRole("button", { name: "Import 1 task" }).click();
  await expect(page.getByTestId("import-outcome")).toContainText("1 task imported; 1 row with problems left out");

  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-xlsx").click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  expect(json.suggestedFilename()).toMatch(/\.json$/);

  await page.goto(sourceUrl);
  await expect(page.getByTestId("task-row").filter({ hasText: `Ex imported ${stamp}` })).toBeVisible();
});

test("a My Tasks calendar address is shown once and serves text/calendar (axe)", async ({ page, context, request }) => {
  await as(context, "E2E_REQ", "light");
  await page.goto("/users/work/my-tasks");
  const feed = page.getByTestId("my-tasks-feed");
  await feed.locator("summary").click();
  await feed.getByRole("button", { name: /Make a calendar address|Make a new address/ }).click();
  const url = await feed.getByTestId("feed-url").inputValue();
  expect(url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  expect(await axe(page, "[data-testid=my-tasks-feed]")).toEqual([]);
  const response = await request.get(new URL(url).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  expect(await response.text()).toContain("BEGIN:VCALENDAR");
  await feed.getByRole("button", { name: "Stop the address" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop it" }).click();
  await expect(feed).toContainText("No calendar address yet.");
  expect((await request.get(new URL(url).pathname)).status()).toBe(404);
});
