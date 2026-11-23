import fs from "node:fs";
import path from "node:path";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { db, dropCustomDraft, phoneLayoutCookie, sessionCookie, toWorkflowStep, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// Shared by the UI/UX QA audit specs (zz-ui-qa-*.spec.ts, phase 1 of the
// global UI/UX QA programme, docs/qa/QA_TEST_PLAN.md). Measuring only: these
// specs never fail on a finding; they write evidence under audit/ui-qa/
// (git-ignored). They run only with UIQA=1 (never in the normal e2e run).

export const OUT = "audit/ui-qa";
export const IDS_FILE = path.join(OUT, "ids.json");

// The owner's nine viewports. Below 768 px a real phone gets the phone layout
// (ars_layout cookie, as LayoutSync sets it) and a touch screen; 768 x 1024 is a tablet (touch).
export const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080, touch: false },
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "1366x768", width: 1366, height: 768, touch: false },
  { name: "1280x720", width: 1280, height: 720, touch: false },
  { name: "1024x768", width: 1024, height: 768, touch: false },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "430x932", width: 430, height: 932, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "360x800", width: 360, height: 800, touch: true },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];

// Roles and the seeded people that stand for them (tests/e2e/global-setup.ts).
export const ROLES = {
  public: { login: null, label: "Public (signed out)" },
  user: { login: "E2E_REQ", label: "USER (requester, Ravi)" },
  approver: { login: "E2E_MGR", label: "USER (manager / approver, Manoj)" },
  staff: { login: "E2E_STAFF", label: "USER (no records, Sita)" },
  admin: { login: "E2E_ADMIN", label: "IT_ADMIN (Elena)" },
  super: { login: "E2E_SUPER", label: "SUPER_ADMIN (Sam)" },
} as const;
export type RoleKey = keyof typeof ROLES;

export type Ids = Record<string, string>;
export function loadIds(): Ids {
  try {
    return JSON.parse(fs.readFileSync(IDS_FILE, "utf8")) as Ids;
  } catch {
    return {};
  }
}

export function moduleOf(p: string): string {
  const pathOnly = p.split("?")[0]!;
  if (!pathOnly.startsWith("/users") && !pathOnly.startsWith("/admin") && !pathOnly.startsWith("/superadmin")) return "Public";
  if (pathOnly.startsWith("/superadmin")) return "Super Admin";
  if (pathOnly.startsWith("/admin")) return "Admin";
  if (pathOnly === "/users") return p.includes("home=tasks") ? "Home (tasks overview)" : p.includes("home=meetings") ? "Home (meetings overview)" : "Home";
  const rules: [RegExp, string][] = [
    [/^\/users\/(approvals|approved|approved-by-me|custom|new|queue|requests|inbox|delegation)/, "Approvals"],
    [/^\/users\/work\/projects\/[^/]+\/forms|^\/users\/forms/, "Forms"],
    [/^\/users\/work\/(projects|portfolios|templates)/, "Projects/PM"],
    [/^\/users\/(tasks|work|collaborating)/, "Tasks/Work"],
    [/^\/users\/information/, "Information"],
    [/^\/users\/ai/, "AI"],
    [/^\/users\/meetings/, "Meetings"],
    [/^\/users\/tickets/, "Tickets"],
    [/^\/users\/calendar/, "Calendar"],
    [/^\/users\/(analytics|reports)/, "Analytics"],
  ];
  for (const [pattern, name] of rules) if (pattern.test(pathOnly)) return name;
  return "User (profile / general)";
}

export type Route = { role: RoleKey; path: string; pattern: string };
const r = (role: RoleKey, pattern: string, ids: Ids): Route | null => {
  const missing = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((key) => !ids[key]);
  if (missing.length) return null;
  return { role, pattern, path: pattern.replace(/\{(\w+)\}/g, (_, key: string) => ids[key]!) };
};

