import AxeBuilder from "@axe-core/playwright";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import type { RowDataPacket } from "mysql2/promise";
import { E2E_ENV } from "../../playwright.config";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, dropCustomDraft, phoneLayoutCookie, sessionCookie, toWorkflowStep } from "./db";
import { createProject } from "./work-helpers";

// v1.72.2 (D-394, QA visual review): toasts show above an open modal dialog;
// the changed screens pass axe in light and dark at 1366, 768 and 375 px.
// VISUAL_SHOTS=1 also saves a screenshot of each to test-results/visual-1722.
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const projectName = `Visual ${stamp}`;
const openTitle = `Pour the slab ${stamp}`;
const doneTitle = `Order the steel ${stamp}`;
const requestTitle = `Visual check ${stamp}`;
let projectUrl = "";
const tabs: Record<string, string> = {};
let requestPath = "";
const SHOTS = Boolean(process.env.VISUAL_SHOTS);
const DIR = "test-results/visual-1722";

// Pico Bot on for Manoj (H5: its launcher must clear the phone's decision bar).
function encrypt(plain: string): string {
  const key = Buffer.from(E2E_ENV.ENCRYPTION_KEY, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
const AI_KEYS: [string, string, boolean][] = [
  ["ai.active_provider", "CLAUDE", false],
  ["ai.claude.api_key", "sk-ant-e2e-mock-key-0000", true],
  ["ai.claude.model", "mock-claude", false],
];
let managerAccess: { module_access: string | null; chat_modes: string | null } | null = null;
test.beforeAll(async () => {
  const conn = await db();
  try {
    for (const [key, value, encrypted] of AI_KEYS)
      await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'AI', 'STRING', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), encrypted = VALUES(encrypted)", [key, encrypted, encrypted ? encrypt(value) : value]);
    // The theme comes from the ars_theme cookie here; a saved account theme (left by another spec) would override it.
    await conn.query("DELETE FROM user_settings WHERE setting_key = 'ui.theme'");
    const [rows] = await conn.query<RowDataPacket[]>("SELECT module_access, chat_modes FROM users WHERE login_id = 'E2E_MGR'");
    managerAccess = { module_access: rows[0]?.module_access ?? null, chat_modes: rows[0]?.chat_modes ?? null };
    const modules = new Set(String(managerAccess.module_access ?? "APPROVAL").split(",").filter(Boolean));
    modules.add("AI");
    await conn.query("UPDATE users SET module_access = ?, chat_modes = 'APPROVAL' WHERE login_id = 'E2E_MGR'", [[...modules].join(",")]);
  } finally {
    await conn.end();
  }
});
test.afterAll(async () => {
  const conn = await db();
  try {
    for (const [key] of AI_KEYS) await conn.query("DELETE FROM system_settings WHERE setting_key = ?", [key]);
    if (managerAccess) await conn.query("UPDATE users SET module_access = ?, chat_modes = ? WHERE login_id = 'E2E_MGR'", [managerAccess.module_access, managerAccess.chat_modes]);
  } finally {
    await conn.end();
  }
});

async function as(context: BrowserContext, loginId: string, theme: "light" | "dark" = "light", phone = false) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId, { tourDone: true }), { name: "ars_theme", value: theme, domain: "localhost", path: "/" }, ...(phone ? [phoneLayoutCookie()] : [])]);
}
async function axe(page: Page, include?: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity)); // v1.80.0 (D-407): menus and dialogs finish fading in first
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}

test("set up: a project with an open and a done task and the extra tabs; a request waiting for Manoj", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  projectUrl = await createProject(page, projectName);
  for (const title of [openTitle, doneTitle]) {
    const add = page.getByRole("rowgroup", { name: "To do" }).getByLabel("Add a task");
    await add.fill(title);
    await add.press("Enter");
    await expect(page.getByTestId("task-row").filter({ hasText: title })).toBeVisible();
  }
  const conn = await db();
  try {
    await conn.query("UPDATE tasks SET status = 'COMPLETED' WHERE title = ?", [doneTitle]);
  } finally {
    await conn.end();
  }
  for (const kind of ["timeline", "gantt", "files", "messages", "page"]) {
    await page.goto(projectUrl);
    await page.getByTestId("add-tab").locator("button[aria-haspopup]").click();
    await page.getByTestId(`add-tab-${kind}`).click();
    await expect(page).toHaveURL(/\?tab=\d+/);
    tabs[kind] = page.url();
  }

  // A request from Sam to Manoj, for the phone's decision bar.
  await as(context, "E2E_STAFF");
  await dropCustomDraft("E2E_STAFF");
  await page.goto("/users/custom");
  await page.locator("#c-title").fill(requestTitle);
  await toWorkflowStep(page);
  const level = page.getByTestId("workflow-level").filter({ visible: true }).last();
  await level.getByLabel("Who approves").selectOption("PEOPLE");
  await level.getByRole("combobox", { name: /People \(search and pick/ }).fill("Manoj");
  await page.getByRole("option", { name: /Manoj Manager/ }).first().click();
  await page.getByTestId("step-next").click();
  await page.getByTestId("action-bar").getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/users\/requests\/\d+\?submitted=1/);
  requestPath = new URL(page.url()).pathname;
});

