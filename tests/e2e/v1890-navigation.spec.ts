import crypto from "node:crypto";
import { expect, request as pwRequest, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { E2E_ENV } from "../../playwright.config";
import { db, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.89.0 (D-419): the navigation audit of v1.88.0 (docs/qa/NAVIGATION-AUDIT.md)
// as a permanent regression spec. NAV-01..08 (each fixed in v1.89.0) and the
// scenarios that passed (S1, S3, S5, S7, S9, S10, S11, S12), with the server
// checks that must stay: the wrong role is still refused everywhere.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const TITLE = `Nav189 ${stamp}`;
let staffTask = 0;
let superTask = 0;
let requestPath = "";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
  // v1.89.0 (D-424, NAV-03 WebKit flake): inside the app, act only once the page has hydrated
  // (the shell's data-session-watch and data-place-memory); WebKit on Windows runs its JavaScript seconds after load.
  await page
    .waitForFunction(() => !document.querySelector("a.skip-link") || (document.documentElement.hasAttribute("data-session-watch") && document.documentElement.hasAttribute("data-place-memory")), undefined, { timeout: 20_000 })
    .catch(() => undefined);
}
const here = (page: Page) => page.evaluate(() => location.pathname + location.search);
// Firefox may abort a goto when the page it leaves starts its own move (NS_BINDING_ABORTED): try once more.
async function go(page: Page, url: string) {
  try {
    return await page.goto(url);
  } catch (error) {
    if (!/NS_BINDING_ABORTED|interrupted by another navigation/.test(String(error))) throw error;
    await page.waitForLoadState("load").catch(() => undefined);
    return page.goto(url);
  }
}
const crumbs = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
async function cookieHeader(loginId: string) {
  const cookie = await sessionCookie(loginId, { tourDone: true });
  return { cookie: `${cookie.name}=${cookie.value}` };
}
// A cookie signed like the app's, for a session that doesn't exist, with any expiry.
function forgedCookie(uid: number, expOffsetSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({ sid: crypto.randomUUID(), uid, iat: now - 60, exp: now + expOffsetSeconds })).toString("base64url");
  const signature = crypto.createHmac("sha256", E2E_ENV.SESSION_SECRET).update(`session:${encoded}`).digest("base64url");
  return `ars_session=${encoded}.${signature}`;
}

test.beforeAll(async ({ browser }) => {
  const conn = await db();
  try {
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const req = await userIdByLogin("E2E_REQ");
    const add = async (no: string, title: string, assignee: number) => {
      const [made] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), JSON_OBJECT())",
        [no.slice(0, 30), Number(version!.id), title, req, assignee, req],
      );
      return made.insertId;
    };
    staffTask = await add(`N9S${stamp}`, `${TITLE} staff`, await userIdByLogin("E2E_STAFF"));
    superTask = await add(`N9U${stamp}`, `${TITLE} super`, await userIdByLogin("E2E_SUPER"));
  } finally {
    await conn.end();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await as(context, "E2E_REQ");
  requestPath = await raisePurchase(page, `${TITLE} request`);
  await context.close();
});