// Every page of the app tree (161 page.tsx, docs/qa/QA_APPLICATION_INVENTORY.md),
// each opened as the role it is for. Patterns with {id} need the set-up's records.
export function routesFor(role: RoleKey, ids: Ids): Route[] {
  const list: Record<RoleKey, string[]> = {
    public: ["/", "/login", "/forgot-password", "/privacy", "/terms", "/security/not-me", "/set-password", "/signed-out"],
    user: [
      "/users", "/users?home=tasks", "/users?home=meetings",
      "/users/approvals", "/users/approved", "/users/approved-by-me", "/users/custom", "/users/new", "/users/queue", "/users/queue/sent-back",
      "/users/requests", "/users/requests/{request}", "/users/inbox", "/users/delegation",
      "/users/tasks", "/users/tasks/{task}", "/users/tasks/assigned", "/users/tasks/new", "/users/tasks/team", "/users/collaborating",
      "/users/work", "/users/work/my-tasks", "/users/work/my-tasks?task={task}", "/users/work/inbox", "/users/work/periodic", "/users/work/deleted", "/users/work/search?q=uiqa",
      "/users/work/projects", "/users/work/projects/new", "/users/work/projects/{project}", "/users/work/projects/{project}?view=board", "/users/work/projects/{project}/settings",
      "/users/work/projects/{project}/forms/{form}", "/users/work/projects/{project}/automations/{automation}", "/users/forms/{formToken}",
      "/users/work/portfolios", "/users/work/portfolios/new", "/users/work/portfolios/{portfolio}", "/users/work/templates",
      "/users/information", "/users/information/new", "/users/information/sent", "/users/information/{info}",
      "/users/ai", "/users/ai/assistant", "/users/ai/data-sources", "/users/ai/history", "/users/ai/insights", "/users/ai/intelligence", "/users/ai/reports",
      "/users/meetings", "/users/meetings/new", "/users/meetings/dashboard", "/users/meetings/follow-ups", "/users/meetings/{meeting}",
      "/users/tickets", "/users/tickets/new", "/users/tickets/{ticket}",
      "/users/calendar", "/users/calendar/items/{calendarItem}",
      "/users/analytics", "/users/analytics/list", "/users/analytics/metrics",
      "/users/profile", "/users/profile/calendar", "/users/profile/devices", "/users/security", "/users/notifications", "/users/notifications/settings",
      "/users/help", "/users/more", "/users/search?q=uiqa", "/users/people/{req}", "/users/no-access", "/users/switched-off",
    ],
    approver: ["/users", "/users/queue", "/users/requests/{request}", "/users/approved-by-me", "/users/tickets/board", "/users/tickets/dashboards", "/users/tickets/dashboards/{ticketDashboard}", "/users/tickets/{ticket}", "/users/information/sent", "/users/meetings/dashboard"],
    staff: ["/users", "/users/requests", "/users/tasks", "/users/tickets", "/users/information", "/users/meetings", "/users/work/projects", "/users/notifications", "/users/work/my-tasks"],
    admin: [
      "/admin", "/admin/calendar", "/admin/organisation", "/admin/no-access",
      "/admin/insights", "/admin/insights/ai", "/admin/insights/analytics", "/admin/insights/analytics/list", "/admin/insights/analytics/metrics",
      "/admin/insights/dashboards", "/admin/insights/dashboards/approvers", "/admin/insights/dashboards/departments", "/admin/insights/dashboards/raisers", "/admin/insights/dashboards/utilisation",
      "/admin/insights/reports", "{reportPath}", "/admin/insights/workload", "/admin/insights/workload/reassign",
      "/admin/records", "/admin/records/requests", "/admin/records/tasks", "/admin/records/information", "/admin/records/tickets", "/admin/records/meetings",
      "/admin/setup", "/admin/setup/ai-rules", "/admin/setup/budgets", "/admin/setup/custom-approval", "/admin/setup/doa", "/admin/setup/groups",
      "/admin/setup/information-types", "/admin/setup/information-types/{infoType}", "/admin/setup/meetings", "/admin/setup/notifications",
      "/admin/setup/reminders", "/admin/setup/reminders/new", "/admin/setup/task-settings", "/admin/setup/task-types", "/admin/setup/task-types/{taskType}",
      "/admin/setup/ticket-categories", "/admin/setup/ticket-forms", "/admin/setup/ticket-forms/{ticketForm}",
      "/admin/users", "/admin/users/new", "/admin/users/{req}",
      "/users",
    ],
    super: [
      "/superadmin",
      "/superadmin/connections/ai", "/superadmin/connections/ai/data-sources", "/superadmin/connections/email", "/superadmin/connections/google", "/superadmin/connections/push", "/superadmin/connections/salesforce",
      "/superadmin/connections/whatsapp", "/superadmin/connections/whatsapp/templates", "{templatePath}",
      "/superadmin/data/backup", "/superadmin/data/danger-zone", "/superadmin/data/danger-zone/demo", "/superadmin/data/danger-zone/requests", "/superadmin/data/import", "/superadmin/data/retention",
      "/superadmin/monitoring/ai-history", "/superadmin/monitoring/ai-reports", "/superadmin/monitoring/audit", "/superadmin/monitoring/deliveries", "/superadmin/monitoring/jobs",
      "/superadmin/security/features", "/superadmin/security/general", "/superadmin/security/pages", "{pageRulePath}", "/superadmin/security/sign-in", "/superadmin/security/sign-in-history",
      "/admin", "/users",
    ],
  };
  return list[role].map((pattern) => r(role, pattern, ids)).filter((route): route is Route => route !== null);
}

