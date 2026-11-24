import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { motionSettled, raisePurchase, sessionCookie } from "./db";

// v1.89.0 stage 3e (UI unification batch 5, content; D-425):
//   CON-08: one date format (India time, "24 Nov 2026, 3:05 pm"; 12 h everywhere, Admin
//           Records included); no native date inputs left on the converted pages.
//   ERR-01: relative times ("just now", "2 h ago") are drawn in the browser after mount;
//           the server's HTML has the absolute text; no hydration error (#418).
//   Date pickers: the filter / period pickers send the same fields; Out of office keeps
//           D-415 (start at most 30 days back, at most 90 days long).
//   Wording: the create pages are titled like their list actions (New meeting, New ticket,
//           New user), and the sidebar says the same.
test.describe.configure({ mode: "serial" });

const DATE_TIME = /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}, \d{1,2}:\d{2} (am|pm)$/;
const stamp = Date.now().toString(36);
let requestPath = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector("a.skip-link") || (document.documentElement.hasAttribute("data-session-watch") && document.documentElement.hasAttribute("data-place-memory")), undefined, { timeout: 20_000 })
    .catch(() => undefined);
  await motionSettled(page);
}
// Uncaught page errors and console errors (a hydration mismatch is React #418 / "Hydration").
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
const indiaDay = (offsetDays = 0) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;

test("ERR-01: the request timeline's relative time is drawn after mount; the server sends the absolute time; no #418", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  requestPath = await raisePurchase(page, `Content dates ${stamp}`);
  // The server's HTML: the absolute India time, never "ago" / "just now" for the timeline.
  const html = await (await page.request.get(requestPath)).text();
  expect(html).toMatch(/data-relative="pending"/);
  expect(html).not.toMatch(/data-relative="ready"/);
  const errors = watchErrors(page);
  await page.goto(requestPath);
  await settle(page);
  const time = page.locator('time[data-relative="ready"]').first();
  await expect(time).toBeVisible();
  await expect(time).toHaveText(/^(just now|\d+ min ago)$/);
  expect(await time.getAttribute("title")).toMatch(DATE_TIME);
  expect(await time.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(errors.filter((text) => /#418|Hydration|did not match/i.test(text))).toEqual([]);
});

test("CON-08: Admin Records shows date-times in the app's 12 h form (was 24 h)", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.goto("/admin/records/requests");
  await settle(page);
  const cells = await page.locator("main table tbody td").allInnerTexts();
  const dated = cells.map((text) => text.trim()).filter((text) => /\d{4}, \d{1,2}:\d{2}/.test(text));
  expect(dated.length).toBeGreaterThan(0);
  for (const text of dated) expect(text).toMatch(DATE_TIME);
});

test("CON-08: the converted pages have no native date inputs; their pickers send the same fields", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  const pages: [string, string[]][] = [
    ["/users/analytics?period=custom&from=2026-11-01&to=2026-11-10", ["from", "to"]],
    ["/users/tasks", ["dueFrom", "dueTo", "createdFrom", "createdTo"]],
    ["/users/information", ["from", "to"]],
    ["/users/requests", ["raisedFrom", "raisedTo"]],
    ["/users/delegation", ["startsOn", "endsOn"]],
  ];
  for (const [path, names] of pages) {
    await page.goto(path);
    await settle(page);
    await expect(page.locator('main input[type="date"]'), path).toHaveCount(0);
    for (const name of names) await expect(page.locator(`main input[type="hidden"][name="${name}"]`), `${path} ${name}`).toHaveCount(1);
  }
  // The Analytics period: the address's days are in the picker, read in the app's format.
  await page.goto("/users/analytics?period=custom&from=2026-11-01&to=2026-11-10");
  await settle(page);
  await expect(page.locator('main input[type="hidden"][name="from"]')).toHaveValue("2026-11-01");
  await expect(page.locator('main input[type="hidden"][name="to"]')).toHaveValue("2026-11-10");
  await expect(page.getByTestId("period-dates-button")).toContainText(/1 – 10 Nov( 2026)?/);
});

test("Date picker: a Task filter picked with the keyboard reaches the address", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.goto("/users/tasks");
  await settle(page);
  await page.getByTestId("list-toolbar").getByTestId("filter-menu").locator("summary").click();
  await page.getByTestId("task-due-button").click();
  const due = page.locator("#task-due-due");
  await due.fill(dmy(indiaDay(5)));
  await due.press("Enter");
  await expect(page.locator('main input[type="hidden"][name="dueTo"]')).toHaveValue(indiaDay(5));
  await page.getByTestId("filter-menu").getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`dueTo=${indiaDay(5)}`));
});

test("Out of office: the picker keeps D-415 (30 days back, 90 days long)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.goto("/users/delegation");
  await settle(page);
  const today = indiaDay();
  await expect(page.locator('main input[type="hidden"][name="startsOn"]')).toHaveValue(today);
  await page.getByTestId("delegation-dates-button").click();
  // 31 days back is refused (the earliest is 30 days back).
  const start = page.locator("#d-dates-start");
  await start.fill(dmy(addDays(today, -31)));
  await start.press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: /or later/ })).toBeVisible();
  await expect(page.locator('main input[type="hidden"][name="startsOn"]')).toHaveValue(today);
  // From today, day 91 is refused, day 90 is taken.
  await start.fill(dmy(today));
  await start.press("Tab");
  const due = page.locator("#d-dates-due");
  await due.fill(dmy(addDays(today, 90)));
  await due.press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: /after the last allowed day/ })).toBeVisible();
  await expect(page.locator('main input[type="hidden"][name="endsOn"]')).toHaveValue("");
  await due.fill(dmy(addDays(today, 2)));
  await due.press("Enter");
  await expect(page.locator('main input[type="hidden"][name="endsOn"]')).toHaveValue(addDays(today, 2));
  // The hint says both rules; the picker's button is described by it.
  await expect(page.locator("#d-dates-hint")).toContainText("up to 30 days");
  await expect(page.locator("#d-dates-hint")).toContainText("90 days");
  await expect(page.getByTestId("delegation-dates-button")).toHaveAttribute("aria-describedby", /d-dates-hint/);
});

test("Wording: create pages are titled like their list actions, and the sidebar says the same", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.goto("/admin/users/new");
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "New user" })).toBeVisible();
  await expect(page).toHaveTitle(/^New user/);

  await as(context, "E2E_MGR");
  await page.goto("/users/meetings/new");
  await settle(page);
  if (!/\/users\/meetings\/new/.test(page.url())) test.skip(true, "no Meetings module for this person");
  await expect(page.getByRole("heading", { level: 1, name: "New meeting" })).toBeVisible();
  await expect(page).toHaveTitle(/^New meeting/);
  // The submit button keeps its verb.
  await expect(page.getByRole("button", { name: "Schedule meeting" })).toBeVisible();
  const sideLink = page.locator('aside nav a[href="/users/meetings/new"]');
  if (await sideLink.count()) await expect(sideLink.first()).toHaveAccessibleName(/New meeting/);
});
