import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.86.0 (header and motion audit, docs/qa/HEADER-AND-MOTION-AUDIT.md):
// regression for H-01..H-04 and the P1 pane fixes. The audit's probe spec
// (zz-audit-header) recorded facts; this one asserts them.
//   H-01: + Add widgets and Customise stay after every overview switch.
//   H-02: Customise (edit mode) ends with the overview it was started on.
//   H-03: the period picker follows the address after a switch.
//   H-04: Admin → Insights tabs are all in view at tablet width; a fade shows more at phone width.
//   Gap 14: Escape with an unsent comment asks "Discard draft?".
//   Gap 16: opening the task pane doesn't move the page.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true })]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
}

// A soft move through the overview switcher (its own link), as a person makes it.
async function switchTo(page: Page, home: "approvals" | "tasks" | "meetings") {
  await page.locator(`main a[href="/users?home=${home}"]`).first().click();
  await page.waitForURL((url) => url.searchParams.get("home") === home);
  await settle(page);
}

const homeTitle = { approvals: /Approvals – Overview/, tasks: /My Work – Overview/, meetings: /Meetings – Overview/ } as const;

async function expectToolbar(page: Page, where: string) {
  const quick = page.locator('main nav[aria-label="Quick actions"]');
  await expect(quick.getByTestId("customise-home"), `Customise after ${where}`).toBeVisible();
  await expect(quick.getByTestId("add-widget"), `Add widgets after ${where}`).toBeVisible();
  // Exactly one toolbar, inside the slot that is on screen.
  expect(await page.getByTestId("customise-home").count(), `one Customise after ${where}`).toBe(1);
}

let staffTask = 0;
test.beforeAll(async () => {
  const conn = await db();
  try {
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const from = await userIdByLogin("E2E_REQ");
    const me = await userIdByLogin("E2E_STAFF");
    // Enough tasks that My Tasks scrolls well past one screen.
    for (let i = 0; i < 30; i++) {
      const [made] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), JSON_OBJECT())",
        [`HC${i}${stamp}`.slice(0, 30), Number(version!.id), `Header check ${stamp} ${String(i).padStart(2, "0")}`, from, me, from, i % 6],
      );
      if (i === 29) staffTask = made.insertId;
    }
  } finally {
    await conn.end();
  }
});

for (const [login, width, height] of [
  ["E2E_MGR", 1440, 900],
  ["E2E_ADMIN", 1024, 768],
  ["E2E_SUPER", 768, 1024],
] as const) {
  test(`H-01: Add widgets and Customise stay over every ordered overview switch (${login}, ${width})`, async ({ page, context }) => {
    test.setTimeout(4 * 60_000);
    await as(context, login);
    await page.setViewportSize({ width, height });
    await page.goto("/users?home=tasks");
    await settle(page);
    await expectToolbar(page, "a fresh load");
    // tasks → meetings → tasks → approvals → meetings → approvals → tasks: every ordered pair once.
    for (const home of ["meetings", "tasks", "approvals", "meetings", "approvals", "tasks"] as const) {
      await switchTo(page, home);
      await expect(page.locator("main h1").first()).toHaveText(homeTitle[home]);
      await expectToolbar(page, `the switch to ${home}`);
    }
  });
}

test("H-02: Customise ends with its overview (no edit mode without Done on the next one)", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users?home=tasks");
  await settle(page);
  await page.getByTestId("customise-home").click();
  await expect(page.getByTestId("customise-home")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("widget-controls").first()).toBeVisible();
  await switchTo(page, "meetings");
  await expect(page.getByTestId("customise-home")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("customise-home")).toHaveText(/Customise/);
  await expect(page.getByTestId("widget-controls")).toHaveCount(0);
  await expect(page.getByTestId("reset-home")).toHaveCount(0);
});

test("H-03: the period picker follows the address after an overview switch", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users?home=approvals&period=custom&from=2026-11-01&to=2026-11-10");
  await settle(page);
  const picker = page.getByTestId("period-picker");
  await expect(picker.locator("select")).toHaveValue("custom");
  // v1.89.0 (D-425): the custom dates are one From – To picker (hidden inputs carry from / to).
  await expect(picker.getByTestId("home-period-dates-button")).toBeVisible();
  await expect(picker.locator('input[type="hidden"][name="from"]')).toHaveValue("2026-11-01");
  for (const home of ["tasks", "meetings"] as const) {
    await switchTo(page, home);
    await expect(picker.locator("select")).not.toHaveValue("custom");
    await expect(picker.locator('input[name="from"]')).toHaveCount(0);
  }
  // Choosing Custom period still opens the From / To form on the overview.
  await picker.locator("select").selectOption("custom");
  await expect(picker.getByTestId("home-period-dates-button")).toBeVisible();
});

test("H-04: Admin → Insights tabs are all in view at 768; at 375 a fade shows there are more", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/admin/insights");
  await settle(page);
  const inView = await page.getByTestId("hub-tabs").locator("a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().right <= window.innerWidth + 1));
  expect(inView.length).toBeGreaterThan(3);
  expect(inView.every(Boolean), "every tab inside the viewport at 768").toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await settle(page);
  const frame = page.getByTestId("hub-tabs-frame");
  await expect(frame).toHaveAttribute("data-clip-end", "");
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowX, "no page overflow at 375").toBeLessThanOrEqual(1);
});

test("gap 16: opening the task pane keeps the list where it was; gap 14: Escape with an unsent comment asks first", async ({ page, context }) => {
  test.setTimeout(3 * 60_000);
  await as(context, "E2E_STAFF");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await settle(page);
  const link = page.locator(`main a[href="/users/tasks/${staffTask}"]`).first();
  await link.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  expect(before, "the list scrolled").toBeGreaterThan(300);
  await link.click();
  await page.waitForURL(/[?&]task=\d+/);
  await expect(page.getByTestId("task-pane")).toBeVisible();
  await settle(page);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => Math.round(window.scrollY));
  expect(Math.abs(after - before), `scroll ${before} → ${after}`).toBeLessThanOrEqual(40);

  // An unsent comment: Escape asks; Keep editing keeps the pane and the text.
  const pane = page.getByTestId("task-pane");
  await pane.getByRole("textbox", { name: /Add a comment/ }).first().click();
  await page.keyboard.type("Unsent draft text");
  await page.locator("main h1").first().click({ force: true });
  await page.keyboard.press("Escape");
  const ask = page.getByTestId("discard-draft");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(/[?&]task=\d+/);
  await expect(pane.getByRole("textbox", { name: /Add a comment/ }).first()).toContainText("Unsent draft text");
  // × asks too; Discard closes the pane.
  await pane.getByTestId("close-pane").click().catch(async () => {
    await page.locator("main h1").first().click({ force: true });
    await page.keyboard.press("Escape");
  });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Discard" }).click();
  await page.waitForURL((url) => !url.searchParams.has("task"));
  await expect(page.getByTestId("task-pane")).toHaveCount(0);
});