test("G1: a toast raised inside an open modal dialog shows above it and can be dismissed", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  // v1.89.0 stage 4 (D-426): Chromium only knows these permissions (WebKit / Firefox throw); the toast shows either way (copied, or a copy error).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.goto(projectUrl);
  await page.getByTestId("share-project").click();
  const dialog = page.getByTestId("share-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Copy/ }).first().click();
  const toast = page.getByTestId("toast-region").locator("p.font-semibold").first();
  await expect(toast).toBeVisible();
  // The region lives inside the open dialog (the top layer), and nothing covers it.
  expect(await page.getByTestId("toast-region").evaluate((region) => Boolean(region.closest("dialog[open]")))).toBe(true);
  const box = (await toast.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest("[data-testid=toast-region]")), [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe(true);
  if (SHOTS) {
    mkdirSync(DIR, { recursive: true });
    await page.screenshot({ path: `${DIR}/toast-over-dialog.png` });
  }
  await page.getByTestId("toast-region").getByRole("button", { name: "Dismiss" }).first().click();
  await expect(page.getByTestId("toast-region").getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  // Closing the dialog puts the toasts back on the page.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.getByTestId("toast-region").evaluate((region) => Boolean(region.closest("dialog")))).toBe(false);
});

// A row menu shows only where the list is a table (not the phone cards).
async function openVisible(page: Page, testId: string) {
  const menu = page.getByTestId(testId).filter({ visible: true }).first();
  if (await menu.count()) await menu.click();
}
// scope: what axe checks (a modal pane: the pane, not the dimmed page behind it).
type Screen = { name: string; login: string; path: () => string; prepare?: (page: Page) => Promise<void>; scope?: string | ((width: number) => string | undefined) };
const SCREENS: Screen[] = [
  { name: "home", login: "E2E_REQ", path: () => "/users" },
  { name: "account-menu", login: "E2E_REQ", path: () => "/users", prepare: async (page) => page.getByRole("button", { name: /Account menu for/ }).click() },
  { name: "project-list", login: "E2E_REQ", path: () => projectUrl },
  { name: "project-board", login: "E2E_REQ", path: () => `${projectUrl}?view=board` },
  { name: "timeline", login: "E2E_REQ", path: () => tabs.timeline! },
  { name: "gantt", login: "E2E_REQ", path: () => tabs.gantt! },
  { name: "files", login: "E2E_REQ", path: () => tabs.files! },
  { name: "messages", login: "E2E_REQ", path: () => tabs.messages! },
  { name: "page", login: "E2E_REQ", path: () => tabs.page! },
  {
    name: "task-pane",
    login: "E2E_REQ",
    path: () => projectUrl,
    prepare: async (page) => {
      await page.getByTestId("task-row").filter({ hasText: openTitle }).getByRole("link").first().click();
      // v1.89.0 (D-424): since D-410 a task opens in the pane on a computer and on its own
      // page on a phone (the phone layout has no pane); each is checked as the person sees it.
      if ((page.viewportSize()?.width ?? 1366) < 768) {
        await expect(page).toHaveURL(/\/users\/tasks\/\d+/);
        await expect(page.getByRole("heading", { level: 1, name: openTitle })).toBeVisible();
      } else await expect(page.getByTestId("task-pane")).toBeVisible();
    },
    scope: (width) => (width < 768 ? undefined : "[data-testid=task-pane]"),
  },
  { name: "requests-row-menu", login: "E2E_STAFF", path: () => "/users/requests", prepare: (page) => openVisible(page, "row-menu") },
  { name: "users-row-menu", login: "E2E_ADMIN", path: () => "/admin/users", prepare: (page) => openVisible(page, "user-row-menu") },
  { name: "request-decision", login: "E2E_MGR", path: () => requestPath },
];
const WIDTHS = SHOTS ? [1366, 768, 375] : [1366, 375];

for (const theme of ["light", "dark"] as const) {
  test(`changed screens pass axe (${theme})`, async ({ page, context }) => {
    test.setTimeout(SHOTS ? 900_000 : 420_000);
    if (SHOTS) mkdirSync(DIR, { recursive: true });
    const problems: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : width === 768 ? 1024 : 900 });
      for (const screen of SCREENS) {
        await as(context, screen.login, theme, width === 375);
        await page.goto(screen.path());
        await page.waitForLoadState("networkidle");
        if (screen.prepare) await screen.prepare(page);
        // A modal (task pane) or an open menu: axe the page as the person sees it.
        const found = await axe(page, typeof screen.scope === "function" ? screen.scope(width) : screen.scope);
        if (found.length) problems.push(`${screen.name} @${width} ${theme}: ${found.join("; ")}`);
        if (screen.name === "request-decision" && width === 375) {
          // H5: Pico Bot's launcher never covers the decision bar.
          const bar = await page.getByRole("region", { name: "Your decision" }).boundingBox();
          const launcher = page.locator(".picbot-launcher");
          await expect(launcher).toBeVisible();
          const bot = await launcher.boundingBox();
          if (bar && bot) expect(bot.y + bot.height, "launcher above the bar").toBeLessThanOrEqual(bar.y + 1);
        }
        if (SHOTS) await page.screenshot({ path: `${DIR}/${screen.name}-${width}-${theme}.png`, fullPage: false });
      }
    }
    expect(problems).toEqual([]);
  });
}
