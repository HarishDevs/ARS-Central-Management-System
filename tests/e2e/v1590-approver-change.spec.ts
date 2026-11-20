import { expect, test, type BrowserContext } from "@playwright/test";
import { raisePurchase, sessionCookie } from "./db";

// v1.59.0 (owner): an approver changes a request's details from the Waiting
// for me table (D-357), and a request they sent back for changes stays on
// their Waiting for me, marked Sent back (D-356).
test.describe.configure({ mode: "serial" });

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}

const stamp = Date.now().toString(36);
let requestPath = "";

test("the approver changes the amount and adds a level from the Waiting for me table", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  requestPath = await raisePurchase(page, `Change check ${stamp}`, "1000");

  await as(context, "E2E_MGR");
  await page.goto("/users/queue");
  const row = page.getByRole("row").filter({ hasText: `Change check ${stamp}` });
  await row.getByTestId("change-details").click();
  const form = page.getByTestId("change-details-form");
  await expect(form).toBeVisible();
  await form.getByLabel(/Amount/).fill("1200");
  // Levels after the Manager: HOD stays; add a Finance level.
  await expect(form.getByTestId("cd-levels")).toContainText("HOD");
  await form.getByTestId("cd-add-level").click();
  const added = form.getByTestId("cd-levels").getByRole("listitem").last();
  await added.getByLabel("Level name").fill("Finance");
  await added.getByRole("combobox").last().fill("Elena");
  await page.getByRole("option", { name: /Elena Admin/ }).first().click();
  await form.getByLabel(/Reason for the change/).fill("Price confirmed with the vendor");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByText(/Details changed/)).toBeVisible();

  // The request's history says who changed what, and why; it waits for the Manager again.
  await page.goto(requestPath);
  await expect(page.locator("main")).toContainText("changed Amount");
  await expect(page.locator("main")).toContainText("Price confirmed with the vendor");
  await expect(page.locator("main")).toContainText("Finance");
});

test("sent back for changes stays on the approver's Waiting for me", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto(requestPath);
  await page.getByLabel(/Comment/).fill("Attach the vendor quote");
  await page.getByRole("button", { name: "Ask for changes", exact: true }).click();
  await expect(page.locator("main")).toContainText(/Changes required|changes/i);
  await page.goto("/users/queue");
  const sent = page.getByTestId("sent-back");
  await expect(sent.getByTestId("sent-back-row").filter({ hasText: `Change check ${stamp}` })).toContainText("Attach the vendor quote");
  await expect(sent).toContainText("Sent back");
});
