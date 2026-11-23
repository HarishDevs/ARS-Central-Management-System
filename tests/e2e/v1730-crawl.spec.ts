import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, phoneLayoutCookie, sessionCookie, toWorkflowStep, dropCustomDraft, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.74.1 (D-397, owner: "hunt all the bugs in all perspective … check
// navigation to and fro"): a live click-through of every screen.
// For every route under /users, /admin, /superadmin and the public pages,
// signed in as the person the screen is for, it records the HTTP status,
// console and page errors, React hydration errors, failed requests, axe
// serious/critical findings, sideways scrolling, controls covered by fixed
// bars, clipped text, and a screenshot. Then it clicks the menus, tabs and
// back links of the main screens and checks the way back (browser back and
// forward included).
//
// Default: light at 1366 px, dark at 768 and 375 px (about 20 minutes plus the to-and-fro checks).
// CRAWL_FULL=1: light and dark at 1366, 768 and 375 px (the owner's matrix).
// Findings: test-results/crawl/findings.json; screenshots: test-results/crawl/shots.
// Kept green: no console, page or hydration errors, no axe serious/critical,
// no sideways scrolling (any width), no 5xx, no navigation that can't come back.
// Not serial: a failing mode doesn't stop the others; the set-up's ids are kept in a file.

const FULL = Boolean(process.env.CRAWL_FULL);
const DIR = "test-results/crawl";
const SHOTS = `${DIR}/shots`;
type Theme = "light" | "dark";
type Mode = { theme: Theme; width: number };
const MODES: Mode[] = FULL
  ? (["light", "dark"] as const).flatMap((theme) => [1366, 768, 375].map((width) => ({ theme, width })))
  : [
      { theme: "light", width: 1366 },
      { theme: "dark", width: 768 },
      { theme: "dark", width: 375 },
    ];
const heightFor = (width: number) => (width === 375 ? 812 : width === 768 ? 1024 : 900);

const stamp = Date.now().toString(36);
const NOMOD = "E2E_CRAWL_NOMOD";
const ids: Record<string, string> = {};
function loadIds() {
  if (Object.keys(ids).length) return;
  try {
    Object.assign(ids, JSON.parse(readFileSync(`${DIR}/ids.json`, "utf8")) as Record<string, string>);
  } catch {
    // The set-up test didn't run: the detail routes answer 404 and say so.
  }
}

async function sql<T = ResultSetHeader>(query: string, values: unknown[] = []): Promise<T> {
  const conn = await db();
  try {
    const [rows] = await conn.query(query, values);
    return rows as T;
  } finally {
    await conn.end();
  }
}

async function as(context: BrowserContext, loginId: string | null, theme: Theme = "light", phone = false) {
  await context.clearCookies();
  const cookies: { name: string; value: string; domain: string; path: string }[] = [{ name: "ars_theme", value: theme, domain: "localhost", path: "/" }];
  if (loginId) cookies.push(await sessionCookie(loginId, { tourDone: true }));
  if (phone) cookies.push(phoneLayoutCookie());
  await context.addCookies(cookies);
}

// ---------------------------------------------------------------- set-up
let savedTicketAccess: { login_id: string; module_access: string | null }[] = [];
test.beforeAll(async () => {
  const conn = await db();
  try {
    // The theme comes from the ars_theme cookie; a saved account theme would override it.
    await conn.query("DELETE FROM user_settings WHERE setting_key = 'ui.theme'");
    const [rows] = await conn.query<RowDataPacket[]>("SELECT login_id, module_access FROM users WHERE login_id LIKE 'E2E%'");
    savedTicketAccess = rows.map((row) => ({ login_id: String(row.login_id), module_access: (row.module_access as string | null) ?? null }));
    await conn.query("UPDATE users SET module_access = CONCAT_WS(',', NULLIF(module_access, ''), 'TICKET') WHERE login_id LIKE 'E2E%' AND NOT FIND_IN_SET('TICKET', IFNULL(module_access, ''))");
    // A person without the Tasks and Projects modules.
    const [found] = await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE login_id = ?", [NOMOD]);
    if (found[0]) await conn.query("UPDATE users SET active = TRUE, module_access = 'APPROVAL,INFORMATION,MEETING' WHERE id = ?", [found[0].id]);
    else {
      const [inserted] = await conn.query<ResultSetHeader>(
        "INSERT INTO users (login_id, name, email, sign_in_method, active, last_login_at, module_access) VALUES (?, 'Nila Nomodule', 'e2e_crawl_nomod@example.test', 'GOOGLE', TRUE, CURRENT_TIMESTAMP, 'APPROVAL,INFORMATION,MEETING')",
        [NOMOD],
      );
      await conn.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'USER'", [inserted.insertId]);
    }
  } finally {
    await conn.end();
  }
});
test.afterAll(async () => {
  const conn = await db();
  try {
    for (const row of savedTicketAccess) await conn.query("UPDATE users SET module_access = ? WHERE login_id = ?", [row.module_access, row.login_id]);
    await conn.query("UPDATE users SET active = FALSE WHERE login_id = ?", [NOMOD]);
  } finally {
    await conn.end();
  }
});

test("set up: one of each record the detail screens need", async ({ page, context }) => {
  test.setTimeout(300_000);
  // A project with a task, a form and an automation (Ravi).
  await as(context, "E2E_REQ");
  const projectUrl = await createProject(page, `Crawl ${stamp}`);
  ids.project = projectUrl.split("/").pop()!;
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(`Crawl task ${stamp}`);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: `Crawl task ${stamp}` })).toBeVisible();
  const [task] = await sql<RowDataPacket[]>("SELECT id FROM tasks WHERE title = ?", [`Crawl task ${stamp}`]);
  ids.task = String(task!.id);
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("add-form").click();
  await expect(page).toHaveURL(/\/forms\/\d+$/);
  ids.form = page.url().split("/").pop()!;
  await page.goto(`${projectUrl}/settings`);
  await page.getByTestId("add-automation").press("Enter");
  await expect(page).toHaveURL(/\/automations\/\d+$/);
  ids.automation = page.url().split("/").pop()!;
  const [form] = await sql<RowDataPacket[]>("SELECT share_token FROM project_forms WHERE id = ?", [ids.form]);
  ids.formToken = String(form?.share_token ?? "none");

  // A portfolio holding the project.
  await page.goto("/users/work/portfolios/new");
  await page.getByTestId("portfolio-name").fill(`Crawl portfolio ${stamp}`);
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-search").fill(stamp);
  await page.getByRole("checkbox", { name: `Crawl ${stamp}` }).check();
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios\/\d+\?created=1/);
  ids.portfolio = new URL(page.url()).pathname.split("/").pop()!;

  // A request from Ravi waiting for Manoj.
  await dropCustomDraft("E2E_REQ");
  await page.goto("/users/custom");
  await page.locator("#c-title").fill(`Crawl request ${stamp}`);
  await toWorkflowStep(page);
  const level = page.getByTestId("workflow-level").filter({ visible: true }).last();
  await level.getByLabel("Who approves").selectOption("PEOPLE");
  await level.getByRole("combobox", { name: /People \(search and pick/ }).fill("Manoj");
  await page.getByRole("option", { name: /Manoj Manager/ }).first().click();
  await page.getByTestId("step-next").click();
  await page.getByTestId("action-bar").getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/users\/requests\/\d+\?submitted=1/);
  ids.request = new URL(page.url()).pathname.split("/").pop()!;

  // Straight into the tables: a ticket (Manoj coordinates its category), a meeting, a calendar entry, an information type.
  const req = await userIdByLogin("E2E_REQ");
  const mgr = await userIdByLogin("E2E_MGR");
  const ticketType = await sql("INSERT INTO module_types (module, code, name, description, active) VALUES ('TICKET', ?, ?, '', TRUE)", [`CRAWL_${stamp.toUpperCase()}`, `Crawl form ${stamp}`]);
  ids.ticketForm = String(ticketType.insertId);
  const version = await sql("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, published_at) VALUES (?, 1, 'PUBLISHED', JSON_ARRAY(), JSON_OBJECT(), UTC_TIMESTAMP())", [ticketType.insertId]);
  const [category] = await sql<RowDataPacket[]>("SELECT id FROM ticket_categories ORDER BY id LIMIT 1");
  const ticket = await sql("INSERT INTO tickets (ticket_no, category_id, type_version_id, title, form_data_json, requester_id, submission_key) VALUES (?, ?, ?, ?, JSON_OBJECT(), ?, ?)", [`CRAWL-${stamp}`, category!.id, version.insertId, `Crawl ticket ${stamp}`, req, `crawl-${stamp}`]);
  ids.ticket = String(ticket.insertId);
  await sql("INSERT IGNORE INTO ticket_request_types (type_id, category_id) VALUES (?, ?)", [ticketType.insertId, category!.id]);
  await sql("INSERT IGNORE INTO ticket_coordinators (type_id, user_id) VALUES (?, ?)", [ticketType.insertId, mgr]);
  const [meetingType] = await sql<RowDataPacket[]>("SELECT id FROM meeting_types ORDER BY id LIMIT 1");
  const meeting = await sql(
    "INSERT INTO meetings (meeting_no, title, description, type_id, owner_id, coordinator_id, mode, venue, link, priority, confidentiality, guests, scheduled_start, scheduled_end, points_policy, created_by, created_at) VALUES (?, ?, '', ?, ?, ?, 'OFFLINE', 'Board room', NULL, 'IMPORTANT', 'GENERAL', '', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 25 HOUR), 'BLOCK', ?, UTC_TIMESTAMP())",
    [`MTG-CRAWL-${stamp}`, `Crawl meeting ${stamp}`, meetingType!.id, req, req, req],
  );
  ids.meeting = String(meeting.insertId);
  const item = await sql("INSERT INTO calendar_items (user_id, title, notes, all_day, starts_at, ends_at, origin) VALUES (?, ?, 'Crawl', FALSE, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR), 'ARS')", [req, `Crawl entry ${stamp}`]);
  ids.calendarItem = String(item.insertId);
  const settings = { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, allowPeople: true, allowDepartments: true, allowGroups: true, allowEveryone: false, ack: "ALWAYS", ackReminderDays: null, defaultPriority: "NORMAL", expiryDays: null, editableAfterPublish: false };
  const infoType = await sql("INSERT INTO module_types (module, code, name, created_by) VALUES ('INFO', ?, ?, ?)", [`CRAWL_NOTICE_${stamp}`, `Crawl notice ${stamp}`, mgr]);
  await sql("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, created_by, published_by, published_at) VALUES (?, 1, 'PUBLISHED', '[]', ?, ?, ?, CURRENT_TIMESTAMP)", [infoType.insertId, JSON.stringify(settings), mgr, mgr]);
  ids.infoType = String(infoType.insertId);
  const [taskType] = await sql<RowDataPacket[]>("SELECT id FROM module_types WHERE module = 'TASK' ORDER BY id LIMIT 1");
  ids.taskType = String(taskType!.id);

  // Information from Manoj to Ravi.
  await as(context, "E2E_MGR");
  await page.goto(`/users/information/new?type=${ids.infoType}`);
  await page.getByLabel("Subject").fill(`Crawl notice ${stamp}`);
  await page.getByLabel("Message").fill("Crawl message.");
  await page.getByRole("combobox", { name: /People/ }).fill("Ravi");
  await page.getByRole("option", { name: /Ravi Requester/ }).first().click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published to 1 person/)).toBeVisible();
  ids.info = new URL(page.url()).pathname.split("/").pop()!;
  ids.req = String(req);

  // Keyed admin pages: the first link each list offers.
  await as(context, "E2E_SUPER");
  const firstLink = async (list: string, pattern: RegExp) => {
    await page.goto(list);
    const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    return hrefs.find((href) => pattern.test(href.split("?")[0]!)) ?? null;
  };
  ids.templatePath = (await firstLink("/superadmin/connections/whatsapp/templates", /^\/superadmin\/connections\/whatsapp\/templates\/[^/]+$/)) ?? "/superadmin/connections/whatsapp/templates/none";
  ids.pageRulePath = (await firstLink("/superadmin/security/pages", /^\/superadmin\/security\/pages\/[^/]+$/)) ?? "/superadmin/security/pages/none";
  ids.reportPath = (await firstLink("/admin/insights/reports", /^\/admin\/insights\/reports\/[a-z_]+$/)) ?? "/admin/insights/reports/none";
  writeFileSync(`${mkdir(DIR)}/ids.json`, JSON.stringify(ids, null, 2));
});

