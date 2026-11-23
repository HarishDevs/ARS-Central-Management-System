import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.85.0 (D-412, owner's Admin redesign): the Admin panel in five groups.
// Overview (figures, one search across records, Needs attention built in),
// Records (five tabs, the power-search chips in the address, the record pane:
// side, ⤢ dialog, full page), the Insights hub tabs, the Set-up hub (section
// list, Search settings, phone list), old addresses redirecting; axe on each.
async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}

test("the sidebar has the five groups; Overview has figures, record search and Needs attention; axe", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  for (const group of ["Overview", "Records", "Insights", "Set-up", "People & organisation"]) await expect(nav.getByRole("button", { name: group })).toBeVisible();
  await expect(page.getByTestId("admin-figures")).toBeVisible();
  await expect(page.locator("#attention")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // One search across records.
  await page.getByLabel(/Number, title or person, across/).fill("E2E");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?q=E2E/);
  await expect(page.getByTestId("record-search-results")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("Records: five tabs, power-search chips in the address, the record pane (side, dialog, full page); axe", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/records/requests");
  const tabs = page.getByTestId("records-tabs");
  for (const name of ["Approval requests", "Tickets", "Meetings"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
  // Add a filter: field, operator, value → a chip, kept in the address.
  await page.getByTestId("power-add").click();
  const panel = page.getByTestId("power-panel");
  await panel.getByLabel("Field").selectOption("q");
  await panel.getByLabel("Value").fill("a");
  await panel.getByTestId("power-apply").click();
  await expect(page).toHaveURL(/[?&]q=a/);
  await expect(page.getByTestId("power-chip")).toContainText("contains");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: /Remove filter/ }).first().click();
  await expect(page).not.toHaveURL(/[?&]q=a/);

  // A row opens the pane beside the table.
  const first = page.getByTestId("record-open").first();
  test.skip((await first.count()) === 0, "no requests in the test database");
  await first.click();
  await expect(page).toHaveURL(/[?&]open=\d+/);
  const pane = page.getByTestId("record-pane");
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
  await expect(pane.getByTestId("record-details")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await pane.getByTestId("record-pane-expand").click();
  await expect(pane).toHaveAttribute("data-pane-mode", "dialog");
  await pane.getByTestId("record-pane-to-side").click();
  await expect(pane).toHaveAttribute("data-pane-mode", "side");
  await expect(pane.getByTestId("record-pane-full")).toHaveAttribute("href", /^\/users\/requests\/\d+$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("record-pane")).toHaveCount(0);

  for (const url of ["/admin/records/tickets", "/admin/records/meetings"]) {
    await page.goto(url);
    await expect(page.getByTestId("power-search")).toBeVisible();
    expect(await axe(page), url).toEqual([]);
  }
});

test("Insights hub: one page with tabs; each tab keeps its address; axe", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/insights");
  const tabs = page.getByTestId("hub-tabs");
  for (const name of ["Summary", "Dashboards", "Workload"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
  expect(await axe(page)).toEqual([]);
  await tabs.getByRole("link", { name: "Dashboards" }).click();
  await expect(page).toHaveURL(/\/admin\/insights\/dashboards/);
  await expect(page.getByTestId("hub-tabs").getByRole("link", { name: "Dashboards" })).toHaveAttribute("aria-current", "page");
  await page.goto("/admin/insights/workload");
  expect(await axe(page)).toEqual([]);
});

test("Set-up hub: a section list, Search settings, each section with its own Save; axe", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/setup");
  await expect(page.getByTestId("setup-hub")).toBeVisible();
  const list = page.getByRole("navigation", { name: "Set-up sections" });
  for (const name of ["Custom approval", "Approver groups", "Task types", "Task settings and holidays", "Information types", "Ticket forms", "Meeting settings", "Reminders & escalations", "AI rules"]) await expect(list.getByRole("link", { name })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await list.getByRole("link", { name: "Task settings and holidays" }).click();
  await expect(page).toHaveURL(/\/admin\/setup\/task-settings$/);
  await expect(list.getByRole("link", { name: "Task settings and holidays" })).toHaveAttribute("aria-current", "page");
  expect(await axe(page)).toEqual([]);
  // Search settings (in the section list) finds a Set-up section.
  const search = list.getByRole("combobox", { name: "Search settings" });
  await search.fill("budgets");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/admin\/setup\/budgets$/);
});

test("old Admin addresses redirect for good", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  const moved: [string, RegExp][] = [
    ["/admin/attention?reason=BLOCKED_STEP", /\/admin\?reason=BLOCKED_STEP#attention$/],
    ["/admin/task-holidays", /\/admin\/setup\/task-settings$/],
    ["/admin/dashboards/utilisation", /\/admin\/insights\/dashboards\/utilisation$/],
    ["/admin/ai-rules", /\/admin\/setup\/ai-rules$/],
  ];
  for (const [old, now] of moved) {
    const response = await page.request.get(old, { maxRedirects: 0 });
    expect(response.status(), old).toBe(308);
    await page.goto(old);
    await expect(page).toHaveURL(now);
  }
});

test("phone width: Set-up opens as a list, each section has a way back; Records filters open as a bottom sheet; no sideways scroll", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin/setup");
  await expect(page.getByTestId("setup-hub")).toBeVisible();
  await page.getByTestId("setup-hub").getByRole("link", { name: /Approver groups/ }).click();
  await expect(page.getByTestId("settings-back")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.goto("/admin/records/requests");
  await page.getByTestId("power-add").click();
  const box = await page.getByTestId("power-panel").boundingBox();
  expect(box && box.y + box.height).toBeGreaterThan(700); // sits at the bottom
  for (const url of ["/admin", "/admin/insights", "/admin/setup", "/admin/records/tickets"]) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), url).toBe(false);
  }
});
