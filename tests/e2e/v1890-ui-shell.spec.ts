import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, phoneLayoutCookie, raisePurchase, sessionCookie, userIdByLogin } from "./db";

// v1.89.0 stage 3a (UI unification, batches 0 and 1; D-421):
//   UIQA-LAY-01 (P1): a long unbroken title never scrolls the page sideways,
//     on every record type whose page title is the record's name.
//   UIQA-A11Y-01: the task page reflows at 320 CSS px (1280 at 400 %).
//   D-421: the shell measures the owner's reference tokens in every area:
//     header 64 (56 on phones), sidebar 250 / rail 72, padding and top 24
//     (16 on phones), content left-aligned beside the sidebar (max 1600),
//     page title 24, button 40, field 42; tablets start on the rail unless the
//     person chose otherwise.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const LONG = `UISHELL-LONG-${"Wwwwwwwwww".repeat(15)}`; // 163 characters, no break opportunity
const ids: Record<string, number | string> = {};

async function as(context: BrowserContext, loginId: string, extra: { name: string; value: string }[] = []) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), ...extra.map((cookie) => ({ ...cookie, domain: "localhost", path: "/" }))]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
}

// The shell, measured as the UI QA sweep does.
async function shell(page: Page) {
  return page.evaluate(() => {
    const header = [...document.querySelectorAll("header")].find((el) => !el.closest("main") && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top <= 1);
    const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar"]');
    const main = document.querySelector("main")!;
    const style = getComputedStyle(main);
    const box = main.getBoundingClientRect();
    const h1 = document.querySelector("main [data-tour='page-header'] h1");
    return {
      headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
      headerPadL: header ? parseFloat(getComputedStyle(header).paddingLeft) : null,
      sidebarW: sidebar && sidebar.getBoundingClientRect().width > 0 ? Math.round(sidebar.getBoundingClientRect().width) : null,
      collapsed: sidebar?.dataset.collapsed === "true",
      padL: parseFloat(style.paddingLeft),
      padT: parseFloat(style.paddingTop),
      contentLeft: Math.round(box.left + parseFloat(style.paddingLeft)),
      mainW: Math.round(box.width),
      h1Size: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.beforeAll(async () => {
  const conn = await db();
  try {
    const req = await userIdByLogin("E2E_REQ");
    const mgr = await userIdByLogin("E2E_MGR");
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const [task] = await conn.query<ResultSetHeader>(
      "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), JSON_OBJECT())",
      [`UL${stamp}`.slice(0, 30), Number(version!.id), LONG, mgr, req, mgr],
    );
    ids.task = task.insertId;
    const [[meetingType]] = await conn.query<RowDataPacket[]>("SELECT id FROM meeting_types ORDER BY id LIMIT 1");
    const [meeting] = await conn.query<ResultSetHeader>(
      "INSERT INTO meetings (meeting_no, title, description, type_id, owner_id, coordinator_id, mode, venue, link, priority, confidentiality, guests, scheduled_start, scheduled_end, points_policy, created_by, created_at) VALUES (?, ?, '', ?, ?, ?, 'OFFLINE', 'Board room', NULL, 'IMPORTANT', 'GENERAL', '', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 25 HOUR), 'BLOCK', ?, UTC_TIMESTAMP())",
      [`UM-${stamp}`.slice(0, 30), LONG, meetingType!.id, req, req, req],
    );
    ids.meeting = meeting.insertId;
    const [type] = await conn.query<ResultSetHeader>("INSERT INTO module_types (module, code, name, description, active) VALUES ('TICKET', ?, ?, '', TRUE)", [`UT${stamp}`.toUpperCase(), `UI shell form ${stamp}`]);
    const [ticketVersion] = await conn.query<ResultSetHeader>("INSERT INTO module_type_versions (type_id, version_no, status, form_json, settings_json, published_at) VALUES (?, 1, 'PUBLISHED', JSON_ARRAY(), JSON_OBJECT(), UTC_TIMESTAMP())", [type.insertId]);
    const [[category]] = await conn.query<RowDataPacket[]>("SELECT id FROM ticket_categories ORDER BY id LIMIT 1");
    const [ticket] = await conn.query<ResultSetHeader>(
      "INSERT INTO tickets (ticket_no, category_id, type_version_id, title, form_data_json, requester_id, submission_key) VALUES (?, ?, ?, ?, JSON_OBJECT(), ?, ?)",
      [`UT-${stamp}`.slice(0, 30), category!.id, ticketVersion.insertId, LONG, req, `uishell-${stamp}`],
    );
    ids.ticket = ticket.insertId;
  } finally {
    await conn.end();
  }
});

test("LAY-01: a long unbroken title wraps inside the page on every record type (1440, 1280, 1024)", async ({ page, context }) => {
  test.setTimeout(5 * 60_000);
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  ids.request = await raisePurchase(page, LONG);
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [`/users/tasks/${ids.task}`, `/users/meetings/${ids.meeting}`, `/users/tickets/${ids.ticket}`, String(ids.request).replace(/\?.*$/, "")]) {
      await page.goto(path);
      await settle(page);
      const facts = await page.evaluate(() => {
        const h1 = document.querySelector("main h1");
        const box = h1?.getBoundingClientRect();
        return { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, h1Right: box ? Math.round(box.right) : null, h1Text: h1?.textContent ?? "", vw: document.documentElement.clientWidth };
      });
      expect(facts.h1Text, `${path}: the long title is the page title`).toContain("UISHELL-LONG-");
      expect(facts.overflowX, `${path} at ${width}: no sideways scroll`).toBeLessThanOrEqual(1);
      expect(facts.h1Right!, `${path} at ${width}: the title stays inside the window`).toBeLessThanOrEqual(facts.vw);
    }
  }
});

test("A11Y-01: the task page reflows at 320 px (1280 at 400 %), phone layout", async ({ page, context }) => {
  await as(context, "E2E_REQ", [phoneLayoutCookie()]);
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto(`/users/tasks/${ids.task}`);
  await settle(page);
  await expect(page.getByTestId("m-task-bar")).toBeVisible();
  const facts = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // The outermost elements past the right edge (named in the failure message).
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1))
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}].${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 6).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { overflowX: document.documentElement.scrollWidth - vw, wide };
  });
  expect(facts.overflowX, `no sideways scroll at 320 px: ${facts.wide.join(" | ")}`).toBeLessThanOrEqual(1);
});

