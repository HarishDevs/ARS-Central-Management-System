import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { phoneLayoutCookie, sessionCookie, motionSettled } from "./db";

// v1.89.0 stage 3b (UI unification batch 2, shared components; D-422):
//   UIQA-CON-05 / CON-06: every named control measures its token (field 42,
//     compact field 32, button 40, compact button 32) on the pages that used
//     to override them (Projects, Tickets board, Admin set-up, Super Admin).
//   UIQA-CON-13: a primary button sizes to its words; sign-in keeps btn-block.
//   UIQA-CON-01: the list pages share one toolbar (ListToolbar) and no page
//     makes its own search box (Projects was the odd one out).
//   UIQA-RESP-01 / CON-14: phone lists are cards, not squeezed tables.
//   UIQA-CON-04 / RESP-04 / A11Y-02: a visible page title everywhere, incl.
//     the AI Assistant and the phone Home; phone titles are 22 / 700.
//   UIQA-CON-18: dialogs share radius 16, the header with an 18 px title and
//     a 40 px close button, and focus moves in and back.
test.describe.configure({ mode: "serial" });

async function as(context: BrowserContext, loginId: string, extra: { name: string; value: string; domain: string; path: string }[] = []) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...extra]);
}
const desktopLayout = { name: "ars_layout", value: "desktop", domain: "localhost", path: "/" };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
}

// Heights of the named controls inside main, by class.
async function controlHeights(page: Page) {
  return page.evaluate(() => {
    const seen = (el: Element) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden";
    const heights = (selector: string) => [...new Set([...document.querySelectorAll(`main ${selector}`)].filter(seen).map((el) => Math.round(el.getBoundingClientRect().height)))].sort((a, b) => a - b);
    return {
      field: heights(":is(input, select).field-input:not(.field-compact)"),
      compactField: heights(":is(input, select).field-compact"),
      button: heights(":is(.btn-primary, .btn-secondary, .btn-danger):not(.btn-compact):not(.btn-lg)"),
      compactButton: heights(".btn-compact"),
    };
  });
}

test("CON-05 / CON-06: controls measure the tokens on the pages that overrode them (1440)", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const visits: [string, string][] = [
    ["E2E_REQ", "/users/work/projects"],
    ["E2E_REQ", "/users/tickets/board"],
    ["E2E_REQ", "/users/work/portfolios"],
    ["E2E_ADMIN", "/admin/setup/task-holidays"],
    ["E2E_ADMIN", "/admin/setup/organisation"],
    ["E2E_SUPER", "/superadmin/monitoring/audit"],
  ];
  for (const [login, path] of visits) {
    await as(context, login, [desktopLayout]);
    const response = await page.goto(path);
    if ((response?.status() ?? 200) >= 400) continue; // a page switched off for the role is not this test's business
    await settle(page);
    const h = await controlHeights(page);
    for (const value of h.field) expect(value, `${path} field-input`).toBe(42);
    for (const value of h.compactField) expect(value, `${path} field-compact`).toBe(32);
    for (const value of h.button) expect(value, `${path} button`).toBe(40);
    for (const value of h.compactButton) expect(value, `${path} btn-compact`).toBe(32);
  }
});

test("CON-13: a form's primary button sizes to its words; the sign-in button stays full width", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await as(context, "E2E_REQ", [desktopLayout]);
  await page.goto("/users/delegation");
  await settle(page);
  const submit = page.locator("main form button[type=submit].btn-primary").first();
  await expect(submit).toBeVisible();
  const [button, form] = await Promise.all([submit.boundingBox(), page.locator("main form").first().boundingBox()]);
  expect(button!.width).toBeLessThan(form!.width * 0.6);
  await context.clearCookies();
  await page.goto("/login");
  const signIn = page.locator("form button.btn-block").first();
  if (await signIn.count()) {
    const [b, f] = await Promise.all([signIn.boundingBox(), page.locator("form").first().boundingBox()]);
    expect(Math.abs(b!.width - f!.width)).toBeLessThanOrEqual(2);
  }
});

test("CON-01: list pages share one toolbar and make no search box of their own", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [login, path] of [
    ["E2E_REQ", "/users/work/projects"],
    ["E2E_REQ", "/users/meetings"],
    ["E2E_REQ", "/users/information"],
    ["E2E_ADMIN", "/admin/users"],
    ["E2E_SUPER", "/superadmin/monitoring/audit"],
  ] as const) {
    await as(context, login, [desktopLayout]);
    await page.goto(path);
    await settle(page);
    const toolbars = page.locator('main [data-testid="list-toolbar"]');
    await expect(toolbars.first(), path).toBeVisible();
    const own = await page.evaluate(() => [...document.querySelectorAll('main input[type="search"], main input[name="q"]')].filter((el) => !el.closest('[data-testid="list-toolbar"], dialog, [role="dialog"]') && el.getBoundingClientRect().height > 0).length);
    expect(own, `${path}: a search box outside the shared toolbar`).toBe(0);
  }
  // The tabs of Meetings / Tickets / Projects lead the toolbar row (one row, not two patterns).
  await as(context, "E2E_REQ", [desktopLayout]);
  await page.goto("/users/work/projects");
  await expect(page.locator('main [data-testid="list-toolbar"] nav[aria-label="Project views"]')).toBeVisible();
  await expect(page.locator("main [data-list-page]")).toHaveCount(1);
});

