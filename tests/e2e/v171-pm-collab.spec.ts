import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.71.0 (D-384, PM phase E part 2) through the real screens: the Messages
// tab (a thread with a file, a reply, a reaction, edit with "Show edits"),
// the Page tab (write, link a task, version history, restore), the Files tab
// (the message's file in the gallery and the list, filters) and a task's Time
// section (log by hand, start/stop, estimate, the project's total and CSV).
// Axe on each new screen, light and dark. "pm_extras" is ON in the e2e seed.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `Collab ${stamp}`;
const taskTitle = `Survey the site ${stamp}`;
let projectUrl = "";

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light") {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary ?? ""})`).join(" | ")}`);
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("Messages: a thread with a file, a reply, a reaction and an edit (axe, light)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  projectUrl = await createProject(page, projectName);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(taskTitle);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: taskTitle })).toBeVisible();

  await page.getByTestId("add-tab").click();
  await page.getByTestId("add-tab-messages").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  await expect(page.getByTestId("messages-tab")).toContainText("Start a conversation");
  expect(await axe(page, "[data-testid=messages-tab]")).toEqual([]);

  await page.getByTestId("new-message").click();
  const composer = page.getByTestId("message-composer");
  await composer.getByLabel("Subject").fill(`Kick-off ${stamp}`);
  await composer.getByRole("textbox", { name: "Message" }).fill("Welcome, everyone. The drawings are attached.");
  await composer.getByTestId("message-files").setInputFiles({ name: `drawing-${stamp}.pdf`, mimeType: "application/pdf", buffer: PDF });
  expect(await axe(page, "[data-testid=message-composer]")).toEqual([]);
  await composer.getByRole("button", { name: "Send" }).click();
  const thread = page.getByTestId("message-thread").filter({ hasText: `Kick-off ${stamp}` });
  await expect(thread).toBeVisible();
  await expect(thread.getByTestId("message").first()).toContainText("The drawings are attached.");
  await expect(thread.getByRole("link", { name: `Download drawing-${stamp}.pdf` })).toBeVisible();

  // A reply, one level.
  await thread.getByTestId("message-reply").click();
  await thread.getByRole("textbox", { name: "Reply" }).fill("Thanks, looks good.");
  await thread.getByRole("button", { name: "Reply" }).click();
  await expect(thread.getByRole("list", { name: "Replies" })).toContainText("Thanks, looks good.");

  // A reaction (a toggle with its count in its name).
  await thread.getByTestId("message").first().getByTestId("add-reaction").click();
  await thread.getByTestId("message").first().getByTestId("react-THUMBS_UP").click();
  await expect(thread.getByTestId("message").first().getByTestId("reaction-pill")).toHaveAttribute("aria-pressed", "true");

  // Edit: the earlier text is kept.
  await thread.getByTestId("message").first().getByTestId("message-edit").click();
  await thread.getByRole("textbox", { name: "Edit message" }).fill("Welcome, everyone. Drawings attached (rev B).");
  await thread.getByRole("button", { name: "Save" }).click();
  await expect(thread.getByTestId("message").first()).toContainText("(edited)");
  await thread.getByTestId("message").first().getByTestId("message-show-edits").click();
  await expect(thread.getByTestId("message-versions")).toContainText("The drawings are attached.");
  expect(await axe(page, "[data-testid=messages-tab]")).toEqual([]);
});

