import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";

// v1.57.6 (D-348, owner): background job state machines (risks 5 and 6).
// Needs migration 202611191200_job_state_recovery.sql.
//   risk 5: exports give up after 3 tries; a stale run can't finish a newer
//           claim; Google Calendar jobs finish only while RUNNING; one job run
//           at a time.
//   risk 6: runs stuck "in progress" after a crash are recovered (weekly HOD
//           report, scheduled reports, AI sync runs, outbox claims).

// A hook inside the report run, to act "while the export is being made".
const hooks = vi.hoisted(() => ({ midRun: null as null | (() => Promise<void>) }));
vi.mock("@/server/reports/run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/reports/run")>();
  return {
    ...actual,
    runReport: async (...args: Parameters<typeof actual.runReport>) => {
      if (hooks.midRun) await hooks.midRun();
      return actual.runReport(...args);
    },
  };
});

const { runExportJob, runExportJobs, recoverStuckExports } = await import("@/server/reports/background");
const { claimJob, failJob, finishJob } = await import("@/lib/db/repositories/gcal.repository");
const { acquireAutomationLock, runAutomations } = await import("@/server/ops/automation");
const { runHodWeekly, HOD_INTERRUPTED } = await import("@/server/reports/hod-weekly");
const { createSchedule, runDueSchedules, REPORT_RUN_INTERRUPTED } = await import("@/server/reports/schedules");
const { finishSyncRun, lastGoodCheckpoint, recoverStuckSyncRuns, startSyncRun } = await import("@/lib/db/repositories/ai.repository");
const { claimOutbox, insertOutbox, listStaleOutbox, markOutboxSent, releaseStaleOutboxClaims } = await import("@/lib/db/repositories/outbox.repository");
const { upsertSetting, clearSetting } = await import("@/lib/db/repositories/settings.repository");
const { createDepartment, createUser } = await import("./helpers");

const db = () => getDbPool();
let itAdmin: number;

beforeAll(async () => {
  itAdmin = await createUser({ name: "Job states admin", roles: ["USER", "IT_ADMIN"] });
});

afterAll(async () => {
  hooks.midRun = null;
  await getDbPool().end();
});

async function exportRow(id: number) {
  const [[row]] = await db().query<RowDataPacket[]>("SELECT status, attempts, message, file_name FROM export_jobs WHERE id = ?", [id]);
  return row!;
}

async function queueExport(userId: number): Promise<number> {
  const [result] = await db().query<ResultSetHeader>("INSERT INTO export_jobs (user_id, report_key, query_json, format) VALUES (?, 'request_register', ?, 'csv')", [userId, JSON.stringify({ scope: "ORGANISATION" })]);
  return result.insertId;
}