test("D-421: the shell measures the tokens at 1440 in every area (header 64, sidebar 250, padding 24 / 24, title 24)", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [login, path] of [
    // v1.91.3 (D-437): My pending requests has no visible title bar now; a users page that has one.
    ["E2E_REQ", "/users/help"],
    ["E2E_ADMIN", "/admin/users"],
    ["E2E_SUPER", "/superadmin/monitoring/audit"],
  ] as const) {
    await as(context, login, [{ name: "ars_layout", value: "desktop" }]);
    await page.goto(path);
    await settle(page);
    const m = await shell(page);
    expect(m, path).toMatchObject({ headerH: 64, headerPadL: 24, sidebarW: 250, collapsed: false, padL: 24, padT: 24, contentLeft: 274, overflowX: 0 });
    expect(m.h1Size, `${path}: page title 24`).toBe(24);
  }
});

test("D-421: at 1920 the content starts beside the sidebar (not centred) and is at most 1600 wide", async ({ page, context }) => {
  await as(context, "E2E_ADMIN", [{ name: "ars_layout", value: "desktop" }]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/admin/users");
  await settle(page);
  const m = await shell(page);
  expect(m.contentLeft, "content left = sidebar 250 + padding 24").toBe(274);
  expect(m.mainW).toBeLessThanOrEqual(1600);
  await as(context, "E2E_ADMIN", [{ name: "ars_layout", value: "desktop" }, { name: "ars_sidebar", value: "rail" }]);
  await page.reload();
  await settle(page);
  expect((await shell(page)).contentLeft, "rail: content left = 72 + 24").toBe(96);
});

test("D-421: a tablet (768-1279) starts on the 72 px rail; the person's choice wins and is kept", async ({ page, context }) => {
  for (const width of [1024, 768]) {
    await as(context, "E2E_REQ", [{ name: "ars_layout", value: "desktop" }]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/users/requests");
    await settle(page);
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    // The device's first page draws the rail at the first paint (CSS), so nothing moves.
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) total += entry.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 200);
        }),
    );
    expect(shift, `${width}: layout shift on the first page`).toBeLessThan(0.05);
    const m = await shell(page);
    expect(m, `${width}`).toMatchObject({ sidebarW: 72, headerH: 64, padL: 24, padT: 24, contentLeft: 96, overflowX: 0 });
    // The rail's icons sit in the middle of the 72 px column.
    const centred = await page.getByTestId("sidebar-rail").locator("a[data-tip]").first().evaluate((link) => {
      const box = link.querySelector("svg")!.getBoundingClientRect();
      return Math.abs(box.left + box.width / 2 - 36);
    });
    expect(centred, "rail icon centred").toBeLessThanOrEqual(1);
    // Next page: the server already draws the rail (the width cookie).
    expect((await context.cookies()).find((cookie) => cookie.name === "ars_vw")?.value).toBe("tablet");
  }
  // Opened by the person: kept on the next page at tablet width.
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("sidebar")).not.toHaveAttribute("data-collapsed", "true");
  expect(Math.round((await page.getByTestId("sidebar").boundingBox())!.width)).toBe(250);
  await page.reload();
  await settle(page);
  await expect(page.getByTestId("sidebar")).not.toHaveAttribute("data-collapsed", "true");
  // From 1280 with no choice saved: open.
  await as(context, "E2E_REQ", [{ name: "ars_layout", value: "desktop" }]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/users/requests");
  await settle(page);
  expect((await shell(page)).sidebarW).toBe(250);
});

