import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, phoneLayoutCookie, sessionCookie } from "./db";

// v1.89.0 stage 3c (UI unification batch 3, the module pages; D-423):
//   UIQA-CON-01: every list page on the shared toolbar (Portfolios, Admin
//     Records with its power search in the toolbar row, the coordinator
//     board, the audit log's download dates on the date picker).
//   UIQA-RESP-01: the tables that were still squeezed on phones are cards.
//   UIQA-LAY-03: an unknown address inside /users, /admin, /superadmin shows
//     the area's not-found page inside the shell (status 404), and a refused
//     area still looks like an unknown address with no title (NAV-01).
//   Settings forms keep the 960 form width.
test.describe.configure({ mode: "serial" });

async function as(context: BrowserContext, loginId: string, extra: { name: string; value: string; domain: string; path: string }[] = []) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...extra]);
}
// Ticketing is a module (D-329): the e2e people get it for this suite (the coordinator board)
// and lose it afterwards, as in v1550-tickets, so other suites see their usual sidebar.
async function ticketModule(give: boolean) {
  const conn = await db();
  try {
    if (give) await conn.query("UPDATE users SET module_access = CONCAT_WS(',', NULLIF(module_access, ''), 'TICKET') WHERE login_id LIKE 'E2E%' AND NOT FIND_IN_SET('TICKET', module_access)");
    else await conn.query("UPDATE users SET module_access = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', module_access, ','), ',TICKET,', ',')) WHERE login_id LIKE 'E2E%' AND FIND_IN_SET('TICKET', module_access)");
  } finally {
    await conn.end();
  }
}
test.beforeAll(() => ticketModule(true));
test.afterAll(() => ticketModule(false));

const desktopLayout = { name: "ars_layout", value: "desktop", domain: "localhost", path: "/" };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
}

// Search boxes in main that belong to no shared toolbar, dialog or finder.
const ownSearchBoxes = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('main input[type="search"], main input[name="q"]')].filter((el) => !el.closest('[data-testid="list-toolbar"], dialog, [role="dialog"]') && !el.hasAttribute("data-search-kind") && el.getBoundingClientRect().height > 0).length);

test("CON-01: Portfolios, Admin Records, the coordinator board and the audit log use the shared list page and toolbar (1440)", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [login, path] of [
    ["E2E_REQ", "/users/work/portfolios"],
    ["E2E_ADMIN", "/admin/records/requests"],
    ["E2E_ADMIN", "/admin/records/tickets"],
    ["E2E_ADMIN", "/admin/records/meetings"],
    ["E2E_ADMIN", "/users/tickets/board"],
    ["E2E_SUPER", "/superadmin/monitoring/audit"],
  ] as const) {
    await as(context, login, [desktopLayout]);
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await settle(page);
    await expect(page.locator("main [data-list-page]"), path).toHaveCount(1);
    await expect(page.locator('main [data-testid="list-toolbar"]').first(), path).toBeVisible();
    expect(await ownSearchBoxes(page), `${path}: a search box outside the shared toolbar`).toBe(0);
  }
  // Records: the power search is the toolbar's lead (one row), with Sort beside it.
  await as(context, "E2E_ADMIN", [desktopLayout]);
  await page.goto("/admin/records/tickets");
  await settle(page);
  const toolbar = page.getByTestId("list-toolbar");
  await expect(toolbar.getByTestId("power-search")).toBeVisible();
  await expect(toolbar.getByTestId("sort-menu")).toBeVisible();
  // Portfolios: "New portfolio" (CON-07) and the search icon of the toolbar finds by name.
  await as(context, "E2E_REQ", [desktopLayout]);
  await page.goto("/users/work/portfolios");
  await settle(page);
  await expect(page.getByTestId("create-portfolio")).toHaveText(/^\s*New portfolio\s*$/);
  await page.getByTestId("list-toolbar").getByRole("button", { name: "Search" }).click();
  await page.locator("#portfolio-list-toolbar-q").fill("zz-no-such-portfolio");
  await page.locator("#portfolio-list-toolbar-q").press("Enter");
  await page.waitForURL(/q=zz-no-such-portfolio/);
  // The audit log's download dates: one date range button that still sends from / to.
  await as(context, "E2E_SUPER", [desktopLayout]);
  await page.goto("/superadmin/monitoring/audit");
  await settle(page);
  await expect(page.locator('main input[type="date"]')).toHaveCount(0);
  await expect(page.locator('main form[action="/api/superadmin/audit"] input[type="hidden"][name="from"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('main form[action="/api/superadmin/audit"] input[type="hidden"][name="to"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
});

test("RESP-01: the tables that were squeezed on phones are cards (390)", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [login, path] of [
    ["E2E_ADMIN", "/admin/insights/dashboards/approvers"],
    ["E2E_ADMIN", "/admin/insights/workload"],
    ["E2E_ADMIN", "/admin/setup/task-types"],
    ["E2E_ADMIN", "/admin/setup/budgets"],
    ["E2E_ADMIN", "/users/tickets/board"],
    ["E2E_ADMIN", "/admin/records/requests"],
    ["E2E_SUPER", "/superadmin/monitoring/jobs"],
    ["E2E_SUPER", "/superadmin/data/retention"],
    ["E2E_SUPER", "/superadmin/security/pages"],
  ] as const) {
    await as(context, login, [phoneLayoutCookie()]);
    const response = await page.goto(path);
    if ((response?.status() ?? 200) >= 400) continue; // switched off for this database: not this test's business
    await settle(page);
    const m = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("main table")].filter((el) => el.getBoundingClientRect().height > 0 && !el.hasAttribute("data-matrix"));
      const squeezed = tables.filter((el) => {
        if (getComputedStyle(el).display !== "table") return false;
        for (let node = el.parentElement; node && node.tagName !== "MAIN"; node = node.parentElement) if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== "visible") return true;
        return false;
      });
      const rows = tables.flatMap((table) => [...table.querySelectorAll(":scope > tbody > tr")]).filter((row) => row.getBoundingClientRect().height > 0);
      return {
        tables: tables.length,
        squeezed: squeezed.length,
        rowsWiderThanScreen: rows.filter((row) => row.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
        labelled: rows.flatMap((row) => [...row.querySelectorAll("[data-label]")]).length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(m.overflowX, path).toBeLessThanOrEqual(0);
    expect(m.squeezed, `${path}: a table still squeezed`).toBe(0);
    expect(m.rowsWiderThanScreen, `${path}: a card wider than the screen`).toBe(0);
    if (m.tables) expect(m.labelled, `${path}: card values carry their column name`).toBeGreaterThan(0);
  }
  // Desktop keeps the tables.
  await page.setViewportSize({ width: 1440, height: 900 });
  await as(context, "E2E_SUPER", [desktopLayout]);
  await page.goto("/superadmin/monitoring/jobs");
  await settle(page);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("main .table-cards table")!).display)).toBe("table");
});