// ------------------------------------------------------------------ NAV-01, S10
test("NAV-01 / S10: a refused area's 404 names no page; the wrong role is still refused", async ({ page, context }) => {
  const api = await pwRequest.newContext({ baseURL: test.info().project.use.baseURL });
  const refused: [string, string[]][] = [
    ["E2E_STAFF", ["/admin", "/admin/users", "/admin/records/tasks", "/superadmin", "/superadmin/monitoring/audit", "/superadmin/security/pages"]],
    ["E2E_ADMIN", ["/superadmin", "/superadmin/monitoring/audit", "/superadmin/security/pages", "/superadmin/data/import"]],
  ];
  for (const [who, urls] of refused) {
    const headers = await cookieHeader(who);
    for (const url of urls) {
      // Server answer (no redirects followed): 404, and no "<page> · ARS CMS" anywhere (HTML or flight data).
      const res = await api.get(url, { headers, maxRedirects: 0 });
      expect(res.status(), `${who} ${url}`).toBe(404);
      const body = await res.text();
      expect(body, `${who} ${url}`).not.toMatch(/[A-Za-z&] · ARS CMS/);
      expect(body).not.toContain("Sita Staff");
    }
    await as(context, who);
    for (const url of urls.slice(0, 3)) {
      const res = await go(page, url);
      await settle(page);
      expect(res?.status()).toBe(404);
      await expect(page).toHaveTitle("ARS CMS");
      await expect(page.getByTestId("back-to-app")).toHaveCount(0);
    }
  }
  // The same title as an unknown address.
  await as(context, "E2E_SUPER");
  await go(page, "/superadmin/does-not-exist");
  await expect(page).toHaveTitle("ARS CMS");
  // The right role still sees the page's own title.
  await go(page, "/superadmin/monitoring/audit");
  await expect(page).toHaveTitle("Audit log · ARS CMS");
  await as(context, "E2E_ADMIN");
  await go(page, "/admin/users");
  await expect(page).toHaveTitle("Users & roles · ARS CMS");
  // APIs and pages still refuse the wrong role (access control unchanged).
  const staffHeaders = await cookieHeader("E2E_STAFF");
  for (const url of ["/api/admin/records/tasks", "/api/superadmin/audit"]) expect((await api.get(url, { headers: staffHeaders, maxRedirects: 0 })).status()).toBe(404);
  expect((await api.get("/api/superadmin/audit", { headers: await cookieHeader("E2E_ADMIN"), maxRedirects: 0 })).status()).toBe(404);
  await api.dispose();
});

// ------------------------------------------------------------------ NAV-02, S12
test("NAV-02 / S12a: the session ends on a pane → signing in again reopens the same screen", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  const start = `/users/work/my-tasks?view=list&task=${staffTask}`;
  await go(page, start);
  await settle(page);
  await expect(page.locator("[data-task-pane]").first()).toBeVisible();
  // v1.89.0 (D-424): the session check listens only once the page has hydrated (the app's
  // data-session-watch signal). Ending the session before that left only the pane's 20 s live
  // refresh to notice it: the ~21 s WebKit "delay" (its JavaScript runs ~5 s behind on Windows).
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-session-watch"), undefined, { timeout: 20_000 });
  const conn = await db();
  await conn.query("DELETE FROM user_sessions WHERE user_id = ?", [await userIdByLogin("E2E_STAFF")]);
  await conn.end();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForURL(/\/signed-out/, { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("next")).toBe(start);
  await expect(page.locator("body")).not.toContainText(TITLE);
  // Signing in again (a fresh session) goes through /login?next= to the same screen, pane open.
  await context.addCookies([await sessionCookie("E2E_STAFF", { tourDone: true })]);
  const again = await page.getByRole("link", { name: "Sign in again" }).getAttribute("href");
  expect(again).toBe(`/login?next=${encodeURIComponent(start)}`);
  await go(page, again!);
  await settle(page);
  expect(await here(page)).toBe(start);
  await expect(page.locator("[data-task-pane]").first()).toBeVisible();
});

test("NAV-02: an expired or ended cookie on Admin keeps the query; ended sessions never see a page", async () => {
  const api = await pwRequest.newContext({ baseURL: test.info().project.use.baseURL });
  const uid = await userIdByLogin("E2E_SUPER");
  for (const cookie of [forgedCookie(uid, -60), forgedCookie(uid, 3600)]) {
    const res = await api.get("/admin/users?q=abc&sortBy=login", { headers: { cookie }, maxRedirects: 0 });
    expect([302, 303, 307]).toContain(res.status());
    const location = new URL(res.headers()["location"]!, "http://x");
    expect(location.pathname).toMatch(/^\/(signed-out|login)$/);
    expect(location.searchParams.get("next")).toBe("/admin/users?q=abc&sortBy=login");
  }
  // An open redirect can't be smuggled through next.
  const res = await api.get("/login?next=%2F%5Cevil.example", { headers: await cookieHeader("E2E_STAFF"), maxRedirects: 0 });
  expect(res.headers()["location"]).toMatch(/\/users$/);
  await api.dispose();
});