function mkdir(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

// ---------------------------------------------------------------- routes
type Route = { path: () => string; login: string | null; label?: string; expect?: number[] };
const R = (login: string | null, ...paths: (string | (() => string))[]): Route[] => paths.map((p) => ({ login, path: typeof p === "string" ? () => p : p }));

const ROUTES: Route[] = [
  // Public (signed out).
  ...R(null, "/", "/login", "/forgot-password", "/privacy", "/terms", "/security/not-me", "/set-password", "/signed-out"),
  // Requester.
  ...R(
    "E2E_REQ",
    "/users",
    "/users/approvals",
    "/users/approved",
    "/users/approved-by-me",
    "/users/calendar",
    () => `/users/calendar/items/${ids.calendarItem}`,
    "/users/collaborating",
    "/users/custom",
    "/users/delegation",
    () => `/users/forms/${ids.formToken}`,
    "/users/help",
    "/users/inbox",
    "/users/information",
    () => `/users/information/${ids.info}`,
    "/users/information/sent",
    "/users/meetings",
    () => `/users/meetings/${ids.meeting}`,
    "/users/meetings/follow-ups",
    "/users/meetings/new",
    "/users/more",
    "/users/new",
    "/users/no-access",
    "/users/notifications/settings",
    () => `/users/people/${ids.req}`,
    "/users/profile",
    "/users/profile/calendar",
    "/users/profile/devices",
    "/users/queue",
    "/users/queue/sent-back",
    "/users/requests",
    () => `/users/requests/${ids.request}`,
    "/users/search?q=crawl",
    "/users/security",
    "/users/switched-off",
    () => `/users/tasks/${ids.task}`,
    "/users/tasks",
    "/users/tasks/assigned",
    "/users/tasks/new",
    "/users/tasks/team",
    "/users/tickets",
    () => `/users/tickets/${ids.ticket}`,
    "/users/tickets/new",
    "/users/work/deleted",
    "/users/work/my-tasks",
    "/users/work/periodic",
    "/users/work/portfolios",
    () => `/users/work/portfolios/${ids.portfolio}`,
    "/users/work/portfolios/new",
    "/users/work/projects",
    () => `/users/work/projects/${ids.project}`,
    () => `/users/work/projects/${ids.project}?view=board`,
    () => `/users/work/projects/${ids.project}/settings`,
    () => `/users/work/projects/${ids.project}/forms/${ids.form}`,
    () => `/users/work/projects/${ids.project}/automations/${ids.automation}`,
    "/users/work/projects/new",
    "/users/work/search?q=crawl",
    "/users/work/templates",
    "/users/analytics",
    "/users/analytics/list",
    "/users/analytics/list?kind=raised",
    "/users/analytics/metrics",
  ),
  // Approver (manager) and coordinator.
  ...R("E2E_MGR", "/users", "/users/queue", () => `/users/requests/${ids.request}`, "/users/approved-by-me", "/users/tickets/board", () => `/users/tickets/${ids.ticket}`, "/users/tickets/dashboards", "/users/information/sent", () => `/users/information/${ids.info}`),
  // HOD.
  ...R("E2E_HOD", "/users", "/users/tasks/team", "/users/work/periodic"),
  // Staff.
  ...R("E2E_STAFF", "/users", "/users/tickets", "/users/requests"),
  // Without the Tasks and Projects modules.
  ...R(NOMOD, "/users", "/users/more", "/users/work/my-tasks", "/users/tasks", "/users/work/projects", () => `/users/work/projects/${ids.project}`, "/users/work/portfolios"),
  // IT admin.
  ...R(
    "E2E_ADMIN",
    "/admin",
    "/admin/insights/ai",
    "/admin/setup/ai-rules",
    "/admin/insights/analytics",
    "/admin/insights/analytics/list",
    "/admin/insights/analytics/list?kind=open",
    "/admin/insights/analytics/metrics",
    "/admin/setup/budgets",
    "/admin/calendar",
    "/admin/setup/custom-approval",
    "/admin/insights/dashboards/approvers",
    "/admin/insights/dashboards/departments",
    "/admin/insights/dashboards/raisers",
    "/admin/insights/dashboards/utilisation",
    "/admin/setup/doa",
    "/admin/setup/groups",
    "/admin/setup/information-types",
    () => `/admin/setup/information-types/${ids.infoType}`,
    "/admin/insights",
    "/admin/setup/meetings",
    "/admin/no-access",
    "/admin/setup/notifications",
    "/admin/organisation",
    "/admin/records/information",
    "/admin/records/requests",
    "/admin/records/tasks",
    "/admin/records/tickets",
    "/admin/records/meetings",
    "/admin/setup",
    "/admin/setup/reminders",
    "/admin/setup/reminders/new",
    "/admin/insights/reports",
    () => ids.reportPath!,
    "/admin/setup/task-settings",
    "/admin/setup/task-types",
    () => `/admin/setup/task-types/${ids.taskType}`,
    "/admin/setup/ticket-categories",
    "/admin/setup/ticket-forms",
    () => `/admin/setup/ticket-forms/${ids.ticketForm}`,
    "/admin/users",
    () => `/admin/users/${ids.req}`,
    "/admin/users/new",
    "/admin/insights/workload",
    "/admin/insights/workload/reassign",
  ),
  // Super admin.
  ...R(
    "E2E_SUPER",
    "/superadmin",
    "/superadmin/connections/ai",
    "/superadmin/connections/ai/data-sources",
    "/superadmin/monitoring/ai-history",
    "/superadmin/monitoring/ai-reports",
    "/superadmin/monitoring/audit",
    "/superadmin/monitoring/jobs",
    "/superadmin/monitoring/deliveries",
    "/superadmin/data/danger-zone/demo",
    "/superadmin/data/import",
    "/superadmin/connections/google",
    "/superadmin/connections/whatsapp",
    "/superadmin/connections/push",
    "/superadmin/security/sign-in",
    "/superadmin/security/general",
    "/superadmin/security/features",
    "/superadmin/data/danger-zone",
    "/superadmin/data/backup",
    "/superadmin/security/sign-in-history",
    "/superadmin/security/pages",
    () => ids.pageRulePath!,
    "/superadmin/data/danger-zone/requests",
    "/superadmin/data/retention",
    "/superadmin/connections/salesforce",
    "/superadmin/connections/email",
    "/superadmin/connections/whatsapp/templates",
    () => ids.templatePath!,
    "/admin",
    "/users",
  ),
];

// ---------------------------------------------------------------- checks
type Finding = { kind: string; login: string; path: string; mode: string; detail: string };
const findings: Finding[] = [];
const visits: { login: string; path: string; mode: string; status: number; landed: string; shot: string }[] = [];
const IGNORED_CONSOLE = [/Download the React DevTools/, /favicon/i, /net::ERR_ABORTED/, /Failed to fetch RSC payload/];
const HYDRATION = /hydrat|Minified React error #(418|419|421|422|423|425)|did not match/i;

function slug(path: string) {
  return path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80) || "root";
}

