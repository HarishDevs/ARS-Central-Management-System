import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, phoneLayoutCookie, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.87.0 (D-417, header and motion audit release 2): navigation continuity,
// the one overlay stack and the race guards, as the audit's scenarios:
//   - the owner's scenario as the Super Admin (Admin → Records: filter, sort,
//     scroll, open, full page with a way back named after Admin → Records,
//     comment, back, close) and as an IT admin (Escape after Back, 3 times);
//   - a user on My Tasks (fold, scroll, pane, comment, close without a
//     history entry, full page and Back keep the fold);
//   - a manager on Waiting for me (the breadcrumb keeps the sort);
//   - races (double clicks, Escape while saving), the stack (menu and
//     palette over the pane, the pane as a dialog: trap, scroll lock, inert);
//   - reduced motion, phone width and axe.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const REQ = `Continuity ${stamp}`;
let staffTask = 0;
let requestPath = "";

async function as(context: BrowserContext, loginId: string, phone = false) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...(phone ? [phoneLayoutCookie()] : [])]);
}
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
}
async function axe(page: Page) {
  await settle(page);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
const here = (page: Page) => page.evaluate(() => location.pathname + location.search);
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

test.beforeAll(async () => {
  const conn = await db();
  try {
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const from = await userIdByLogin("E2E_REQ");
    const me = await userIdByLogin("E2E_STAFF");
    for (let i = 0; i < 30; i++) {
      const [made] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), JSON_OBJECT())",
        [`NC${i}${stamp}`.slice(0, 30), Number(version!.id), `Continuity task ${stamp} ${String(i).padStart(2, "0")}`, from, me, from, i % 6],
      );
      if (i === 29) staffTask = made.insertId;
    }
  } finally {
    await conn.end();
  }
});

test("seed: a request waiting for the manager", async ({ page, context }) => {
  test.setTimeout(3 * 60_000);
  await as(context, "E2E_REQ");
  requestPath = await raisePurchase(page, REQ);
  expect(requestPath).toMatch(/^\/users\/requests\/\d+$/);
});

// The owner's scenario: Super Admin → module → listing → filter → open record → edit → save → close.
test("owner's scenario (Super Admin, Admin → Records): the exact screen comes back", async ({ page, context }) => {
  test.setTimeout(4 * 60_000);
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin");
  await settle(page);
  await page.goto("/admin/records/requests");
  await settle(page);
  await page.getByTestId("power-add").click();
  const panel = page.getByTestId("power-panel");
  await panel.getByLabel("Field").selectOption("q");
  await panel.getByLabel("Value").fill("Continuity");
  await panel.getByTestId("power-apply").click();
  await page.waitForURL(/[?&]q=Continuity/);
  await settle(page);
  const sort = page.locator("main thead a").first();
  // v1.89.0: wait for the sorted address itself (settle alone could finish before the click's move began).
  const sorted = await sort.getAttribute("href");
  await sort.click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === sorted);
  await settle(page);
  const list = await here(page);
  const chips = await page.getByTestId("power-chip").allTextContents();
  expect(chips.join()).toContain("Continuity");
  // Open the record beside the list.
  const open = page.getByTestId("record-open").first();
  await open.click();
  await page.waitForURL(/[?&]open=\d+/);
  const withPane = await here(page);
  const pane = page.getByTestId("record-pane");
  await expect(pane).toBeVisible();
  // Its full page offers the way back by name, with the list's query.
  await pane.getByTestId("record-pane-full").click();
  await page.waitForURL(/\/users\/requests\/\d+\?from=/);
  await settle(page);
  const back = page.getByTestId("return-to");
  await expect(back).toContainText("Admin → Records");
  expect(await back.getAttribute("href")).toBe(withPane);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Admin → Records");
  // Edit (a comment) and save.
  await page.getByRole("textbox", { name: /Add a comment/ }).first().click();
  await page.keyboard.type("Checked by the Super Admin");
  await page.locator('main button:has-text("Post comment"), main button[aria-label="Comment"]').first().click();
  await expect(page.locator("main p", { hasText: "Checked by the Super Admin" }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Add a comment/ }).first()).not.toContainText("Checked by the Super Admin");
  // Back to Admin → Records: the same list, filter, sort and the record beside it.
  await back.click();
  await page.waitForURL((url) => url.pathname === "/admin/records/requests");
  await settle(page);
  expect(await here(page)).toBe(withPane);
  await expect(page.getByTestId("record-pane")).toBeVisible();
  expect((await page.getByTestId("power-chip").allTextContents()).join()).toContain("Continuity");
  // The person's area never changed: the Admin panel sidebar, not the users one.
  await expect(page.getByTestId("sidebar")).toContainText("Records");
  // Close: the listing exactly as before, and no new history entry.
  const length = await page.evaluate(() => history.length);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("open"));
  expect(await here(page)).toBe(list);
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(length);
  await expect(page.getByTestId("record-pane")).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test("a forged or foreign ?from= is ignored (the page keeps its own way back)", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const bad of ["https://evil.example/admin/records/requests", "//evil.example/x", "/admin/records/requests"]) {
    await page.goto(`${requestPath}?from=${encodeURIComponent(bad)}`);
    await settle(page);
    // The manager can't open Admin, so even a well-formed Admin address isn't offered.
    await expect(page.getByTestId("return-to")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Admin");
  }
});

