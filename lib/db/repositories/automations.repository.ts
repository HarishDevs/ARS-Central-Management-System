import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { automationContext } from "@/lib/automation/context";
import { LISTENED_EVENTS, parseDefinition, RUN_LOG_KEEP, WEBHOOK_KEEP_DAYS, type AutomationEvent, type RuleDefinition } from "@/server/work/automation-rules";

// v1.68.0 (D-380, PM phase D part 2): project automations, the event outbox,
// the run log and webhook calls. Raw SQL; the services check who may do what.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const maybeNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const json = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const date = (value: unknown) => (value instanceof Date ? value : value ? new Date(String(value)) : null);

// ---- the outbox ------------------------------------------------------------------------------
// Written in the same transaction as the task change (so an event is never
// lost or invented by a rollback), and only for tasks in a project that has
// at least one published, switched-on rule. The engine evaluates it after the
// commit. Inside a running rule the event carries the chain.
export async function emitAutomationEvent(
  taskId: number,
  event: { type: string; from?: string | null; to?: string | null; payload?: Record<string, unknown> | null; actorId: number | null },
  db: Queryable,
): Promise<boolean> {
  if (!LISTENED_EVENTS.has(event.type)) return false;
  const context = automationContext();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO automation_events (task_id, event_type, from_status, to_status, payload_json, actor_id, depth, chain_json)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM DUAL
     WHERE EXISTS (SELECT 1 FROM task_projects tp JOIN project_automations a ON a.project_id = tp.project_id
                   WHERE tp.task_id = ? AND a.published_json IS NOT NULL AND a.enabled = TRUE)`,
    [taskId, event.type, event.from ?? null, event.to ?? null, event.payload ? JSON.stringify(event.payload) : null, event.actorId, context?.depth ?? 0, JSON.stringify(context?.chain ?? []), taskId],
  );
  return result.affectedRows === 1;
}

// Claim up to `limit` waiting events (oldest first). A claim older than 10
// minutes (a process that died) is taken again.
export async function claimEvents(limit: number, db: Queryable = getDbPool()): Promise<AutomationEvent[]> {
  const [rows] = await db.query<Row[]>(
    "SELECT id FROM automation_events WHERE status = 'PENDING' OR (status = 'CLAIMED' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)) ORDER BY id LIMIT ?",
    [limit],
  );
  const out: AutomationEvent[] = [];
  for (const row of rows) {
    const [claimed] = await db.query<ResultSetHeader>(
      "UPDATE automation_events SET status = 'CLAIMED', claimed_at = UTC_TIMESTAMP() WHERE id = ? AND (status = 'PENDING' OR (status = 'CLAIMED' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)))",
      [row.id],
    );
    if (claimed.affectedRows !== 1) continue;
    const [found] = await db.query<Row[]>("SELECT * FROM automation_events WHERE id = ?", [row.id]);
    const event = found[0];
    if (!event) continue;
    const chain = json(event.chain_json);
    out.push({
      id: num(event.id),
      taskId: num(event.task_id),
      type: String(event.event_type),
      fromStatus: str(event.from_status),
      toStatus: str(event.to_status),
      payload: (json(event.payload_json) as Record<string, unknown> | null) ?? null,
      actorId: maybeNum(event.actor_id),
      depth: num(event.depth),
      chain: Array.isArray(chain) ? chain.map(Number).filter(Number.isFinite) : [],
    });
  }
  return out;
}
export async function finishEvent(id: number, db: Queryable = getDbPool()): Promise<void> {
  await db.query("UPDATE automation_events SET status = 'DONE' WHERE id = ?", [id]);
}
export async function pendingEventCount(db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM automation_events WHERE status <> 'DONE'");
  return num(rows[0]?.n ?? 0);
}

// ---- rules -----------------------------------------------------------------------------------
export interface RuleRecord {
  id: number;
  projectId: number;
  name: string;
  ownerId: number;
  ownerName: string;
  ownerActive: boolean;
  draft: RuleDefinition;
  published: RuleDefinition | null;
  publishedVersion: number;
  publishedAt: Date | null;
  draftChanged: boolean;
  triggerType: string | null;
  enabled: boolean;
  pausedReason: string | null;
  webhookToken: string | null;
  webhookSecretEnc: string | null;
  scheduledOn: string | null;
  hourStart: Date | null;
  hourRuns: number;
  failing: boolean;
  lastRunAt: Date | null;
  lastResult: string | null;
  lastError: string | null;
  rowVersion: number;
  createdBy: number;
  createdAt: Date;
}
const RULE_SELECT = `SELECT a.*, u.name AS owner_name, (u.active = TRUE AND u.is_system = FALSE) AS owner_active, DATE_FORMAT(a.scheduled_on, '%Y-%m-%d') AS scheduled_day
  FROM project_automations a JOIN users u ON u.id = a.owner_id`;
function toRule(row: Row): RuleRecord {
  return {
    id: num(row.id),
    projectId: num(row.project_id),
    name: String(row.name),
    ownerId: num(row.owner_id),
    ownerName: String(row.owner_name ?? ""),
    ownerActive: Boolean(Number(row.owner_active)),
    draft: parseDefinition(json(row.draft_json)),
    published: row.published_json === null || row.published_json === undefined ? null : parseDefinition(json(row.published_json)),
    publishedVersion: num(row.published_version),
    publishedAt: date(row.published_at),
    draftChanged: Boolean(row.draft_changed),
    triggerType: str(row.trigger_type),
    enabled: Boolean(row.enabled),
    pausedReason: str(row.paused_reason),
    webhookToken: str(row.webhook_token),
    webhookSecretEnc: str(row.webhook_secret_enc),
    scheduledOn: str(row.scheduled_day),
    hourStart: date(row.hour_start),
    hourRuns: num(row.hour_runs),
    failing: Boolean(row.failing),
    lastRunAt: date(row.last_run_at),
    lastResult: str(row.last_result),
    lastError: str(row.last_error),
    rowVersion: num(row.row_version),
    createdBy: num(row.created_by),
    createdAt: date(row.created_at) ?? new Date(0),
  };
}
export async function findRule(id: number, db: Queryable = getDbPool(), lock = false): Promise<RuleRecord | null> {
  if (lock) await db.query("SELECT id FROM project_automations WHERE id = ? FOR UPDATE", [id]);
  const [rows] = await db.query<Row[]>(`${RULE_SELECT} WHERE a.id = ?`, [id]);
  return rows[0] ? toRule(rows[0]) : null;
}
export async function findRuleByWebhook(token: string, db: Queryable = getDbPool()): Promise<RuleRecord | null> {
  const [rows] = await db.query<Row[]>(`${RULE_SELECT} WHERE a.webhook_token = ?`, [token]);
  return rows[0] ? toRule(rows[0]) : null;
}
export async function listProjectRules(projectId: number, db: Queryable = getDbPool()): Promise<RuleRecord[]> {
  const [rows] = await db.query<Row[]>(`${RULE_SELECT} WHERE a.project_id = ? ORDER BY a.id`, [projectId]);
  return rows.map(toRule);
}
export async function countProjectRules(projectId: number, db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM project_automations WHERE project_id = ?", [projectId]);
  return num(rows[0]?.n ?? 0);
}
// Published, switched-on rules of these projects (oldest first: BR order "in creation order").
export async function liveRulesFor(projectIds: readonly number[], triggerTypes: readonly string[], db: Queryable = getDbPool()): Promise<RuleRecord[]> {
  if (!projectIds.length || !triggerTypes.length) return [];
  const [rows] = await db.query<Row[]>(`${RULE_SELECT} WHERE a.project_id IN (?) AND a.trigger_type IN (?) AND a.enabled = TRUE AND a.published_json IS NOT NULL ORDER BY a.id`, [projectIds, triggerTypes]);
  return rows.map(toRule);
}
export async function liveRulesOfType(triggerTypes: readonly string[], db: Queryable = getDbPool()): Promise<RuleRecord[]> {
  const [rows] = await db.query<Row[]>(
    `${RULE_SELECT} JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL AND p.archived_at IS NULL WHERE a.trigger_type IN (?) AND a.enabled = TRUE AND a.published_json IS NOT NULL AND a.paused_reason IS NULL ORDER BY a.id`,
    [triggerTypes],
  );
  return rows.map(toRule);
}

export async function insertRule(input: { projectId: number; name: string; ownerId: number; draft: RuleDefinition; createdBy: number }, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO project_automations (project_id, name, owner_id, draft_json, created_by) VALUES (?, ?, ?, ?, ?)", [
    input.projectId,
    input.name,
    input.ownerId,
    JSON.stringify(input.draft),
    input.createdBy,
  ]);
  return result.insertId;
}
export async function saveDraft(id: number, rowVersion: number, input: { name: string; draft: RuleDefinition }, by: number, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE project_automations SET name = ?, draft_json = ?, draft_changed = TRUE, row_version = row_version + 1, updated_by = ? WHERE id = ? AND row_version = ?",
    [input.name, JSON.stringify(input.draft), by, id, rowVersion],
  );
  return result.affectedRows === 1;
}
export async function publishRule(id: number, def: RuleDefinition, by: number, db: Queryable): Promise<void> {
  await db.query(
    "UPDATE project_automations SET published_json = ?, published_version = published_version + 1, published_at = UTC_TIMESTAMP(), trigger_type = ?, draft_changed = FALSE, row_version = row_version + 1, updated_by = ? WHERE id = ?",
    [JSON.stringify(def), def.trigger?.type ?? null, by, id],
  );
}
export async function discardDraft(id: number, by: number, db: Queryable): Promise<void> {
  await db.query("UPDATE project_automations SET draft_json = published_json, draft_changed = FALSE, row_version = row_version + 1, updated_by = ? WHERE id = ? AND published_json IS NOT NULL", [by, id]);
}
export async function setEnabled(id: number, enabled: boolean, by: number, db: Queryable): Promise<void> {
  await db.query("UPDATE project_automations SET enabled = ?, row_version = row_version + 1, updated_by = ? WHERE id = ?", [enabled, by, id]);
}
export async function setOwner(id: number, ownerId: number, by: number, db: Queryable): Promise<void> {
  await db.query("UPDATE project_automations SET owner_id = ?, paused_reason = NULL, row_version = row_version + 1, updated_by = ? WHERE id = ?", [ownerId, by, id]);
}
export async function setPaused(id: number, reason: string | null, db: Queryable = getDbPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(reason ? "UPDATE project_automations SET paused_reason = ? WHERE id = ? AND paused_reason IS NULL" : "UPDATE project_automations SET paused_reason = ? WHERE id = ?", [reason, id]);
  return result.affectedRows === 1;
}
export async function setWebhook(id: number, token: string | null, secretEnc: string | null, by: number, db: Queryable): Promise<void> {
  await db.query("UPDATE project_automations SET webhook_token = ?, webhook_secret_enc = ?, row_version = row_version + 1, updated_by = ? WHERE id = ?", [token, secretEnc, by, id]);
}
export async function deleteRule(id: number, db: Queryable): Promise<void> {
  await db.query("DELETE FROM automation_runs WHERE automation_id = ?", [id]);
  await db.query("DELETE FROM automation_webhook_deliveries WHERE automation_id = ?", [id]);
  await db.query("DELETE FROM project_automations WHERE id = ?", [id]);
}
// A Scheduled trigger runs once a day: claim the day.
export async function claimScheduledDay(id: number, day: string, db: Queryable = getDbPool()): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE project_automations SET scheduled_on = ? WHERE id = ? AND (scheduled_on IS NULL OR scheduled_on <> ?)", [day, id, day]);
  return result.affectedRows === 1;
}
// The per-rule hourly count: a new window, or one more in this one.
export async function countRunInWindow(id: number, reset: boolean, db: Queryable = getDbPool()): Promise<void> {
  await db.query(reset ? "UPDATE project_automations SET hour_start = UTC_TIMESTAMP(), hour_runs = 1 WHERE id = ?" : "UPDATE project_automations SET hour_runs = hour_runs + 1 WHERE id = ?", [id]);
}
export async function runsInLastHour(db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM automation_runs WHERE started_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) AND status <> 'SKIPPED'");
  return num(rows[0]?.n ?? 0);
}
// After a run: the list's "Last run" line and the failure latch. Returns
// whether the latch was clear before this failure (tell the owner once).
export async function recordOutcome(id: number, result: "SUCCEEDED" | "FAILED" | "SKIPPED", error: string | null, db: Queryable = getDbPool()): Promise<{ firstFailure: boolean }> {
  if (result === "SKIPPED") {
    await db.query("UPDATE project_automations SET last_run_at = UTC_TIMESTAMP(), last_result = 'SKIPPED', last_error = ? WHERE id = ?", [error?.slice(0, 500) ?? null, id]);
    return { firstFailure: false };
  }
  if (result === "SUCCEEDED") {
    await db.query("UPDATE project_automations SET last_run_at = UTC_TIMESTAMP(), last_result = 'SUCCEEDED', last_error = NULL, failing = FALSE WHERE id = ?", [id]);
    return { firstFailure: false };
  }
  const [latch] = await db.query<ResultSetHeader>("UPDATE project_automations SET failing = TRUE WHERE id = ? AND failing = FALSE", [id]);
  await db.query("UPDATE project_automations SET last_run_at = UTC_TIMESTAMP(), last_result = 'FAILED', last_error = ? WHERE id = ?", [error?.slice(0, 500) ?? null, id]);
  return { firstFailure: latch.affectedRows === 1 };
}

// ---- the run log -----------------------------------------------------------------------------
export interface StepOutcome {
  label: string;
  ok: boolean;
  message: string | null;
}
export interface RunRecord {
  id: number;
  version: number;
  triggerLabel: string;
  taskId: number | null;
  taskNo: string | null;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  steps: StepOutcome[];
  error: string | null;
  depth: number;
  startedAt: Date;
  finishedAt: Date | null;
}
// One run per rule and key; null when the key already ran (idempotency).
export async function startRun(input: { automationId: number; version: number; key: string; triggerLabel: string; taskId: number | null; taskNo: string | null; depth: number; status?: "RUNNING" | "SKIPPED"; error?: string | null }, db: Queryable = getDbPool()): Promise<number | null> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO automation_runs (automation_id, version, run_key, trigger_label, task_id, task_no, status, error, depth, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [input.automationId, input.version, input.key.slice(0, 120), input.triggerLabel.slice(0, 200), input.taskId, input.taskNo, input.status ?? "RUNNING", input.error?.slice(0, 500) ?? null, input.depth, input.status === "SKIPPED" ? new Date() : null],
  );
  return result.affectedRows === 1 ? result.insertId : null;
}
export async function findRunByKey(automationId: number, key: string, db: Queryable = getDbPool()): Promise<{ id: number; taskId: number | null; taskNo: string | null; status: string } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, task_id, task_no, status FROM automation_runs WHERE automation_id = ? AND run_key = ?", [automationId, key.slice(0, 120)]);
  const row = rows[0];
  return row ? { id: num(row.id), taskId: maybeNum(row.task_id), taskNo: str(row.task_no), status: String(row.status) } : null;
}
export async function finishRun(id: number, status: "SUCCEEDED" | "FAILED", steps: StepOutcome[], error: string | null, db: Queryable = getDbPool()): Promise<void> {
  await db.query("UPDATE automation_runs SET status = ?, steps_json = ?, error = ?, finished_at = UTC_TIMESTAMP(3) WHERE id = ?", [status, JSON.stringify(steps), error?.slice(0, 500) ?? null, id]);
}
export async function listRuns(automationId: number, limit = RUN_LOG_KEEP, db: Queryable = getDbPool()): Promise<RunRecord[]> {
  const [rows] = await db.query<Row[]>("SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT ?", [automationId, limit]);
  return rows.map((row) => {
    const steps = json(row.steps_json);
    return {
      id: num(row.id),
      version: num(row.version),
      triggerLabel: String(row.trigger_label),
      taskId: maybeNum(row.task_id),
      taskNo: str(row.task_no),
      status: String(row.status) as RunRecord["status"],
      steps: Array.isArray(steps) ? (steps as StepOutcome[]) : [],
      error: str(row.error),
      depth: num(row.depth),
      startedAt: date(row.started_at) ?? new Date(0),
      finishedAt: date(row.finished_at),
    };
  });
}

// ---- webhook calls ---------------------------------------------------------------------------
export async function recordDelivery(input: { automationId: number; status: "ACCEPTED" | "REFUSED" | "FAILED"; httpStatus: number; payload: unknown; taskId: number | null; error: string | null }, db: Queryable = getDbPool()): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO automation_webhook_deliveries (automation_id, status, http_status, payload_json, task_id, error) VALUES (?, ?, ?, ?, ?, ?)", [
    input.automationId,
    input.status,
    input.httpStatus,
    input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
    input.taskId,
    input.error?.slice(0, 255) ?? null,
  ]);
  return result.insertId;
}
export async function recentDeliveries(automationId: number, seconds: number, db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM automation_webhook_deliveries WHERE automation_id = ? AND received_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)", [automationId, seconds]);
  return num(rows[0]?.n ?? 0);
}
export async function listDeliveries(automationId: number, limit = 20, db: Queryable = getDbPool()): Promise<{ id: number; receivedAt: Date; status: string; httpStatus: number; taskId: number | null; error: string | null }[]> {
  const [rows] = await db.query<Row[]>("SELECT id, received_at, status, http_status, task_id, error FROM automation_webhook_deliveries WHERE automation_id = ? ORDER BY id DESC LIMIT ?", [automationId, limit]);
  return rows.map((row) => ({ id: num(row.id), receivedAt: date(row.received_at) ?? new Date(0), status: String(row.status), httpStatus: num(row.http_status), taskId: maybeNum(row.task_id), error: str(row.error) }));
}

// ---- housekeeping ----------------------------------------------------------------------------
// Run logs: the newest 200 of each rule stay; older runs go once 2 days old.
// Webhook calls (and their JSON bodies) go after 30 days. Handled events go after 7 days.
export async function purgeAutomationData(db: Queryable = getDbPool()): Promise<{ runsPruned: number; webhookCallsPruned: number; eventsPruned: number }> {
  const [rules] = await db.query<Row[]>("SELECT automation_id, COUNT(*) AS n FROM automation_runs GROUP BY automation_id HAVING n > ?", [RUN_LOG_KEEP]);
  let runsPruned = 0;
  for (const rule of rules) {
    const [cut] = await db.query<Row[]>("SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?", [rule.automation_id, RUN_LOG_KEEP - 1]);
    if (!cut[0]) continue;
    const [result] = await db.query<ResultSetHeader>("DELETE FROM automation_runs WHERE automation_id = ? AND id < ? AND started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY) LIMIT 5000", [rule.automation_id, cut[0].id]);
    runsPruned += result.affectedRows;
  }
  const [hooks] = await db.query<ResultSetHeader>(`DELETE FROM automation_webhook_deliveries WHERE received_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${WEBHOOK_KEEP_DAYS} DAY) LIMIT 5000`);
  const [events] = await db.query<ResultSetHeader>("DELETE FROM automation_events WHERE status = 'DONE' AND created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY) LIMIT 5000");
  return { runsPruned, webhookCallsPruned: hooks.affectedRows, eventsPruned: events.affectedRows };
}
