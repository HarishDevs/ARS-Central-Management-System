import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.89.0 (D-420): the global motion and transition system. Page transitions
// are on by default (the Super Admin switch is the kill switch); reduced
// motion moves nothing; WebKit no longer freezes or dies with transitions on
// (UIQA-MOT-02); rapid clicks, Back and Forward land right; no layout-shift
// regressions on the pages the audit flagged (UIQA-PERF-01/02); the Motion
// Playground is a 404 for everyone but the Super Admin, with no title leak.
// Measured numbers (frame times, long tasks, CLS) are written to
// test-results/motion-<browser>.json for docs/qa/PERFORMANCE_VALIDATION.md.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
let taskId = 0;
let managerTask = 0;
const measured: Record<string, unknown> = {};

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function setSwitch(value: "ON" | "OFF" | null) {
  const conn = await db();
  try {
    if (value === null) await conn.query("DELETE FROM system_settings WHERE setting_key = 'features.page_transitions'");
    else await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.page_transitions', 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [value]);
  } finally {
    await conn.end();
  }
}
// Counts view transitions the page starts (and how many ended skipped), without changing them.
async function countTransitions(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __vt: { calls: number; skipped: number } };
    w.__vt = { calls: 0, skipped: 0 };
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { ready: Promise<void> } };
    const original = doc.startViewTransition;
    if (typeof original !== "function") return;
    doc.startViewTransition = function (this: Document, cb: () => Promise<void>) {
      w.__vt.calls += 1;
      const transition = original.call(this, cb);
      transition.ready.catch(() => (w.__vt.skipped += 1));
      return transition;
    } as typeof original;
  });
}
const vt = (page: Page) => page.evaluate(() => (window as unknown as { __vt?: { calls: number; skipped: number } }).__vt ?? { calls: 0, skipped: 0 });
const supportsVT = (page: Page) => page.evaluate(() => typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === "function");
async function sidebarLink(page: Page, href: string) {
  for (let round = 0; round < 3; round++) {
    const closed = page.locator('[data-testid="sidebar"] [data-testid^="nav-group-"] > button[aria-expanded="false"][aria-controls]').filter({ visible: true });
    const count = await closed.count();
    if (!count) break;
    for (let index = 0; index < count; index++) await closed.first().click({ timeout: 3000 }).catch(() => undefined);
  }
  return page.locator(`[data-testid="sidebar"] a[href="${href}"]`).filter({ visible: true }).first();
}
// Frame gaps while something animates: the longest gap and the share of frames under 20 ms (60 FPS ≈ 16.7 ms).
async function startFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framesOn: boolean };
    w.__frames = [];
    w.__framesOn = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__framesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopFrames(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framesOn: boolean };
    w.__framesOn = false;
    const frames = w.__frames.slice(1);
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { frames: frames.length, maxGapMs: Math.round(Math.max(0, ...frames)), p95Ms: Math.round(p95 * 10) / 10, under20ms: frames.length ? Math.round((frames.filter((gap) => gap < 20).length / frames.length) * 100) : 0 };
  });
}
async function cls(page: Page, url: string, settleMs = 2000) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __clsSources: string[]; __long: number[] };
    w.__cls = 0;
    w.__clsSources = [];
    w.__long = [];
    // An engine without layout-shift entries (WebKit) reports -1: "not measurable", never 0.
    if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) w.__cls = -1;
    else try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
          if (entry.hadRecentInput) continue;
          w.__cls += entry.value;
          for (const source of entry.sources ?? []) {
            const node = source.node as Element | undefined;
            if (node?.nodeType === 1) w.__clsSources.push(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${node.getAttribute("data-testid") ? `[${node.getAttribute("data-testid")}]` : ""}.${String(node.className).split(" ").slice(0, 3).join(".")} ${entry.value.toFixed(3)}`);
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      w.__cls = -1; // no layout-shift entries in this engine
    }
    (w as unknown as { __longOk: boolean }).__longOk = Boolean(PerformanceObserver.supportedEntryTypes?.includes("longtask"));
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push(Math.round(entry.duration));
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* no long-task entries in this engine */
    }
  });
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const w = window as unknown as { __cls: number; __clsSources: string[]; __long: number[] };
    const longOk = (w as unknown as { __longOk: boolean }).__longOk;
    return { cls: w.__cls < 0 ? -1 : Math.round(w.__cls * 10000) / 10000, sources: w.__clsSources.slice(0, 6), longTasks: longOk ? w.__long.length : -1, longestTaskMs: longOk ? Math.max(0, ...w.__long) : -1 };
  });
}

test.beforeAll(async () => {
  await setSwitch(null); // the default
  const conn = await db();
  try {
    const me = await userIdByLogin("E2E_STAFF");
    const from = await userIdByLogin("E2E_REQ");
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const [made] = await conn.query<ResultSetHeader>(
      "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), JSON_OBJECT())",
      [`MO${stamp}`, Number(version!.id), `Motion task ${stamp} with a long enough title to wrap the header`, from, me, from],
    );
    taskId = made.insertId;
    // A manager's own Task Summary (its header also has the team switcher and Share).
    const manager = await userIdByLogin("E2E_MGR");
    const [mine] = await conn.query<ResultSetHeader>(
      "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), JSON_OBJECT())",
      [`MM${stamp}`, Number(version!.id), `Manager motion task ${stamp}`, from, manager, from],
    );
    managerTask = mine.insertId;
    await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.pane_mode'", [manager]);
    await conn.query("DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'work.pane_mode'", [me]);
  } finally {
    await conn.end();
  }
});
test.afterAll(async ({}, info) => {
  await setSwitch(null);
  const file = path.join(process.cwd(), "test-results", `motion-${process.env.E2E_BROWSER ?? info.project.use.browserName ?? "chromium"}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(measured, null, 2));
  console.log(`MOTION ${JSON.stringify(measured)}`);
});

