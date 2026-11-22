import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.79.0 (D-406, owner: "Match all 3 Overview Screens, it should be
// identically featured"): Approvals, My Work and Meetings share the header
// (greeting, title, role line, switcher + period), quick actions with
// + Add widgets / Customise, four summary cards, and the person's own widgets
// per overview (add, move, resize, remove, reset; keyboard moves); axe in
// light, dark and at phone width. "pm_foundations" is ON in the e2e seed.
test.describe.configure({ mode: "serial" });

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const widgetKinds = (page: Page) => page.getByTestId("home-widget").evaluateAll((items) => items.map((item) => item.getAttribute("data-kind")));

async function cleanUp() {
  const conn = await db();
  try {
    const id = await userIdByLogin("E2E_ADMIN");
    await conn.query("DELETE FROM home_layouts WHERE user_id = ? AND scope IN ('approvals', 'meetings')", [id]);
  } finally {
    await conn.end();
  }
}
test.beforeAll(cleanUp);
test.afterAll(cleanUp);

const OVERVIEWS = [
  { home: "approvals", title: "Approvals – Overview", quick: "approval-quick-actions", create: "New request", cards: "approval-cards" },
  { home: "tasks", title: "My Work – Overview", quick: "work-quick-actions", create: "Create task", cards: "work-kpis" },
  { home: "meetings", title: "Meetings – Overview", quick: "meeting-quick-actions", create: "Schedule meeting", cards: "meeting-tiles" },
] as const;

test("all three overviews: the same header, quick actions with Add widgets / Customise, four cards and widgets", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const overview of OVERVIEWS) {
    await page.goto(`/users?home=${overview.home}`);
    await expect(page.getByRole("heading", { level: 1, name: overview.title })).toBeVisible();
    await expect(page.getByTestId("home-greeting")).toBeVisible();
    await expect(page.getByTestId("home-focus")).toBeVisible();
    await expect(page.getByTestId("period-picker")).toHaveCount(1);
    await expect(page.getByTestId("period-picker").getByRole("combobox").locator("option")).toHaveText(["Today", "This week", "This month", "Last 30 days", "Last 90 days", "Custom period"]);
    const quick = page.getByTestId(overview.quick);
    await expect(quick.getByRole("link", { name: overview.create }).or(quick.getByRole("button", { name: overview.create })).first()).toBeVisible();
    await expect(quick.getByTestId("customise-home")).toBeVisible();
    await expect(quick.getByTestId("add-widget")).toBeVisible();
    const cards = page.getByTestId(overview.cards).locator("a");
    await expect(cards).toHaveCount(4);
    // The fourth card compares with the period before.
    await expect(cards.nth(3).getByTestId("card-change")).toBeVisible();
    await expect(page.getByTestId("home-widgets")).toHaveAttribute("data-scope", overview.home);
    await page.screenshot({ path: `test-results/v1790-${overview.home}.png`, fullPage: true });
  }
  // Today's screen order is each overview's default.
  await page.goto("/users?home=approvals");
  expect(await widgetKinds(page)).toEqual(["ap_waiting", "ap_due", "ap_returned", "ap_recent", "ap_drafts", "ap_insights"]);
  await expect(page.locator('[data-tour="page-header"]')).toBeVisible();
  await expect(page.locator('[data-tour="overview-tiles"]')).toBeVisible();
  await page.goto("/users?home=meetings");
  expect(await widgetKinds(page)).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm", "mt_insights", "mt_figures", "mt_register"]);
  // The period moves every figure on the page and stays in the address.
  await expect(async () => {
    await page.getByTestId("period-picker").getByRole("combobox").selectOption("week");
    await expect(page).toHaveURL(/home=meetings.*period=week|period=week.*home=meetings/, { timeout: 2000 });
  }).toPass();
  await expect(page.getByTestId("meeting-card-held")).toContainText("vs last week");
});

