import { expect, test } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.77.1 (owner, 22 Nov 2026): every Home overview has a quick-action row with
// its create action first; + Create offers Meeting and Ticket when allowed.
test("quick actions on the Approval and Meeting overviews; Create offers Meeting and Ticket", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_ADMIN", { tourDone: true })]);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/users?home=approvals");
  const approvals = page.getByTestId("approval-quick-actions");
  await expect(approvals.getByRole("link", { name: "New request" })).toHaveAttribute("href", "/users/custom");
  await expect(approvals.getByRole("link", { name: "Waiting for me" })).toBeVisible();
  await expect(approvals.getByRole("link", { name: "My requests" })).toBeVisible();

  await page.goto("/users?home=meetings");
  const meetings = page.getByTestId("meeting-quick-actions");
  await expect(meetings.getByRole("link", { name: "Schedule meeting" })).toHaveAttribute("href", "/users/meetings/new");
  await expect(meetings.getByRole("link", { name: "Follow-ups" })).toBeVisible();

  await page.getByTestId("create-menu").getByRole("button", { name: "Create" }).first().click();
  await expect(page.getByRole("menuitem", { name: /^Meeting/ })).toBeVisible();
  // Ticket shows only for people whose menu has "Raise a ticket" (the Tickets module).
  const canTicket = (await page.locator('a[href="/users/tickets/new"]').count()) > 0;
  await expect(page.getByRole("menuitem", { name: /^Ticket/ })).toHaveCount(canTicket ? 1 : 0);
  await page.getByRole("menuitem", { name: /^Meeting/ }).click();
  await expect(page).toHaveURL(/\/users\/meetings\/new/);
});