test("page transitions are on by default: the new page fades in, navigation lands, focus goes to the heading, no errors", async ({ page, context, browserName }) => {
  await countTransitions(context);
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/users/requests");
  const supported = await supportsVT(page);
  measured.viewTransitionsSupported = supported;
  const hops: { to: string; ms: number }[] = [];
  await startFrames(page);
  for (const href of ["/users/queue", "/users/tasks", "/users/information", "/users/requests"]) {
    const link = await sidebarLink(page, href);
    const started = Date.now();
    await link.click();
    await page.waitForURL((url) => url.pathname === href);
    await expect(page.locator("main h1").first()).toBeVisible();
    hops.push({ to: href, ms: Date.now() - started });
    await page.waitForTimeout(400);
  }
  measured.transitionFrames = await stopFrames(page);
  measured.transitionHops = hops;
  const counts = await vt(page);
  measured.transitionsDefaultOn = counts;
  // v1.89.0 (D-424): WebKit changes pages without view transitions (they crashed its page).
  if (supported && browserName !== "webkit") expect(counts.calls).toBeGreaterThan(0);
  if (browserName === "webkit") expect(counts.calls).toBe(0);
  // The new heading has focus after an animated move (the guide's accessibility routing).
  if (supported && counts.calls > counts.skipped && browserName !== "webkit") await expect(page.locator("main h1").first()).toBeFocused();
  // One main area, one sidebar: nothing drawn twice.
  expect(await page.locator("main#main").count()).toBe(1);
  expect(await page.locator('[data-testid="sidebar"]').count()).toBe(1);
  // The CSS the owner asked for: fade + 4 px rise, enter easing, page = 200 ms.
  const rule = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const item of Array.from(sheet.cssRules)) if (item.cssText.includes("view-transition-new(page-main)")) return item.cssText;
      } catch {
        /* another origin */
      }
    }
    return "";
  });
  if (browserName !== "firefox" || rule) expect(rule).toContain("page-in");
  expect(["200ms", "var(--motion-standard)"]).toContain(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-page").trim()));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-standard").trim())).toBe("200ms");
  expect(errors).toEqual([]);
});