test("Approvals: add, move, resize, remove and reset a widget; keyboard moves; kept per overview", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users?home=approvals");
  const tasksBefore = await (async () => {
    await page.goto("/users?home=tasks");
    const kinds = await widgetKinds(page);
    await page.goto("/users?home=approvals");
    return kinds;
  })();

  // Add the standard widgets.
  for (const kind of ["ap_attention", "ap_chart", "notepad"]) {
    await page.getByTestId("add-widget").locator("button[aria-haspopup]").click();
    await page.getByTestId(`add-widget-${kind}`).click();
    await expect.poll(() => widgetKinds(page)).toContain(kind);
  }
  await expect(page.getByTestId("approval-attention")).toBeVisible();
  await expect(page.getByTestId("approval-chart").getByTestId("workload-chart")).toBeVisible();
  await expect(page.getByTestId("home-notepad")).toBeVisible();

  // Move the chart up with its Actions menu; make it full width.
  const chart = page.getByTestId("home-widget").filter({ has: page.getByTestId("approval-chart") });
  await chart.getByTestId("widget-actions").locator("button[aria-haspopup]").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(page.getByTestId("home-live")).toContainText("My approval activity moved to position 7 of 9");
  await chart.getByTestId("widget-actions").locator("button[aria-haspopup]").click();
  await page.getByTestId("widget-menu-full").click();
  await expect(chart).toHaveAttribute("data-size", "full");

  // Customise: keyboard pick up, move up twice, drop.
  await page.getByTestId("customise-home").click();
  const handle = page.locator('[data-widget-handle="ap_drafts"]');
  await handle.focus();
  await handle.press("Space");
  await expect(page.getByTestId("home-live")).toContainText("Picked up Your drafts");
  await handle.press("ArrowUp");
  await page.locator('[data-widget-handle="ap_drafts"]').press("ArrowUp");
  await page.locator('[data-widget-handle="ap_drafts"]').press("Enter");
  await expect(page.getByTestId("home-live")).toContainText("Your drafts dropped at position 3");
  // Alt + ↓ moves at once.
  await page.locator('[data-widget-handle="ap_waiting"]').focus();
  await page.locator('[data-widget-handle="ap_waiting"]').press("Alt+ArrowDown");
  await expect(page.getByTestId("home-live")).toContainText("Waiting for me moved to position 2");
  // Remove one.
  await page.getByTestId("home-widget").filter({ has: page.locator('[data-widget-handle="ap_due"]') }).getByTestId("remove-widget").click();
  await expect.poll(() => widgetKinds(page)).not.toContain("ap_due");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.reload();
  const saved = await widgetKinds(page);
  expect(saved.slice(0, 3)).toEqual(["ap_waiting", "ap_drafts", "ap_returned"]);
  expect(saved).not.toContain("ap_due");
  expect(saved).toContain("ap_chart");
  await expect(page.getByTestId("home-widget").filter({ has: page.getByTestId("approval-chart") })).toHaveAttribute("data-size", "full");
  expect(await axe(page)).toEqual([]);

  // My Work's layout didn't change.
  await page.goto("/users?home=tasks");
  expect(await widgetKinds(page)).toEqual(tasksBefore);

  // Reset brings back today's screen for Approvals only.
  await page.goto("/users?home=approvals");
  await page.getByTestId("customise-home").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("reset-home").click();
  await expect.poll(() => widgetKinds(page)).toEqual(["ap_waiting", "ap_due", "ap_returned", "ap_recent", "ap_drafts", "ap_insights"]);
});

test("Meetings: add, move, resize, remove and reset a widget; keyboard moves", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users?home=meetings");
  await page.getByTestId("add-widget").locator("button[aria-haspopup]").click();
  await page.getByTestId("add-widget-mt_chart").click();
  await expect(page.getByTestId("meeting-chart")).toBeVisible();
  const chart = page.getByTestId("home-widget").filter({ has: page.getByTestId("meeting-chart") });
  await chart.getByTestId("widget-actions").locator("button[aria-haspopup]").click();
  await page.getByTestId("widget-menu-full").click();
  await expect(chart).toHaveAttribute("data-size", "full");

  await page.getByTestId("customise-home").click();
  const handle = page.locator('[data-widget-handle="mt_chart"]');
  await handle.focus();
  await handle.press("Alt+ArrowUp");
  await expect(page.getByTestId("home-live")).toContainText("My meeting activity moved to position 8 of 9");
  await page.locator('[data-widget-handle="mt_chart"]').press("Space");
  await page.locator('[data-widget-handle="mt_chart"]').press("ArrowUp");
  await page.locator('[data-widget-handle="mt_chart"]').press("Escape");
  await expect(page.getByTestId("home-live")).toContainText("Move cancelled");
  await page.getByTestId("home-widget").filter({ has: page.locator('[data-widget-handle="mt_register"]') }).getByTestId("remove-widget").click();
  await expect.poll(() => widgetKinds(page)).not.toContain("mt_register");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.reload();
  const saved = await widgetKinds(page);
  expect(saved.at(-1)).toBe("mt_chart");
  expect(saved).toContain("mt_chart");
  expect(saved).not.toContain("mt_register");
  expect(await axe(page)).toEqual([]);

  await page.getByTestId("customise-home").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("reset-home").click();
  await expect.poll(() => widgetKinds(page)).toEqual(["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm", "mt_insights", "mt_figures", "mt_register"]);
});

test("axe on all three overviews in light and dark and at tablet width; the phone layout unchanged; nothing cut off", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const overview of OVERVIEWS) {
      await page.goto(`/users?home=${overview.home}`);
      await expect(page.getByRole("heading", { level: 1, name: overview.title })).toBeVisible();
      expect(await axe(page), `${overview.home} ${scheme}`).toEqual([]);
    }
  }
  // The narrowest desktop layout (768 px, a tablet): one column, nothing cut off.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 768, height: 1000 });
  for (const overview of OVERVIEWS) {
    await page.goto(`/users?home=${overview.home}`);
    await expect(page.getByRole("heading", { level: 1, name: overview.title })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, overview.home).toBeLessThanOrEqual(1);
    expect(await axe(page), `${overview.home} tablet`).toEqual([]);
  }
  // Phone width: the phone layout's Home (MobileHome), unchanged, with nothing cut off.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/users?home=approvals");
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Today", exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await axe(page), "phone").toEqual([]);
});