test("IT admin on Admin → Records: open, full page, Back, Escape closes the pane every time (audit gap 20)", async ({ page, context }) => {
  test.setTimeout(4 * 60_000);
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/records/requests?q=Continuity");
  await settle(page);
  for (let round = 0; round < 3; round++) {
    await page.getByTestId("record-open").first().click();
    await page.waitForURL(/[?&]open=\d+/);
    await page.getByTestId("record-pane").getByTestId("record-pane-full").click();
    await page.waitForURL(/\/users\/requests\/\d+/);
    await settle(page);
    await page.goBack();
    await page.waitForURL(/[?&]open=\d+/);
    await expect(page.getByTestId("record-pane")).toBeVisible();
    await settle(page);
    await page.keyboard.press("Escape");
    await page.waitForURL((url) => !url.searchParams.has("open"), { timeout: 5000 });
    await expect(page.getByTestId("record-pane")).toHaveCount(0);
  }
  // Closing never left a pane entry behind: Back now leaves the list.
  await page.getByTestId("record-open").first().click();
  await page.waitForURL(/[?&]open=\d+/);
  await expect(page.getByTestId("record-pane")).toBeVisible();
  // v1.89.0: as in the rounds above, the pane has finished arriving before Escape.
  await settle(page);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("open"));
  await page.goBack();
  await settle(page);
  expect(new URL(page.url()).searchParams.has("open")).toBe(false);
});

test("user on My Tasks: fold, scroll, pane, comment, close (no history entry), full page and Back keep the fold", async ({ page, context }) => {
  test.setTimeout(4 * 60_000);
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  await settle(page);
  // A soft move (the app router, as a sidebar link does).
  await page.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/users/work/my-tasks"));
  await page.waitForURL(/\/users\/work\/my-tasks$/);
  await settle(page);
  const folds = page.locator('main button[aria-expanded][aria-label^="Hide "], main button[aria-expanded][aria-label^="Show "]');
  const foldCount = await folds.count();
  test.skip(foldCount < 2, "My Tasks shows fewer than two sections");
  // Fold the first section (its name is kept to find it again).
  const first = folds.first();
  const name = ((await first.getAttribute("aria-label")) ?? "").replace(/^(Hide|Show) /, "");
  if ((await first.getAttribute("aria-expanded")) === "true") await first.click();
  const fold = page.locator(`main button[aria-label="Show ${name}"]`);
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  const link = page.locator(`main a[href="/users/tasks/${staffTask}"]`).first();
  await link.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(300);
  const y = await scrollY(page);
  const length = await page.evaluate(() => history.length);
  await link.click();
  await page.waitForURL(/[?&]task=\d+/);
  const pane = page.getByTestId("task-pane");
  await expect(pane).toBeVisible();
  expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(40);
  // Comment and save inside the pane.
  await pane.getByRole("textbox", { name: /Add a comment/ }).first().click();
  await page.keyboard.type("Pane comment kept");
  await pane.getByTestId("pane-send").click();
  // v1.89.0 (D-425): the comment, in Comments (the hidden All activity tab lists it too once the pane refreshes; also on the stage 3d build).
  await expect(pane.getByTestId("comment").getByText("Pane comment kept")).toBeVisible();
  // × closes without adding a history entry, the list where it was.
  await pane.getByTestId("close-pane").click();
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  // Closing went back to the list's own entry (history.length keeps the forward entry; nothing was added).
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-pane-closed-by"))).toMatch(/^back /);
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(40);
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  // Back now leaves My Tasks (the pane isn't reopened).
  await page.goBack();
  await page.waitForURL(/\/users\/queue/);
  await page.goForward();
  await page.waitForURL(/\/users\/work\/my-tasks$/);
  await settle(page);
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  // The full page and Back: the fold is kept (per page, this tab).
  await link.click();
  await page.waitForURL(/[?&]task=\d+/);
  await page.getByTestId("task-pane").getByTestId("pane-full").click();
  await page.waitForURL(/\/users\/tasks\/\d+$/);
  await settle(page);
  await page.goBack();
  await page.waitForURL(/[?&]task=\d+/);
  await settle(page);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(page.locator(`main button[aria-label="Show ${name}"]`)).toHaveAttribute("aria-expanded", "false");
});

