import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { purchaseTemplateId, raisePurchase, sessionCookie, toReviewStep, userIdByLogin } from "./db";

// v1.94.0 (D-451..D-458, owner 27 Nov 2026: "From Super admin should be able
// to create, Modify, Delete, archive anything like approval, task, Ticket at
// any level"): the control panel and Deleted items, as Super Admin; IT and an
// ordinary user are refused (the server checks too: tests/integration/
// v194-superadmin-control.int.test.ts calls every action directly).
async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const tag = Date.now().toString(36);

test("only the Super Admin reaches the control panel and Deleted items", async ({ page, context }) => {
  for (const login of ["E2E_ADMIN", "E2E_REQ"]) {
    await as(context, login);
    for (const url of ["/superadmin/control", "/superadmin/control/bin"]) expect((await page.goto(url))?.status(), `${login} ${url}`).toBe(404);
  }
  await as(context, "E2E_SUPER");
  await page.goto("/superadmin/control");
  await expect(page.getByRole("heading", { name: "Control panel", level: 1 })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  await expect(nav.getByRole("link", { name: "Control panel" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Deleted items" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.goto("/superadmin/control/bin");
  await expect(page.getByRole("heading", { name: "Deleted items", level: 1 })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("find a request, force its status with a reason, archive, bin and restore it", async ({ page, context }) => {
  const title = `Control ${tag}`;
  await as(context, "E2E_REQ");
  const requestPath = await raisePurchase(page, title);
  await as(context, "E2E_SUPER");
  await page.goto(`/superadmin/control?q=${encodeURIComponent(title)}`);
  const results = page.getByTestId("control-results");
  await expect(results.getByText(title)).toBeVisible();
  await results.getByRole("link").first().click();
  await expect(page.getByTestId("control-item")).toBeVisible();
  expect(await axe(page)).toEqual([]);

  // Modify: force Approved, with a reason.
  await page.getByTestId("force-status-open").click();
  const force = page.getByTestId("force-status");
  await force.getByLabel("New status").selectOption("APPROVED");
  await force.getByLabel("Reason").fill("Approved by the board offline");
  await force.getByRole("button", { name: "Set status" }).click();
  await expect(page.getByTestId("control-item").getByText("Approved", { exact: true })).toBeVisible();
  await page.goto(requestPath);
  await expect(page.getByText(/Changed by Super Admin \(Sam Super\): set the status to Approved\. Reason: Approved by the board offline/)).toBeVisible();

  // Archive: read-only, still visible, with its badge.
  await page.goto(`/superadmin/control?q=${encodeURIComponent(title)}`);
  await page.getByTestId("control-results").getByRole("link").first().click();
  await page.getByTestId("archive-open").click();
  await page.getByTestId("archive").getByLabel("Reason").fill("Year-end clean up");
  await page.getByTestId("archive").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByTestId("control-item").getByText("Archived", { exact: true })).toBeVisible();
  await as(context, "E2E_REQ");
  await page.goto(requestPath);
  await expect(page.getByText("Archived (read-only)")).toBeVisible();
  await page.goto("/users/requests?tab=archived");
  await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible();

  // Un-archive, then move to Deleted items: gone for the requester.
  await as(context, "E2E_SUPER");
  await page.goto(`/superadmin/control?q=${encodeURIComponent(title)}&state=ARCHIVED`);
  await page.getByTestId("control-results").getByRole("link").first().click();
  await page.getByTestId("unarchive-open").click();
  await page.getByTestId("unarchive").getByLabel("Reason").fill("Needs to go to the bin");
  await page.getByTestId("unarchive").getByRole("button", { name: "Un-archive" }).click();
  await page.getByTestId("bin-open").click();
  await page.getByTestId("bin").getByLabel("Reason").fill("Raised in a test");
  await page.getByTestId("bin").getByRole("button", { name: "Move to Deleted items" }).click();
  await expect(page.getByText("In Deleted items")).toBeVisible();
  await as(context, "E2E_REQ");
  expect((await page.goto(requestPath))?.status()).toBe(404);

  // Deleted items: listed with the days left; restore brings it back.
  await as(context, "E2E_SUPER");
  await page.goto(`/superadmin/control/bin?q=${encodeURIComponent(title)}`);
  const row = page.getByTestId("bin-table").getByRole("row").filter({ hasText: title });
  await expect(row.getByText(/30 days until it can be deleted permanently/)).toBeVisible();
  await expect(row.getByText(/Delete permanently in 30 days/)).toBeVisible();
  await row.getByRole("button", { name: "Restore" }).click();
  await row.getByLabel("Reason").fill("Binned by mistake");
  await row.getByRole("button", { name: "Restore" }).last().click();
  await expect(page.getByText("The bin is empty.").or(page.getByText(/No deleted items match|items? in the bin/))).toBeVisible();
  // KF-06 (Firefox): let the page's own refresh after Restore finish before leaving it.
  await page.waitForLoadState("networkidle");
  await as(context, "E2E_REQ");
  expect((await page.goto(requestPath))?.status()).toBe(200);
});

test("create a request on someone's behalf: they are the requester and the page says so", async ({ page, context }) => {
  const title = `On behalf ${tag}`;
  const templateId = await purchaseTemplateId("E2E_SUPER");
  const raiser = await userIdByLogin("E2E_REQ");
  await as(context, "E2E_SUPER");
  await page.goto(`/users/custom?template=${templateId}&onBehalfOf=${raiser}`);
  await expect(page.getByTestId("on-behalf-banner")).toContainText("Raising on behalf of Ravi Requester");
  await page.locator("#c-title").fill(title);
  await toReviewStep(page);
  await page.getByTestId("action-bar").getByRole("button", { name: "Submit request" }).click();
  await page.waitForURL(/\/users\/requests\/\d+\?submitted=1/);
  await expect(page.getByText("Created by Super Admin on behalf of Ravi Requester").first()).toBeVisible();
  await expect(page.getByText(/raised by Ravi Requester/)).toBeVisible();
  // An IT admin can't raise on someone's behalf: the address is ignored (the server refuses it too).
  await as(context, "E2E_ADMIN");
  await page.goto(`/users/custom?onBehalfOf=${raiser}`);
  await expect(page.getByRole("heading", { name: "New request" })).toBeAttached();
  await expect(page.getByTestId("on-behalf-banner")).toHaveCount(0);
});

test("the panel at phone width has no sideways scroll", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ["/superadmin/control?state=FINISHED", "/superadmin/control/bin"]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
});
