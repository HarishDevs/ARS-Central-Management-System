import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.64.0 (D-371, PM phase B part 1): custom fields through the real screens:
// the Add field dialog for each of the 11 types, inline values in the List,
// filter, sort and group by a field (saved in the tab), Board columns by a
// field with a keyboard move, the task pane rows, library reuse, and axe.
// "pm_planning" is ON in the e2e seed (global-setup).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const alpha = `Alpha ${stamp}`;
const beta = `Beta ${stamp}`;
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
async function addField(page: Page, name: string, type: string, fill?: (dialog: ReturnType<Page["getByTestId"]>) => Promise<void>) {
  await page.getByTestId("add-field").click();
  const dialog = page.getByTestId("field-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Field title").fill(name);
  await dialog.getByLabel("Field type").selectOption(type);
  if (fill) await fill(dialog);
  await page.getByTestId("field-dialog-save").click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText(name);
}
const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title }).first();

test("the Add field dialog makes each of the 11 types (with axe)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E fields ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  for (const title of [alpha, beta]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(row(page, title)).toBeVisible();
  }
  await page.goto(`${projectUrl}/settings`);
  // AC-PROJC-01/02: Single-select with two empty options; Create disabled without a title.
  await page.getByTestId("add-field").click();
  const dialog = page.getByTestId("field-dialog");
  await expect(dialog.getByLabel("Field type")).toHaveValue("SELECT");
  await expect(dialog.getByLabel("Option 1", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Option 2", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("field-dialog-save")).toBeDisabled();
  expect(await axe(page, "dialog")).toEqual([]);
  // AC-PROJC-05: Lookup without a reference field.
  await dialog.getByLabel("Field type").selectOption("LOOKUP");
  await expect(dialog.getByRole("alert")).toContainText("No reference fields are available");
  // AC-PROJC-06: no notify for Text.
  await dialog.getByLabel("Field type").selectOption("TEXT");
  await expect(page.getByTestId("field-notify")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await addField(page, "Stage", "SELECT", async (box) => {
    await box.getByLabel("Option 1", { exact: true }).fill("To do");
    await box.getByLabel("Option 2", { exact: true }).fill("Done");
    // Keyboard reorder: Alt+↓ moves "To do" below "Done", Alt+↑ back.
    await box.getByLabel("Option 1", { exact: true }).press("Alt+ArrowDown");
    await expect(box.getByLabel("Option 1", { exact: true })).toHaveValue("Done");
    await box.getByLabel("Option 2", { exact: true }).press("Alt+ArrowUp");
    await expect(box.getByLabel("Option 1", { exact: true })).toHaveValue("To do");
    await box.getByLabel("Colour of option 2").selectOption("6");
  });
  await addField(page, "Cost", "NUMBER", async (box) => {
    await box.getByLabel("Format").selectOption("currency");
    await box.getByLabel("Decimal places").selectOption("2");
    await expect(page.getByTestId("number-example")).toHaveText("₹1,000.00");
  });
  await addField(page, "Hours", "NUMBER");
  await addField(page, "Rate", "FORMULA", async (box) => {
    await box.getByLabel("Field to insert").selectOption({ label: "Cost (Number)" });
    await box.getByRole("button", { name: "Insert field" }).click();
    await box.getByRole("button", { name: "Insert divided by" }).click();
    await box.getByLabel("Field to insert").selectOption({ label: "Hours (Number)" });
    await box.getByRole("button", { name: "Insert field" }).click();
    await expect(box.getByRole("textbox", { name: "Formula" })).toHaveValue("[Cost] ÷ [Hours]");
  });
  await addField(page, "Plants", "MULTI_SELECT", async (box) => {
    await box.getByLabel("Option 1", { exact: true }).fill("Raipur");
    await box.getByLabel("Option 2", { exact: true }).fill("Bilaspur");
  });
  await addField(page, "Review", "DATE");
  await addField(page, "Reviewer", "PEOPLE", async () => {
    await page.getByTestId("field-notify").check();
  });
  await addField(page, "Notes", "TEXT");
  await addField(page, `PO ${stamp}`, "ID", async (box) => {
    await expect(page.getByTestId("id-preview")).toHaveText("—");
    await box.getByLabel("Prefix").fill("po");
    await expect(page.getByTestId("id-preview")).toHaveText("PO-1");
    await expect(page.getByTestId("field-library")).toBeChecked();
    await expect(page.getByTestId("field-library")).toBeDisabled();
  });
  await addField(page, "Time", "TIMER");
  await addField(page, "Linked", "REFERENCE");
  await addField(page, "Linked stage", "LOOKUP", async (box) => {
    await box.getByLabel("Reference field").selectOption({ label: "Linked" });
    await box.getByLabel("Field to show from the linked task").selectOption({ label: "Stage" });
  });
  await expect(page.getByTestId("field-row")).toHaveCount(12);
  expect(await axe(page, "[data-testid='fields-panel']")).toEqual([]);
});

test("values change inline in the List; formula, ID and timer; filter, sort and group by a field, saved with the tab", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(projectUrl);
  await expect(page.getByRole("columnheader", { name: /Stage/ })).toBeVisible();
  // AC-PROJC-04: every task got an ID in list order.
  await expect(row(page, alpha).getByTestId("field-readonly").filter({ hasText: "PO-1" })).toBeVisible();
  await expect(row(page, beta).getByTestId("field-readonly").filter({ hasText: "PO-2" })).toBeVisible();
  await page.getByLabel(`Stage of ${alpha}`, { exact: true }).selectOption("Done");
  await page.waitForLoadState("networkidle");
  const cost = page.getByLabel(`Cost of ${alpha}`, { exact: true });
  await cost.click();
  await cost.fill("1234.5");
  await cost.press("Enter");
  await expect(page.getByLabel(`Cost of ${alpha}`, { exact: true })).toHaveValue("₹1,234.50"); // AC-PROJC-07
  const hours = page.getByLabel(`Hours of ${alpha}`, { exact: true });
  await hours.click();
  await hours.fill("2");
  await hours.press("Enter");
  await expect(row(page, alpha).getByLabel(`Rate of ${alpha}: 617 (calculated)`)).toBeVisible();
  const notes = page.getByLabel(`Notes of ${alpha}`, { exact: true });
  await notes.fill("Check invoice");
  await notes.press("Enter");
  await page.waitForLoadState("networkidle");
  await row(page, alpha).getByRole("button", { name: `Start your timer for Time of ${alpha}` }).click();
  await expect(row(page, alpha).getByRole("button", { name: `Stop your timer for Time of ${alpha}` })).toHaveAttribute("aria-pressed", "true");
  // Multi-select with the keyboard.
  await row(page, alpha).getByRole("button", { name: new RegExp(`Plants of ${alpha}`) }).click();
  await page.getByRole("dialog", { name: `Plants of ${alpha}` }).getByRole("checkbox").first().check();
  await page.keyboard.press("Escape");
  await expect(row(page, alpha)).toContainText("Raipur");
  await page.reload();
  await expect(page.getByLabel(`Stage of ${alpha}`, { exact: true })).toHaveValue("Done");
  await expect(page.getByLabel(`Notes of ${alpha}`, { exact: true })).toHaveValue("Check invoice");

  // Filter by a field (Filters panel).
  await page.getByTestId("filter-menu").locator("summary").click();
  await page.getByTestId("add-field-filter").click();
  const filters = page.getByTestId("field-filters");
  await filters.getByLabel("Field", { exact: true }).selectOption({ label: "Stage" });
  await filters.getByLabel("How Stage is compared").selectOption("is");
  await filters.getByLabel("Stage value").selectOption({ label: "Done" });
  await page.keyboard.press("Escape");
  await expect(row(page, alpha)).toBeVisible();
  await expect(page.getByTestId("task-row").filter({ hasText: beta })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row(page, beta)).toBeVisible();
  // The column menu: sort descending, then group by this field.
  // v1.72.0 (D-387): the column ▾ is an ARIA menu.
  await page.getByRole("button", { name: "Show options for Cost column" }).click();
  await page.getByRole("menuitem", { name: "Sort descending" }).click();
  await expect(page.getByTestId("task-row").first()).toContainText(alpha);
  await page.getByRole("button", { name: "Show options for Stage column" }).click();
  await page.getByRole("menuitem", { name: "Group by this field" }).click();
  await expect(page.getByRole("rowgroup", { name: "Done" })).toBeVisible();
  await expect(page.getByRole("rowgroup", { name: "No Stage" })).toBeVisible();
  // Saved with the tab: Save view, reload, still grouped.
  await page.getByTestId("save-view").click();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("rowgroup", { name: "Done" })).toBeVisible();
  expect(await axe(page, "[data-testid='project-grid']")).toEqual([]);
});