test("LAY-03: an unknown address shows the area's not-found page inside the shell (404); a refused area still shows none", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [login, path, home] of [
    ["E2E_REQ", "/users/not-a-page", "/users"],
    ["E2E_REQ", "/users/tasks/not/a/page", "/users"],
    ["E2E_ADMIN", "/admin/not-a-page", "/admin"],
    ["E2E_SUPER", "/superadmin/not-a-page/deeper", "/superadmin"],
  ] as const) {
    await as(context, login, [desktopLayout]);
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await settle(page);
    await expect(page.getByRole("heading", { level: 1, name: "This page isn't available" }), path).toBeVisible();
    await expect(page.getByTestId("sidebar"), `${path}: the shell is kept`).toBeVisible();
    await expect(page.locator("main"), path).toHaveCount(1);
    await expect(page, `${path}: no page title is sent`).toHaveTitle("ARS CMS");
    await expect(page.locator("main").getByRole("link", { name: /^Go to/ })).toHaveAttribute("href", home);
    expect(new URL(page.url()).pathname, "the address typed stays").toBe(path);
  }
  // NAV-01 unchanged: someone who may not open the area sees the plain 404 without the area's shell,
  // the same for a real page and an unknown one, and no title.
  await as(context, "E2E_REQ", [desktopLayout]);
  for (const path of ["/superadmin/monitoring/audit", "/superadmin/not-a-page", "/admin/users", "/admin/not-a-page"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await settle(page);
    await expect(page, path).toHaveTitle("ARS CMS");
    await expect(page.getByTestId("back-to-app"), path).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar"] a[href^="/superadmin/"], [data-testid="sidebar"] a[href^="/admin/"]'), `${path}: no area links`).toHaveCount(0);
  }
  // Phones: the users phone layout keeps its own shell around the not-found page.
  await page.setViewportSize({ width: 390, height: 844 });
  await as(context, "E2E_REQ", [phoneLayoutCookie()]);
  const phone = await page.goto("/users/not-a-page");
  expect(phone?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "This page isn't available" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("Settings forms keep the 960 form width; detail pages put the way back on the breadcrumb line", async ({ page, context }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await as(context, "E2E_ADMIN", [desktopLayout]);
  for (const path of ["/admin/setup/meetings", "/admin/setup/ticket-categories", "/admin/setup/groups"]) {
    await page.goto(path);
    await settle(page);
    const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll("main .max-w-form")].map((el) => el.getBoundingClientRect().width)));
    expect(widest, path).toBeGreaterThan(400);
    expect(widest, path).toBeLessThanOrEqual(960);
  }
  // CON-11: the admin user page's "← All users" sits on the breadcrumb's line (D-419 keeps the list's address).
  await page.goto("/admin/users");
  await settle(page);
  await page.locator('main a[href^="/admin/users/"]:not([href="/admin/users/new"])').locator("visible=true").first().click();
  await page.waitForURL(/\/admin\/users\/\d+$/);
  const nav = page.getByTestId("detail-nav");
  await expect(nav.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  await expect(nav.getByTestId("all-link")).toHaveText("← All users");
  await expect(page.locator('[data-tour="page-header"]').getByTestId("all-link")).toHaveCount(0);
});