test("rapid clicks and Back / Forward: the last click wins, the page never freezes (WebKit UIQA-MOT-02), no errors", async ({ page, context }) => {
  await countTransitions(context);
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  let crashed = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("crash", () => (crashed = true));
  await page.goto("/users/requests");
  for (let round = 0; round < 3; round++) {
    for (const href of ["/users/tasks", "/users/meetings", "/users/information"]) {
      await (await sidebarLink(page, href)).click({ noWaitAfter: true, timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(40);
    }
    await page.waitForURL((url) => url.pathname === "/users/information", { timeout: 8000 });
    // The page answers at once (a frozen page would not run this within the timeout).
    const answered = await Promise.race([page.evaluate(() => document.readyState).then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000))]);
    expect(answered).toBe(true);
    await expect(page.locator("main h1").first()).toBeVisible();
    await (await sidebarLink(page, "/users/requests")).click();
    await page.waitForURL((url) => url.pathname === "/users/requests");
  }
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/users/information");
  await page.goForward();
  await page.waitForURL((url) => url.pathname === "/users/requests");
  await expect(page.locator("main h1").first()).toBeVisible();
  measured.rapid = await vt(page);
  expect(crashed).toBe(false);
  expect(errors).toEqual([]);
});

test("Back restores the list's place with transitions on (no fade, no jump to the top)", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/users/help");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
  measured.helpPage = sizes;
  const tall = sizes.scroll > sizes.inner + 300;
  test.skip(!tall, "the help page is too short at this size to scroll");
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(200);
  const link = page.locator('main a[href^="/users/"]').filter({ visible: true }).first();
  await link.click();
  await page.waitForURL((url) => url.pathname !== "/users/help");
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/users/help");
  await page.waitForTimeout(800);
  const y = await page.evaluate(() => window.scrollY);
  measured.backScrollY = y;
  expect(y).toBeGreaterThan(150);
});

test("the Super Admin switch is the kill switch: OFF means no view transitions at all", async ({ page, context }) => {
  await setSwitch("OFF");
  try {
    await countTransitions(context);
    await as(context, "E2E_MGR");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/users/requests");
    await (await sidebarLink(page, "/users/tasks")).click();
    await page.waitForURL((url) => url.pathname === "/users/tasks");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect((await vt(page)).calls).toBe(0);
  } finally {
    await setSwitch(null);
  }
});

test("reduced motion: no page transition, dialogs only fade, the shared motion is off", async ({ page, context }) => {
  await countTransitions(context);
  await as(context, "E2E_MGR");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/requests");
  await (await sidebarLink(page, "/users/tasks")).click();
  await page.waitForURL((url) => url.pathname === "/users/tasks");
  await expect(page.locator("main h1").first()).toBeVisible();
  expect((await vt(page)).calls).toBe(0);
  // The global rule: every transition and animation is 0.01 ms.
  const button = page.locator("main .btn-primary, main .btn-secondary").first();
  if (await button.count()) {
    const duration = await button.evaluate((element) => getComputedStyle(element).transitionDuration);
    for (const part of duration.split(",")) expect(parseFloat(part)).toBeLessThanOrEqual(0.0001);
  }
});