test("RESP-01: phone lists are cards, not squeezed tables (390)", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [login, path, cookies] of [
    ["E2E_REQ", "/users/tasks", []],
    ["E2E_REQ", "/users/meetings", []],
    ["E2E_ADMIN", "/admin/users", [phoneLayoutCookie()]],
    ["E2E_SUPER", "/superadmin/monitoring/audit", [phoneLayoutCookie()]],
  ] as const) {
    await as(context, login, [...cookies]);
    await page.goto(path);
    await settle(page);
    const m = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("main .table-cards table")].filter((el) => el.getBoundingClientRect().height > 0);
      const rows = tables.flatMap((table) => [...table.querySelectorAll(":scope > tbody > tr")]).filter((row) => row.getBoundingClientRect().height > 0);
      return {
        tables: tables.length,
        drawnAsTable: tables.filter((el) => getComputedStyle(el).display === "table").length,
        rowsWiderThanScreen: rows.filter((row) => row.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
        labelled: rows.slice(0, 1).flatMap((row) => [...row.querySelectorAll("[data-label]")]).length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(m.overflowX, path).toBeLessThanOrEqual(0);
    expect(m.drawnAsTable, `${path}: tables still drawn as tables`).toBe(0);
    expect(m.rowsWiderThanScreen, `${path}: a card wider than the screen`).toBe(0);
    // The user list always has rows (the seeded people).
    if (path === "/admin/users") expect(m.tables, `${path}: has a list`).toBeGreaterThan(0);
    if (m.tables) expect(m.labelled, `${path}: card values carry their column name`).toBeGreaterThan(0);
  }
  // Desktop keeps the table.
  await page.setViewportSize({ width: 1440, height: 900 });
  await as(context, "E2E_SUPER", [desktopLayout]);
  await page.goto("/admin/users");
  await settle(page);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("main .table-cards table")!).display)).toBe("table");
});

test("CON-04 / RESP-04 / A11Y-02: a visible page title on every page, incl. AI and the phone Home; phone titles 22 / 700", async ({ page, context }) => {
  const title = () =>
    page.evaluate(() => {
      const h1 = [...document.querySelectorAll("main h1")].find((el) => el.getBoundingClientRect().height > 0 && !el.classList.contains("sr-only"));
      if (!h1) return null;
      const style = getComputedStyle(h1);
      return { text: (h1.textContent ?? "").trim(), size: Math.round(parseFloat(style.fontSize)), weight: style.fontWeight };
    });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [login, path, text] of [
    ["E2E_REQ", "/users/work/projects/new", "Create a new project"],
    ["E2E_REQ", "/users/work/projects", "Projects"],
    ["E2E_ADMIN", "/admin/users", null],
  ] as const) {
    await as(context, login, [desktopLayout]);
    await page.goto(path);
    await settle(page);
    const t = await title();
    expect(t, path).not.toBeNull();
    expect(t!.size, path).toBe(24);
    if (text) expect(t!.text, path).toBe(text);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/users", "/users/approvals", "/users/work/my-tasks", "/users/information"]) {
    await as(context, "E2E_REQ", [phoneLayoutCookie()]);
    await page.goto(path);
    await settle(page);
    const t = await title();
    expect(t, `${path} has a visible h1`).not.toBeNull();
    expect({ size: t!.size, weight: t!.weight }, path).toEqual({ size: 22, weight: "700" });
  }
});

test("CON-04: the AI Assistant page shows its title (when AI is on for the person)", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await as(context, "E2E_SUPER", [desktopLayout]);
  const response = await page.goto("/users/ai/assistant");
  test.skip((response?.status() ?? 200) >= 400 || !page.url().includes("/users/ai"), "AI is switched off for this person in the test database");
  await settle(page);
  const h1 = page.locator("main [data-tour='page-header'] h1");
  await expect(h1).toHaveText("AI Assistant");
  await expect(h1).not.toHaveClass(/sr-only/);
});

test("CON-18: a dialog has radius 16, an 18 px title, a 40 px close button, and focus goes in and back", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await as(context, "E2E_SUPER", [desktopLayout]);
  // The motion lab opens the shared Dialog (features/ui/Dialog), like every other page.
  await page.goto("/superadmin/dev/motion");
  await settle(page);
  const opener = page.getByTestId("lab-open-dialog");
  await expect(opener).toBeVisible();
  // Opened from the keyboard: Safari (WebKit) does not focus a button on a mouse click, so focus could not return to it.
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog.ars-dialog[open]").last();
  await expect(dialog).toBeVisible();
  // v1.89.0 stage 4 (D-426): measured once its scale-in has finished (39 px mid-animation under load).
  await motionSettled(page);
  const m = await dialog.evaluate((el) => {
    const close = el.querySelector<HTMLElement>('button[aria-label="Close"]');
    const h2 = el.querySelector("h2");
    return {
      radius: getComputedStyle(el).borderTopLeftRadius,
      title: h2 ? Math.round(parseFloat(getComputedStyle(h2).fontSize)) : null,
      close: close ? Math.round(close.getBoundingClientRect().height) : null,
      focusInside: el.contains(document.activeElement),
    };
  });
  expect(m).toMatchObject({ radius: "16px", title: 18, close: 40, focusInside: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
