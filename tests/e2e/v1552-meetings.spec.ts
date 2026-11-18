import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.55.2 (D-330, owner, 18 Nov 2026): the schedule form starts at today and
// now, keeps the end after the start, marks what is required, chooses
// departments by name; a meeting's link shows in the meetings list and on
// the calendar.
test.describe.configure({ mode: "serial" });
const title = `Link check ${Date.now().toString(36)}`;
const link = "https://meet.example.com/ars-e2e";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function pick(page: Page, label: string, search: string, option: RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(search);
  await page.getByRole("option", { name: option }).first().click();
}
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

test("the schedule form: today and now, required marks, department search, end after start", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/meetings/new");
  await expect(page.locator("#mtg-date")).toHaveValue(indiaToday());
  const start = await page.locator("#mtg-start").inputValue();
  const end = await page.locator("#mtg-end").inputValue();
  expect(start).toMatch(/^\d{2}:\d{2}$/);
  expect(end > start).toBe(true);
  // Required fields carry the red star.
  for (const label of ["Meeting title", "Meeting type", "Date", "Starts", "Ends", "Meeting Owner", "Coordinator"]) {
    await expect(page.locator("label.field-label", { hasText: label }).first().locator("span.text-danger-600")).toHaveText(/\*/);
  }
  // Departments are searched by name.
  await expect(page.getByRole("combobox", { name: "Organising department", exact: true })).toHaveAttribute("placeholder", "Type a department name");
  await expect(page.getByText("Choose one department.")).toBeVisible();
  await expect(page.getByText("Up to 50 departments.")).toBeVisible();
  // Moving the start past the end moves the end an hour later.
  await page.locator("#mtg-start").fill("15:00");
  await expect(page.locator("#mtg-end")).toHaveValue("16:00");
  // An end before the start is refused in the browser.
  await page.locator("#mtg-end").fill("11:00");
  await expect(page.getByText("The end time must be after the start time.")).toBeVisible();
  await page.screenshot({ path: "test-results/v1552-schedule-form.png", fullPage: true });
});

test("an online meeting's link shows in the meetings list and on the calendar", async ({ page, context }) => {
  test.setTimeout(120_000);
  await as(context, "E2E_REQ");
  await page.goto("/users/meetings/new");
  await page.locator("#mtg-title").fill(title);
  await page.locator("#mtg-type").selectOption({ label: "IDM (Inter Department Meeting)" });
  await page.locator("#mtg-start").fill("10:00");
  await page.locator("#mtg-end").fill("11:00");
  await pick(page, "Meeting Owner", "Manoj", /Manoj Manager/);
  await page.locator("#mtg-mode").selectOption("ONLINE");
  await page.locator("#mtg-link").fill(link);
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(page).toHaveURL(/\/users\/meetings\/\d+\?scheduled=1/);

  await page.goto(`/users/meetings?tab=all&q=${encodeURIComponent(title)}`);
  const card = page.getByTestId("meeting-list").locator("li", { hasText: title });
  await expect(card.getByTestId("meeting-join-link")).toHaveAttribute("href", link);

  await page.goto(`/users/calendar?view=day&date=${indiaToday()}`);
  const row = page.getByTestId("calendar-list").locator("li", { hasText: title });
  await expect(row).toContainText("Meetings");
  await expect(row).toContainText("10:00–11:00");
  await expect(row.getByTestId("calendar-join-link")).toHaveAttribute("href", link);
  await page.screenshot({ path: "test-results/v1552-calendar-meeting.png", fullPage: true });
});
