import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { IDS_FILE, VIEWPORTS, loadIds, setUpRecords, signIn, webkitHttpsShim, type Ids, type RoleKey, type Viewport } from "../e2e/ui-qa-shared";

// v1.89.0 stage 4 (D-426): visual regression baselines (docs/qa/VISUAL_REGRESSION_REPORT.md).
// Key screens of every module and role, the overlays, phone cards, empty and not-found
// states and a dark-theme sample at 1440 / 1024 / 390; the shell pages at all nine
// viewports. Deterministic:
//   - a fresh database and fixed-title records (setUpRecords with the stamp "vr");
//   - the browser clock frozen (page.clock.setFixedTime) at the moment the run starts;
//   - relative times waited for (time[data-relative="ready"]), then every date / time /
//     relative text normalised to one fixed text (a baseline taken on another day or at
//     another hour shows the same characters); fonts loaded; motion reduced, animations
//     disabled, the caret hidden; canvases, time boxes and month grids masked.
// Run only with VISUAL=1 (playwright.visual.config.ts).
test.skip(!process.env.VISUAL, "visual baselines: run only with VISUAL=1 (playwright.visual.config.ts)");
// One worker, file order (the set-up first); a failed screen does not stop the others.
test.describe.configure({ mode: "default" });

const STAMP = "vr";
const NOW = Date.now();
const vp = (name: string): Viewport => VIEWPORTS.find((v) => v.name === name)!;
const MAIN = ["1440x900", "1024x768", "390x844"];
const ALL = VIEWPORTS.map((v) => v.name);
const PAIR = ["1440x900", "390x844"];

type Shot = { role: RoleKey; path: string; name: string; viewports?: string[]; theme?: "dark"; open?: (page: Page) => Promise<void>; mask?: string[] };
const shots: Shot[] = [
  // Public
  { role: "public", path: "/", name: "public/landing" },
  { role: "public", path: "/login", name: "public/login", viewports: ALL },
  { role: "public", path: "/privacy", name: "public/privacy" },
  { role: "public", path: "/no-such-page", name: "public/not-found" },
  // Users (requester)
  { role: "user", path: "/users", name: "users/home", viewports: ALL },
  { role: "user", path: "/users?home=tasks", name: "users/home-tasks" },
  { role: "user", path: "/users/requests", name: "users/requests" },
  { role: "user", path: "/users/requests/{request}", name: "users/request-detail" },
  { role: "user", path: "/users/custom", name: "users/custom-step1" },
  { role: "user", path: "/users/work/my-tasks", name: "users/task-summary" },
  { role: "user", path: "/users/tasks/{task}", name: "users/task-detail" },
  { role: "user", path: "/users/work/projects/{project}", name: "users/project-list" },
  { role: "user", path: "/users/work/projects/{project}?view=board", name: "users/project-board" },
  { role: "user", path: "/users/information", name: "users/information" },
  { role: "user", path: "/users/information/{info}", name: "users/information-detail" },
  { role: "user", path: "/users/meetings", name: "users/meetings" },
  { role: "user", path: "/users/meetings/{meeting}", name: "users/meeting-detail" },
  { role: "user", path: "/users/meetings/new", name: "users/meeting-new" },
  { role: "user", path: "/users/tickets", name: "users/tickets" },
  { role: "user", path: "/users/tickets/{ticket}", name: "users/ticket-detail" },
  { role: "user", path: "/users/calendar", name: "users/calendar", mask: ["main [role=grid]", "main table"] },
  { role: "user", path: "/users/profile", name: "users/profile" },
  { role: "user", path: "/users/help", name: "users/help" },
  { role: "user", path: "/users/no-such-page", name: "users/not-found" },
  // Approver, and a person with no records (empty states)
  { role: "approver", path: "/users/queue", name: "approver/queue" },
  { role: "staff", path: "/users/requests", name: "staff/requests-empty" },
  { role: "staff", path: "/users/tickets", name: "staff/tickets-empty" },
  // Admin
  { role: "admin", path: "/admin", name: "admin/home", viewports: ALL },
  { role: "admin", path: "/admin/users", name: "admin/users" },
  { role: "admin", path: "/admin/users/{req}", name: "admin/user-detail" },
  { role: "admin", path: "/admin/records/requests", name: "admin/records-requests" },
  { role: "admin", path: "/admin/insights", name: "admin/insights", mask: ["main svg"] },
  { role: "admin", path: "/admin/setup", name: "admin/setup" },
  { role: "admin", path: "/admin/setup/doa", name: "admin/doa" },
  { role: "admin", path: "/admin/setup/task-types/{taskType}", name: "admin/task-type" },
  // Super Admin
  { role: "super", path: "/superadmin", name: "super/home", viewports: ALL },
  { role: "super", path: "/superadmin/security/features", name: "super/features" },
  { role: "super", path: "/superadmin/monitoring/audit", name: "super/audit", mask: ["main table tbody", "main ul"] },
  { role: "super", path: "/superadmin/connections/email", name: "super/email" },
  // Overlays
  { role: "user", path: "/users/work/my-tasks?task={task}", name: "overlay/task-pane" },
  {
    role: "user",
    path: "/users",
    name: "overlay/search-palette",
    // On a phone the users area's search is its own page (/users/search), not this window.
    viewports: ["1440x900", "1024x768"],
    open: async (page) => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog").first()).toBeVisible();
    },
  },
  {
    role: "user",
    path: "/users/work/my-tasks",
    name: "overlay/create-task",
    viewports: ["1440x900"],
    open: async (page) => {
      await page.getByTestId("create-menu").getByRole("button").first().click();
      await page.getByRole("menuitem", { name: /^Task/ }).click();
      await expect(page.getByTestId("create-dialog")).toBeVisible();
    },
  },
  {
    role: "user",
    path: "/users/tickets/new",
    name: "overlay/date-picker",
    viewports: PAIR,
    open: async (page) => {
      await page.locator("#ticket-required").click();
      await expect(page.locator("[data-date-picker-open]")).toBeVisible();
    },
    mask: ["[data-date-picker-open] [role=grid]", "[data-date-picker-open] h3"],
  },
  // Dark theme sample
  { role: "user", path: "/users", name: "dark/users-home", viewports: PAIR, theme: "dark" },
  { role: "user", path: "/users/requests", name: "dark/users-requests", viewports: PAIR, theme: "dark" },
  { role: "admin", path: "/admin", name: "dark/admin-home", viewports: PAIR, theme: "dark" },
];

