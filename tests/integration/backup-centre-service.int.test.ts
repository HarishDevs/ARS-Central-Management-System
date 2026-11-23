import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool } from "@/lib/db/client";
import { resetEnvCacheForTests } from "@/config/environment";
import { createUser } from "./helpers";

// D-408 (v1.81.0, BK-1): the centre's runs end to end against the test
// database: backup → check → restore (database only, in place) with the
// safety snapshot, migrations after, the maintenance notice, one restore at a
// time, typed confirmation, stopping a run, and the scheduled package.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ars-bk-svc-"));
const PASSPHRASE = "service level test passphrase";
type Service = typeof import("@/server/ops/backup-centre/service");
let service: Service;
let actor: { id: number; name: string };

beforeAll(async () => {
  process.env.BACKUP_DIR = path.join(work, "backups");
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  resetEnvCacheForTests();
  service = await import("@/server/ops/backup-centre/service");
  actor = { id: await createUser({ name: "Backup Tester", roles: ["SUPER_ADMIN"] }), name: "Backup Tester" };
  await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.backup_centre', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
});

afterAll(async () => {
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  resetEnvCacheForTests();
  await getDbPool().query("DELETE FROM system_settings WHERE setting_key IN ('features.backup_centre', 'backup.package_schedule')");
  await getDbPool().end();
  fs.rmSync(work, { recursive: true, force: true });
});

async function drive(id: number, passphrase: string | null = PASSPHRASE) {
  for (let steps = 0; steps < 400; steps += 1) {
    const view = await service.stepRun(id, { passphrase }, actor, 5_000);
    if (view.status !== "RUNNING") return view;
  }
  throw new Error("run did not finish");
}