test("Board columns by a field: a keyboard move sets the option; the task pane edits values", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto(`${projectUrl}?view=board`);
  await page.getByTestId("board-group").locator("summary").click(); // v1.72.0 (D-387): columns are chosen in the Group popover
  await page.getByTestId("board-columns").selectOption({ label: "Stage" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /^Done, 1 task$/ })).toBeVisible();
  const card = page.getByTestId("board-card").filter({ hasText: beta });
  await card.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: /^Done, 2 tasks$/ })).toBeVisible();
  await expect(page.getByTestId("board-card").filter({ hasText: alpha }).getByTestId("card-fields")).toContainText("Done");
  // Pane rows: Notes edited from the task.
  await page.getByTestId("board-card").filter({ hasText: beta }).getByRole("link").click();
  // v1.75.0 (D-399): a project shows five fields in the pane, then "Show N more".
  await expect(page.getByTestId("task-pane").getByTestId("pane-field").first()).toBeVisible();
  const moreFields = page.getByTestId("task-pane").getByTestId("fields-more");
  if (await moreFields.first().isVisible().catch(() => false)) await moreFields.first().click();
  const paneNotes = page.getByTestId("pane-field").filter({ hasText: "Notes" }).getByRole("textbox");
  await paneNotes.fill("From the pane");
  await paneNotes.press("Enter");
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("task-pane").getByTestId("pane-field").first()).toBeVisible();
  await page.getByTestId("task-pane").getByTestId("fields-more").first().click();
  await expect(page.getByTestId("pane-field").filter({ hasText: "Notes" }).getByRole("textbox")).toHaveValue("From the pane");
});

test("a library field is added to another project from the library", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  const other = await createProject(page, `E2E fields two ${stamp}`);
  await page.goto(`${other}/settings`);
  await page.getByTestId("add-field").click();
  await page.getByRole("tab", { name: "Choose from library" }).click();
  await page.getByLabel("Search the field library").fill(stamp);
  await page.getByRole("button", { name: `Add PO ${stamp} to this project` }).click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText(`PO ${stamp}`);
  // Delete with confirmation, then restore (30 days).
  await page.getByRole("button", { name: `Remove PO ${stamp} from this project` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("list", { name: "Removed fields" })).toContainText(`PO ${stamp}`);
  await page.getByRole("button", { name: "Add back" }).click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText(`PO ${stamp}`);
});
