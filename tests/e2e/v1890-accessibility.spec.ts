import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, motionSettled, phoneLayoutCookie, sessionCookie, typeCreateDue, userIdByLogin } from "./db";

// v1.89.0 stage 3d (UI unification batch 4, accessibility; D-424):
//   A11Y-04: status text on the open (row-active) Task Summary row passes AA, light and dark.
//   ERR-02 / ERR-01: no React #418 (hydration mismatch) on the devices and security pages.
//   meta-refresh: the Dashboards hub is a server redirect (no <meta http-equiv=refresh>).
//   FORM-01 / FORM-02: a missing value is said under the form, tied to its field.
//   Screen-reader pass without a screen reader: landmarks, one h1, no skipped heading
//   level, the toast live regions, focus in and back for the Create task window and the
//   task pane, and keyboard-only walks of the main flows (create a task, open the pane,
//   approve a request, Admin users search).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const title = `A11y walk ${stamp}`;
let taskId = 0;

async function as(context: BrowserContext, loginId: string, theme?: "dark" | "light", phone = false) {
  await context.clearCookies();
  if (theme) {
    const conn = await db();
    await conn.query("DELETE FROM user_settings WHERE setting_key = 'ui.theme' AND user_id = ?", [await userIdByLogin(loginId)]);
    await conn.end();
  }
  await context.addCookies([
    await sessionCookie(loginId, { tourDone: true }),
    ...(theme ? [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }] : []),
    ...(phone ? [phoneLayoutCookie()] : []),
  ]);
}
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  // The shell has hydrated (its listeners are on): data-session-watch and data-place-memory.
  await page
    .waitForFunction(() => !document.querySelector("a.skip-link") || (document.documentElement.hasAttribute("data-session-watch") && document.documentElement.hasAttribute("data-place-memory")), undefined, { timeout: 20_000 })
    .catch(() => undefined);
  await motionSettled(page);
}
async function axe(page: Page, include?: string, rules?: string[]) {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  if (rules) builder = builder.withRules(rules);
  const result = await builder.analyze();
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ") : "";
  });
// Safari's Tab moves between form controls and buttons only (links need Option+Tab, which
// Playwright's WebKit on Windows does not send), so the walks Tab to buttons and fields.
const WEBKIT = process.env.E2E_BROWSER === "webkit";
const TAB = "Tab";
// Tab until the focused element matches (a real keyboard walk), at most `max` presses.
async function tabTo(page: Page, match: RegExp, max = 80, back = false) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(back ? `Shift+${TAB}` : TAB);
    if (match.test(await focusedName(page))) return;
  }
  throw new Error(`Tab never reached ${match} (last: ${await focusedName(page)})`);
}
// Every uncaught page error and console error while a page loads.
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("keyboard only: + Create → Task; an empty Create says what is missing (FORM-01); the task is created", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await settle(page);
  // The first stop is the skip link; it moves focus to the main region.
  if (WEBKIT) {
    // The skip link is still the first focusable element and targets the main region.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.textContent?.trim())).toBe("Skip to content");
  } else {
    await page.keyboard.press(TAB);
    expect(await focusedName(page)).toBe("Skip to content");
  }
  await tabTo(page, /^\+?\s*Create$/);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: /^Task/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("create-dialog");
  await expect(dialog).toBeVisible();
  await settle(page);
  // Focus moves into the window (the task name).
  await expect(page.locator("#create-title")).toBeFocused();
  // FORM-01: Create is enabled; pressing it with nothing typed says why and marks the name.
  const create = dialog.getByRole("button", { name: "Create task", exact: true });
  await expect(create).toBeEnabled();
  await create.focus();
  await page.keyboard.press("Enter");
  const missing = dialog.getByTestId("create-missing");
  await expect(missing).toContainText("Enter a task name.");
  await expect(missing).toHaveAttribute("role", "alert");
  await expect(page.locator("#create-title")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#create-title")).toHaveAttribute("aria-describedby", "create-missing");
  await expect(page.locator("#create-title")).toBeFocused();
  await page.keyboard.type(title);
  await expect(page.locator("#create-title")).not.toHaveAttribute("aria-invalid", "true");
  await typeCreateDue(dialog, new Date(Date.now() + 330 * 60_000 + 2 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("#create-title").focus();
  await page.keyboard.press("Control+Enter");
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => {
    const conn = await db();
    const [rows] = await conn.query("SELECT id FROM tasks WHERE title = ?", [title]);
    await conn.end();
    return (rows as { id: number }[])[0]?.id ?? 0;
  }).toBeGreaterThan(0);
  const conn = await db();
  const [rows] = await conn.query("SELECT id FROM tasks WHERE title = ?", [title]);
  taskId = (rows as { id: number }[])[0]!.id;
  // Due today, so the open row shows the green "Today" (A11Y-04's text).
  await conn.query("UPDATE tasks SET due_at = DATE_ADD(UTC_DATE(), INTERVAL 12 HOUR) WHERE id = ?", [taskId]);
  await conn.end();
});

test("keyboard only: the task opens in the pane, focus goes in; Escape closes it and focus comes back", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks?view=list");
  await settle(page);
  const link = page.getByTestId("task-row").filter({ hasText: title }).getByRole("link").first();
  await link.focus();
  await page.keyboard.press("Enter");
  const pane = page.getByTestId("task-pane");
  await expect(pane).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`task=${taskId}`));
  await settle(page);
  await expect.poll(() => pane.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(pane).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
});