describe("Backup centre service (D-408)", { timeout: 300_000 }, () => {
  let packageName: string;
  let verifyId: number;

  it("refuses a weak passphrase, then makes a database package", async () => {
    await expect(service.startBackup({ include: "database", keepOnServer: true, copyToDrive: false, passphrase: "short" }, actor)).rejects.toThrow(/at least 12/);
    const started = await service.startBackup({ include: "database", keepOnServer: true, copyToDrive: false, passphrase: PASSPHRASE }, actor);
    expect(started.token.length).toBeGreaterThan(20);
    const done = await drive(started.id);
    expect(done.status).toBe("DONE");
    packageName = done.packageName!;
    const listed = await service.centreSnapshot();
    expect(listed.packages.find((item) => item.name === packageName)?.keyKind).toBe("PASSPHRASE");
    expect(fs.existsSync(path.join(work, "backups", "packages", `${packageName}.sha256`))).toBe(true);
    const [[audit]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'BACKUP_PACKAGE_CREATED' AND entity_id = ?", [packageName]);
    expect(Number(audit!.n)).toBe(1);
  });

  it("checks the package (wrong passphrase first) without changing anything", async () => {
    await expect(service.startVerify({ name: packageName, passphrase: "a wrong passphrase here" }, actor)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const started = await service.startVerify({ name: packageName, passphrase: PASSPHRASE }, actor);
    const done = await drive(started.id);
    expect(done.status).toBe("DONE");
    expect((done.summary as { tables: unknown[] }).tables.length).toBeGreaterThan(25);
    verifyId = started.id;
  });

  it("needs the database's name typed, then restores in place with a safety snapshot and migrations", async () => {
    await expect(service.startRestore({ verifyRunId: verifyId, mode: "database", tables: [], confirm: "wrong_db", acceptWarnings: true }, actor)).rejects.toThrow(/database's name/);
    const marker = await createUser({ name: "Made after the backup" });
    const started = await service.startRestore({ verifyRunId: verifyId, mode: "database", tables: [], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor);
    // One restore at a time.
    await expect(service.startRestore({ verifyRunId: verifyId, mode: "database", tables: [], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor)).rejects.toMatchObject({ code: "BUSY" });
    const [[notice]] = await getDbPool().query<RowDataPacket[]>("SELECT value FROM system_settings WHERE setting_key = 'general.maintenance_notice'");
    expect(String(notice!.value)).toMatch(/being restored/);
    const done = await drive(started.id);
    expect(done.error).toBeNull();
    expect(done.status).toBe("DONE");
    expect((done.summary as { snapshot: string }).snapshot).toMatch(/^ars-safety-/);
    // The person made after the backup is gone; the backup's data is back.
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT id FROM users WHERE id = ?", [marker]);
    expect(rows).toEqual([]);
    const [[after]] = await getDbPool().query<RowDataPacket[]>("SELECT COALESCE(MAX(value), '') AS value FROM system_settings WHERE setting_key = 'general.maintenance_notice'");
    expect(String(after!.value)).not.toMatch(/being restored/);
    const [[sessions]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM user_sessions");
    expect(Number(sessions!.n)).toBe(0);
    const [[slot]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM backup_runs WHERE active_slot IS NOT NULL");
    expect(Number(slot!.n)).toBe(0);
    const [work] = await getDbPool().query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND (table_name LIKE '\\_rs\\_%' OR table_name LIKE '\\_old\\_%')");
    expect(work).toEqual([]);
  });

  it("stops a restore before anything changed, dropping the staged tables", async () => {
    const verify = await service.startVerify({ name: packageName, passphrase: PASSPHRASE }, actor);
    await drive(verify.id);
    const started = await service.startRestore({ verifyRunId: verify.id, mode: "database", tables: [], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor);
    // Drive it into the load phase.
    for (let steps = 0; steps < 200; steps += 1) {
      const view = await service.stepRun(started.id, { passphrase: PASSPHRASE }, actor, 200);
      if (view.phase === "load") break;
    }
    await service.stepRun(started.id, { passphrase: PASSPHRASE }, actor, 50);
    const stopped = await service.cancelRun(started.id, actor);
    expect(stopped.status).toBe("CANCELLED");
    const [work] = await getDbPool().query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '\\_rs\\_%'");
    expect(work).toEqual([]);
  });

  it("v1.85.1 (D-413): a sub-millisecond file time that the run's JSON column rounds still counts as the checked package", async () => {
    const file = path.join(work, "backups", "packages", packageName);
    // 17 significant digits in milliseconds: more than MySQL keeps for a JSON double.
    fs.utimesSync(file, 1795413084.9267817, 1795413084.9267817);
    const verify = await service.startVerify({ name: packageName, passphrase: PASSPHRASE }, actor);
    await drive(verify.id);
    const started = await service.startRestore({ verifyRunId: verify.id, mode: "database", tables: [], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor);
    expect((await service.cancelRun(started.id, actor)).status).toBe("CANCELLED");
    // A real change is still refused.
    fs.utimesSync(file, 1795413090, 1795413090);
    await expect(service.startRestore({ verifyRunId: verify.id, mode: "database", tables: [], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor)).rejects.toThrow(/changed or was removed/);
  });

  it("v1.85.1 (D-413): a database-only package has no server secrets to show", async () => {
    await expect(service.revealSecrets(packageName, PASSPHRASE, actor)).rejects.toThrow(/no server secrets/);
  });

  it("asks for the passphrase again when the key isn't held (after a restart)", async () => {
    const started = await service.startBackup({ include: "database", keepOnServer: true, copyToDrive: false, passphrase: PASSPHRASE }, actor);
    await service.stepRun(started.id, { passphrase: PASSPHRASE }, actor, 1);
    const keys = await import("@/server/ops/backup-centre/keys");
    keys.forgetKeys(started.id);
    await expect(service.stepRun(started.id, {}, actor, 1)).rejects.toMatchObject({ code: "PASSPHRASE_NEEDED" });
    const done = await drive(started.id);
    expect(done.status).toBe("DONE");
  });

  it("makes the scheduled package with the server key from the job runner", async () => {
    await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('backup.package_schedule', 'BACKUP', 'STRING', FALSE, 'DAILY') ON DUPLICATE KEY UPDATE value = 'DAILY'");
    let counts: Record<string, string | number> = {};
    for (let runs = 0; runs < 20 && counts.scheduled !== "DONE"; runs += 1) {
      counts = await service.runBackupCentreJob(60_000);
      // Treat the person's two-minute grace as over for the scheduled run.
      await getDbPool().query("UPDATE backup_runs SET updated_at = DATE_SUB(updated_at, INTERVAL 5 MINUTE) WHERE status = 'RUNNING'");
    }
    expect(counts.scheduled).toBe("DONE");
    const listed = await service.centreSnapshot();
    const scheduled = listed.packages.find((item) => item.kind === "scheduled");
    expect(scheduled?.keyKind).toBe("SERVER_KEY");
    // Not due again the same day.
    expect((await service.runBackupCentreJob(10_000)).scheduled).toBeUndefined();
  });
});
