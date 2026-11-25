import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie } from "./db";
import { createProject } from "./work-helpers";

// v1.88.0 (D-418, owner: "use all these as simple formulas"; spec
// FORMULA_FIELDS): the formula editor through the real screens: the task
// dates and Today in Select field, operators typed by the input (a date can
// only be subtracted), the Functions list with its help card and Insert, a
// ready-made formula (TAT) and one that asks for a date field (Delay), live
// checking, Formatting only for a valid number formula, the preview on a
// task of the project, and the values in the List.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const alpha = `Fx alpha ${stamp}`;
let projectUrl = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title }).first();
async function openAdd(page: Page, name: string) {
  await page.getByTestId("add-field").click();
  const dialog = page.getByTestId("field-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Field title").fill(name);
  return dialog;
}
async function save(page: Page, name: string) {
  await page.getByTestId("field-dialog-save").click();
  await expect(page.getByRole("list", { name: "Fields", exact: true })).toContainText(name);
}

test("formulas with functions and presets, checked live, shown in the List", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, `E2E formulas ${stamp}`);
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(alpha);
  await add.press("Enter");
  await expect(row(page, alpha)).toBeVisible();
  // Monday 23 Nov → Friday 27 Nov 2026 (due stored in UTC; India day 27 Nov).
  const conn = await db();
  try {
    await conn.query("UPDATE tasks SET starts_on = '2026-11-23', due_at = '2026-11-27 12:00:00' WHERE title = ?", [alpha]);
  } finally {
    await conn.end();
  }

  await page.goto(`${projectUrl}/settings`);
  let dialog = await openAdd(page, "Review");
  await dialog.getByLabel("Field type").selectOption("DATE");
  await save(page, "Review");

  // A ready-made formula: TAT = DAYS([Start date], [Due date]), with the preview.
  dialog = await openAdd(page, "TAT");
  await dialog.getByLabel("Field type").selectOption("FORMULA");
  await dialog.getByRole("button", { name: /ready-made formula TAT/ }).click();
  const box = dialog.getByRole("textbox", { name: "Formula" });
  await expect(box).toHaveValue("DAYS([Start date], [Due date])");
  await expect(page.getByTestId("formula-check")).toContainText("the result is a number");
  await expect(page.getByTestId("formula-preview")).toContainText(`4 on`);
  await expect(page.getByTestId("formula-preview")).toContainText(alpha);
  await expect(dialog.getByRole("tab", { name: "Formatting" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include("[data-testid='field-dialog']").withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id)).toEqual([]);
  await save(page, "TAT");

  // A preset that needs a project date field asks for one (no "Revised Target" here).
  dialog = await openAdd(page, "Delay");
  await dialog.getByLabel("Field type").selectOption("FORMULA");
  await dialog.getByRole("button", { name: /ready-made formula Delay:/ }).click();
  await expect(page.getByTestId("preset-field")).toContainText("Revised Target");
  await page.getByTestId("preset-field").getByRole("combobox").selectOption({ label: "Review" });
  await page.getByTestId("preset-field").getByRole("button", { name: "Use Delay" }).click();
  await expect(box).toHaveValue("DAYS([Start date], [Review])");
  await page.keyboard.press("Escape");

  // A function, typed and through the Functions list; operators follow the input's type.
  dialog = await openAdd(page, "Follow-up");
  await dialog.getByLabel("Field type").selectOption("FORMULA");
  await dialog.getByLabel("Field to insert").selectOption({ label: "Due date" });
  await expect(dialog.getByRole("button", { name: "Insert plus" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Insert minus" })).toBeEnabled();
  await dialog.getByLabel("Field to insert").selectOption({ label: "Today" });
  await expect(dialog.getByRole("button", { name: "Insert times" })).toBeDisabled();
  await dialog.getByTestId("formula-functions").locator("summary").click();
  await dialog.getByRole("button", { name: "DATEADD", exact: true }).click();
  await expect(page.getByTestId("function-help")).toContainText("DATEADD(date, days)");
  await expect(page.getByTestId("function-help")).toContainText("Example: DATEADD([Due date], 5)");
  await page.getByTestId("function-help").getByRole("button", { name: "Insert DATEADD" }).click();
  await expect(box).toHaveValue("DATEADD()");
  // Wrong first: a date can't be multiplied; Formatting stays locked.
  await box.fill("[Due date] * 2");
  await expect(page.getByTestId("formula-check")).toContainText("can't be multiplied");
  await expect(dialog.getByRole("tab", { name: "Formatting" })).toBeDisabled();
  await expect(page.getByTestId("field-dialog-save")).toBeDisabled();
  await box.fill("dateadd([Due date], 3)");
  await expect(page.getByTestId("formula-check")).toContainText("the result is a date");
  await expect(dialog.getByRole("tab", { name: "Formatting" })).toBeDisabled(); // formatting is for numbers
  await expect(page.getByTestId("formula-preview")).toContainText("30 Nov 2026");
  await save(page, "Follow-up");

  // The List shows both, worked out by the server.
  await page.goto(projectUrl);
  await expect(row(page, alpha).getByLabel(`TAT of ${alpha}: 4 (calculated)`)).toBeVisible();
  await expect(row(page, alpha).getByLabel(`Follow-up of ${alpha}: 30 Nov 2026 (calculated)`)).toBeVisible();
});

test("Help has a Formulas topic with the functions and the ready-made formulas", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/help");
  await page.locator("#help-search").fill("WORKDAYS");
  await expect(page.getByText("Formulas", { exact: true }).first()).toBeVisible();
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const word of ["WORKDAYS(from, to)", "COALESCE(value, fallback)", "TAT = DAYS([Start date], [Due date])", "NFD Delay = DAYS(TODAY(), [NFD])"]) expect(text).toContain(word); // v1.90 (D-430): the preset uses TODAY()
});
