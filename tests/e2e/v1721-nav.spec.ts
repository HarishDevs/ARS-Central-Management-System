import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { db, phoneLayoutCookie, sessionCookie, userIdByLogin } from "./db";
import { createProject } from "./work-helpers";

// v1.72.1 (D-395): the QA review of state screens and navigation. Clear
// filters with a default view, phone navigation to Tickets and Portfolios,
// the "switched off" screen, back links, Ctrl+K tickets and meetings, and
// to-and-fro walks on the main flows (no dead ends).
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function phone(context: BrowserContext, page: Page, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId), phoneLayoutCookie()]);
  await page.setViewportSize({ width: 390, height: 844 });
}
async function sql(text: string, params: unknown[] = []) {
  const conn = await db();
  try {
    const [rows] = await conn.query(text, params);
    return rows as RowDataPacket[] & { insertId?: number };
  } finally {
    await conn.end();
  }
}
async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
async function palette(page: Page) {
  const box = page.getByRole("combobox", { name: /Type a page/ });
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(box).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return box;
}

test("Clear filters reaches the unfiltered list even with a default view saved (F-01)", async ({ page, context }) => {
  const userId = await userIdByLogin("E2E_REQ");
  const name = `Default ${stamp}`;
  await sql("INSERT INTO analytics_views (user_id, target, name, query_json, shared, is_default) VALUES (?, 'my_requests', ?, ?, FALSE, TRUE)", [userId, name, JSON.stringify({ q: `nomatch-${stamp}` })]);
  try {
    await as(context, "E2E_REQ");
    // Opening the list plainly applies the default view…
    await page.goto("/users/requests");
    await expect(page).toHaveURL(new RegExp(`q=nomatch-${stamp}`));
    await expect(page.getByTestId("no-results")).toBeVisible();
    // …and Reset filters (or Clear) shows everything, not the default view again.
    await page.getByTestId("no-results").getByRole("link", { name: "Reset filters" }).click();
    await expect(page).toHaveURL(/\/users\/requests$/);
    await expect(page.getByTestId("no-results")).toHaveCount(0);
    // Coming back from another page applies the default view again.
    await page.goto("/users/approved");
    await page.goto("/users/requests");
    await expect(page).toHaveURL(new RegExp(`q=nomatch-${stamp}`));
  } finally {
    await sql("DELETE FROM analytics_views WHERE user_id = ? AND name = ?", [userId, name]);
  }
});

test("phones reach Tickets and Portfolios from More, and back (F-02)", async ({ page, context }) => {
  // E2E_SUPER has every module (Super Admin); portfolios are switched on in the e2e seed.
  await phone(context, page, "E2E_SUPER");
  await page.goto("/users/more");
  const work = page.getByRole("region", { name: "Work" });
  await expect(work.getByRole("link", { name: /^Tickets/ })).toBeVisible();
  await expect(work.getByRole("link", { name: /^Portfolios/ })).toBeVisible();
  await work.getByRole("link", { name: /^Portfolios/ }).click();
  await expect(page).toHaveURL(/\/users\/work\/portfolios$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/users\/more$/);
  await page.getByRole("region", { name: "Work" }).getByRole("link", { name: /^Tickets/ }).click();
  await expect(page).toHaveURL(/\/users\/tickets$/);
  // On a ticket page the More tab stays lit.
  await expect(page.getByTestId("mobile-tabbar").getByRole("link", { name: /^More/ })).toHaveAttribute("aria-current", "page");
  expect(await axe(page)).toEqual([]);
  // Someone without the Ticketing module doesn't get the entry.
  await phone(context, page, "E2E_STAFF");
  await page.goto("/users/more");
  await expect(page.getByRole("link", { name: /^Tickets/ })).toHaveCount(0);
});

test("a switched-off feature shows a clear screen, not page not found (F-04)", async ({ page, context }) => {
  await sql("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.information', 'FEATURES', 'STRING', FALSE, 'OFF') ON DUPLICATE KEY UPDATE value = 'OFF'");
  try {
    await as(context, "E2E_REQ");
    await page.goto("/users/information");
    await expect(page).toHaveURL(/\/users\/switched-off\?feature=information/);
    await expect(page.getByTestId("switched-off")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Information is switched off" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole("link", { name: "Go to Home" }).click();
    await expect(page).toHaveURL(/\/users$/);
  } finally {
    await sql("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.information', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
  }
});

test("old task links, /users/approvals?tab= and the Project templates tab land in the right place (F-03, F-05, F-11)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/approvals?tab=mine");
  await expect(page).toHaveURL(/\/users\/requests/);
  await page.goto("/users/approvals?tab=approved");
  await expect(page).toHaveURL(/\/users\/approved/);
  const [task] = await sql("SELECT t.id FROM tasks t WHERE t.deleted_at IS NULL AND (t.assignee_id = ? OR t.created_by = ?) ORDER BY t.id DESC LIMIT 1", [await userIdByLogin("E2E_REQ"), await userIdByLogin("E2E_REQ")]);
  if (task) {
    await page.goto(`/users/work?task=${task.id}`);
    await expect(page).toHaveURL(new RegExp(`/users/tasks/${task.id}$`));
  }
  await page.goto("/users/work/projects?show=templates");
  await expect(page).toHaveURL(/\/users\/work\/templates$/);
});