async function checkPage(page: Page): Promise<{ kind: string; detail: string }[]> {
  return page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const ancestors = (el: Element) => {
      const list: Element[] = [];
      for (let node = el.parentElement; node; node = node.parentElement) list.push(node);
      return list;
    };
    const describe = (el: Element) => {
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      const testId = el.getAttribute("data-testid");
      const where = el.closest("[data-testid]")?.getAttribute("data-testid");
      return `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ""}${!testId && where ? ` in [${where}]` : ""} "${text}"`;
    };
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 1) {
      // The widest culprits: elements that reach past the right edge.
      const width = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.right > width + 1 && box.width > 0 && getComputedStyle(el).position !== "fixed";
        })
        .slice(0, 4)
        .map(describe);
      out.push({ kind: "overflow", detail: `${overflow}px: ${wide.join(" | ")}` });
    }
    // Controls a bottom bar (phone tab bar, decision bar, form footer) still covers with the page
    // scrolled to its end: nothing can be scrolled out from under it, so it can't be reached.
    const main = document.querySelector("main");
    const scrollers = [document.scrollingElement, ...(main ? [main, ...ancestors(main)] : [])].filter((el, index, all): el is Element => {
      if (!el || all.indexOf(el) !== index) return false;
      if (el === document.scrollingElement) return true;
      const overflowY = getComputedStyle(el).overflowY;
      return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    });
    const before = scrollers.map((el) => el.scrollTop);
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    const shown = (el: Element) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const bars = [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (!shown(el)) return false;
      return (style.position === "fixed" || style.position === "sticky") && (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
    });
    const controls = [...document.querySelectorAll("main a[href], main button, main input:not([type=hidden]), main select, main textarea")];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      if (box.width < 4 || box.height < 4 || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
      if (!shown(control) || control.closest("thead, [role=columnheader]")) continue;
      const x = Math.min(Math.max(box.left + box.width / 2, 1), innerWidth - 2);
      const y = Math.min(Math.max(box.top + box.height / 2, 1), innerHeight - 2);
      const top = document.elementFromPoint(x, y);
      if (!top || control.contains(top) || top.contains(control)) continue;
      const bar = bars.find((candidate) => candidate.contains(top) && !candidate.contains(control) && candidate.getBoundingClientRect().top > innerHeight / 2);
      if (bar) out.push({ kind: "covered", detail: `${describe(control)} under ${describe(bar).slice(0, 60)}` });
    }
    scrollers.forEach((el, index) => (el.scrollTop = before[index]!));
    // Text cut off without an ellipsis.
    for (const el of document.querySelectorAll("main h1, main h2, main h3, main button, main a, main label, main th, main td, main p, main span, main dt, main dd")) {
      if (el.children.length > 0 || !(el.textContent ?? "").trim()) continue;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") continue;
      if (!["hidden", "clip"].includes(style.overflowX)) continue;
      if (el.closest(".sr-only") || (el as HTMLElement).offsetWidth <= 1) continue;
      if (el.scrollWidth > (el as HTMLElement).clientWidth + 2) out.push({ kind: "clipped", detail: describe(el) });
    }
    // Controls without a name (axe reports the serious ones too; this catches the rest).
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem]")) {
      const html = el as HTMLElement;
      // Hidden from assistive tech on purpose (a chart's hover targets with a table for screen readers).
      if ((!html.offsetWidth && !html.offsetHeight) || !shown(el) || el.closest('[aria-hidden="true"], [inert]')) continue;
      const labelled =
        (el.getAttribute("aria-label") ?? "").trim() ||
        el.getAttribute("aria-labelledby") ||
        (el.getAttribute("title") ?? "").trim() ||
        (html.innerText ?? "").trim() ||
        el.querySelector("img[alt]:not([alt=''])") ||
        (el instanceof HTMLInputElement && (el.labels?.length || el.placeholder || ["submit", "button", "reset"].includes(el.type) && el.value)) ||
        ((el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.labels?.length);
      if (!labelled) out.push({ kind: "unlabelled", detail: `${describe(el)} ${el.outerHTML.slice(0, 160)}` });
    }
    return out;
  });
}

