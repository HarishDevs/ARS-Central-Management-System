import fs from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { OUT, VIEWPORTS, loadIds, settle, signIn, sql, webkitHttpsShim, type RoleKey, type Viewport } from "./ui-qa-shared";

// UI/UX QA audit, phase 1: targeted interaction, overlay, form, table,
// state, edge-case and motion probes on a representative page per module
// (docs/qa/QA_TEST_CASES.md). Evidence only, never fails on a finding:
// audit/ui-qa/probes/<browser>.json. Needs the audit's set-up (ids.json).
//   UIQA=1 required; UIQA_PROBES = comma list of probe groups (default all;
//   the browser-compatibility pass uses "overlays,pane,picker,upload,resize").
test.skip(!process.env.UIQA, "UI QA audit: run only with UIQA=1 (docs/qa/QA_TEST_PLAN.md)");
test.describe.configure({ mode: "serial" });

const groups = process.env.UIQA_PROBES?.split(",") ?? ["overlays", "resize", "pane", "picker", "upload", "forms", "offline", "tables", "keyboard", "reflow", "motion", "sidebar", "transitions", "integration", "states", "longtext", "rapid"];
const on = (group: string) => groups.includes(group);
type Result = { group: string; name: string; browser: string; vp: string; role: string; route: string; ok: boolean | null; facts: Record<string, unknown>; error?: string };
const results: Result[] = [];
let browserName = "chromium";
// Written after every probe, so a timeout keeps what ran.
const resultFile = () => path.join(OUT, "probes", `${browserName}${process.env.UIQA_PROBES ? `-${process.env.UIQA_PROBES.replace(/,/g, "+")}` : ""}.json`);
function flush() {
  fs.mkdirSync(path.dirname(resultFile()), { recursive: true });
  fs.writeFileSync(resultFile(), JSON.stringify(results, null, 1));
}

const vp = (name: string): Viewport => VIEWPORTS.find((v) => v.name === name)!;

async function open(context: BrowserContext, page: Page, role: RoleKey, viewport: Viewport, route: string, extra: { name: string; value: string }[] = []) {
  await signIn(context, role, viewport, extra);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page);
}

async function probe(group: string, name: string, meta: { vp: string; role: string; route: string }, run: () => Promise<{ ok: boolean | null; facts: Record<string, unknown> }>) {
  try {
    const { ok, facts } = await run();
    results.push({ group, name, browser: browserName, ...meta, ok, facts });
    flush();
  } catch (error) {
    results.push({ group, name, browser: browserName, ...meta, ok: null, facts: {}, error: (error as Error).message.split("\n")[0]!.slice(0, 240) });
    flush();
  }
}

// Opens every closed sidebar group, so a link inside a group can be clicked as a person would.
async function openSidebarGroups(page: Page) {
  for (let round = 0; round < 3; round++) {
    const closed = page.locator('[data-testid="sidebar"] [data-testid^="nav-group-"] > button[aria-expanded="false"][aria-controls]').filter({ visible: true });
    const count = await closed.count();
    if (!count) return;
    for (let i = 0; i < count; i++) await closed.first().click({ timeout: 3000 }).catch(() => undefined);
  }
}

// Box, in-viewport, top-most at its centre, computed motion of an overlay.
async function overlayFacts(locator: Locator) {
  return locator.first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    const cx = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(box.top + Math.min(box.height / 2, 40), 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    const s = getComputedStyle(el);
    return {
      box: { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom), w: Math.round(box.width), h: Math.round(box.height) },
      inViewport: box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
      topMost: hit ? el.contains(hit) || hit.contains(el) : false,
      focusInside: el.contains(document.activeElement),
      animation: `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction}`,
      transition: `${s.transitionProperty} ${s.transitionDuration}`,
      radius: s.borderTopLeftRadius,
      zIndex: s.zIndex,
      tag: el.tagName.toLowerCase(),
      modal: el.tagName === "DIALOG" ? (el as HTMLDialogElement).matches(":modal") : el.getAttribute("aria-modal") === "true",
    };
  });
}

const activeName = (page: Page) => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim().slice(0, 40));