export async function sql<T = ResultSetHeader>(query: string, values: unknown[] = []): Promise<T> {
  const conn = await db();
  try {
    const [rows] = await conn.query(query, values);
    return rows as T;
  } finally {
    await conn.end();
  }
}

export async function signIn(context: BrowserContext, role: RoleKey, viewport: Viewport, extra: { name: string; value: string }[] = []) {
  await context.clearCookies();
  const login = ROLES[role].login;
  const cookies: { name: string; value: string; domain: string; path: string }[] = [{ name: "ars_theme", value: "light", domain: "localhost", path: "/" }];
  if (login) cookies.push(await sessionCookie(login, { tourDone: true }));
  cookies.push(viewport.width < 768 ? phoneLayoutCookie() : { name: "ars_layout", value: "desktop", domain: "localhost", path: "/" });
  for (const cookie of extra) cookies.push({ ...cookie, domain: "localhost", path: "/" });
  await context.addCookies(cookies);
}

// WebKit only: the app's production headers (HSTS and CSP upgrade-insecure-requests,
// lib/security/csp.ts:45) make WebKit ask for every /_next asset over https://localhost,
// which has no TLS here ("SSL connect error": no CSS, no JS). Chromium never upgrades
// localhost. Production runs on https, so this only puts the test server's http answers
// back under the https addresses WebKit asks for.
export async function webkitHttpsShim(context: BrowserContext, project: string) {
  if (project !== "webkit") return;
  await context.route(/^https:\/\/localhost:\d+\//, async (route) => {
    try {
      const response = await route.fetch({ url: route.request().url().replace(/^https:/, "http:") });
      await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
    } catch {
      // The context closed while a request was in flight (end of a probe): nothing to answer.
      await route.abort().catch(() => undefined);
    }
  });
}

export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

// Grants every module (Tickets and AI included) to the seeded people, so each
// module's pages render for the audit. Kept for the whole audit (throw-away DB).
export async function grantModules() {
  await sql("UPDATE users SET module_access = 'APPROVAL,TASK,PROJECT,INFORMATION,MEETING,TICKET,AI' WHERE login_id LIKE 'E2E%'");
  await sql("DELETE FROM user_settings WHERE setting_key IN ('ui.theme', 'ui.workspace_view')");
}

