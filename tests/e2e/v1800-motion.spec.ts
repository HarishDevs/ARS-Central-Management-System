import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, dropCustomDraft, phoneLayoutCookie, sessionCookie, toWorkflowStep } from "./db";

// v1.80.0 (D-407): the owner-approved interaction, motion and loading review.
// Dialogs and drawers animate and still close with Escape (focus back to the
// opener); menus and folds unfold; links show they're loading and never
// reload the page; desktop skeletons; an optimistic comment with roll-back;
// toasts for "done" and inline errors; the list's place kept on Back; "Discard
// draft?"; J / K / Enter; the "Next waiting for you" flow; a bottom sheet
// swiped away on a phone; reduce motion; page transitions on and off; axe in
// light, dark and phone on the changed screens.
test.describe.configure({ mode: "serial" });
const stamp = Date.now().toString(36);
const ids: number[] = [];

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5000 }).catch(() => undefined); // v1.80.0 (D-407): menus and dialogs finish fading in first; v1.89.0 stage 4 (D-426): at most 5 s (Firefox can leave a colour transition at currentTime 0 after a theme switch; it never ends)
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
}
// A page marker that a full reload would wipe (a client-side navigation keeps it).
async function mark(page: Page) {
  await page.evaluate(() => ((window as unknown as { __kept: string }).__kept = "yes"));
}
async function stillMarked(page: Page) {
  return page.evaluate(() => (window as unknown as { __kept?: string }).__kept === "yes");
}
// v1.89.0 (D-420): null puts the switch back to its default (ON since v1.89.0).
async function setSwitch(value: "ON" | "OFF" | null) {
  const conn = await db();
  try {
    if (value === null) {
      await conn.query("DELETE FROM system_settings WHERE setting_key = 'features.page_transitions'");
      return;
    }
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.page_transitions', 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [value]);
  } finally {
    await conn.end();
  }
}

test("setup: two custom requests waiting for Manoj (E2E_MGR)", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const n of [1, 2]) {
    await dropCustomDraft("E2E_REQ");
    await page.goto("/users/custom");
    await page.getByLabel("Title").fill(`Motion ${n} ${stamp}`);
    await page.getByLabel(/^Details/).fill("Chairs for the motion review.");
    await toWorkflowStep(page);
    await page.getByTestId("step-next").click();
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page).toHaveURL(/\/users\/requests\/\d+\?submitted=1/);
    ids.push(Number(new URL(page.url()).pathname.split("/").pop()));
  }
  expect(ids).toHaveLength(2);
});