// Every date, time and relative text the app writes (lib/format/date.ts) becomes one fixed text.
async function normalise(page: Page) {
  await page.evaluate(() => {
    const rules: [RegExp, string][] = [
      [/\b(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?,?\s+(?=\d)/g, "Mon, "],
      [/\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:,?\s\d{4})?/g, "1 Jan 2026"],
      [/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s(?:\d{1,2},\s)?\d{2,4}\b/g, "Jan 2026"],
      [/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?/gi, "9:00 am"],
      [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/g, "2026-01-01"],
      [/\b\d{2}[/-]\d{2}[/-]\d{2,4}\b/g, "01/01/26"],
      [/\b(?:just now|\d+\s(?:secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?)\sago|in\s\d+\s(?:mins?|minutes?|h|hours?|days?|weeks?))\b/gi, "just now"],
      [/\b(?:Today|Yesterday|Tomorrow)\b/g, "Today"],
      [/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, "Monday"],
      [/Good (?:morning|afternoon|evening|night)/g, "Good day"],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, noscript")) continue;
      let text = node.nodeValue ?? "";
      for (const [pattern, fixed] of rules) text = text.replace(pattern, fixed);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  });
}

async function ready(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-pending"), undefined, { timeout: 5000 }).catch(() => undefined);
  // The app shell has hydrated (D-424 readiness markers); public pages have no skip link.
  await page
    .waitForFunction(() => !document.querySelector("a.skip-link") || (document.documentElement.hasAttribute("data-session-watch") && document.documentElement.hasAttribute("data-place-memory")), undefined, { timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForFunction(() => [...document.querySelectorAll("time[data-relative]")].every((time) => time.getAttribute("data-relative") === "ready"), undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Finite animations done (menus, dialogs); infinite ones are frozen by the screenshot.
  await page
    .waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5000 })
    .catch(() => undefined);
}

test("set up: fixed-title records (once per database)", async ({ page, context }) => {
  test.setTimeout(400_000);
  if (fs.existsSync(IDS_FILE)) test.skip(true, "ids.json exists (VISUAL_SETUP=1 makes a fresh database)");
  await setUpRecords(page, context, STAMP);
});

for (const shot of shots) {
  for (const name of shot.viewports ?? MAIN) {
    const view = vp(name);
    test(`${shot.name} @ ${name}`, async ({ browser }) => {
      const ids: Ids = loadIds();
      const target = shot.path.replace(/\{(\w+)\}/g, (_, key: string) => ids[key] ?? "missing");
      test.skip(target.includes("missing"), `no record for ${shot.path}`);
      const project = test.info().project.name;
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1, hasTouch: view.touch, isMobile: view.touch && project !== "firefox", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
      await signIn(context, shot.role, view);
      if (shot.theme === "dark") await context.addCookies([{ name: "ars_theme", value: "dark", domain: "localhost", path: "/" }]);
      await webkitHttpsShim(context, project);
      const page = await context.newPage();
      await page.clock.setFixedTime(NOW);
      await page.goto(target, { waitUntil: "domcontentloaded" });
      await ready(page);
      if (shot.open) {
        await shot.open(page);
        await ready(page);
      }
      await page.mouse.move(0, 0);
      await normalise(page);
      const mask = ["canvas", "input[type=time]", ".jr-panel", "[data-update-notice]", ...(shot.mask ?? [])].map((selector) => page.locator(selector));
      const [area, file] = shot.name.split("/");
      await expect(page).toHaveScreenshot([area!, name, `${file}.png`], { mask, fullPage: false });
      await context.close();
    });
  }
}