// One of each record the detail screens need (the pattern of v1730-crawl's set-up),
// plus long-text and bulk rows for the edge-case probes. Ids go to audit/ui-qa/ids.json.
export async function setUpRecords(page: Page, context: BrowserContext): Promise<Ids> {
  const stamp = `uiqa${Date.now().toString(36)}`;
  const ids: Ids = {};
  await grantModules();
  const vp = VIEWPORTS[1];
  await signIn(context, "user", vp);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const projectUrl = await createProject(page, `UIQA project ${stamp}`);
  ids.project = projectUrl.split("/").pop()!;
  const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
  await add.fill(`UIQA task ${stamp}`);
  await add.press("Enter");
  await expect(page.getByTestId("task-row").filter({ hasText: `UIQA task ${stamp}` })).toBeVisible();
  const [task] = await sql<RowDataPacket[]>("SELECT id FROM tasks WHERE title = ?", [`UIQA task ${stamp}`]);
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
  if (form?.share_token) ids.formToken = String(form.share_token);

  await page.goto("/users/work/portfolios/new");
  await page.getByTestId("portfolio-name").fill(`UIQA portfolio ${stamp}`);
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-search").fill(stamp);
  await page.getByRole("checkbox", { name: `UIQA project ${stamp}` }).check();
  await page.getByTestId("wizard-continue").click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios\/\d+\?created=1/);
  ids.portfolio = new URL(page.url()).pathname.split("/").pop()!;

  await dropCustomDraft("E2E_REQ");
  await page.goto("/users/custom");
  await page.locator("#c-title").fill(`UIQA request ${stamp}`);
  await toWorkflowStep(page);
  const level = page.getByTestId("workflow-level").filter({ visible: true }).last();
  await level.getByLabel("Who approves").selectOption("PEOPLE");
  await level.getByRole("combobox", { name: /People \(search and pick/ }).fill("Manoj");
  await page.getByRole("option", { name: /Manoj Manager/ }).first().click();
  await page.getByTestId("step-next").click();
  await page.getByTestId("action-bar").getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/users\/requests\/\d+\?submitted=1/);
  ids.request = new URL(page.url()).pathname.split("/").pop()!;
  ids.requestTitle = `UIQA request ${stamp}`;

  const req = await userIdByLogin("E2E_REQ");
  const mgr = await userIdByLogin("E2E_MGR");
  const ticketType = await sql("INSERT INTO module_types (module, code, name, description, active) VALUES ('TICKET', ?, ?, '', TRUE)", [stamp.toUpperCase(), `UIQA form ${stamp}`]);
  ids.ticketForm = String(ticketType.insertId);
  const version = await sql("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, published_at) VALUES (?, 1, 'PUBLISHED', JSON_ARRAY(), JSON_OBJECT(), UTC_TIMESTAMP())", [ticketType.insertId]);
  const [category] = await sql<RowDataPacket[]>("SELECT id FROM ticket_categories ORDER BY id LIMIT 1");
  const ticket = await sql("INSERT INTO tickets (ticket_no, category_id, type_version_id, title, form_data_json, requester_id, submission_key) VALUES (?, ?, ?, ?, JSON_OBJECT(), ?, ?)", [`UIQA-${stamp}`.slice(0, 30), category!.id, version.insertId, `UIQA ticket ${stamp}`, req, `uiqa-${stamp}`]);
  ids.ticket = String(ticket.insertId);
  await sql("INSERT IGNORE INTO ticket_request_types (type_id, category_id) VALUES (?, ?)", [ticketType.insertId, category!.id]);
  await sql("INSERT IGNORE INTO ticket_coordinators (type_id, user_id) VALUES (?, ?)", [ticketType.insertId, mgr]);
  const [meetingType] = await sql<RowDataPacket[]>("SELECT id FROM meeting_types ORDER BY id LIMIT 1");
  const meeting = await sql(
    "INSERT INTO meetings (meeting_no, title, description, type_id, owner_id, coordinator_id, mode, venue, link, priority, confidentiality, guests, scheduled_start, scheduled_end, points_policy, created_by, created_at) VALUES (?, ?, '', ?, ?, ?, 'OFFLINE', 'Board room', NULL, 'IMPORTANT', 'GENERAL', '', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 25 HOUR), 'BLOCK', ?, UTC_TIMESTAMP())",
    [`MTG-${stamp}`.slice(0, 30), `UIQA meeting ${stamp}`, meetingType!.id, req, req, req],
  );
  ids.meeting = String(meeting.insertId);
  const item = await sql("INSERT INTO calendar_items (user_id, title, notes, all_day, starts_at, ends_at, origin) VALUES (?, ?, 'UIQA', FALSE, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR), 'ARS')", [req, `UIQA entry ${stamp}`]);
  ids.calendarItem = String(item.insertId);
  const settings = { access: { mode: "EVERYONE", departmentIds: [], userIds: [] }, allowPeople: true, allowDepartments: true, allowGroups: true, allowEveryone: false, ack: "ALWAYS", ackReminderDays: null, defaultPriority: "NORMAL", expiryDays: null, editableAfterPublish: false };
  const infoType = await sql("INSERT INTO module_types (module, code, name, created_by) VALUES ('INFO', ?, ?, ?)", [`NOTICE_${stamp}`.toUpperCase(), `UIQA notice ${stamp}`, mgr]);
  await sql("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, created_by, published_by, published_at) VALUES (?, 1, 'PUBLISHED', '[]', ?, ?, ?, CURRENT_TIMESTAMP)", [infoType.insertId, JSON.stringify(settings), mgr, mgr]);
  ids.infoType = String(infoType.insertId);
  const [taskType] = await sql<RowDataPacket[]>("SELECT id FROM module_types WHERE module = 'TASK' ORDER BY id LIMIT 1");
  ids.taskType = String(taskType!.id);
  const [versionRow] = await sql<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
  // Edge cases: a task with a 190-character unbroken title, one with markup and
  // emoji, and 60 more tasks so lists page and scroll (rows for Ravi from Manoj).
  const longTitle = `UIQA-LONG-${"Wwwwwwwwww".repeat(18)}`; // 190 characters (tasks.title is VARCHAR(200))
  const long = await sql("INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), JSON_OBJECT())", [`QL${stamp}`.slice(0, 30), Number(versionRow!.id), longTitle, mgr, req, mgr]);
  ids.longTask = String(long.insertId);
  const markup = await sql("INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY), JSON_OBJECT())", [`QM${stamp}`.slice(0, 30), Number(versionRow!.id), `UIQA <b>bold</b> & "quotes" 😀 ₹1,00,000 ${stamp}`, mgr, req, mgr]);
  ids.markupTask = String(markup.insertId);
  for (let i = 0; i < 60; i++)
    await sql("INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), JSON_OBJECT())", [`QB${i}${stamp}`.slice(0, 30), Number(versionRow!.id), `UIQA bulk ${String(i).padStart(2, "0")} ${stamp}`, mgr, req, mgr, (i % 9) - 2]);
  ids.req = String(req);
  ids.stamp = stamp;

  await signIn(context, "approver", vp);
  await page.goto(`/users/information/new?type=${ids.infoType}`);
  await page.getByLabel("Subject").fill(`UIQA notice ${stamp}`);
  await page.getByLabel("Message").fill("UIQA message.");
  await page.getByRole("combobox", { name: /People/ }).fill("Ravi");
  await page.getByRole("option", { name: /Ravi Requester/ }).first().click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published to 1 person/)).toBeVisible();
  ids.info = new URL(page.url()).pathname.split("/").pop()!;

  await signIn(context, "super", vp);
  const firstLink = async (list: string, pattern: RegExp) => {
    await page.goto(list);
    const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    return hrefs.find((href) => pattern.test(href.split("?")[0]!)) ?? null;
  };
  const template = await firstLink("/superadmin/connections/whatsapp/templates", /^\/superadmin\/connections\/whatsapp\/templates\/[^/]+$/);
  if (template) ids.templatePath = template;
  const pageRule = await firstLink("/superadmin/security/pages", /^\/superadmin\/security\/pages\/[^/]+$/);
  if (pageRule) ids.pageRulePath = pageRule;
  const report = await firstLink("/admin/insights/reports", /^\/admin\/insights\/reports\/[a-z_]+$/);
  if (report) ids.reportPath = report;
  await signIn(context, "approver", vp);
  const dashboard = await firstLink("/users/tickets/dashboards", /^\/users\/tickets\/dashboards\/\d+$/);
  if (dashboard) ids.ticketDashboard = dashboard.split("/").pop()!;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
  return ids;
}
