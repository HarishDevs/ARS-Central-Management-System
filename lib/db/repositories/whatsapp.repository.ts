import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";

export interface ActiveTemplate {
  id: number;
  providerName: string;
  language: string;
  variableKeys: string[];
}

interface TemplateRow extends RowDataPacket {
  id: number;
  provider_name: string;
  language: string;
}

interface VariableRow extends RowDataPacket {
  variable_key: string;
}

// Only a template that is ACTIVE, APPROVED by Meta and has a provider name
// is ever sent (Power BI site rule). Returns null otherwise.
export async function findActiveTemplate(eventType: string, language = "en"): Promise<ActiveTemplate | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<TemplateRow[]>(
    `SELECT id, provider_name, language FROM whatsapp_templates
     WHERE event_type = ? AND language = ? AND status = 'ACTIVE' AND approval_status = 'APPROVED'
       AND provider_name IS NOT NULL
     ORDER BY version DESC LIMIT 1`,
    [eventType, language],
  );
  const row = rows[0];
  if (!row) return null;
  const [variables] = await pool.query<VariableRow[]>(
    "SELECT variable_key FROM whatsapp_template_variables WHERE template_id = ? ORDER BY position",
    [row.id],
  );
  return { id: row.id, providerName: row.provider_name, language: row.language, variableKeys: variables.map((v) => v.variable_key) };
}

interface CountRow extends RowDataPacket {
  recent: number;
}

// D-243: slots a minute kept back for sign-in codes, so a burst of bulk
// notifications can never make a code fail with "try again". A fifth of the
// limit (at least 1, none when the limit is 1). Sign-in codes may use every
// slot; everything else stops at the limit less the reserve.
export function whatsAppSlotsFor(limitPerMinute: number, priority: "OTP" | "BULK"): number {
  const limit = Math.max(0, Math.floor(limitPerMinute));
  if (priority === "OTP" || limit < 2) return limit;
  return limit - Math.max(1, Math.floor(limit / 5));
}

const RATE_LOCK = "ars_whatsapp_send_limit";

type LockConnection = Pick<PoolConnection, "query" | "release">;

// MySQL-backed sliding window: prune old rows, count, then record. D-243:
// the three statements run under a named lock, so concurrent senders (app
// processes and the cron runner) can't all pass the same count.
export async function tryConsumeWhatsAppRateLimit(
  limitPerMinute: number,
  priority: "OTP" | "BULK" = "BULK",
  connect: () => Promise<LockConnection> = () => getDbPool().getConnection(),
): Promise<boolean> {
  const allowed = whatsAppSlotsFor(limitPerMinute, priority);
  if (allowed <= 0) return false;
  const connection = await connect();
  try {
    const [lock] = await connection.query<(RowDataPacket & { got: number | null })[]>("SELECT GET_LOCK(?, 5) AS got", [RATE_LOCK]);
    if (Number(lock[0]?.got) !== 1) return false; // busy for 5 s: treated as the limit (retried)
    try {
      await connection.query<ResultSetHeader>(
        "DELETE FROM whatsapp_rate_limit_log WHERE occurred_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 60 SECOND)",
      );
      const [rows] = await connection.query<CountRow[]>("SELECT COUNT(*) AS recent FROM whatsapp_rate_limit_log");
      if (Number(rows[0]?.recent ?? 0) >= allowed) return false;
      await connection.query<ResultSetHeader>("INSERT INTO whatsapp_rate_limit_log () VALUES ()");
      return true;
    } finally {
      await connection.query("DO RELEASE_LOCK(?)", [RATE_LOCK]);
    }
  } finally {
    connection.release();
  }
}

// ---- template registry and creator (S6-04, S7, F-42b, D-076) -------------------------
// One row per version (English). A version is a draft until it's submitted;
// after that it's never edited again. The newest ACTIVE + APPROVED version
// is the one notify() sends (findActiveTemplate).
export interface TemplateVersion {
  id: number;
  code: string;
  eventType: string;
  version: number;
  providerName: string | null;
  category: string;
  body: string | null;
  footer: string | null;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  providerStatus: string | null;
  rejectionReason: string | null;
  submittedAt: Date | null;
  syncedAt: Date | null;
  updatedAt: Date;
  variableKeys: string[];
}

interface VersionRow extends RowDataPacket {
  id: number;
  template_code: string;
  event_type: string;
  version: number;
  provider_name: string | null;
  category: string;
  body_text: string | null;
  footer_text: string | null;
  status: TemplateVersion["status"];
  approval_status: TemplateVersion["approvalStatus"];
  provider_status: string | null;
  rejection_reason: string | null;
  submitted_at: Date | null;
  synced_at: Date | null;
  updated_at: Date;
  variable_keys: string | null;
}