test("probes", async ({ browser, browserName: name }) => {
  test.setTimeout(55 * 60_000);
  // The project name (chromium, msedge, firefox, webkit), not the engine.
  browserName = test.info().project.name;
  const ids = loadIds();
  const isTouch = (v: Viewport) => v.touch;
  const newPage = async (v: Viewport) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, hasTouch: isTouch(v), isMobile: isTouch(v) && name !== "firefox" });
    await webkitHttpsShim(context, test.info().project.name);
    // Bounded waits (a held navigation must not stall the run) and native dialogs recorded, then accepted
    // ("Leave site?" from UnsavedGuard would otherwise hold a navigation).
    context.setDefaultNavigationTimeout(20_000);
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on("dialog", (dialog) => {
      nativeDialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 80)} @ ${page.url().replace(/^https?:\/\/[^/]+/, "")}`);
      void dialog.accept().catch(() => undefined);
    });
    return { context, page };
  };
  const errors: string[] = [];
  const nativeDialogs: string[] = [];

  // ---------------------------------------------------------------- overlays
  if (on("overlays")) {
    for (const v of [vp("1440x900"), vp("1024x768"), vp("768x1024"), vp("390x844"), vp("360x800")]) {
      for (const [role, route] of [["user", "/users/requests"], ["admin", "/admin/users"]] as const) {
        const { context, page } = await newPage(v);
        page.on("pageerror", (e) => errors.push(`${route} ${v.name}: ${e.message}`));
        await open(context, page, role, v, route);
        const meta = { vp: v.name, role, route };
        // Search (command palette)
        await probe("overlays", "search palette: opens inside the viewport, focus inside, Escape closes, focus back", meta, async () => {
          const opener = page.getByRole("button", { name: "Search ARS CMS" }).filter({ visible: true }).first();
          if (!(await opener.count())) {
            const link = page.getByRole("link", { name: "Search" }).filter({ visible: true }).first();
            return { ok: null, facts: { note: (await link.count()) ? "phone layout: Search is a page link (/users/search), not a palette" : "no search opener" } };
          }
          await opener.click();
          const panel = page.locator('dialog[open][data-testid="search-panel"]');
          await panel.waitFor({ timeout: 4000 });
          await page.waitForTimeout(350);
          const facts = await overlayFacts(panel);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(350);
          const closed = (await panel.count()) === 0 || !(await panel.isVisible());
          const back = await activeName(page);
          return { ok: facts.inViewport && facts.focusInside && closed, facts: { ...facts, closedByEscape: closed, focusAfterClose: back } };
        });
        await probe("overlays", "notification bell dropdown", meta, async () => {
          const bell = page.getByTestId("notification-bell").filter({ visible: true }).first();
          await bell.click();
          const panel = page.getByTestId("notification-dropdown");
          await panel.waitFor({ timeout: 4000 });
          await page.waitForTimeout(300);
          const facts = await overlayFacts(panel);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(250);
          const closed = !(await panel.isVisible().catch(() => false));
          return { ok: facts.inViewport && closed, facts: { ...facts, closedByEscape: closed, focusAfterClose: await activeName(page) } };
        });
        await probe("overlays", "account (profile) menu", meta, async () => {
          const button = page.getByRole("button", { name: /Account menu for/ }).filter({ visible: true }).first();
          await button.click();
          const menu = page.getByRole("menu").filter({ visible: true }).first();
          await menu.waitFor({ timeout: 4000 });
          await page.waitForTimeout(250);
          const facts = await overlayFacts(menu);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(250);
          return { ok: facts.inViewport, facts: { ...facts, closedByEscape: !(await menu.isVisible().catch(() => false)), focusAfterClose: await activeName(page) } };
        });
        if (role === "user" && v.width >= 768) {
          await probe("overlays", "+ Create menu (sidebar)", meta, async () => {
            const create = page.getByTestId("create-menu").getByRole("button", { name: "Create" }).filter({ visible: true }).first();
            if (!(await create.count())) return { ok: null, facts: { note: "no visible + Create (sidebar hidden below md)" } };
            await create.click();
            const menu = page.getByTestId("create-menu").getByRole("menu");
            await menu.waitFor({ timeout: 4000 });
            await page.waitForTimeout(250);
            const facts = await overlayFacts(menu);
            await page.keyboard.press("Escape");
            return { ok: facts.inViewport, facts };
          });
        }
        if (v.width < 768) {
          await probe("overlays", "phone menu (MobileNav) or tab bar", meta, async () => {
            const opener = page.getByRole("button", { name: "Open menu" }).filter({ visible: true }).first();
            if (!(await opener.count())) return { ok: null, facts: { note: "no Open menu button (users phone layout uses the tab bar + More)", tabBar: await page.locator("nav").filter({ hasText: /Home/ }).count() } };
            await opener.click();
            const sheet = page.getByRole("dialog", { name: "Menu" });
            await sheet.waitFor({ timeout: 4000 });
            await page.waitForTimeout(350);
            const facts = await overlayFacts(sheet);
            const scrollLocked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            return { ok: facts.inViewport && facts.focusInside, facts: { ...facts, htmlOverflowWhileOpen: scrollLocked, closedByEscape: !(await sheet.isVisible().catch(() => false)), focusAfterClose: await activeName(page) } };
          });
        }
        await context.close();
      }
    }
  }

  // ---------------------------------------------------------------- resize with an overlay open
  if (on("resize")) {
    const v = vp("1440x900");
    const { context, page } = await newPage(v);
    await open(context, page, "admin", v, "/admin/users");
    await probe("resize", "search palette open while the window shrinks 1440 -> 390 -> 1440", { vp: "1440->390", role: "admin", route: "/admin/users" }, async () => {
      await page.getByRole("button", { name: "Search ARS CMS" }).filter({ visible: true }).first().click();
      const panel = page.locator('dialog[open][data-testid="search-panel"]');
      await panel.waitFor({ timeout: 4000 });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      const small = await overlayFacts(panel);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(600);
      const big = await overlayFacts(panel);
      return { ok: small.inViewport && big.inViewport, facts: { at390: small, at1440: big, pageOverflowAt390: overflow } };
    });
    await context.close();
    // The users area switches layout (phone <-> desktop) on a resize; with the task pane open.
    const second = await newPage(v);
    await open(second.context, second.page, "user", v, `/users/work/my-tasks?task=${ids.task}`);
    await probe("resize", "task pane open while the window shrinks 1440 -> 390 (layout switches to phone)", { vp: "1440->390", role: "user", route: "/users/work/my-tasks?task=" }, async () => {
      const page2 = second.page;
      await page2.getByTestId("task-pane").waitFor({ timeout: 6000 });
      await page2.setViewportSize({ width: 390, height: 844 });
      await page2.waitForTimeout(1500);
      await settle(page2);
      const pane = page2.getByTestId("task-pane");
      const facts = (await pane.count()) ? await overlayFacts(pane) : null;
      const overflow = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const layout = await page2.evaluate(() => document.querySelector("[data-layout]")?.getAttribute("data-layout") ?? "desktop");
      return { ok: (!facts || facts.inViewport) && overflow <= 1, facts: { pane: facts, pageOverflow: overflow, layoutAfter: layout, url: page2.url().replace(/^https?:\/\/[^/]+/, "") } };
    });
    await second.context.close();
  }

  // ---------------------------------------------------------------- task pane
  if (on("pane")) {
    for (const v of [vp("1920x1080"), vp("1440x900"), vp("1024x768"), vp("768x1024")]) {
      const { context, page } = await newPage(v);
      await open(context, page, "user", v, `/users/work/my-tasks?task=${ids.task}`);
      await probe("pane", "task pane (?task=): geometry, layer, Escape closes, URL cleared", { vp: v.name, role: "user", route: "/users/work/my-tasks?task=" }, async () => {
        const pane = page.getByTestId("task-pane");
        await pane.waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
        const facts = await overlayFacts(pane.getByTestId("task-pane-body"));
        const mainCovered = await page.evaluate(() => {
          const main = document.querySelector("main")!.getBoundingClientRect();
          const paneBox = document.querySelector('[data-testid="task-pane-body"]')!.getBoundingClientRect();
          return { mainRight: Math.round(main.right), paneLeft: Math.round(paneBox.left), overlapPx: Math.max(0, Math.round(main.right - paneBox.left)) };
        });
        await page.locator('[data-testid="task-pane-body"]').click({ position: { x: 20, y: 120 } }).catch(() => undefined);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
        const closed = (await pane.count()) === 0;
        return { ok: facts.inViewport && closed && !page.url().includes("task="), facts: { ...facts, ...mainCovered, closed, urlAfter: page.url().replace(/^https?:\/\/[^/]+/, "") } };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- Create task: date picker, upload, forms
  const openCreate = async (page: Page) => {
    const create = page.getByTestId("create-menu").filter({ visible: true }).first();
    for (let i = 0; i < 3; i++) {
      const button = create.getByRole("button", { name: "Create" });
      if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
      if (await create.getByRole("menuitem", { name: /^Task/ }).isVisible().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    await create.getByRole("menuitem", { name: /^Task/ }).click();
    const dialog = page.getByTestId("create-dialog");
    await dialog.waitFor({ timeout: 6000 });
    return dialog;
  };
  if (on("picker") || on("upload")) {
    for (const v of [vp("1440x900"), vp("768x1024")]) {
      const { context, page } = await newPage(v);
      await open(context, page, "user", v, "/users/work/my-tasks");
      const meta = { vp: v.name, role: "user", route: "/users/work/my-tasks (Create task)" };
      let dialog: Locator | null = null;
      await probe("picker", "Create task dialog geometry", meta, async () => {
        dialog = await openCreate(page);
        await page.waitForTimeout(400);
        return { ok: true, facts: await overlayFacts(dialog) };
      });
      if (dialog && on("picker")) {
        await probe("picker", "date range picker inside Create task: inside the viewport, Escape closes the picker only", meta, async () => {
          await dialog!.getByTestId("create-dates-button").click();
          const field = page.locator("#create-due");
          await field.waitFor({ timeout: 4000 });
          const pickerBox = await field.evaluate((el) => {
            let node: HTMLElement | null = el as HTMLElement;
            while (node && !(node.getAttribute("role") === "dialog" || node.getAttribute("data-testid")?.includes("picker"))) node = node.parentElement;
            const target = node ?? (el as HTMLElement);
            const box = target.getBoundingClientRect();
            return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), inViewport: box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1, container: target.getAttribute("data-testid") ?? target.getAttribute("role") ?? target.tagName };
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
          const dialogStill = await dialog!.isVisible();
          return { ok: pickerBox.inViewport && dialogStill, facts: { picker: pickerBox, createDialogStillOpenAfterEscape: dialogStill } };
        });
      }
      if (dialog && on("upload")) {
        await probe("upload", "file upload in Create task (chip shown, name kept)", meta, async () => {
          await dialog!.getByLabel("Choose files to attach").setInputFiles({ name: "uiqa-note.txt", mimeType: "text/plain", buffer: Buffer.from("UI QA") });
          const chip = dialog!.getByTestId("draft-files");
          await chip.waitFor({ timeout: 4000 });
          return { ok: (await chip.innerText()).includes("uiqa-note.txt"), facts: { chip: (await chip.innerText()).slice(0, 80) } };
        });
      }
      await context.close();
    }
  }

  if (on("forms")) {
    const v = vp("1440x900");
    const { context, page } = await newPage(v);
    await open(context, page, "user", v, "/users/work/my-tasks");
    const meta = { vp: v.name, role: "user", route: "/users/work/my-tasks (Create task)" };
    await probe("forms", "required: Create task with an empty name", meta, async () => {
      const dialog = await openCreate(page);
      const create = dialog.getByRole("button", { name: "Create task" });
      const disabled = await create.isDisabled();
      if (!disabled) await create.click();
      await page.waitForTimeout(600);
      const invalid = await dialog.locator('[aria-invalid="true"]').count();
      const alerts = (await dialog.locator('[role="alert"], .text-danger-600').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 4);
      const name = dialog.getByLabel("Task name");
      const attrs = await name.evaluate((el) => ({ required: (el as HTMLInputElement).required, maxLength: (el as HTMLInputElement).maxLength, tag: el.tagName }));
      return { ok: disabled || invalid > 0 || alerts.length > 0, facts: { createDisabledWhenEmpty: disabled, ariaInvalid: invalid, messages: alerts, taskName: attrs } };
    });
    await probe("forms", "whitespace-only name, then special characters and emoji (saved as text, trimmed)", meta, async () => {
      const dialog = page.getByTestId("create-dialog");
      const name = dialog.getByLabel("Task name");
      await name.fill("     ");
      const createBtn = dialog.getByRole("button", { name: "Create task" });
      const disabledOnSpaces = await createBtn.isDisabled();
      const title = `   UIQA <script>alert(1)</script> "q" & 😀 ${ids.stamp}-special   `;
      await name.fill(title);
      await page.locator("#create-due").isVisible().then(async (shown) => {
        if (!shown) await dialog.getByTestId("create-dates-button").click();
      });
      const due = new Date(Date.now() + 3 * 86_400_000);
      if (due.getUTCDay() === 0) due.setUTCDate(due.getUTCDate() + 1);
      await page.locator("#create-due").fill(due.toISOString().slice(0, 10));
      await page.locator("#create-due").press("Enter");
      // Double click: one task or two?
      await createBtn.dblclick();
      await page.waitForURL(/[?&]task=\d+/, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const rows = await sql<RowDataPacket[]>("SELECT id, title FROM tasks WHERE title LIKE ?", [`%${ids.stamp}-special%`]);
      const pane = page.getByTestId("task-pane");
      const scriptRendered = await page.evaluate(() => document.querySelectorAll("main script, [data-testid='task-pane'] script").length);
      return {
        ok: rows.length === 1 && rows[0]!.title === String(rows[0]!.title).trim() && scriptRendered === 0,
        facts: { createDisabledOnSpaces: disabledOnSpaces, tasksCreatedByDoubleClick: rows.length, storedTitle: rows.map((r) => r.title), trimmed: rows.every((r) => String(r.title) === String(r.title).trim()), paneOpen: (await pane.count()) > 0, scriptElements: scriptRendered },
      };
    });
    await probe("forms", "unsaved warning: Escape with a typed name asks Discard draft?", meta, async () => {
      await page.goto("/users/work/my-tasks");
      await settle(page);
      const dialog = await openCreate(page);
      await dialog.getByLabel("Task name").fill("UIQA unsaved");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const asks = await page.getByText(/Discard draft\?/).isVisible().catch(() => false);
      const buttons = asks ? await page.getByRole("dialog").filter({ hasText: /Discard draft/ }).getByRole("button").allInnerTexts() : [];
      if (asks) await page.getByRole("button", { name: /Discard|Yes/ }).first().click().catch(() => undefined);
      return { ok: asks, facts: { asksDiscard: asks, buttons } };
    });
    // A second form: Out of office (dates, validation placement).
    await probe("forms", "Out of office: submit empty, where the errors show", { vp: v.name, role: "user", route: "/users/delegation" }, async () => {
      await page.goto("/users/delegation");
      await settle(page);
      const submit = page.locator("main form").getByRole("button", { name: /Save|Set|Turn on|Add/ }).first();
      if (!(await submit.count())) return { ok: null, facts: { note: "no submit found" } };
      await submit.click();
      await page.waitForTimeout(800);
      const invalid = await page.locator('main [aria-invalid="true"]').count();
      const native = await page.evaluate(() => [...document.querySelectorAll("main input, main select, main textarea")].filter((el) => !(el as HTMLInputElement).checkValidity()).length);
      const alerts = (await page.locator('main [role="alert"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 4);
      return { ok: invalid + native + alerts.length > 0, facts: { ariaInvalid: invalid, nativeInvalid: native, alerts } };
    });
    await context.close();
  }

  // ---------------------------------------------------------------- offline during submit
  if (on("offline")) {
    const v = vp("1440x900");
    const { context, page } = await newPage(v);
    await open(context, page, "user", v, "/users/work/my-tasks");
    await probe("offline", "Create task while offline: message, no crash, nothing saved, works again online", { vp: v.name, role: "user", route: "/users/work/my-tasks (Create task)" }, async () => {
      const dialog = await openCreate(page);
      await dialog.getByLabel("Task name").fill(`UIQA offline ${ids.stamp}`);
      await dialog.getByTestId("create-dates-button").click().catch(() => undefined);
      const due = new Date(Date.now() + 4 * 86_400_000);
      if (due.getUTCDay() === 0) due.setUTCDate(due.getUTCDate() + 1);
      await page.locator("#create-due").fill(due.toISOString().slice(0, 10));
      await page.locator("#create-due").press("Enter");
      await context.setOffline(true);
      await dialog.getByRole("button", { name: "Create task" }).click();
      await page.waitForTimeout(3000);
      const shown = (await page.locator('[role="alert"], [role="status"]').allInnerTexts()).map((t) => t.trim()).filter((t) => t && /offline|connection|network|internet|try again|couldn/i.test(t)).slice(0, 3);
      const dialogKept = await dialog.isVisible().catch(() => false);
      const kept = dialogKept ? await dialog.getByLabel("Task name").inputValue() : null;
      await context.setOffline(false);
      await page.waitForTimeout(800);
      const [row] = await sql<RowDataPacket[]>("SELECT COUNT(*) AS n FROM tasks WHERE title = ?", [`UIQA offline ${ids.stamp}`]);
      return { ok: shown.length > 0 && dialogKept && kept === `UIQA offline ${ids.stamp}`, facts: { messages: shown, dialogKept, nameKept: kept, savedWhileOffline: Number(row!.n) } };
    });
    await context.close();
  }

  // ---------------------------------------------------------------- tables
  if (on("tables")) {
    for (const [role, route] of [["admin", "/admin/records/tasks"], ["admin", "/admin/records/requests"], ["user", "/users/tasks"], ["user", "/users/requests"], ["admin", "/admin/users"], ["super", "/superadmin/monitoring/audit"]] as const) {
      const v = vp("1440x900");
      const { context, page } = await newPage(v);
      const started = Date.now();
      await open(context, page, role, v, route);
      const loadMs = Date.now() - started;
      await probe("tables", "table: header, sort, paging, sticky header, resize, row height", { vp: v.name, role, route }, async () => {
        const facts = await page.evaluate(() => {
          const table = document.querySelector("main table");
          if (!table) return { table: false } as Record<string, unknown>;
          const th = table.querySelector("thead th");
          const rows = table.querySelectorAll("tbody tr");
          const firstRow = rows[0] as HTMLElement | undefined;
          const sortLinks = table.querySelectorAll("thead a[href], thead button").length;
          return {
            table: true,
            dataTableClass: table.classList.contains("data-table"),
            columns: table.querySelectorAll("thead th").length,
            rows: rows.length,
            rowHeight: firstRow ? Math.round(firstRow.getBoundingClientRect().height) : null,
            headerPosition: th ? getComputedStyle(th).position : null,
            thFont: th ? `${getComputedStyle(th).fontSize} ${getComputedStyle(th).fontWeight}` : null,
            tdFont: table.querySelector("tbody td") ? getComputedStyle(table.querySelector("tbody td")!).fontSize : null,
            sortControls: sortLinks,
            ariaSort: [...table.querySelectorAll("thead [aria-sort]")].map((el) => el.getAttribute("aria-sort")),
            pagination: Boolean(document.querySelector('main nav[aria-label*="agination" i], main [data-testid*="pag" i]')),
            wrapperScrollsX: (() => {
              let node = table.parentElement;
              while (node && node.tagName !== "MAIN") {
                if (["auto", "scroll"].includes(getComputedStyle(node).overflowX)) return true;
                node = node.parentElement;
              }
              return false;
            })(),
          } as Record<string, unknown>;
        });
        let sortWorked: unknown = null;
        const sortLink = page.locator("main table thead a[href]").first();
        if (await sortLink.count()) {
          const before = page.url();
          await sortLink.click();
          await page.waitForTimeout(1200);
          sortWorked = { urlChanged: page.url() !== before, url: page.url().replace(/^https?:\/\/[^/]+/, ""), ariaSort: await page.locator("main table thead [aria-sort]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-sort"))) };
        }
        return { ok: facts.table === true, facts: { ...facts, loadMs, sortWorked } };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- keyboard and focus
  if (on("keyboard")) {
    for (const [role, route] of [["user", "/users"], ["user", "/users/requests"], ["user", "/users/work/my-tasks"], ["user", `/users/meetings/${ids.meeting}`], ["admin", "/admin/users"], ["super", "/superadmin"]] as const) {
      const v = vp("1440x900");
      const { context, page } = await newPage(v);
      await open(context, page, role, v, route);
      await probe("keyboard", "Tab x30: skip link first, visible focus ring, focus never off-screen or hidden", { vp: v.name, role, route }, async () => {
        // Fresh load: sequential focus starts at the top of the document (no click, which would move the start point).
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const stops: { el: string; ring: boolean; inView: boolean }[] = [];
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          stops.push(
            await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el || el === document.body) return { el: "body", ring: false, inView: true };
              const s = getComputedStyle(el);
              const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "") || el.matches(":focus-visible") && s.outlineStyle !== "none";
              const box = el.getBoundingClientRect();
              const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
              return { el: `${el.tagName.toLowerCase()} "${label}"`, ring, inView: box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth && box.width > 0 };
            }),
          );
        }
        const noRing = stops.filter((s) => !s.ring && s.el !== "body");
        const offscreen = stops.filter((s) => !s.inView);
        return { ok: noRing.length === 0 && offscreen.length === 0 && /skip to content/i.test(stops[0]?.el ?? ""), facts: { first: stops[0]?.el, noVisibleRing: noRing.slice(0, 8), offscreen: offscreen.slice(0, 8), stops: stops.length } };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- reflow / zoom
  if (on("reflow")) {
    const pages: [RoleKey, string][] = [["user", "/users"], ["user", "/users/requests"], ["user", `/users/requests/${ids.request}`], ["user", "/users/work/my-tasks"], ["user", `/users/tasks/${ids.task}`], ["user", "/users/meetings"], ["user", "/users/tickets"], ["user", "/users/information"], ["user", `/users/work/projects/${ids.project}`], ["admin", "/admin/users"], ["admin", "/admin/records/requests"], ["super", "/superadmin/monitoring/audit"]];
    // WCAG 1.4.10: 1280 px at 400% = 320 CSS px; 200% of 1280x720 = 640x360; 80% of 1280x720 ~ 1600x900.
    for (const [label, w, h] of [["400% (320x256)", 320, 256], ["200% (640x360)", 640, 360], ["80% (1600x900)", 1600, 900]] as const) {
      for (const [role, route] of pages) {
        const v = { name: label, width: w, height: h, touch: false } as unknown as Viewport;
        const { context, page } = await newPage(v);
        await open(context, page, role, v, route);
        await probe("reflow", `reflow at zoom ${label}`, { vp: label, role, route }, async () => {
          const facts = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            // The outermost elements past the right edge (what makes the page scroll sideways).
            const wide = [...document.querySelectorAll("body *")]
              .filter((el) => el.getBoundingClientRect().right > vw + 1 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1))
              .slice(0, 4)
              .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
            return { overflowX: document.documentElement.scrollWidth - vw, h1: document.querySelector("main h1")?.getBoundingClientRect().width ?? null, layout: document.querySelector("[data-layout]")?.getAttribute("data-layout") ?? "desktop", wide };
          });
          return { ok: facts.overflowX <= 1, facts };
        });
        await context.close();
      }
    }
  }

  // ---------------------------------------------------------------- motion (reduced motion; overlay timings)
  if (on("motion")) {
    for (const reduce of [false, true]) {
      const v = vp("1440x900");
      const { context, page } = await newPage(v);
      await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
      await open(context, page, "user", v, "/users/requests");
      const meta = { vp: v.name, role: "user", route: `/users/requests (reduced motion ${reduce ? "on" : "off"})` };
      await probe("motion", "account menu: computed animation", meta, async () => {
        await page.getByRole("button", { name: /Account menu for/ }).first().click();
        const menu = page.getByRole("menu").filter({ visible: true }).first();
        await menu.waitFor();
        const facts = await overlayFacts(menu);
        await page.keyboard.press("Escape");
        return { ok: true, facts: { animation: facts.animation, transition: facts.transition } };
      });
      await probe("motion", "search palette: computed animation", meta, async () => {
        await page.getByRole("button", { name: "Search ARS CMS" }).filter({ visible: true }).first().click();
        const panel = page.locator('dialog[open][data-testid="search-panel"]');
        await panel.waitFor();
        const facts = await overlayFacts(panel);
        await page.keyboard.press("Escape");
        return { ok: true, facts: { animation: facts.animation, transition: facts.transition } };
      });
      await probe("motion", "toast and dialog: ConfirmDialog style dialog timings (CSS)", meta, async () => {
        const facts = await page.evaluate(() => {
          const d = document.createElement("dialog");
          d.className = "ars-dialog";
          document.body.appendChild(d);
          d.showModal();
          const s = getComputedStyle(d);
          const out = { dialogTransition: `${s.transitionProperty} | ${s.transitionDuration} | ${s.transitionTimingFunction}` };
          d.close();
          d.remove();
          return out;
        });
        return { ok: true, facts };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- sidebar: content moves with it? layout shift?
  if (on("sidebar")) {
    for (const v of [vp("1440x900"), vp("1024x768")]) {
      const { context, page } = await newPage(v);
      await open(context, page, "user", v, "/users/requests");
      await probe("sidebar", "collapse/expand: widths, what animates, does main move with it, layout shift", { vp: v.name, role: "user", route: "/users/requests" }, async () => {
        const toggle = page.getByTestId("sidebar-toggle");
        const sample = async () =>
          page.evaluate(
            () =>
              new Promise<{ frames: { t: number; sidebar: number; mainLeft: number }[]; shift: number; transition: string }>((resolve) => {
                const frames: { t: number; sidebar: number; mainLeft: number }[] = [];
                let shift = 0;
                const po = new PerformanceObserver((list) => {
                  for (const e of list.getEntries() as (PerformanceEntry & { value: number })[]) shift += e.value;
                });
                try {
                  po.observe({ type: "layout-shift" });
                } catch {
                  /* not supported */
                }
                const sidebar = document.querySelector('[data-testid="sidebar"]') as HTMLElement;
                const main = document.querySelector("main") as HTMLElement;
                const t0 = performance.now();
                const tick = () => {
                  frames.push({ t: Math.round(performance.now() - t0), sidebar: Math.round(sidebar.getBoundingClientRect().width), mainLeft: Math.round(main.getBoundingClientRect().left) });
                  if (performance.now() - t0 < 500) requestAnimationFrame(tick);
                  else {
                    po.disconnect();
                    resolve({ frames, shift: Math.round(shift * 10000) / 10000, transition: `${getComputedStyle(sidebar).transitionProperty} ${getComputedStyle(sidebar).transitionDuration} ${getComputedStyle(sidebar).transitionTimingFunction}` });
                  }
                };
                requestAnimationFrame(tick);
              }),
          );
        const widthBefore = await page.getByTestId("sidebar").evaluate((el) => el.getBoundingClientRect().width);
        const [collapse] = await Promise.all([sample(), toggle.click()]);
        await page.waitForTimeout(400);
        const widthCollapsed = await page.getByTestId("sidebar").evaluate((el) => el.getBoundingClientRect().width);
        const [expand] = await Promise.all([sample(), page.getByTestId("sidebar-toggle").click()]);
        const distinctWidths = new Set(collapse.frames.map((f) => f.sidebar)).size;
        const mainSteps = new Set(collapse.frames.map((f) => f.mainLeft)).size;
        return {
          ok: null,
          facts: { widthExpanded: widthBefore, widthCollapsed, transition: collapse.transition, intermediateSidebarWidths: distinctWidths, intermediateMainLefts: mainSteps, layoutShiftCollapse: collapse.shift, layoutShiftExpand: expand.shift, framesCollapse: collapse.frames.filter((_, i) => i % 3 === 0).slice(0, 12) },
        };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- page transitions switched on
  if (on("transitions")) {
    await sql("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.page_transitions', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    try {
      const v = vp("1440x900");
      const { context, page } = await newPage(v);
      await context.addInitScript(() => {
        const w = window as unknown as { __vt: { calls: number; skipped: number; done: number } };
        w.__vt = { calls: 0, skipped: 0, done: 0 };
        const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void>; skipTransition: () => void } };
        const original = doc.startViewTransition?.bind(document);
        if (!original) return;
        doc.startViewTransition = (cb) => {
          w.__vt.calls += 1;
          const t = original(cb);
          const skip = t.skipTransition.bind(t);
          t.skipTransition = () => {
            w.__vt.skipped += 1;
            skip();
          };
          void t.finished.then(() => (w.__vt.done += 1)).catch(() => undefined);
          return t;
        };
      });
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await open(context, page, "user", v, "/users/requests");
      const meta = { vp: v.name, role: "user", route: "sidebar links with page_transitions ON" };
      await probe("transitions", "page transitions ON: sidebar navigation, rapid clicks, back/forward, CLS", meta, async () => {
        const supported = await page.evaluate(() => typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === "function");
        await openSidebarGroups(page);
        const hrefs = ["/users/queue", "/users/tasks", "/users/information", "/users/meetings", "/users/requests"];
        const steps: { to: string; landed: string; h1: string; ms: number }[] = [];
        for (const href of hrefs) {
          await openSidebarGroups(page);
          const link = page.locator(`[data-testid="sidebar"] a[href="${href}"]`).filter({ visible: true }).first();
          if (!(await link.count())) continue;
          const t0 = Date.now();
          await link.click();
          await page.waitForURL((u) => u.pathname === href, { timeout: 8000 }).catch(() => undefined);
          await settle(page);
          steps.push({ to: href, landed: new URL(page.url()).pathname, h1: (await page.locator("main h1").first().innerText().catch(() => "")).slice(0, 40), ms: Date.now() - t0 });
        }
        // Rapid: three links within ~150 ms; the last one must win.
        const rapid = ["/users/tasks", "/users/meetings", "/users/information"];
        await openSidebarGroups(page);
        for (const href of rapid) {
          await page.locator(`[data-testid="sidebar"] a[href="${href}"]`).filter({ visible: true }).first().click({ noWaitAfter: true, timeout: 2000 }).catch(() => undefined);
          await page.waitForTimeout(50);
        }
        await page.waitForTimeout(2500);
        const rapidLanded = new URL(page.url()).pathname;
        const rapidH1 = await page.locator("main h1").first().innerText().catch(() => "");
        await page.goBack();
        await settle(page);
        const backLanded = new URL(page.url()).pathname;
        await page.goForward();
        await settle(page);
        const forwardLanded = new URL(page.url()).pathname;
        const vt = await page.evaluate(() => (window as unknown as { __vt?: unknown }).__vt ?? null);
        const cls = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let total = 0;
              new PerformanceObserver((list) => {
                for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) total += e.value;
              }).observe({ type: "layout-shift", buffered: true });
              setTimeout(() => resolve(Math.round(total * 10000) / 10000), 100);
            }),
        ).catch(() => -1);
        const css = await page.evaluate(() => {
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) if (rule.cssText.includes("view-transition-new(page-main)")) return rule.cssText.slice(0, 200);
            } catch {
              /* cross-origin */
            }
          }
          return null;
        });
        return { ok: rapidLanded === rapid[rapid.length - 1] && errs.length === 0, facts: { viewTransitionsSupported: supported, steps, rapidLanded, rapidH1: rapidH1.slice(0, 40), backLanded, forwardLanded, viewTransitionCalls: vt, clsSession: cls, pageErrors: errs.slice(0, 4), pageMainRule: css } };
      });
      await context.close();
    } finally {
      await sql("UPDATE system_settings SET value = 'OFF' WHERE setting_key = 'features.page_transitions'");
    }
  }

  // ---------------------------------------------------------------- cross-module integration: one request everywhere
  if (on("integration")) {
    const v = vp("1440x900");
    const title = ids.requestTitle!;
    const places: [RoleKey, string, string][] = [
      ["user", "detail", `/users/requests/${ids.request}`],
      ["user", "my requests list", "/users/requests"],
      ["user", "global search page", `/users/search?q=${encodeURIComponent(title)}`],
      ["user", "home (approvals overview)", "/users"],
      ["approver", "waiting for me (queue)", "/users/queue"],
      ["approver", "notifications", "/users/notifications"],
      ["approver", "home (approvals overview)", "/users"],
      ["admin", "Admin records", "/admin/records/requests"],
    ];
    const seen: Record<string, unknown> = {};
    for (const [role, label, route] of places) {
      const { context, page } = await newPage(v);
      await open(context, page, role, v, route);
      seen[`${role}: ${label}`] = await page.evaluate((t) => {
        const main = document.querySelector("main");
        if (!main) return null;
        const holders = [...main.querySelectorAll("tr, li, article, a, h1, [data-testid]")].filter((el) => (el as HTMLElement).innerText?.includes(t));
        const tight = holders.sort((a, b) => (a as HTMLElement).innerText.length - (b as HTMLElement).innerText.length)[0] as HTMLElement | undefined;
        const row = tight?.closest("tr, li, article") as HTMLElement | null;
        const text = (row ?? tight)?.innerText.replace(/\s+/g, " ").slice(0, 220) ?? null;
        const pageText = main.innerText;
        return { found: Boolean(tight), text, number: (text ?? "").match(/\b[A-Z]{2,6}[-/][A-Z0-9-/]*\d+\b/)?.[0] ?? null, status: (text ?? pageText).match(/\b(Pending|Waiting|In progress|Approved|Rejected|Sent back|Submitted|Open|Awaiting[a-z ]*)\b/i)?.[0] ?? null };
      }, title);
      await context.close();
    }
    const numbers = new Set(Object.values(seen).map((s) => (s as { number?: string } | null)?.number).filter(Boolean));
    const statuses = new Set(Object.values(seen).map((s) => (s as { status?: string } | null)?.status?.toLowerCase()).filter(Boolean));
    results.push({ group: "integration", name: "the same request from detail, list, search, home, queue, notifications and Admin records", browser: browserName, vp: v.name, role: "user/approver/admin", route: `/users/requests/${ids.request}`, ok: numbers.size <= 1, facts: { seen, distinctNumbers: [...numbers], distinctStatusWords: [...statuses] } });
  }

  // ---------------------------------------------------------------- error, empty and not-found states
  if (on("states")) {
    const v = vp("1440x900");
    const cases: [RoleKey, string][] = [["user", "/users/requests/99999999"], ["user", "/users/tasks/99999999"], ["user", "/users/meetings/99999999"], ["user", "/users/tickets/99999999"], ["user", "/users/information/99999999"], ["user", "/users/work/projects/99999999"], ["user", "/users/not-a-page"], ["admin", "/admin/users/99999999"], ["admin", "/admin/not-a-page"], ["super", "/superadmin/not-a-page"], ["staff", "/users/requests"], ["staff", "/users/tasks"], ["staff", "/users/tickets"], ["staff", "/users/information"], ["staff", "/users/meetings"], ["staff", "/users/work/projects"], ["staff", "/users/notifications"], ["staff", "/users/queue"]];
    for (const [role, route] of cases) {
      const { context, page } = await newPage(v);
      await signIn(context, role, v);
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      await settle(page);
      await probe("states", route.includes("9999") || route.includes("not-a-page") ? "not found: status, words, shell kept" : "empty state: words and next step", { vp: v.name, role, route }, async () => {
        const facts = await page.evaluate(() => {
          const main = document.querySelector("main");
          return {
            h1: document.querySelector("h1")?.textContent?.trim().slice(0, 60) ?? null,
            shellHeader: Boolean(document.querySelector("header")),
            sidebar: Boolean(document.querySelector('[data-testid="sidebar"]')),
            emptyTable: [...(main?.querySelectorAll("table") ?? [])].some((t) => t.querySelectorAll("tbody tr").length === 0),
            text: (main?.innerText ?? document.body.innerText).replace(/\s+/g, " ").slice(0, 260),
            actions: [...(main?.querySelectorAll("a[href], button") ?? [])].slice(0, 6).map((a) => (a.textContent ?? "").trim().slice(0, 30)),
          };
        });
        return { ok: null, facts: { status: response?.status(), landed: new URL(page.url()).pathname, ...facts } };
      });
      await context.close();
    }
  }

  // ---------------------------------------------------------------- long text and markup
  if (on("longtext")) {
    for (const v of [vp("1440x900"), vp("390x844"), vp("360x800")]) {
      for (const route of [`/users/tasks/${ids.longTask}`, `/users/work/my-tasks?task=${ids.longTask}`, "/users/tasks", `/users/tasks/${ids.markupTask}`, "/admin/records/tasks"]) {
        const role: RoleKey = route.startsWith("/admin") ? "admin" : "user";
        const { context, page } = await newPage(v);
        await open(context, page, role, v, route);
        await probe("longtext", "190-char unbroken title / markup + emoji title", { vp: v.name, role, route }, async () => {
          const facts = await page.evaluate(() => {
            const longEl = [...document.querySelectorAll("main *, [data-testid='task-pane'] *")].find((el) => el.childElementCount === 0 && (el.textContent ?? "").includes("UIQA-LONG-"));
            const box = longEl?.getBoundingClientRect();
            return {
              overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              longTitleBox: box ? { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) } : null,
              longTitleInside: box ? box.right <= window.innerWidth + 1 : null,
              markupRenderedAsText: [...document.querySelectorAll("main, [data-testid='task-pane']")].some((el) => (el as HTMLElement).innerText.includes("<b>bold</b>")),
              boldElementFromTitle: Boolean([...document.querySelectorAll("main b")].find((b) => b.textContent === "bold")),
            };
          });
          return { ok: facts.overflowX <= 1 && facts.longTitleInside !== false && !facts.boldElementFromTitle, facts };
        });
        await context.close();
      }
    }
  }

  // ---------------------------------------------------------------- rapid clicks
  if (on("rapid")) {
    const v = vp("1440x900");
    const { context, page } = await newPage(v);
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await open(context, page, "admin", v, "/admin/records/tasks");
    await probe("rapid", "sort header clicked 6 times quickly; sidebar link double-clicked", { vp: v.name, role: "admin", route: "/admin/records/tasks" }, async () => {
      const sort = page.locator("main table thead a[href]").first();
      const has = await sort.count();
      for (let i = 0; i < 6 && has; i++) await sort.click({ noWaitAfter: true }).catch(() => undefined);
      await page.waitForTimeout(2500);
      const afterSort = page.url().replace(/^https?:\/\/[^/]+/, "");
      await openSidebarGroups(page);
      const link = page.locator('[data-testid="sidebar"] a[href="/admin/users"]').first();
      if (await link.count()) await link.dblclick().catch(() => undefined);
      await page.waitForTimeout(2500);
      return { ok: errs.length === 0 && new URL(page.url()).pathname === "/admin/users", facts: { sortLinks: has, afterSort, landed: new URL(page.url()).pathname, pageErrors: errs.slice(0, 4), historyLength: await page.evaluate(() => history.length) } };
    });
    await context.close();
  }

  // ---------------------------------------------------------------- layout shift sources (pages the sweep flagged)
  if (on("cls")) {
    for (const v of [vp("1366x768"), vp("1280x720"), vp("1920x1080"), vp("1440x900")]) {
      for (const [role, route] of [["user", "/users/analytics"], ["admin", "/admin/insights/analytics"], ["user", `/users/work/my-tasks?task=${ids.task}`]] as const) {
        const { context, page } = await newPage(v);
        await signIn(context, role, v);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.waitForTimeout(1500);
        await probe("cls", "layout shift during load: total and the elements that moved", { vp: v.name, role, route }, async () => {
          const facts = await page.evaluate(
            () =>
              new Promise<Record<string, unknown>>((resolve) => {
                const shifts: { t: number; value: number; sources: string[] }[] = [];
                new PerformanceObserver((list) => {
                  for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] })[]) {
                    if (e.hadRecentInput) continue;
                    shifts.push({
                      t: Math.round(e.startTime),
                      value: Math.round(e.value * 10000) / 10000,
                      sources: (e.sources ?? []).slice(0, 3).map((s) => {
                        const el = s.node as Element | undefined;
                        const name = el && el.nodeType === 1 ? `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}` : "#text";
                        return `${name} ${Math.round(s.previousRect.y)},${Math.round(s.previousRect.height)} -> ${Math.round(s.currentRect.y)},${Math.round(s.currentRect.height)}`;
                      }),
                    });
                  }
                }).observe({ type: "layout-shift", buffered: true });
                setTimeout(() => resolve({ total: Math.round(shifts.reduce((a, s) => a + s.value, 0) * 10000) / 10000, shifts: shifts.filter((s) => s.value > 0.005).slice(0, 6) }), 150);
              }),
          );
          return { ok: (facts.total as number) < 0.1, facts };
        });
        await context.close();
      }
    }
  }

  results.push({ group: "meta", name: "page errors seen during overlay probes", browser: browserName, vp: "-", role: "-", route: "-", ok: errors.length === 0, facts: { errors: errors.slice(0, 20), nativeDialogs: nativeDialogs.slice(0, 20) } });
  flush();
});