test("no layout-shift regressions: Analytics and Task Summary with a task open stay under 0.1 (UIQA-PERF-01/02)", async ({ browser, browserName }) => {
  test.setTimeout(240_000); // 10 pages, each loaded twice (WebKit and Firefox are slower here)
  const results: Record<string, unknown> = {};
  const cases: [string, string, { width: number; height: number }][] = [
    ["E2E_MGR", "/users/analytics", { width: 1366, height: 768 }],
    ["E2E_MGR", "/users/analytics", { width: 1280, height: 720 }],
    ["E2E_MGR", "/users/analytics", { width: 1920, height: 1080 }],
    ["E2E_ADMIN", "/admin/insights/analytics", { width: 1366, height: 768 }],
    ["E2E_ADMIN", "/admin/insights/analytics", { width: 1920, height: 1080 }],
    ["E2E_STAFF", `/users/work/my-tasks?task=${taskId}`, { width: 1366, height: 768 }],
    ["E2E_STAFF", `/users/work/my-tasks?task=${taskId}`, { width: 1280, height: 720 }],
    ["E2E_STAFF", `/users/work/my-tasks?task=${taskId}`, { width: 1440, height: 900 }],
    ["E2E_MGR", `/users/work/my-tasks?task=${managerTask}`, { width: 1366, height: 768 }],
    ["E2E_MGR", `/users/work/my-tasks?task=${managerTask}`, { width: 1280, height: 720 }],
  ];
  for (const [who, url, size] of cases) {
    const context = await browser.newContext({ viewport: size });
    await context.addCookies([await sessionCookie(who, { tourDone: true })]);
    // Twice: the first visit warms the server; the second is the measure.
    await cls(await context.newPage(), url, 500);
    const result = await cls(await context.newPage(), url);
    results[`${who} ${url.split("?")[0]}${url.includes("task=") ? "?task" : ""} ${size.width}x${size.height}`] = result;
    await context.close();
  }
  measured.cls = results;
  console.log(`CLS ${browserName} ${JSON.stringify(results)}`);
  for (const [label, value] of Object.entries(results)) {
    const { cls: shift } = value as { cls: number };
    if (shift >= 0) expect(shift, label).toBeLessThan(0.1);
  }
});

test("frame times while a dialog and the side pane open and close (60 FPS target)", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await page.waitForLoadState("networkidle").catch(() => undefined); // the pane host listens once the page is live
  // v1.89.0 (D-424): and the shell has hydrated (WebKit on Windows hydrates seconds after load).
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-session-watch") && document.documentElement.hasAttribute("data-place-memory"), undefined, { timeout: 20_000 });
  const link = page.locator(`#main a[href="/users/tasks/${taskId}"]`).first();
  await link.scrollIntoViewIfNeeded();
  await startFrames(page);
  for (let round = 0; round < 3; round++) {
    await link.click();
    await expect(page).toHaveURL(new RegExp(`[?&]task=${taskId}`));
    await expect(page.getByTestId("task-pane")).toBeVisible();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-pane")).toHaveCount(0);
    await page.waitForTimeout(300);
  }
  measured.paneFrames = await stopFrames(page);
  // Only one pane at a time, ever.
  expect(await page.getByTestId("task-pane").count()).toBe(0);
});

test("the Motion Playground: Super Admin only (404 and no title for anyone else), values from the one source", async ({ page, context }) => {
  for (const who of ["E2E_STAFF", "E2E_ADMIN"]) {
    await as(context, who);
    const response = await page.goto("/superadmin/dev/motion");
    expect(response?.status(), who).toBe(404);
    expect(await page.title(), who).not.toMatch(/motion/i);
    await expect(page.getByTestId("motion-playground")).toHaveCount(0);
  }
  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  const ok = await page.goto("/superadmin/dev/motion");
  expect(ok?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Motion playground" })).toBeVisible();
  expect(await page.title()).toMatch(/Motion playground/);
  for (const [token, ms] of [["instant", 100], ["fast", 150], ["standard", 200], ["smooth", 250], ["emphasis", 300]] as const) {
    await expect(page.getByTestId(`lab-css-${token}`)).toHaveText(`${ms}ms`);
    await expect(page.getByTestId(`lab-ts-${token}`)).toHaveText(`${ms}ms`);
  }
  // Not linked from the sidebar or any menu.
  expect(await page.locator('a[href="/superadmin/dev/motion"]').count()).toBe(0);
  await page.getByTestId("lab-play").click();
  await page.getByTestId("lab-open-dialog").click();
  await expect(page.getByTestId("lab-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lab-dialog")).toBeHidden();
  await page.getByTestId("lab-reduce").check();
  await expect(page.getByTestId("motion-playground")).toHaveAttribute("data-reduce-motion", "");
});