test("S12c: sign out, then Back shows nothing protected", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await go(page, "/admin/users");
  await settle(page);
  await page.locator('button[aria-label^="Account menu for"]').first().click();
  await page.locator('[role="menu"]').getByText(/Sign out/).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"), { timeout: 15_000 });
  await page.goBack().catch(() => undefined);
  await settle(page);
  await expect(page.locator("body")).not.toContainText("Ravi Requester");
});

// ------------------------------------------------------------------ NAV-03, S2
test("NAV-03 / S2: breadcrumb, '← All users' and Back all keep the users list's search and sort", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  const list = "/admin/users?q=E2E&sortBy=login&dir=desc";
  for (const via of ["breadcrumb", "all-users", "back"] as const) {
    await go(page, list);
    await settle(page);
    await page.locator('main a[href^="/admin/users/"]:not([href="/admin/users/new"])').locator("visible=true").first().click();
    await page.waitForURL(/\/admin\/users\/\d+$/);
    await settle(page);
    if (via === "breadcrumb") await crumbs(page).getByRole("link", { name: "Users & roles" }).click();
    else if (via === "all-users") {
      await expect(page.getByTestId("all-link")).toHaveAttribute("href", list);
      await page.getByRole("link", { name: "← All users" }).click();
    } else await page.goBack();
    await page.waitForURL((url) => url.pathname === "/admin/users");
    expect(await here(page), via).toBe(list);
  }
});

// ------------------------------------------------------------------ NAV-04, S1, S6
test("NAV-04 / S1 / S6: Admin → Records → task → Open full page → Back to Admin → Records", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  const filtered = `/admin/records/tasks?q=${encodeURIComponent(TITLE)}&sort=title`;
  await go(page, filtered);
  await settle(page);
  // S1 / S6a: the record pane opens and closes on the same filtered, sorted list, still in Admin.
  await page.getByTestId("record-open").first().click();
  await page.waitForURL(/[?&]open=/);
  await page.locator("[data-record-pane]").waitFor();
  await settle(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !location.search.includes("open="), undefined, { timeout: 8000 });
  expect(await here(page)).toBe(filtered);
  await expect(page.getByTestId("back-to-app")).toBeVisible();
  // NAV-04: the task's full page names the way back and returns to the list (with the record beside it).
  await page.getByTestId("record-open").first().click();
  await page.waitForURL(/[?&]open=/);
  await page.getByTestId("record-pane-full").click();
  await page.waitForURL(/\/users\/tasks\/\d+\?from=/);
  await settle(page);
  await expect(crumbs(page)).toContainText("Admin → Records");
  await expect(crumbs(page)).not.toContainText("Tasks");
  const back = page.getByTestId("return-to");
  await expect(back).toHaveText("← Back to Admin → Records");
  await back.click();
  await page.waitForURL(/\/admin\/records\/tasks/);
  const url = await here(page);
  expect(url.startsWith(`/admin/records/tasks?q=${encodeURIComponent(TITLE)}`) || url.startsWith(`/admin/records/tasks?q=${encodeURIComponent(TITLE).replace(/%20/g, "+")}`)).toBe(true);
  await expect(page.locator("[data-record-pane]")).toBeVisible();
});

test("NAV-04: a tampered or foreign ?from= is ignored; a User never gets an Admin link", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, `/users/tasks/${staffTask}?from=${encodeURIComponent("/admin/records/tasks?q=x")}`);
  await settle(page);
  await expect(page.getByTestId("return-to")).toHaveCount(0);
  await expect(crumbs(page)).not.toContainText("Admin");
  await as(context, "E2E_SUPER");
  for (const bad of ["//evil.example/admin/records", "https://evil.example/admin/records", "/admin/records/../../users", "/users/approvals"]) {
    await go(page, `/users/tasks/${superTask}?from=${encodeURIComponent(bad)}`);
    await settle(page);
    await expect(page.getByTestId("return-to")).toHaveCount(0);
    await expect(page.locator("main a[href*='evil.example']")).toHaveCount(0);
  }
});