const VERSION_SELECT = `SELECT t.id, t.template_code, t.event_type, t.version, t.provider_name, t.category, t.body_text, t.footer_text, t.status,
    t.approval_status, t.provider_status, t.rejection_reason, t.submitted_at, t.synced_at, t.updated_at,
    (SELECT GROUP_CONCAT(v.variable_key ORDER BY v.position SEPARATOR ',') FROM whatsapp_template_variables v WHERE v.template_id = t.id) AS variable_keys
  FROM whatsapp_templates t WHERE t.language = 'en'`;

const toVersion = (row: VersionRow): TemplateVersion => ({
  id: row.id,
  code: row.template_code,
  eventType: row.event_type,
  version: row.version,
  providerName: row.provider_name,
  category: row.category,
  body: row.body_text,
  footer: row.footer_text,
  status: row.status,
  approvalStatus: row.approval_status,
  providerStatus: row.provider_status,
  rejectionReason: row.rejection_reason,
  submittedAt: row.submitted_at,
  syncedAt: row.synced_at,
  updatedAt: row.updated_at,
  variableKeys: row.variable_keys ? row.variable_keys.split(",") : [],
});

export async function listTemplateVersions(db: Queryable = getDbPool()): Promise<TemplateVersion[]> {
  const [rows] = await db.query<VersionRow[]>(`${VERSION_SELECT} ORDER BY t.template_code, t.version`);
  return rows.map(toVersion);
}

export async function versionsFor(code: string, db: Queryable = getDbPool()): Promise<TemplateVersion[]> {
  const [rows] = await db.query<VersionRow[]>(`${VERSION_SELECT} AND t.template_code = ? ORDER BY t.version`, [code]);
  return rows.map(toVersion);
}

// Another row (any event) already using this CEOITBox name.
export async function nameTakenElsewhere(providerName: string, exceptId: number | null, db: Queryable = getDbPool()): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM whatsapp_templates WHERE provider_name = ? AND language = 'en' AND id <> ? LIMIT 1", [providerName, exceptId ?? 0]);
  return rows.length > 0;
}