test("project and person pages have a way back; sidebar → page → detail → back walks (F-06, F-13)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectUrl = await createProject(page, `Nav project ${stamp}`);
  await page.goto(projectUrl);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText(`Nav project ${stamp}`);
  await crumbs.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/users\/work\/projects$/);
  // List → detail → browser back → list.
  await page.getByRole("link", { name: `Nav project ${stamp}` }).click();
  await expect(page).toHaveURL(/\/users\/work\/projects\/\d+/);
  await page.goBack();
  await expect(page).toHaveURL(/\/users\/work\/projects$/);
  // A person's card: Back returns to where they came from.
  const managerId = await userIdByLogin("E2E_MGR");
  await page.goto("/users/profile");
  await page.goto(`/users/people/${managerId}`);
  await expect(page.getByTestId("person-card")).toBeVisible();
  await page.getByTestId("back-link").click();
  await expect(page).toHaveURL(/\/users\/profile$/);
  // Opened directly (no history), Back goes Home.
  const fresh = await context.newPage();
  await fresh.goto(`/users/people/${managerId}`);
  await fresh.getByTestId("back-link").click();
  await expect(fresh).toHaveURL(/\/users$/);
  await fresh.close();
});

test("Ctrl+K finds tickets and meetings the person can see (F-08)", async ({ page, context }) => {
  const superId = await userIdByLogin("E2E_SUPER");
  const managerId = await userIdByLogin("E2E_MGR");
  // A ticket raised by the Super Admin, and a meeting Manoj owns (straight into the tables).
  const typeResult = (await sql("INSERT INTO module_types (module, code, name, description, active) VALUES ('TICKET', ?, ?, '', TRUE)", [`NAV_${stamp.toUpperCase()}`, `Nav form ${stamp}`])) as unknown as { insertId: number };
  const versionResult = (await sql("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, published_at) VALUES (?, 1, 'PUBLISHED', JSON_ARRAY(), JSON_OBJECT(), UTC_TIMESTAMP())", [typeResult.insertId])) as unknown as { insertId: number };
  const [category] = await sql("SELECT id FROM ticket_categories ORDER BY id LIMIT 1");
  await sql("INSERT INTO tickets (ticket_no, category_id, type_version_id, title, form_data_json, requester_id, submission_key) VALUES (?, ?, ?, ?, JSON_OBJECT(), ?, ?)", [`NAV-${stamp}`, category!.id, versionResult.insertId, `Scanner jam ${stamp}`, superId, `nav-${stamp}`]);
  const [meetingType] = await sql("SELECT id FROM meeting_types ORDER BY id LIMIT 1");
  const meeting = (await sql(
    "INSERT INTO meetings (meeting_no, title, description, type_id, owner_id, coordinator_id, mode, venue, link, priority, confidentiality, guests, scheduled_start, scheduled_end, points_policy, created_by, created_at) VALUES (?, ?, '', ?, ?, ?, 'OFFLINE', 'Board room', NULL, 'IMPORTANT', 'GENERAL', '', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 25 HOUR), 'BLOCK', ?, UTC_TIMESTAMP())",
    [`MTG-NAV-${stamp}`, `Despatch review ${stamp}`, meetingType!.id, managerId, managerId, managerId],
  )) as unknown as { insertId: number };

  await as(context, "E2E_SUPER");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  let box = await palette(page);
  await box.fill(`Scanner jam ${stamp}`);
  await expect(page.getByRole("option", { name: new RegExp(`NAV-${stamp}`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/users\/tickets\/\d+$/);

  await as(context, "E2E_MGR");
  await page.goto("/users");
  box = await palette(page);
  await box.fill(`Despatch review ${stamp}`);
  await expect(page.getByRole("option", { name: new RegExp(`MTG-NAV-${stamp}`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/users/meetings/${meeting.insertId}$`));

  // Someone not on the meeting (and without the Ticketing module) finds neither.
  await as(context, "E2E_STAFF");
  await page.goto("/users");
  box = await palette(page);
  const answered = page.waitForResponse((response) => response.url().includes("/api/me/quick") && response.url().includes(stamp));
  await box.fill(stamp);
  await answered;
  await expect(page.getByRole("option", { name: new RegExp(`MTG-NAV-${stamp}|NAV-${stamp}`) })).toHaveCount(0);
});