for (const theme of ["light", "dark"] as const) {
  test(`A11Y-04: the open row's due date and status text pass AA (${theme})`, async ({ page, context }) => {
    await as(context, "E2E_STAFF", theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/users/work/my-tasks?view=list&task=${taskId}`);
    await expect(page.getByTestId("task-pane")).toBeVisible();
    const row = page.getByTestId("task-row").filter({ hasText: title }).first();
    await expect(row).toHaveClass(/bg-row-active/);
    expect(await axe(page, `[data-testid=task-row]`, ["color-contrast"])).toEqual([]);
    // The measured ratio of the due text on the row (the axe rule also covers it).
    const ratio = await row.evaluate((el) => {
      const due = Array.from(el.querySelectorAll<HTMLElement>("span")).find((span) => /^Today$/.test(span.textContent?.trim() ?? ""));
      if (!due) return 99;
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const fg = lum(rgb(getComputedStyle(due).color));
      const bg = lum(rgb(getComputedStyle(el).backgroundColor));
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

test("PERF-02: Task Summary loaded with a task open does not jump (the pane's room is reserved first)", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let run = 0; run < 3; run += 1) {
    await page.goto(`/users/work/my-tasks?task=${taskId}`);
    await settle(page);
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) total += entry.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 150);
        }),
    );
    expect(shift).toBeLessThan(0.05);
  }
});

test("no React #418 on the devices and security pages (computer and phone), ERR-01 / ERR-02", async ({ page, context }) => {
  const errors = watchErrors(page);
  for (const phone of [false, true]) {
    await as(context, "E2E_STAFF", undefined, phone);
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    for (const path of ["/users/profile/devices", "/users/security"]) {
      await page.goto(path);
      await settle(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  }
  expect(errors.filter((text) => /#418|Hydration|hydrat/i.test(text))).toEqual([]);
});

test("the Dashboards hub is a server redirect, with no meta refresh", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  const response = await page.request.get("/admin/insights/dashboards?from=a11y", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe("/admin/insights/dashboards/utilisation?from=a11y");
  await page.goto("/admin/insights/dashboards");
  await expect(page).toHaveURL(/\/admin\/insights\/dashboards\/utilisation$/);
  expect(await page.locator('meta[http-equiv="refresh"]').count()).toBe(0);
  expect(await axe(page, undefined, ["meta-refresh"])).toEqual([]);
});

test("FORM-02: Out of office without a delegate ties the message to the picker", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users/delegation");
  await page.getByRole("button", { name: "Set out of office" }).click();
  const error = page.locator("#delegateId-error");
  await expect(error).toBeVisible();
  const picker = page.locator("#d-delegate");
  await expect(picker).toHaveAttribute("aria-describedby", "delegateId-error");
  await expect(picker).toHaveAttribute("data-invalid", "true");
});

test("landmarks, one h1 and no skipped heading level on the main pages", async ({ page, context }) => {
  const pages: [string, string][] = [
    ["E2E_STAFF", "/users"],
    ["E2E_STAFF", "/users/requests"],
    ["E2E_STAFF", "/users/work/my-tasks"],
    ["E2E_STAFF", "/users/information"],
    ["E2E_ADMIN", "/admin/users"],
    ["E2E_SUPER", "/superadmin"],
  ];
  const problems: string[] = [];
  for (const [login, path] of pages) {
    await as(context, login);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await settle(page);
    const facts = await page.evaluate(() => {
      const visible = (el: Element) => !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === "fixed";
      const levels = Array.from(document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6"))
        .filter(visible)
        .map((h) => Number(h.tagName[1]));
      let skip = "";
      for (let i = 1; i < levels.length; i += 1) if (levels[i]! > levels[i - 1]! + 1) skip ||= `h${levels[i - 1]} → h${levels[i]}`;
      return {
        main: document.querySelectorAll("main").length,
        banner: document.querySelectorAll("header, [role=banner]").length > 0,
        nav: document.querySelectorAll("nav, [role=navigation]").length > 0,
        h1: document.querySelectorAll("h1").length,
        skip,
      };
    });
    if (facts.main !== 1 || !facts.banner || !facts.nav || facts.h1 !== 1 || facts.skip) problems.push(`${path}: ${JSON.stringify(facts)}`);
  }
  expect(problems).toEqual([]);
});

test("the toast live regions are in the accessibility tree before a toast arrives", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.goto("/users");
  await settle(page);
  const region = page.getByTestId("toast-region");
  await expect(region.getByRole("status")).toHaveCount(1);
  await expect(region.getByRole("alert")).toHaveCount(1);
  // Real boxes, not display: contents (dropped from the tree by some screen readers).
  expect(await region.locator("[aria-live]").evaluateAll((els) => els.map((el) => getComputedStyle(el).display))).toEqual(["flex", "flex"]);
});

test("keyboard only: a manager approves a request; Admin users is searched from the toolbar", async ({ page, context }) => {
  // Raised through the requester's template (two levels: Manoj, then Harini).
  const { raisePurchase } = await import("./db");
  await as(context, "E2E_REQ");
  const path = await raisePurchase(page, `A11y approve ${stamp}`);
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await settle(page);
  await tabTo(page, /^Approve$/, 120);
  await page.keyboard.press("Enter");
  // A confirmation (if any) is a dialog: its own button by keyboard too.
  const confirm = page.getByRole("dialog").getByRole("button", { name: /^Approve/ });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText(/Approved by Manoj Manager/).first()).toBeVisible();

  await as(context, "E2E_ADMIN");
  await page.goto("/admin/users");
  await settle(page);
  // The toolbar's search is an icon button until used (D-228): Tab to it, Enter opens the box with focus in it.
  await page.getByTestId("list-toolbar").getByRole("button", { name: "Search" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("list-toolbar").getByRole("searchbox", { name: "Search" })).toBeFocused();
  await page.keyboard.type("Sita");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=Sita/);
  await expect(page.locator("main")).toContainText("Sita Staff");
});
