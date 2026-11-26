import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ENV } from "../../playwright.config";
import { db, sessionCookie } from "./db";

// v1.81.0 (D-408, BK-1): Super Admin → Backup, restore & migrate. Make a
// database package with a passphrase, check it (a wrong passphrase first),
// restore one chosen table with the typed database name, download it, and
// make sure nobody else can see the page or its API. axe on each state.
test.describe.configure({ mode: "serial" });
const PASSPHRASE = "e2e backup passphrase 2026";

async function as(context: BrowserContext, loginId: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookie(loginId)]);
}
async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} [${(node.failureSummary ?? "").replace(/\s+/g, " ").trim()}${node.any.concat(node.all, node.none).flatMap((check) => check.relatedNodes ?? []).slice(0, 3).map((related) => ` ~ ${related.target.join(" ")}`).join("")}]`).join(" | ")}`); // v1.92.1 (TD-016): why, and what overlaps, so a CI-only failure can be read from the log
}

test("the centre is for the Super Admin only", async ({ page, context }) => {
  await as(context, "E2E_ADMIN");
  expect((await page.goto("/superadmin/data/backup"))?.status()).toBe(404);
  expect((await page.request.get("/api/superadmin/backup-centre/runs")).status()).toBe(404);
  await as(context, "E2E_REQ");
  expect((await page.request.post("/api/superadmin/backup-centre/runs", { data: { action: "backup", include: "database", keepOnServer: true, copyToDrive: false, passphrase: PASSPHRASE } })).status()).toBe(404);
});