test("Waiting for me: J / K move between rows (never while typing), Enter opens without a full reload", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  const links = page.locator("main table a[data-queue-link]").filter({ hasText: stamp });
  await expect(links).toHaveCount(2);
  // v1.91.1 (D-435): the page's h1 is screen-reader only now; start with nothing focused instead of clicking it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("j");
  const first = await page.evaluate(() => document.activeElement?.getAttribute("href"));
  expect(first).toMatch(/^\/users\/requests\/\d+$/);
  await page.keyboard.press("j");
  const second = await page.evaluate(() => document.activeElement?.getAttribute("href"));
  expect(second).not.toBe(first);
  await page.keyboard.press("k");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe(first);
  // Typing in a field: J is a letter, not a move.
  const search = page.locator("main input[type='search'], main input[name='q']").first();
  if (await search.count()) {
    await search.focus();
    await page.keyboard.press("j");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.tagName)).toBe("INPUT");
  }
  // Enter on the selected row opens it, as a client-side navigation.
  await page.locator(`main table a[href="${first}"]`).focus();
  await mark(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${first}$`));
  expect(await stillMarked(page)).toBe(true);
});

test("a dialog opens and closes smoothly; Escape closes it and focus goes back to its button; reduce motion only fades", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/requests/${ids[0]}`);
  await page.getByLabel(/Comment/).first().fill("Checking the dialog");
  const reject = page.getByRole("button", { name: "Reject", exact: true }).first();
  await reject.click();
  const ask = page.getByRole("alertdialog", { name: "Reject this request?" });
  await expect(ask).toBeVisible();
  // The shared dialog: one motion system (opacity + transform, 220 ms in).
  const styles = await page.locator("dialog.ars-dialog[open]").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { property: style.transitionProperty, opacity: style.opacity };
  });
  expect(styles.property).toContain("opacity");
  expect(styles.property).toContain("transform");
  await page.keyboard.press("Escape");
  await expect(ask).toBeHidden();
  await expect(reject).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await reject.click();
  await expect(ask).toBeVisible();
  const reduced = await page.locator("dialog.ars-dialog[open]").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, transform: style.transform };
  });
  expect(reduced.transform).toBe("none");
  for (const part of reduced.duration.split(",")) expect(parseFloat(part)).toBeLessThanOrEqual(0.1);
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("a comment shows at once and rolls back when the server can't take it; success is a toast, errors stay inline", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/users/requests/${ids[0]}`);
  const form = page.getByRole("region", { name: "Discussion" });
  const box = form.locator("[contenteditable='true']").first();
  // The server is slow: the comment shows as "Posting…" straight away.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/users/requests/${ids[0]}`, async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await box.click();
  await page.keyboard.type(`Optimistic ${stamp}`);
  await form.getByRole("button", { name: "Post comment" }).click();
  await expect(form.getByTestId("comment-optimistic")).toContainText(`Optimistic ${stamp}`);
  release();
  // Done: a toast that repeats the verb, nothing left inline in the form.
  await expect(page.getByTestId("toast-region")).toContainText("Posted");
  await expect(form.getByText("Posted.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(`Optimistic ${stamp}`).first()).toBeVisible();
  await expect(form.getByTestId("comment-optimistic")).toHaveCount(0);
  await page.unroute(`**/users/requests/${ids[0]}`);

  // The server can't be reached: the preview goes, the words stay, the error is inline.
  await page.route(`**/users/requests/${ids[0]}`, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await box.click();
  await page.keyboard.type(`Rolled back ${stamp}`);
  await form.getByRole("button", { name: "Post comment" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByTestId("comment-optimistic")).toHaveCount(0);
  await expect(box).toContainText(`Rolled back ${stamp}`);
  await page.unroute(`**/users/requests/${ids[0]}`);
});

test("Next waiting for you: a decision taken from Waiting for me lands on the next request with a short highlight", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/queue");
  await page.locator(`main table a[data-queue-link][href="/users/requests/${ids[0]}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/users/requests/${ids[0]}$`));
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  // The next one waiting (in a full run other suites leave more requests waiting for Manoj).
  await expect(page).toHaveURL(new RegExp(`/users/requests/\\d+\\?nextwaiting=1&after=${ids[0]}`));
  expect(page.url()).not.toContain(`/users/requests/${ids[0]}?`);
  const arrived = page.getByTestId("next-waiting-arrived");
  await expect(arrived).toContainText("Next waiting for you");
  await expect(page.locator("[data-next-flash]")).toHaveCount(1);
  await expect(page.locator("[data-next-flash]")).toHaveCount(0, { timeout: 5000 });
  await arrived.getByRole("link", { name: "Back to the one you decided" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/requests/${ids[0]}\\?decided=1`));
  await expect(page.getByTestId("next-waiting")).toBeVisible();
});

test("menus and filter panels unfold (and still open with reduce motion); folded groups glide open", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/requests");
  const sort = page.getByTestId("sort-menu").first();
  await sort.locator("summary").click();
  const panel = sort.locator(":scope > :not(summary)").first();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe("menu-in");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sort.locator("summary").click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe("fade-in-only");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await as(context, "E2E_SUPER");
  await page.goto("/admin/users?group=status");
  const fold = page.getByTestId("group-fold").first();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("tbody[data-revealed]").first()).toBeVisible();
  await page.getByRole("button", { name: "Collapse all" }).first().click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
});

test("a sort shows it was heard (the title dims, the table dims) and never reloads the page; lists get a skeleton", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/requests");
  await mark(page);
  // Hold the next page's data so the pending look can be seen.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/users/requests?*", async (route) => {
    if (route.request().headers()["rsc"]) await held;
    await route.continue();
  });
  await page.getByTestId("sort-link").first().click();
  await expect(page.locator("[data-link-pending]").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-pending", "");
  release();
  await expect(page).toHaveURL(/sort/i);
  await expect(page.locator("html")).not.toHaveAttribute("data-nav-pending", "");
  expect(await stillMarked(page)).toBe(true);
  await page.unroute("**/users/requests?*");

  // Another list: its table-shaped skeleton covers the page until it arrives.
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => (open = resolve));
  await page.route("**/users/approved*", async (route) => {
    if (route.request().headers()["rsc"]) await wait;
    await route.continue();
  });
  await page.locator("nav a[href='/users/approved']").first().click();
  await expect(page.getByTestId("nav-skeleton")).toBeVisible();
  open();
  await expect(page).toHaveURL(/\/users\/approved/);
  await expect(page.getByTestId("nav-skeleton")).toHaveCount(0);
  expect(await stillMarked(page)).toBe(true);
  await page.unroute("**/users/approved*");
});

test("Back returns the list at the same place with the same row focused", async ({ page, context }) => {
  await as(context, "E2E_REQ");
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto("/users/requests");
  const link = page.locator(`main table a[href="/users/requests/${ids[1]}"]`).first();
  await link.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 60));
  const y = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/users/requests/${ids[1]}`));
  await page.goBack();
  await expect(page).toHaveURL(/\/users\/requests$/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe(`/users/requests/${ids[1]}`);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(4);
});

test("Create task asks 'Discard draft?' when closed by accident with something typed", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/tasks/new");
  const draft = page.getByTestId("create-dialog");
  await expect(draft).toBeVisible();
  await draft.getByRole("textbox").first().fill(`Draft ${stamp}`);
  await page.keyboard.press("Escape");
  const ask = page.getByRole("alertdialog", { name: "Discard draft?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toBeHidden();
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: "Close" }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(draft).toBeHidden();
});

test("phone: a bottom sheet and a drawer close with a swipe down", async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([await sessionCookie("E2E_MGR"), phoneLayoutCookie()]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users/approvals");
  await page.getByTestId("m-choose-view").click();
  const sheet = page.getByRole("dialog", { name: "Choose view" });
  await expect(sheet).toBeVisible();
  // Measured once the sheet has risen (its 220 ms entrance).
  await page.waitForTimeout(400);
  const grip = page.getByTestId("m-sheet-grip").locator("h2");
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (const step of [20, 60, 120]) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step);
  await page.mouse.up();
  await expect(sheet).toBeHidden();

  // The decision drawer (the shared Dialog as a bottom sheet).
  await page.goto(`/users/requests/${ids[1]}`);
  const bar = page.getByRole("region", { name: "Your decision" });
  await bar.getByRole("button", { name: "Return" }).click();
  const drawer = page.getByRole("dialog", { name: "Ask for changes" });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400);
  const handle = page.getByTestId("sheet-handle");
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (const step of [20, 60, 120]) await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + step);
  await page.mouse.up();
  await expect(drawer).toBeHidden();
});