// Insert a new draft version, or update the draft in place (only while it
// hasn't been submitted). The variables are rewritten in position order.
export async function saveTemplateDraft(
  input: {
    existingId: number | null;
    code: string;
    eventType: string;
    version: number;
    providerName: string;
    category: string;
    body: string;
    footer: string | null;
    variables: readonly { key: string; label: string }[];
  },
  actorId: number,
  db: Queryable,
): Promise<number> {
  let id = input.existingId;
  if (id === null) {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO whatsapp_templates (template_code, event_type, provider_name, language, category, body_text, footer_text, version, status, approval_status, provider_status, created_by, updated_by)
       VALUES (?, ?, ?, 'en', ?, ?, ?, ?, 'DRAFT', 'PENDING', 'NOT_SUBMITTED', ?, ?)`,
      [input.code, input.eventType, input.providerName, input.category, input.body, input.footer, input.version, actorId, actorId],
    );
    id = result.insertId;
  } else {
    await db.query<ResultSetHeader>(
      `UPDATE whatsapp_templates SET provider_name = ?, category = ?, body_text = ?, footer_text = ?, updated_by = ?
       WHERE id = ? AND submitted_at IS NULL`,
      [input.providerName, input.category, input.body, input.footer, actorId, id],
    );
  }
  await db.query<ResultSetHeader>("DELETE FROM whatsapp_template_variables WHERE template_id = ?", [id]);
  for (const [index, variable] of input.variables.entries()) {
    await db.query<ResultSetHeader>("INSERT INTO whatsapp_template_variables (template_id, position, variable_key, display_name) VALUES (?, ?, ?, ?)", [id, index + 1, variable.key, variable.label]);
  }
  return id;
}

export async function markTemplateSubmitted(id: number, actorId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>(
    "UPDATE whatsapp_templates SET provider_status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, submitted_by = ?, updated_by = ? WHERE id = ?",
    [actorId, actorId, id],
  );
}

// Meta's verdict from a sync. Approved: this version goes live and older
// live versions of the same event retire. Rejected or paused: it stops (or
// never starts) sending; an older approved version keeps working.
// v1.57.6 (D-349, owner): the verdict is now applied with every version of
// the template_code locked, and one rule settles all of them together:
// exactly one ACTIVE version per code, the newest that is APPROVED and not
// paused/rejected at Meta. See nextTemplateStates.
export type TemplateVerdict = { outcome: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED"; metaStatus: string; reason: string | null };

export interface VersionState {
  id: number;
  version: number;
  status: TemplateVersion["status"];
  approvalStatus: TemplateVersion["approvalStatus"];
  providerStatus: string | null;
}

// v1.57.6 (D-349, owner): Meta statuses that mean "not usable", so a row
// carrying one is never brought back as the fallback (covers rows paused
// before this fix, which still say APPROVED).
const BLOCKED_PROVIDER_STATUSES = new Set(["PAUSED", "DISABLED", "DELETED", "PENDING_DELETION", "REJECTED"]);

const usable = (row: VersionState) =>
  row.approvalStatus === "APPROVED" && !BLOCKED_PROVIDER_STATUSES.has((row.providerStatus ?? "").toUpperCase());

// v1.57.6 (D-349, owner): pure decision. Given every version of one
// template_code and Meta's verdict on one of them, returns the new
// status/approval of each row that changes (the verdict row first if it
// changes). Rules:
// - APPROVED: recorded APPROVED. It goes ACTIVE only if it is the newest
//   usable version; an older one approved late is RETIRED ("Replaced").
// - PAUSED (Meta PAUSED/DISABLED/DELETED): status DRAFT (sync keeps watching
//   it, so it comes back if Meta re-approves) and approval cleared to PENDING
//   (the enum has no PAUSED; provider_status keeps Meta's word).
// - REJECTED: status DRAFT, approval REJECTED.
// - PENDING: no status change.
// Then the newest usable version is ACTIVE and every other ACTIVE one is
// RETIRED, so pausing or rejecting the live version re-activates the
// previous approved one. With no usable version nothing else is touched.
export function nextTemplateStates(
  rows: readonly VersionState[],
  targetId: number,
  verdict: TemplateVerdict,
): { id: number; status: VersionState["status"]; approvalStatus: VersionState["approvalStatus"] }[] {
  const next = rows.map((row) => ({ ...row }));
  const target = next.find((row) => row.id === targetId);
  if (!target) return [];
  target.providerStatus = verdict.metaStatus;
  if (verdict.outcome === "APPROVED") {
    target.approvalStatus = "APPROVED";
  } else if (verdict.outcome === "REJECTED") {
    target.status = "DRAFT";
    target.approvalStatus = "REJECTED";
  } else if (verdict.outcome === "PAUSED") {
    target.status = "DRAFT";
    if (target.approvalStatus === "APPROVED") target.approvalStatus = "PENDING";
  }
  const live = next.filter(usable).sort((a, b) => b.version - a.version)[0];
  if (live) {
    for (const row of next) {
      if (row === live) row.status = "ACTIVE";
      else if (row.status === "ACTIVE") row.status = "RETIRED";
    }
    if (verdict.outcome === "APPROVED" && target !== live && target.status !== "RETIRED") target.status = "RETIRED";
  }
  const before = new Map(rows.map((row) => [row.id, row]));
  return next
    .filter((row) => row.status !== before.get(row.id)!.status || row.approvalStatus !== before.get(row.id)!.approvalStatus)
    .sort((a, b) => (a.id === targetId ? -1 : b.id === targetId ? 1 : a.version - b.version))
    .map((row) => ({ id: row.id, status: row.status, approvalStatus: row.approvalStatus }));
}

interface StateRow extends RowDataPacket {
  id: number;
  version: number;
  status: VersionState["status"];
  approval_status: VersionState["approvalStatus"];
  provider_status: string | null;
}

// `db` must be a transaction connection (callers use withTransaction) so the
// FOR UPDATE lock holds until commit.
export async function applyTemplateVerdict(
  row: Pick<TemplateVersion, "id" | "code" | "version">,
  verdict: TemplateVerdict,
  db: Queryable,
): Promise<void> {
  // v1.57.6 (D-349, owner): lock every version of this code first, so two
  // syncs can never leave two ACTIVE versions.
  const [locked] = await db.query<StateRow[]>(
    "SELECT id, version, status, approval_status, provider_status FROM whatsapp_templates WHERE template_code = ? AND language = 'en' ORDER BY version FOR UPDATE",
    [row.code],
  );
  const states: VersionState[] = locked.map((item) => ({
    id: item.id,
    version: item.version,
    status: item.status,
    approvalStatus: item.approval_status,
    providerStatus: item.provider_status,
  }));
  if (!states.some((item) => item.id === row.id)) return; // version gone: nothing to apply
  const changes = nextTemplateStates(states, row.id, verdict);
  const own = changes.find((change) => change.id === row.id);
  // Meta's words always land on the verdict row; a rejection reason only on
  // REJECTED/PAUSED, cleared on approval, untouched while pending.
  const reasonSql = verdict.outcome === "PENDING" ? "" : ", rejection_reason = ?";
  const reasonArgs = verdict.outcome === "PENDING" ? [] : [verdict.outcome === "APPROVED" ? null : verdict.reason];
  const stateSql = own ? ", status = ?, approval_status = ?" : "";
  const stateArgs = own ? [own.status, own.approvalStatus] : [];
  await db.query<ResultSetHeader>(
    `UPDATE whatsapp_templates SET provider_status = ?${reasonSql}${stateSql}, synced_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [verdict.metaStatus, ...reasonArgs, ...stateArgs, row.id],
  );
  for (const change of changes) {
    if (change.id === row.id) continue;
    await db.query<ResultSetHeader>("UPDATE whatsapp_templates SET status = ?, approval_status = ? WHERE id = ?", [change.status, change.approvalStatus, change.id]);
  }
}