test("Overview warns about GoDaddy's Import and links the centre", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.goto("/superadmin");
  await expect(page.getByRole("note", { name: /Database Manager Import/ })).toContainText("deletes every table");
  await page.getByRole("note", { name: /Database Manager Import/ }).getByRole("link", { name: "Backup, restore & migrate" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Backup, restore & migrate" })).toBeVisible();
});

test("make, check, restore a chosen table and download", async ({ page, context }) => {
  test.setTimeout(300_000);
  await as(context, "E2E_SUPER");
  await page.goto("/superadmin/data/backup");
  expect(await axe(page)).toEqual([]);

  // Make a database-only package.
  const make = page.getByRole("region", { name: "Make a backup" });
  await make.getByLabel("Database only").check();
  await make.getByLabel("Download it to this computer when it's ready").uncheck();
  await make.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await make.getByLabel("Type it again").fill("not the same");
  await expect(make.getByText("The two don't match.")).toBeVisible();
  await expect(make.getByRole("button", { name: "Make the backup" })).toBeDisabled();
  await make.getByLabel("Type it again").fill(PASSPHRASE);
  await make.getByRole("button", { name: "Make the backup" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Package ready" }).first()).toBeVisible({ timeout: 240_000 });

  const packages = page.getByRole("region", { name: "Packages on this server" });
  const row = packages.getByRole("row").filter({ hasText: /ars-database-\d{8}-\d{6}\.arsbak/ }).first();
  await expect(row).toBeVisible();
  const name = (await row.getByRole("cell").first().innerText()).trim().split("\n")[0]!;

  // Download (streamed, audited).
  const download = await page.request.get(`/api/superadmin/backup-centre/packages/${encodeURIComponent(name)}`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("application/octet-stream");
  expect((await download.body()).subarray(0, 6).toString()).toBe("ARSPK1");

  // Check: a wrong passphrase first.
  await row.getByRole("button", { name: `Check and restore ${name}` }).click();
  const restore = page.getByRole("region", { name: `Restore ${name}` });
  await restore.getByLabel("Passphrase of the package").fill("a wrong passphrase");
  await restore.getByRole("button", { name: "Check package" }).click();
  await expect(restore.getByText("Wrong passphrase.")).toBeVisible();
  await restore.getByLabel("Passphrase of the package").fill(PASSPHRASE);
  await restore.getByRole("button", { name: "Check package" }).click();
  await expect(restore.getByText(/tables, .* rows/)).toBeVisible({ timeout: 120_000 });
  expect(await axe(page)).toEqual([]);

  // Restore one chosen table; the database's name must be typed.
  await restore.getByLabel("Chosen tables").check();
  await restore.getByLabel("Filter tables").fill("work_tags");
  await restore.getByLabel(/^work_tags \(/).check();
  const restoreButton = restore.getByRole("button", { name: "Restore now" });
  await expect(restoreButton).toBeDisabled();
  await restore.getByLabel(/Type the database's name to confirm/).fill("wrong");
  await expect(restoreButton).toBeDisabled();
  await restore.getByLabel(/Type the database's name to confirm/).fill(E2E_ENV.DB_NAME);
  await restoreButton.click();
  await expect(page.getByRole("status").filter({ hasText: /Restored 1 tables/ }).first()).toBeVisible({ timeout: 240_000 });

  // A safety snapshot was made first, and the run is in Recent activity.
  const safety = packages.getByRole("row").filter({ hasText: /ars-safety-/ }).first();
  await expect(safety).toBeVisible();
  // The safety snapshot holds the server secrets: shown with the passphrase, masked until asked.
  await safety.getByRole("button", { name: /^Server secrets in / }).click();
  const secrets = page.getByRole("region", { name: /^Server secrets in ars-safety-/ });
  await secrets.getByLabel("Passphrase of the package").fill(PASSPHRASE);
  await secrets.getByRole("button", { name: "Show the server secrets" }).click();
  const keyRow = secrets.getByRole("row").filter({ hasText: "ENCRYPTION_KEY" }).first();
  await expect(keyRow).toContainText("Same");
  await expect(keyRow).toContainText("••••••••");
  expect(await axe(page)).toEqual([]);
  // v1.82.0 (D-409): the check after a restore.
  await page.getByRole("button", { name: "Check the system now" }).click();
  const live = page.getByRole("region", { name: "Check after the move", exact: true });
  await expect(live).toContainText("An active Super Admin", { timeout: 60_000 });
  await expect(live).toContainText("Rows:");
  const recent = page.getByRole("region", { name: "Recent activity" });
  await expect(recent.getByRole("row").filter({ hasText: "Restore" }).first()).toContainText("Done");
  // Audited, and the maintenance notice is gone again.
  const conn = await db();
  try {
    const [audit] = await conn.query<import("mysql2/promise").RowDataPacket[]>("SELECT action FROM audit_logs WHERE action IN ('BACKUP_PACKAGE_DOWNLOADED', 'BACKUP_RESTORED', 'BACKUP_RESTORE_STARTED') AND entity_id IN (?, ?)", [name, name.slice(0, 64)]);
    expect(new Set(audit.map((item) => item.action))).toEqual(new Set(["BACKUP_PACKAGE_DOWNLOADED", "BACKUP_RESTORE_STARTED", "BACKUP_RESTORED"]));
    const [[notice]] = await conn.query<import("mysql2/promise").RowDataPacket[]>("SELECT COALESCE(MAX(value), '') AS value FROM system_settings WHERE setting_key = 'general.maintenance_notice'");
    expect(String(notice!.value)).not.toMatch(/being restored/);
  } finally {
    await conn.end();
  }
});

test("moving: a one-time pairing code, shown once, refused when wrong, withdrawn (D-409)", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.goto("/superadmin/data/backup");
  const move = page.getByRole("region", { name: /Move to another server/ });
  await expect(move.getByRole("tab", { name: "Receive here" })).toHaveAttribute("aria-selected", "true");
  await move.getByRole("button", { name: "Make a pairing code" }).click();
  const shown = move.getByRole("status").filter({ hasText: "Pairing code (shown once)" });
  await expect(shown).toBeVisible();
  const code = (await shown.locator("strong").innerText()).trim();
  expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
  expect(await axe(page)).toEqual([]);
  // Another server with a wrong code is refused; no session needed for the machine route.
  await context.clearCookies();
  const wrong = await page.request.post("/api/backup-transfer/receive", { data: { fileName: "x.arsbak", size: 1000 }, headers: { "x-pairing-code": "0000-0000-0000-0000-0000" } });
  expect(wrong.status()).toBe(403);
  const right = await page.request.post("/api/backup-transfer/receive", { data: { fileName: "x.arsbak", size: 1000 }, headers: { "x-pairing-code": code } });
  expect(right.status()).toBe(200);
  const bad = await page.request.put(`/api/backup-transfer/receive/${(await right.json()).data.id}?offset=0`, { data: Buffer.from("not a package at all"), headers: { "x-pairing-code": code, "content-type": "application/octet-stream" } });
  expect(bad.status()).toBe(400);
  // Keyboard between the ways to move; the database form needs the name typed.
  await as(context, "E2E_SUPER");
  await page.reload();
  await move.getByRole("tab", { name: "Receive here" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(move.getByRole("tab", { name: "Database to database" })).toHaveAttribute("aria-selected", "true");
  await move.getByLabel("Host", { exact: true }).fill("db.example.test");
  await move.getByLabel("User", { exact: true }).fill("someone");
  await move.getByRole("textbox", { name: "Database", exact: true }).fill("target_db");
  await expect(move.getByRole("button", { name: "Copy the database there" })).toBeDisabled();
  await move.getByLabel(/Type the target database's name/).fill("target_db");
  await expect(move.getByRole("button", { name: "Copy the database there" })).toBeEnabled();
  expect(await axe(page)).toEqual([]);
  await move.getByRole("tab", { name: "Receive here" }).click();
  await move.getByRole("button", { name: "Withdraw" }).first().click();
});

test("the centre in dark mode and at phone width passes axe", async ({ page, context }) => {
  await as(context, "E2E_SUPER");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/superadmin/data/backup");
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Backup, restore & migrate" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("switched off, the page says so and the API is closed", async ({ page, context }) => {
  const conn = await db();
  try {
    await conn.query("UPDATE system_settings SET value = 'OFF' WHERE setting_key = 'features.backup_centre'");
    await as(context, "E2E_SUPER");
    await page.goto("/superadmin/data/backup");
    await expect(page.getByText("The centre is switched off.")).toBeVisible();
    expect((await page.request.get("/api/superadmin/backup-centre/runs")).status()).toBe(404);
  } finally {
    await conn.query("UPDATE system_settings SET value = 'ON' WHERE setting_key = 'features.backup_centre'");
    await conn.end();
  }
});