test("page transitions: off with the switch (nothing changes), on with it (main fades in, focus on the new heading); v1.89.0: on by default", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  await page.setViewportSize({ width: 1440, height: 900 });
  const watch = async () =>
    page.evaluate(() => {
      const seen = window as unknown as { __vt: string[] };
      seen.__vt = [];
      new MutationObserver(() => {
        const value = document.documentElement.getAttribute("data-vt");
        if (value) seen.__vt.push(value);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-vt"] });
    });
  await setSwitch("OFF");
  await page.goto("/users/queue");
  await watch();
  await mark(page);
  await page.locator("nav a[href='/users/requests']").first().click();
  await expect(page).toHaveURL(/\/users\/requests$/);
  expect(await page.evaluate(() => (window as unknown as { __vt: string[] }).__vt)).toEqual([]);
  expect(await stillMarked(page)).toBe(true);

  await setSwitch("ON");
  try {
    await page.goto("/users/queue");
    await watch();
    await page.locator("nav a[href='/users/requests']").first().click();
    await expect(page).toHaveURL(/\/users\/requests$/);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.length)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-vt"))).toBe(false);
    // Reduce motion: no view transition at all.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/users/queue");
    await watch();
    await page.locator("nav a[href='/users/requests']").first().click();
    await expect(page).toHaveURL(/\/users\/requests$/);
    expect(await page.evaluate(() => (window as unknown as { __vt: string[] }).__vt)).toEqual([]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  } finally {
    await setSwitch(null);
  }
});

test("axe: the changed screens in light, dark and at phone width", async ({ page, context }) => {
  await as(context, "E2E_MGR");
  const screens = ["/users", "/users/queue", `/users/requests/${ids[1]}`, "/users/requests"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of screens) {
      await page.goto(path);
      expect(await axe(page), `${scheme} ${path}`).toEqual([]);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await context.addCookies([phoneLayoutCookie()]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/users", "/users/approvals", `/users/requests/${ids[1]}`]) {
    await page.goto(path);
    expect(await axe(page), `phone ${path}`).toEqual([]);
  }
});
