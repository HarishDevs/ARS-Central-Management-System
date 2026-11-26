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
  await expect(page.getByTestId("toast-region").getByText(/Details changed/)).toBeVisible(); // v1.80.0 (D-407): a toast

  // The request's history says who changed what, and why; it waits for the Manager again.
  await page.goto(requestPath);
  await expect(page.locator("main")).toContainText("changed Amount");
  await expect(page.locator("main")).toContainText("Price confirmed with the vendor");
  await expect(page.locator("main")).toContainText("Finance");
});

test("sent back for changes: its own page (sidebar) with every table feature (v1.59.1; no link on Waiting for me since v1.91.1)", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto(requestPath);
  await page.getByLabel(/Comment/).fill("Attach the vendor quote");
  await page.getByRole("button", { name: "Ask for changes", exact: true }).click();
  await expect(page.locator("main")).toContainText(/Changes required|changes/i);
  // No table on Waiting for me, and since v1.91.1 (D-435, owner) no link either: the sidebar item opens it.
  await page.goto("/users/queue");
  await expect(page.getByTestId("sent-back")).toHaveCount(0);
  await expect(page.getByTestId("sent-back-link")).toHaveCount(0);
  await page.getByTestId("sidebar-scroll").getByRole("link", { name: "Sent back for changes", exact: true }).click();
  await expect(page).toHaveURL(/\/users\/queue\/sent-back$/);
  await expect(page.getByTestId("sidebar-scroll").getByRole("link", { name: "Sent back for changes", exact: true })).toHaveAttribute("aria-current", "page");
  const row = page.getByTestId("sent-back-row").filter({ hasText: `Change check ${stamp}` });
  await expect(row).toContainText("Attach the vendor quote");
  await expect(row).toContainText("Ravi Requester");
  // Search, sort both ways on every column, Group by (folded), Expand all.
  await page.goto(`/users/queue/sent-back?q=${stamp}`);
  await expect(page.getByTestId("sent-back-row")).toHaveCount(1);
  for (const column of ["request", "type", "priority", "requester", "department", "step", "sent", "waiting", "reason"]) {
    for (const dir of ["asc", "desc"]) {
      await page.goto(`/users/queue/sent-back?sortBy=${column}&dir=${dir}`);
      await expect(page.locator(`th[data-sort-column="${column}"]`)).toHaveAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
    }
  }
  await page.goto("/users/queue/sent-back?group=requester");
  const fold = page.getByTestId("group-fold").first();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand all" }).first().click();
  await expect(page.getByTestId("sent-back-row").filter({ hasText: `Change check ${stamp}` })).toBeVisible();
  // Filters and a saved view.
  await page.goto("/users/queue/sent-back?requester=Ravi%20Requester&group=dept");
  await page.getByTestId("save-view").first().click();
  await page.getByPlaceholder(/e\.g\./).first().fill(`Ravi sent back ${stamp}`);
  await page.getByRole("button", { name: "Save view" }).first().click();
  await expect(page.getByText(`Saved "Ravi sent back ${stamp}".`)).toBeVisible();
});