// ------------------------------------------------------------------ NAV-05, S3, S8
test("NAV-05 / S3: Task Summary → pane → full page: the crumb names Task Summary; Back returns", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, "/users/work/my-tasks?view=list");
  await settle(page);
  // S3a: a task link opens the pane; Back closes it on the same list.
  await page.locator(`main a[href="/users/tasks/${staffTask}"]`).first().click();
  await page.waitForURL(new RegExp(`task=${staffTask}`));
  await page.goBack();
  await page.waitForFunction(() => !location.search.includes("task="), undefined, { timeout: 8000 });
  expect(await here(page)).toBe("/users/work/my-tasks?view=list");
  // S3b + NAV-05.
  await page.locator(`main a[href="/users/tasks/${staffTask}"]`).first().click();
  await page.waitForURL(new RegExp(`task=${staffTask}`));
  await page.getByTestId("pane-full").click();
  await page.waitForURL(new RegExp(`/users/tasks/${staffTask}$`));
  await settle(page);
  const parent = page.getByTestId("crumb-parent");
  await expect(parent).toHaveText("Task Summary");
  await expect(parent).toHaveAttribute("href", "/users/work/my-tasks?view=list");
  await page.goBack();
  await settle(page);
  expect((await here(page)).startsWith("/users/work/my-tasks")).toBe(true);
  // S3c: opened directly in a new tab (e.g. from an email): the page's own parent.
  const direct = await context.newPage();
  await go(direct, `/users/tasks/${staffTask}`);
  await settle(direct);
  await expect(direct.getByTestId("crumb-parent")).toHaveText("Tasks");
  await direct.close();
});

test("NAV-05 / S8: Inbox → request: the crumb names the Inbox with its filter; Back returns", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await go(page, "/users/inbox?type=approvals");
  await settle(page);
  await page.locator(`main a[href^="${requestPath}"]`).first().click();
  await page.waitForURL(/\/users\/requests\/\d+/);
  await settle(page);
  const parent = page.getByTestId("crumb-parent");
  await expect(parent).toHaveText("Inbox");
  await expect(parent).toHaveAttribute("href", "/users/inbox?type=approvals");
  await expect(page.getByTestId("back-to-list")).toHaveText("← Back to Inbox");
  await page.goBack();
  await settle(page);
  expect(await here(page)).toBe("/users/inbox?type=approvals");
  // Opened directly in a new tab: the request's own list.
  const direct = await context.newPage();
  await go(direct, requestPath);
  await settle(direct);
  await expect(direct.getByTestId("crumb-parent")).toHaveText("Waiting for me");
  await direct.close();
});

// ------------------------------------------------------------------ NAV-06
test("NAV-06: browser Back with an unsent pane comment asks first; Keep keeps it, Discard leaves", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, "/users/work/my-tasks");
  await settle(page);
  await page.locator(`main a[href="/users/tasks/${staffTask}"]`).first().click();
  await page.waitForURL(new RegExp(`task=${staffTask}`));
  const box = page.locator("[data-task-pane]").getByRole("textbox", { name: /comment/i }).first();
  await box.click();
  await page.keyboard.type("Unsent 189 note");
  await page.waitForTimeout(300);
  await page.goBack({ waitUntil: "commit" }).catch(() => undefined);
  await expect(page.getByText(/Discard draft/i).first()).toBeVisible();
  await expect.poll(() => here(page)).toContain(`task=${staffTask}`);
  await page.getByRole("button", { name: /Keep/i }).first().click();
  await expect(box).toContainText("Unsent 189 note");
  expect(await here(page)).toContain(`task=${staffTask}`);
  // Again, and Discard: the move happens.
  await page.goBack({ waitUntil: "commit" }).catch(() => undefined);
  await expect(page.getByText(/Discard draft/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Discard/i }).first().click();
  await page.waitForFunction(() => !location.search.includes("task="), undefined, { timeout: 8000 });
  expect(await here(page)).toBe("/users/work/my-tasks");
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  // Without a draft, Back is not held up.
  await page.goForward();
  await page.waitForURL(new RegExp(`task=${staffTask}`));
  await page.goBack();
  await page.waitForFunction(() => !location.search.includes("task="), undefined, { timeout: 8000 });
});

