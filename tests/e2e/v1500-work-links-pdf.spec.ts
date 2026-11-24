import { expect, test } from "@playwright/test";
import { chooseDate, dropCustomDraft, sessionCookie, toWorkflowStep } from "./db";

// v1.50.0 (owner): a work step has Task priority and Task due date; Linked
// requests is a search over requests the person can see; the PDF downloads.
test("a work step offers Task priority and Task due date", async ({ page, context }) => {
  await dropCustomDraft("E2E_REQ");
  await context.addCookies([await sessionCookie("E2E_REQ")]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/custom");
  await page.locator("#c-title").fill(`Work options ${Date.now().toString(36)}`);
  await toWorkflowStep(page);
  await page.getByLabel("Kind of step").first().selectOption("WORK");
  const options = page.getByTestId("work-task-options").first();
  await expect(options.getByLabel("Task priority")).toHaveValue("NORMAL");
  await options.getByLabel("Task priority").selectOption("URGENT");
  // v1.89.0 stage 4 (D-426): the shared date picker (type the day, Enter).
  await chooseDate(page, options.getByLabel(/Task due date/), "2031-01-15");
  await expect(options.getByRole("button", { name: /Task due date: Wednesday 15 January 2031/ })).toBeVisible();
  // Back to an approval: the work options go away.
  await page.getByLabel("Kind of step").first().selectOption("APPROVE");
  await expect(page.getByTestId("work-task-options")).toHaveCount(0);
  await dropCustomDraft("E2E_REQ");
});

test("Linked requests: search instead of typing a number; the PDF downloads", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_REQ")]);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Its own request (the custom request starts with the reporting manager as approver).
  await dropCustomDraft("E2E_REQ");
  await page.goto("/users/custom");
  await page.locator("#c-title").fill(`Link search ${Date.now().toString(36)}`);
  await toWorkflowStep(page);
  await page.getByTestId("step-next").click();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/users\/requests\/\d+\?submitted=1/);
  const search = page.getByTestId("link-search");
  await expect(search).toHaveAttribute("placeholder", "Number or title");
  await search.fill("zz-no-such-request");
  await expect(page.getByRole("listbox", { name: "Requests you can link" })).toContainText("No request you can see matches.");

  const id = new URL(page.url()).pathname.split("/").at(-1);
  const pdf = await page.request.get(`/api/requests/${id}/summary.pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