describe("background exports (risk 5)", () => {
  it("an export whose runs die 3 times ends FAILED, the requester is told, and it isn't queued again", async () => {
    const id = await queueExport(itAdmin);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // A runner claims it and dies (still RUNNING 40 minutes later).
      await db().query("UPDATE export_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 40 MINUTE) WHERE id = ? AND status = 'QUEUED'", [id]);
      await recoverStuckExports();
      expect(await exportRow(id)).toMatchObject({ status: attempt < 3 ? "QUEUED" : "FAILED", attempts: attempt });
    }
    expect(String((await exportRow(id)).message)).toMatch(/3 times/);
    const [notes] = await db().query<RowDataPacket[]>("SELECT title FROM notifications WHERE user_id = ? AND event_type = 'EXPORT_READY' ORDER BY id DESC LIMIT 1", [itAdmin]);
    expect(notes[0]?.title).toBe("Your export couldn't be made");
    await runExportJobs();
    expect(await runExportJob(id)).toBe("SKIPPED");
    expect(await exportRow(id)).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("an error is retried until the third try, then the export fails for good", async () => {
    const id = await queueExport(itAdmin);
    hooks.midRun = async () => {
      throw new Error("boom");
    };
    try {
      expect(await runExportJob(id)).toBe("RETRY");
      expect(await exportRow(id)).toMatchObject({ status: "QUEUED", attempts: 1 });
      expect(await runExportJob(id)).toBe("RETRY");
      expect(await runExportJob(id)).toBe("FAILED");
      expect(await exportRow(id)).toMatchObject({ status: "FAILED", attempts: 3 });
      expect(await runExportJob(id)).toBe("SKIPPED");
    } finally {
      hooks.midRun = null;
    }
  });

  it("a stale run's finish doesn't overwrite a newer claim", async () => {
    const id = await queueExport(itAdmin);
    // While try 1 is making the file, it is given up on and try 2 claims it.
    hooks.midRun = async () => {
      hooks.midRun = null;
      await db().query("UPDATE export_jobs SET status = 'QUEUED' WHERE id = ?", [id]);
      await db().query("UPDATE export_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'QUEUED'", [id]);
    };
    try {
      expect(await runExportJob(id)).toBe("SKIPPED");
    } finally {
      hooks.midRun = null;
    }
    // Try 2 still owns the job: no DONE, no file from try 1.
    expect(await exportRow(id)).toMatchObject({ status: "RUNNING", attempts: 2, file_name: null });
  });

  it("a stale run's failure doesn't overwrite a newer claim either", async () => {
    const id = await queueExport(itAdmin);
    // Try 1 is given up on and try 2 claims the job; then try 1 errors.
    hooks.midRun = async () => {
      hooks.midRun = null;
      await db().query("UPDATE export_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
      throw new Error("late failure");
    };
    try {
      expect(await runExportJob(id)).toBe("SKIPPED");
    } finally {
      hooks.midRun = null;
    }
    expect(await exportRow(id)).toMatchObject({ status: "RUNNING", attempts: 2, message: null });
  });
});

describe("Google Calendar jobs (risk 5)", () => {
  it("finishJob and failJob do nothing once the job is no longer RUNNING under that claim", async () => {
    const user = await createUser();
    const [connection] = await db().query<ResultSetHeader>("INSERT INTO gcal_connections (user_id) VALUES (?)", [user]);
    const [inserted] = await db().query<ResultSetHeader>("INSERT INTO gcal_jobs (connection_id, kind, reason) VALUES (?, 'SYNC', 'TEST')", [connection.insertId]);
    const job = await claimJob(inserted.insertId);
    expect(job).toMatchObject({ status: "RUNNING", attempts: 1 });
    // Recovered as INTERRUPTED meanwhile.
    await db().query("UPDATE gcal_jobs SET status = 'FAILED', error_category = 'INTERRUPTED' WHERE id = ?", [job!.id]);
    expect(await finishJob(job!.id, { created: 1 })).toBe(false);
    expect(await failJob(job!, { category: "INTERNAL", detail: "late", retryable: true, retryMax: 5, backoffSeconds: 60 })).toBe(false);
    const [[row]] = await db().query<RowDataPacket[]>("SELECT status, error_category, result_json FROM gcal_jobs WHERE id = ?", [job!.id]);
    expect(row).toMatchObject({ status: "FAILED", error_category: "INTERRUPTED", result_json: null });
    // A claim that is current still finishes.
    await db().query("UPDATE gcal_jobs SET status = 'PENDING' WHERE id = ?", [job!.id]);
    const again = await claimJob(job!.id);
    expect(await failJob(job!, { category: "INTERNAL", detail: "old claim", retryable: false, retryMax: 5, backoffSeconds: 60 })).toBe(false); // attempts 1 ≠ 2
    expect(await finishJob(again!.id, { created: 1 })).toBe(true);
  });
});

describe("one automation run at a time (risk 5)", () => {
  it("a second run is skipped while the lock is held, and runs once it is free", async () => {
    const lock = await acquireAutomationLock();
    expect(lock).not.toBeNull();
    try {
      expect(await acquireAutomationLock()).toBeNull();
      const skipped = await runAutomations({ runRef: `v1576-${Date.now()}`, trigger: "MANUAL", only: ["stuck"] });
      expect(skipped).toMatchObject({ steps: {}, failed: [], skipped: "already running" });
    } finally {
      await lock!.release();
    }
    const ran = await runAutomations({ runRef: `v1576-${Date.now()}`, trigger: "MANUAL", only: ["stuck"] });
    expect(ran.skipped).toBeUndefined();
    expect(ran.steps.stuck?.status).toBe("OK");
  });
});

describe("recovering runs stuck after a crash (risk 6)", () => {
  it("weekly HOD report: SENDING over an hour becomes FAILED and that week is sent again once", async () => {
    const hod = await createUser({ name: "HOD v1576" });
    const department = await createDepartment(hod);
    const monday = new Date("2026-11-16T04:30:00Z"); // Monday 10:00 India time
    await upsertSetting({ key: "general.hod_weekly_report", group: "GENERAL", valueType: "STRING", encrypted: false, storedValue: "ON", updatedBy: itAdmin });
    try {
      await db().query("INSERT INTO hod_report_runs (week_start, department_id, hod_user_id, status) VALUES ('2026-11-16', ?, ?, 'SENDING')", [department, hod]);
      await db().query("UPDATE hod_report_runs SET updated_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR) WHERE week_start = '2026-11-16' AND department_id = ?", [department]);
      const first = await runHodWeekly(monday);
      expect(Number(first.recovered)).toBeGreaterThanOrEqual(1);
      expect(Number(first.retried)).toBeGreaterThanOrEqual(1);
      const [[row]] = await db().query<RowDataPacket[]>("SELECT status, attempts, note FROM hod_report_runs WHERE week_start = '2026-11-16' AND department_id = ?", [department]);
      // Email isn't set up in tests, so the retry fails; it is the one retry.
      expect(row!.attempts).toBe(2);
      expect(["SENT", "FAILED"]).toContain(row!.status);
      expect(row!.note).not.toBe(HOD_INTERRUPTED);
      await runHodWeekly(monday);
      const [[after]] = await db().query<RowDataPacket[]>("SELECT attempts FROM hod_report_runs WHERE week_start = '2026-11-16' AND department_id = ?", [department]);
      expect(after!.attempts).toBe(2); // never a third time
    } finally {
      await clearSetting("general.hod_weekly_report", itAdmin);
    }
  });

  it("scheduled reports: RUNNING over an hour becomes FAILED and is sent again once on the next run", async () => {
    const [[previous]] = await db().query<RowDataPacket[]>("SELECT value FROM system_settings WHERE setting_key = 'features.scheduled_reports'");
    await db().query("INSERT INTO system_settings (setting_key, setting_group, value) VALUES ('features.scheduled_reports', 'FEATURES', 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    try {
      const schedule = await createSchedule({ userId: itAdmin, reportKey: "request_register", query: {}, format: "csv", frequency: "DAILY", weekday: null, monthDay: null, hourIst: 8 });
      const [run] = await db().query<ResultSetHeader>("INSERT INTO report_runs (schedule_id, due_at, started_at) VALUES (?, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR), DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR))", [schedule]);
      const first = await runDueSchedules();
      expect(Number(first.reportsRecovered)).toBeGreaterThanOrEqual(1);
      expect(Number(first.reportsRetried)).toBeGreaterThanOrEqual(1);
      const [[row]] = await db().query<RowDataPacket[]>("SELECT status, attempts, message FROM report_runs WHERE id = ?", [run.insertId]);
      expect(row!.attempts).toBe(2);
      expect(row!.status).not.toBe("RUNNING");
      expect(row!.message).not.toBe(REPORT_RUN_INTERRUPTED);
      await runDueSchedules();
      const [[after]] = await db().query<RowDataPacket[]>("SELECT attempts FROM report_runs WHERE id = ?", [run.insertId]);
      expect(after!.attempts).toBe(2);
      await db().query("UPDATE report_schedules SET active = FALSE WHERE id = ?", [schedule]);
    } finally {
      if (previous) await db().query("UPDATE system_settings SET value = ? WHERE setting_key = 'features.scheduled_reports'", [previous.value]);
      else await db().query("DELETE FROM system_settings WHERE setting_key = 'features.scheduled_reports'");
    }
  });

  it("AI sync: RUNNING over an hour becomes FAILED and a late finish can't move the checkpoint", async () => {
    const source = `t1576${Date.now().toString(36)}`.slice(0, 30);
    const good = await startSyncRun(source, "Account", null, null);
    expect(await finishSyncRun(good, { status: "SUCCEEDED", rowsFetched: 1, checkpointOut: "2026-11-01T00:00:00Z", error: null })).toBe(true);
    const stuck = await startSyncRun(source, "Account", "2026-11-01T00:00:00Z", null);
    await db().query("UPDATE ai_sync_runs SET started_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR) WHERE id = ?", [stuck]);
    expect(await recoverStuckSyncRuns()).toBeGreaterThanOrEqual(1);
    const [[row]] = await db().query<RowDataPacket[]>("SELECT status, checkpoint_out, error FROM ai_sync_runs WHERE id = ?", [stuck]);
    expect(row).toMatchObject({ status: "FAILED", checkpoint_out: null });
    expect(String(row!.error)).toMatch(/^INTERRUPTED/);
    expect(await finishSyncRun(stuck, { status: "SUCCEEDED", rowsFetched: 9, checkpointOut: "2026-11-19T00:00:00Z", error: null })).toBe(false);
    expect(await lastGoodCheckpoint(source, "Account")).toBe("2026-11-01T00:00:00Z");
  });

  it("outbox: a claim older than 15 minutes that was never sent is released; a fresh one is kept", async () => {
    const userId = await createUser();
    const [stale, fresh] = await insertOutbox(null, [
      { eventType: "QA_TEST", userId, title: "t", message: "stale", email: null, whatsappVariables: null },
      { eventType: "QA_TEST", userId, title: "t", message: "fresh", email: null, whatsappVariables: null },
    ], db());
    await db().query("UPDATE notification_outbox SET created_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 40 MINUTE) WHERE id IN (?)", [[stale, fresh]]);
    const staleClaim = await claimOutbox(stale!);
    const freshClaim = await claimOutbox(fresh!);
    await db().query("UPDATE notification_outbox SET claimed_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 20 MINUTE) WHERE id = ?", [stale]);
    await db().query("UPDATE notification_outbox SET claimed_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE) WHERE id = ?", [fresh]);
    expect(await releaseStaleOutboxClaims()).toBeGreaterThanOrEqual(1);
    const pending = await listStaleOutbox(500);
    expect(pending).toContain(stale);
    expect(pending).not.toContain(fresh);
    // The stopped sender's late "sent" with its old token doesn't apply after another sender took it.
    const newClaim = await claimOutbox(stale!);
    expect(newClaim).not.toBeNull();
    await markOutboxSent(stale!, staleClaim!.claimToken);
    const [[unsent]] = await db().query<RowDataPacket[]>("SELECT sent_at, claim_token FROM notification_outbox WHERE id = ?", [stale]);
    expect(unsent).toMatchObject({ sent_at: null, claim_token: newClaim!.claimToken });
    await markOutboxSent(stale!, newClaim!.claimToken);
    await markOutboxSent(fresh!, freshClaim!.claimToken);
    const [rows] = await db().query<RowDataPacket[]>("SELECT sent_at, claim_token FROM notification_outbox WHERE id IN (?)", [[stale, fresh]]);
    for (const row of rows) expect(row).toMatchObject({ claim_token: null });
    expect(rows.every((row) => row.sent_at !== null)).toBe(true);
  });
});