test("manager on Waiting for me: the request's breadcrumb returns to the sorted list", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue?sortBy=title&dir=asc");
  await settle(page);
  const row = page.locator(`main a[href="${requestPath}"]:visible`).first();
  await row.click();
  await page.waitForURL((url) => url.pathname === requestPath);
  await settle(page);
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Waiting for me" });
  await expect(crumb).toHaveAttribute("href", "/users/queue?sortBy=title&dir=asc");
  await crumb.click();
  await page.waitForURL((url) => url.pathname === "/users/queue");
  expect(new URL(page.url()).searchParams.get("sortBy")).toBe("title");
  expect(await axe(page)).toEqual([]);
});

test("races and the overlay stack: double clicks, Escape while saving, menu and palette over the pane, the pane as a dialog", async ({ page, context }) => {
  test.setTimeout(4 * 60_000);
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await settle(page);
  const link = page.locator(`main a[href="/users/tasks/${staffTask}"]`).first();
  await link.scrollIntoViewIfNeeded();
  const h0 = await page.evaluate(() => history.length);
  await link.dblclick();
  await expect(page.getByTestId("task-pane")).toHaveCount(1);
  await settle(page);
  expect((await page.evaluate(() => history.length)) - h0).toBe(1);
  await page.getByTestId("task-pane").getByTestId("close-pane").dblclick();
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await settle(page);
  expect(await page.evaluate(() => history.length)).toBe(h0 + 1);
  await expect(page.getByTestId("task-pane")).toHaveCount(0);

  // Escape straight after Send: the close waits for the save ("Saving…"); the comment is kept.
  await link.click();
  const pane = page.getByTestId("task-pane");
  await pane.getByRole("textbox", { name: /Add a comment/ }).first().click();
  await page.keyboard.type("Sent then Escape");
  await pane.getByTestId("pane-send").click();
  await page.locator("main h1").first().click({ force: true });
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(page.getByTestId("discard-draft")).toHaveCount(0);
  const conn = await db();
  const [[row]] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM task_comments WHERE task_id = ? AND body LIKE '%Sent then Escape%'", [staffTask]);
  await conn.end();
  expect(Number(row?.n)).toBe(1);

  // A menu in the pane: Escape closes the menu only; the palette over the pane likewise.
  await link.click();
  await expect(pane).toBeVisible();
  const more = pane.locator('button[aria-haspopup="menu"]').first();
  await more.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pane).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search-panel")).toBeHidden();
  await expect(pane).toBeVisible();

  // The pane as a dialog (⤢): Tab stays inside, the page can't scroll, the rest is inert.
  await pane.getByTestId("pane-expand").click();
  await expect(page.locator('[data-task-pane][data-pane-mode="dialog"]')).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  // The page behind (its heading, the top bar) is inert; the pane is not.
  expect(await page.evaluate(() => Boolean(document.querySelector("main h1")?.closest("[inert]")))).toBe(true);
  expect(await page.evaluate(() => Boolean(document.querySelector("header")?.closest("[inert]")))).toBe(true);
  expect(await page.evaluate(() => Boolean(document.querySelector("[data-task-pane]")?.closest("[inert]")))).toBe(false);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-task-pane]")))).toBe(true);
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("[inert]").length)).toBe(0);
  // Back to the side mode for later specs.
  await link.click();
  await page.getByTestId("task-pane").getByTestId("pane-to-side").click();
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
});

test("reduced motion: panes open and close at once and everything still works", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await settle(page);
  const link = page.locator(`main a[href="/users/tasks/${staffTask}"]`).first();
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const pane = page.getByTestId("task-pane");
  await expect(pane).toBeVisible();
  const running = await page.evaluate(() => document.querySelector("[data-task-pane]")!.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity && Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).length);
  // Nothing in the pane moves for longer than the global reduced-motion floor (0.01 ms).
  expect(running).toBe(0);
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(pane).toHaveCount(0);
});

test("phone width: a bottom sheet closes with Escape (the stack), no sideways overflow, axe", async ({ page, context }) => {
  await as(context, "E2E_MGR", true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/users/approvals");
  await settle(page);
  await page.getByTestId("m-choose-view").click();
  const sheet = page.getByRole("dialog", { name: "Choose view" });
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  for (const path of ["/users/approvals", "/users/queue", requestPath]) {
    await page.goto(path);
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(1);
    expect(await axe(page), path).toEqual([]);
  }
});
