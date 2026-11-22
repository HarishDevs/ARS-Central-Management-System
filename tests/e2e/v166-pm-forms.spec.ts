import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.66.0 (D-374, PM phase C): project intake forms through the real
// screens: build in Customize (the shared designer's intake kind) with a
// branch, a connected field and an attachment; publish; another person
// submits (required errors, the branch appearing, a file); the task appears
// at the top of the section with the mapped name; axe on the builder and
// the fill view. "pm_forms" is ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `E2E forms ${stamp}`;
let projectUrl = "";
let formLink = "";

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
async function addQuestion(page: Page, type: string, label: string) {
  await page.getByRole("button", { name: `Add a ${type} question` }).click();
  const field = page.getByLabel("Field label");
  await expect(field).toHaveValue(type === "Heading" ? "Heading" : "New question");
  await field.fill(label);
}

test("build a form with a branch, a connected field and an attachment, then publish (with axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, projectName);
  await page.goto(`${projectUrl}/settings`);
  await expect(page.getByTestId("forms-panel")).toContainText("Get started with forms");
  await page.getByTestId("add-form").click();
  await expect(page).toHaveURL(/\/forms\/\d+$/);
  await expect(page.getByRole("heading", { name: "Add form" })).toBeVisible();
  // BR-FORM-004: the title starts as the project's name; Name and Email are the signed-in person's.
  await expect(page.getByLabel("Form title")).toHaveValue(projectName);
  await expect(page.getByTestId("form-builder")).toContainText("Ravi Requester");
  // Nothing to publish yet.
  await expect(page.getByTestId("form-publish")).toBeDisabled();

  await addQuestion(page, "Text", "Summary");
  await page.getByLabel("Required: Summary").check();
  await page.getByTestId("connect-field").selectOption("task:title");
  await addQuestion(page, "Single-select", "Kind");
  // A select question without values keeps Publish off (BR-FORM-005).
  await expect(page.getByTestId("form-publish")).toBeDisabled();
  await page.getByLabel("New option for Kind").fill("Laptop");
  await page.getByLabel("New option for Kind").press("Enter");
  await page.getByLabel("New option for Kind").fill("Phone");
  await page.getByLabel("New option for Kind").press("Enter");
  await addQuestion(page, "Text", "Model");
  await page.getByLabel("Required: Model").check();
  await addQuestion(page, "Attachment", "Photo");
  // Branch: Model only for Laptop.
  await page.getByRole("button", { name: "Edit Kind" }).click();
  await page.getByRole("button", { name: "Add branch for Laptop" }).click();
  await page.getByRole("checkbox", { name: "Model" }).check();
  await expect(page.getByTestId("branches")).toContainText("shows 1");
  // Keyboard reorder still works in the intake kind (Alt+↓ then Alt+↑ back).
  await page.getByRole("button", { name: "Edit Photo" }).press("Alt+ArrowUp");
  await page.getByRole("button", { name: "Edit Photo" }).press("Alt+ArrowDown");
  expect(await axe(page, "[data-testid=form-builder]")).toEqual([]);

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByLabel("Default assignee (required)")).not.toHaveValue("");
  await page.getByLabel("Due date (required): working days after the submission").fill("2");
  await page.getByLabel("Confirmation message").fill("Thanks, IT will pick this up.");
  expect(await axe(page, "[data-testid=form-builder]")).toEqual([]);
  await expect(page.getByTestId("form-publish")).toBeEnabled();
  await page.getByTestId("form-publish").click();
  await expect(page.getByTestId("form-status")).toContainText("Published · version 1");
  await expect(page.getByRole("tab", { name: "Share" })).toHaveAttribute("aria-selected", "true");
  formLink = await page.getByTestId("form-link").inputValue();
  expect(formLink).toMatch(/\/users\/forms\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId("form-qr")).toBeVisible();

  await page.goto(`${projectUrl}/settings`);
  await expect(page.getByTestId("form-row")).toContainText("Published");
});

test("another person submits: required errors, the branch, a file, then the confirmation (with axe)", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto(formLink);
  const form = page.getByTestId("fill-form");
  await expect(form.getByRole("heading", { name: projectName })).toBeVisible();
  await expect(form).toContainText("Sita Staff");
  // The branch question waits for its option.
  await expect(form.getByLabel(/^Model/)).toHaveCount(0);
  expect(await axe(page, "[data-testid=fill-form]")).toEqual([]);
  await page.getByTestId("fill-submit").click();
  await expect(page.getByTestId("fill-errors")).toBeVisible();
  await expect(form.getByRole("alert").filter({ hasText: "This field is required" })).toHaveCount(1);
  expect(await axe(page, "[data-testid=fill-form]")).toEqual([]);
  await form.getByLabel(/^Summary/).fill(`Laptop for ${stamp}`);
  await expect(form.getByRole("alert").filter({ hasText: "This field is required" })).toHaveCount(0);
  await form.getByLabel(/^Kind/).selectOption("Laptop");
  await expect(form.getByLabel(/^Model/)).toBeVisible();
  await page.getByTestId("fill-submit").click();
  await expect(form.getByRole("alert").filter({ hasText: "This field is required" })).toHaveCount(1);
  await form.getByLabel(/^Model/).fill("ThinkPad X1");
  await page.getByLabel("Files for Photo").setInputFiles({ name: "photo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") });
  await expect(form.getByRole("list", { name: "Files chosen for Photo" })).toContainText("photo.pdf");
  await page.getByTestId("fill-submit").click();
  const done = page.getByTestId("form-confirmation");
  await expect(done).toContainText("Thanks, IT will pick this up.");
  await expect(page.getByTestId("view-request")).toBeVisible();
  await page.getByTestId("view-request").click();
  await expect(page.getByRole("heading", { name: `Laptop for ${stamp}` })).toBeVisible();
  await expect(page.locator("body")).toContainText("Model: ThinkPad X1");
  await expect(page.locator("body")).toContainText("photo.pdf");
});

test("the task is at the top of the section, made by ARS-CMS Automation", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  const first = page.getByTestId("task-row").first();
  await expect(first).toContainText(`Laptop for ${stamp}`);
  await first.getByRole("link", { name: `Laptop for ${stamp}` }).first().click();
  await expect(page.locator("body")).toContainText("ARS-CMS Automation");
  await expect(page.locator("body")).toContainText("Submitted through the form");
});