async function axe(page: Page): Promise<string[]> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}

function watch(page: Page, current: () => { login: string; path: string; mode: string }) {
  const add = (kind: string, detail: string) => findings.push({ kind, ...current(), detail: detail.slice(0, 400) });
  page.on("pageerror", (error) => add(HYDRATION.test(error.message) ? "hydration" : "page-error", error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    add(HYDRATION.test(text) ? "hydration" : "console", text);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)) return;
    add("request-failed", `${request.method()} ${request.url()} ${failure}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname !== "localhost") return;
    if (response.status() >= 500) add("server-error", `${response.status()} ${url.pathname}`);
    else if (response.status() >= 400 && response.request().resourceType() !== "document" && !url.searchParams.has("_rsc")) add("request-4xx", `${response.status()} ${response.request().method()} ${url.pathname}`);
  });
}

for (const mode of MODES) {
  const label = `${mode.theme} ${mode.width}`;
  test(`every route: ${label}`, async ({ browser }) => {
    loadIds();
    test.setTimeout(FULL ? 3_600_000 : 1_800_000);
    mkdir(SHOTS);
    const context = await browser.newContext({ viewport: { width: mode.width, height: heightFor(mode.width) }, colorScheme: mode.theme });
    const page = await context.newPage();
    let current = { login: "", path: "", mode: label };
    watch(page, () => current);
    let signedInAs: string | null | undefined;
    for (const route of ROUTES) {
      const path = route.path();
      const login = route.login ?? "public";
      current = { login, path, mode: label };
      if (signedInAs !== route.login) {
        await as(context, route.login, mode.theme, mode.width < 768);
        signedInAs = route.login;
      }
      const response = await page.goto(path, { waitUntil: "networkidle", timeout: 45_000 }).catch(async (error: Error) => {
        findings.push({ kind: "navigation-failed", ...current, detail: error.message.slice(0, 200) });
        return null;
      });
      const status = response?.status() ?? 0;
      const landed = new URL(page.url()).pathname + new URL(page.url()).search;
      if (status >= 400) findings.push({ kind: `status-${status}`, ...current, detail: `landed on ${landed}` });
      // Let late client work (polling, effects) surface its errors.
      await page.waitForTimeout(250);
      for (const found of await checkPage(page).catch(() => [])) findings.push({ ...found, ...current });
      for (const violation of await axe(page).catch((error: Error) => [`axe-crashed: ${error.message}`])) findings.push({ kind: "axe", ...current, detail: violation });
      const shot = `${SHOTS}/${slug(login)}__${slug(path)}__${mode.width}-${mode.theme}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      visits.push({ login, path, mode: label, status, landed, shot });
    }
    await context.close();
    writeFileSync(`${DIR}/findings-${mode.theme}-${mode.width}.json`, JSON.stringify({ visits, findings: findings.filter((finding) => finding.mode === label) }, null, 2));
    const must = findings.filter(
      (finding) =>
        finding.mode === label &&
        (["console", "page-error", "hydration", "axe", "server-error", "navigation-failed"].includes(finding.kind) || /^status-5/.test(finding.kind) || finding.kind === "overflow"),
    );
    expect(must.map((finding) => `${finding.kind} ${finding.login} ${finding.path}: ${finding.detail}`)).toEqual([]);
  });
}