test("D-421: phones measure one shell in every area (header 56, padding 16, top 16)", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [login, path, cookies] of [
    ["E2E_REQ", "/users/requests", [phoneLayoutCookie()]],
    ["E2E_ADMIN", "/admin/users", [phoneLayoutCookie()]],
    ["E2E_SUPER", "/superadmin/monitoring/audit", [phoneLayoutCookie()]],
  ] as const) {
    await as(context, login, [...cookies]);
    await page.goto(path);
    await settle(page);
    const m = await shell(page);
    expect(m, path).toMatchObject({ headerH: 56, headerPadL: 16, sidebarW: null, padL: 16, padT: 16, overflowX: 0 });
  }
});

test("D-421: the named control sizes (button 40, compact 32, field 42) on a desktop page", async ({ page, context }) => {
  await as(context, "E2E_REQ", [{ name: "ars_layout", value: "desktop" }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/custom");
  await settle(page);
  const sizes = await page.evaluate(() => {
    const height = (selector: string) => [...document.querySelectorAll<HTMLElement>(`main ${selector}`)].filter((el) => el.getBoundingClientRect().height > 0 && !/\bh-\d/.test(el.className)).map((el) => Math.round(el.getBoundingClientRect().height));
    return { field: height("input.field-input:not(.field-compact)"), button: height(":is(.btn-primary, .btn-secondary):not(.btn-compact)"), compact: height(".btn-compact") };
  });
  expect(sizes.field.length).toBeGreaterThan(0);
  expect(new Set(sizes.field)).toEqual(new Set([42]));
  if (sizes.button.length) expect(new Set(sizes.button)).toEqual(new Set([40]));
  if (sizes.compact.length) expect(new Set(sizes.compact)).toEqual(new Set([32]));
});