test("Page: write the brief, link a task, see versions and restore (axe, dark)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "dark");
  await page.goto(projectUrl);
  await page.getByTestId("add-tab").click();
  await page.getByTestId("add-tab-page").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  await expect(page.getByTestId("page-empty")).toBeVisible();
  expect(await axe(page, "[data-testid=page-tab]")).toEqual([]);

  await page.getByTestId("page-edit").click();
  await page.getByLabel("Title").fill(`Brief ${stamp}`);
  await page.getByRole("textbox", { name: "Page" }).fill("Goals: finish the survey by Friday.");
  await page.getByTestId("page-link-task").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByTestId("page-save").click();
  await expect(page.getByTestId("page-title")).toHaveText(`Brief ${stamp}`);
  await expect(page.getByTestId("page-linked")).toContainText(taskTitle);

  // A second version, then restore the first.
  await page.getByTestId("page-edit").click();
  await page.getByLabel("Title").fill(`Brief ${stamp} v2`);
  await page.getByTestId("page-save").click();
  await expect(page.getByTestId("page-title")).toHaveText(`Brief ${stamp} v2`);
  await page.getByTestId("page-versions-toggle").click();
  await expect(page.getByTestId("page-versions").getByRole("listitem")).toHaveCount(2);
  expect(await axe(page, "[data-testid=page-tab]")).toEqual([]);
  await page.getByTestId("page-versions").getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).last().click();
  await expect(page.getByTestId("page-title")).toHaveText(`Brief ${stamp}`);
});

test("Files: the message's file in the gallery and the list, with filters (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  await page.goto(projectUrl);
  await page.getByTestId("add-tab").click();
  await page.getByTestId("add-tab-files").click();
  await expect(page).toHaveURL(/\?tab=\d+/);
  const tab = page.getByTestId("files-tab");
  await expect(tab.getByTestId("file-tile").filter({ hasText: `drawing-${stamp}.pdf` })).toContainText(`Message: Kick-off ${stamp}`);
  expect(await axe(page, "[data-testid=files-tab]")).toEqual([]);
  await tab.getByTestId("files-list").click();
  await expect(tab.getByTestId("file-row")).toHaveCount(1);
  await tab.getByLabel("Type").selectOption("image");
  await expect(tab).toContainText("No files match these filters.");
  await tab.getByRole("button", { name: "Clear filters" }).click();
  await expect(tab.getByTestId("file-row")).toHaveCount(1);
  expect(await axe(page, "[data-testid=files-tab]")).toEqual([]);
  const download = await page.request.get(await tab.getByRole("link", { name: `Download drawing-${stamp}.pdf` }).getAttribute("href") ?? "");
  expect(download.status()).toBe(200);
});

test("Time: log by hand, start and stop, an estimate, the project's total and CSV (axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ", "light");
  await page.goto(projectUrl);
  await page.getByTestId("task-row").filter({ hasText: taskTitle }).getByRole("link").first().click();
  const pane = page.getByTestId("task-pane");
  const timeBox = pane.getByTestId("task-time");
  await expect(timeBox).toContainText("No time logged yet.");
  await timeBox.getByTestId("time-estimate").fill("4h");
  await timeBox.getByRole("button", { name: "Set estimate" }).click();
  await expect(timeBox.getByTestId("time-summary")).toContainText("0m of 4h estimated");
  await timeBox.getByTestId("time-duration").fill("1h 30m");
  await timeBox.getByTestId("time-note").fill("Walked the boundary");
  await timeBox.getByTestId("time-log").click();
  await expect(timeBox.getByTestId("time-entry")).toHaveCount(1);
  await expect(timeBox.getByTestId("time-summary")).toContainText("1h 30m of 4h estimated (38%)");
  await timeBox.getByTestId("time-start").click();
  await expect(timeBox.getByTestId("time-running")).toBeVisible();
  await timeBox.getByTestId("time-stop").click();
  await expect(timeBox.getByTestId("time-entry")).toHaveCount(2);
  await expect(timeBox.getByTestId("time-summary")).toContainText("1h 31m of 4h");
  expect(await axe(page, "[data-testid=task-time]")).toEqual([]);

  await page.goto(`${projectUrl}?view=overview`);
  await expect(page.getByTestId("project-time")).toBeVisible();
  await expect(page.getByText("1h 31m of 4h estimated")).toBeVisible();
  const csv = await page.request.get(`${projectUrl.replace(/^https?:\/\/[^/]+/, "")}`.replace("/users/work/projects/", "/api/work/projects/") + "/time");
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain("Walked the boundary");
  expect(text).toContain("Timer");
});