// ---------------------------------------------------------------- to and fro
// The main screens' menus, tabs and back links: each opens, closes and comes back.
type NavCase = { login: string; start: () => string; width: number };
const NAV: NavCase[] = [
  { login: "E2E_REQ", start: () => "/users", width: 1366 },
  { login: "E2E_ADMIN", start: () => "/admin", width: 1366 },
  { login: "E2E_SUPER", start: () => "/superadmin", width: 1366 },
  { login: "E2E_REQ", start: () => "/users", width: 375 },
  { login: NOMOD, start: () => "/users", width: 1366 },
];
const navProblems: string[] = [];

async function landedOk(page: Page): Promise<string | null> {
  const heading = await page.locator("h1").first().textContent({ timeout: 5_000 }).catch(() => null);
  if (/Something went wrong|This page isn't available/i.test(heading ?? "")) return `shows "${heading}"`;
  return null;
}

for (const nav of NAV) {
  test(`to and fro: ${nav.login} ${nav.width}`, async ({ browser }) => {
    loadIds();
    test.setTimeout(900_000);
    const context = await browser.newContext({ viewport: { width: nav.width, height: heightFor(nav.width) } });
    await as(context, nav.login, "light", nav.width < 768);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !IGNORED_CONSOLE.some((pattern) => pattern.test(message.text()))) errors.push(`${page.url()}: ${message.text()}`);
    });
    const start = nav.start();
    await page.goto(start, { waitUntil: "networkidle" });
    // The menu: the sidebar on a computer, the tab bar and More on a phone. Each entry is
    // clicked where it is (the page it's on is `from`).
    const sidebar = nav.width < 768 ? '[data-testid="mobile-tabbar"]' : '[data-testid="sidebar"]';
    const hrefsIn = async (scope: string) => [...new Set(await page.locator(`${scope} a[href]`).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")))].filter((href) => href.startsWith("/") && !/logout|signed-out/.test(href));
    const entries: { href: string; from: string; scope: string }[] = (await hrefsIn(sidebar)).map((href) => ({ href, from: start, scope: sidebar }));
    if (nav.width < 768) {
      await page.goto("/users/more", { waitUntil: "networkidle" });
      for (const href of await hrefsIn("main")) if (!entries.some((entry) => entry.href === href)) entries.push({ href, from: "/users/more", scope: "main" });
    }
    expect(entries.length, "menu links").toBeGreaterThan(2);
    const problem = (text: string) => navProblems.push(`${nav.login}@${nav.width} ${text}`);
    for (const { href, from: fromPath, scope } of entries) {
      await page.goto(fromPath, { waitUntil: "networkidle" });
      const from = page.url();
      if (new URL(from).pathname + new URL(from).search === href) continue;
      // Click it in the menu (a closed menu group: open the address instead).
      const link = page.locator(`${scope} a[href="${href}"]`).filter({ visible: true }).first();
      if (await link.count()) {
        await Promise.all([page.waitForURL((url) => url.href !== from, { timeout: 20_000 }).catch(() => null), link.click()]);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        if (page.url() === from) {
          problem(`${href}: clicking the menu entry goes nowhere`);
          continue;
        }
      } else {
        const response = await page.goto(href, { waitUntil: "networkidle" }).catch(() => null);
        if (!response || response.status() >= 400) {
          problem(`${href}: ${response?.status() ?? "no answer"}`);
          continue;
        }
      }
      // A menu address that redirects (e.g. Dashboards → its first board) settles first.
      await page.waitForTimeout(500);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const there = page.url();
      const bad = await landedOk(page);
      if (bad) problem(`${href}: ${bad}`);
      // Browser back returns to the menu's page; forward comes back here.
      await page.goBack({ waitUntil: "networkidle" }).catch(() => null);
      if (page.url() !== from) problem(`${href}: back lands on ${page.url()} (expected ${from})`);
      await page.goForward({ waitUntil: "networkidle" }).catch(() => null);
      if (new URL(page.url()).pathname !== new URL(there).pathname) problem(`${href}: forward lands on ${page.url()} (expected ${there})`);
      // Tabs on the page: each one opens without an error.
      const tabs = page.locator('main [role="tablist"] [role="tab"]').filter({ visible: true });
      const tabCount = Math.min(await tabs.count(), 8);
      for (let index = 0; index < tabCount; index += 1) {
        const tab = page.locator('main [role="tablist"] [role="tab"]').filter({ visible: true }).nth(index);
        if (!(await tab.isVisible().catch(() => false))) continue;
        await tab.click({ timeout: 5_000 }).catch((error: Error) => problem(`${href} tab ${index}: ${error.message.split("\n")[0]}`));
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const tabBad = await landedOk(page);
        if (tabBad) problem(`${href} tab ${index}: ${tabBad}`);
      }
      // Menus in the page: open with a click, close with Escape.
      const menus = page.locator('main button[aria-haspopup="menu"], main button[aria-haspopup="true"]').filter({ visible: true });
      const menuCount = Math.min(await menus.count(), 4);
      for (let index = 0; index < menuCount; index += 1) {
        const button = menus.nth(index);
        if (!(await button.isVisible().catch(() => false)) || (await button.isDisabled().catch(() => true))) continue;
        await button.click({ timeout: 5_000 }).catch(() => undefined);
        if ((await button.getAttribute("aria-expanded").catch(() => null)) !== "true") continue;
        await page.keyboard.press("Escape");
        if ((await button.getAttribute("aria-expanded").catch(() => null)) === "true") problem(`${href} menu ${index}: Escape doesn't close it`);
      }
    }
    // Back links and breadcrumbs on the detail screens: each leads somewhere that works.
    if (nav.login === "E2E_REQ" && nav.width === 1366) {
      const details = [`/users/requests/${ids.request}`, `/users/tasks/${ids.task}`, `/users/information/${ids.info}`, `/users/meetings/${ids.meeting}`, `/users/tickets/${ids.ticket}`, `/users/work/projects/${ids.project}`, `/users/work/portfolios/${ids.portfolio}`, `/users/calendar/items/${ids.calendarItem}`, `/users/people/${ids.req}`, `/users/work/projects/${ids.project}/settings`];
      for (const detail of details) {
        await page.goto(detail, { waitUntil: "networkidle" });
        const back = page.locator('main nav[aria-label="Breadcrumb"] a[href], main a[data-testid="back-link"], main a:has-text("Back"), main a:has-text("All ")').filter({ visible: true }).first();
        if (!(await back.count())) {
          navProblems.push(`${detail}: no back link or breadcrumb`);
          continue;
        }
        // A history Back link (person card) steps back itself, so browser back then goes one further.
        const historyBack = (await back.getAttribute("data-testid")) === "back-link";
        await Promise.all([page.waitForURL((url) => !url.href.includes(detail), { timeout: 20_000 }).catch(() => null), back.click()]);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const bad = await landedOk(page);
        if (bad || page.url().includes(detail)) navProblems.push(`${detail}: back link ${bad ?? "goes nowhere"}`);
        await page.goBack({ waitUntil: "networkidle" });
        if (!historyBack && !page.url().includes(detail)) navProblems.push(`${detail}: browser back after the back link lands on ${page.url()}`);
      }
    }
    await context.close();
    writeFileSync(`${mkdir(DIR)}/nav-${slug(nav.login)}-${nav.width}.json`, JSON.stringify({ navProblems, errors }, null, 2));
    expect(errors).toEqual([]);
    expect(navProblems.filter((problem) => problem.startsWith(`${nav.login}@${nav.width}`) || (nav.login === "E2E_REQ" && nav.width === 1366 && problem.startsWith("/")))).toEqual([]);
  });
}