// ------------------------------------------------------------------ NAV-07, H2
test("NAV-07 / H2: sign-in next to an area the person can't open lands on their home", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, "/login?next=/admin/users");
  expect(await here(page)).toBe("/users");
  await go(page, "/login?next=/superadmin/monitoring/audit");
  expect(await here(page)).toBe("/users");
  await as(context, "E2E_ADMIN");
  await go(page, "/login?next=/superadmin");
  expect(await here(page)).toBe("/users");
  await go(page, `/login?next=${encodeURIComponent("/admin/users?q=E2E")}`);
  expect(await here(page)).toBe("/admin/users?q=E2E");
  await go(page, "/login");
  expect(await here(page)).toBe("/users");
});

// ------------------------------------------------------------------ NAV-08
test("NAV-08: '← Back' stays in the app when the page was opened from outside; keeps the list from inside", async ({ page, context, browserName }) => {
  // v1.89.0 (D-424): Playwright's WebKit on Windows cancels a navigation from a data: page into a
  // site whose service worker controls it ("Provisional navigation canceled", 2 / 2; passes with
  // the worker blocked). The worker plays no part in the Back link, so WebKit runs this one without it.
  if (browserName === "webkit") await context.route("**/sw.js*", (route) => route.abort());
  await as(context, "E2E_STAFF");
  const staff = await userIdByLogin("E2E_STAFF");
  await go(page, "/users");
  await settle(page);
  await go(page, "/users/inbox");
  await settle(page);
  await go(page, "data:text/html,<p>Email client</p>");
  await go(page, `/users/people/${staff}`);
  await settle(page);
  await page.getByTestId("back-link").click();
  await page.waitForURL((url) => url.origin === new URL(test.info().project.use.baseURL!).origin && url.pathname === "/users");
  // From a page of the app: Back to that page, with its query.
  await go(page, "/users/work/my-tasks?view=list");
  await settle(page);
  await page.getByTestId("my-tasks-avatar").click();
  await page.waitForURL(/\/users\/people\/\d+/);
  await settle(page);
  await page.getByTestId("back-link").click();
  await page.waitForURL(/\/users\/work\/my-tasks/);
  expect(await here(page)).toBe("/users/work/my-tasks?view=list");
});

// ------------------------------------------------------------------ S5, S7, S9, S11
test("S7 / S9: refresh and a pasted pane address keep the role and the pane", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  for (const [url, pane] of [
    [`/users/work/my-tasks?task=${superTask}`, "[data-task-pane]"],
    [`/admin/records/tasks?sort=title&open=${superTask}`, "[data-record-pane]"],
  ] as const) {
    await go(page, url);
    await settle(page);
    await page.reload();
    await settle(page);
    await expect(page.locator(pane).first()).toBeVisible();
    expect(await here(page)).toBe(url);
    const second = await context.newPage();
    await go(second, url);
    await expect(second.locator(pane).first()).toBeVisible();
    await second.close();
  }
});

test("S5 / S11: Board view kept across modules; spaces by role; the area round trip", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, "/users/work/my-tasks?view=board");
  await settle(page);
  await go(page, "/users/meetings");
  await settle(page);
  await page.goBack();
  await settle(page);
  await expect.poll(() => here(page).catch(() => "")).toBe("/users/work/my-tasks?view=board");
  for (const [who, spaces] of [
    ["E2E_STAFF", []],
    ["E2E_ADMIN", ["/admin"]],
    ["E2E_SUPER", ["/admin", "/superadmin"]],
  ] as const) {
    await as(context, who);
    await go(page, "/users");
    await settle(page);
    await page.locator('button[aria-label^="Account menu for"]').first().click();
    const hrefs = await page.locator('[role="menu"] a').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    for (const space of ["/admin", "/superadmin"]) expect(hrefs.includes(space), `${who} ${space}`).toBe((spaces as readonly string[]).includes(space));
    await page.keyboard.press("Escape");
  }
});

// ------------------------------------------------------------------ general pages
test("Help explains signing in again and the way back", async ({ page, context }) => {
  await as(context, "E2E_STAFF");
  await go(page, "/users/help");
  await settle(page);
  await expect(page.locator("main")).toContainText("Sign in again brings back the same view");
  await expect(page.locator("main")).toContainText("opened from Admin → Records offers ← Back to Admin → Records");
  await expect(page.locator("main")).toContainText("the browser's Back first asks Discard draft?");
});
