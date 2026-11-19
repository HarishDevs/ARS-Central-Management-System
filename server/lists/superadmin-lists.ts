// v1.58.0 (D-354, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns in all tables ... all the changes like filters, group,
// sort can be saved as a view"): the Super Admin lists' column sorts (the SQL
// for server-paged lists, whitelisted per column), their Group by buckets and
// the address helper. Pure (used by repositories, pages and tests).
import { sqlDir, type ColumnSort } from "@/server/lists/sorting";
import { departmentBucket, indiaDayOf } from "@/server/lists/group-rows";

// ORDER BY for one whitelisted column: empty values last in both directions,
// then the tiebreak (newest first) so paging stays stable. Nothing from the
// address reaches the SQL: only the map's own expressions.
export function orderBySql<K extends string>(map: Record<K, string>, sort: ColumnSort<K>, fallback: string, tiebreak: string): string {
  if (!sort.sortBy || !(sort.sortBy in map)) return `ORDER BY ${fallback}`;
  const expr = map[sort.sortBy];
  return `ORDER BY (${expr}) IS NULL, ${expr} ${sqlDir(sort.dir)}, ${tiebreak}`;
}

// v1.58.0 (D-354): Audit log columns (When, Who, Action, On, Result, Details).
export const AUDIT_COLUMNS = ["when", "who", "action", "on", "result", "details"] as const;
export type AuditColumn = (typeof AUDIT_COLUMNS)[number];
export const AUDIT_ORDER: Record<AuditColumn, string> = {
  when: "a.occurred_at",
  who: "u.name",
  action: "a.action",
  on: "CONCAT(a.entity_type, ' ', COALESCE(a.entity_id, ''))",
  result: "a.result",
  details: "CAST(a.metadata_json AS CHAR)",
};

// v1.58.0 (D-354): Sign-in history columns (When, Who, How, Outcome, From).
export const LOGIN_COLUMNS = ["when", "who", "how", "outcome", "from"] as const;
export type LoginColumn = (typeof LOGIN_COLUMNS)[number];
export const LOGIN_ORDER: Record<LoginColumn, string> = {
  when: "l.occurred_at",
  who: "u.name",
  how: "l.auth_method",
  outcome: "l.success",
  from: "l.ip_address",
};

// v1.58.0 (D-354): Super Admin → Requests columns. Priority is read from each
// request's form, so it sorts the page on screen (not in SQL).
export const REQUEST_COLUMNS = ["request", "raised_by", "type", "status", "priority", "when", "reason"] as const;
export type RequestColumn = (typeof REQUEST_COLUMNS)[number];
export function requestOrder(deleted: boolean): Record<Exclude<RequestColumn, "priority">, string> {
  return {
    request: "r.request_no",
    raised_by: "u.name",
    type: "w.name",
    status: "r.status",
    when: deleted ? "r.deleted_at" : "r.submitted_at",
    reason: "r.delete_reason",
  };
}

// The address of a list with some parameters changed (null/"" removes one).
// `page` and `before` (paging) are always dropped unless set in `changes`.
export function listHref(path: string, query: Record<string, unknown>, changes: Record<string, string | number | null | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key in changes || key === "page" || key === "before" || value === undefined || value === null || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  for (const [key, value] of Object.entries(changes)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

// ---- Group by buckets ([label, order]: lower first, ties by label) ----

// A day group, newest first.
export const dayBucket = (at: Date): [string, number] => {
  const day = indiaDayOf(at);
  return [day, -Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)];
};

export const AUDIT_GROUPS = ["action", "actor", "entity", "day"] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];
export const AUDIT_GROUP_LABEL: Record<AuditGroup, string> = { action: "Action", actor: "Who", entity: "Record type", day: "Day" };
export function auditBucket(group: AuditGroup, entry: { actorName: string | null; action: string; entityType: string; occurredAt: Date }): [string, number] {
  if (group === "action") return [entry.action, 0];
  if (group === "actor") return entry.actorName ? [entry.actorName, 0] : ["System", 9];
  if (group === "entity") return [entry.entityType, 0];
  return dayBucket(entry.occurredAt);
}

export const LOGIN_GROUPS = ["person", "result", "method", "dept"] as const;
export type LoginGroup = (typeof LOGIN_GROUPS)[number];
export const LOGIN_GROUP_LABEL: Record<LoginGroup, string> = { person: "Person", result: "Outcome", method: "How", dept: "Department" };
export const LOGIN_METHOD_LABEL = { GOOGLE: "Google", PASSWORD_OTP: "Password + WhatsApp code" } as const;
export function loginBucket(group: LoginGroup, item: { userName: string | null; success: boolean; method: keyof typeof LOGIN_METHOD_LABEL; departmentName?: string | null }): [string, number] {
  if (group === "person") return item.userName ? [item.userName, 0] : ["Unknown User ID", 9];
  if (group === "result") return item.success ? ["Signed in", 0] : ["Failed", 1];
  if (group === "method") return [LOGIN_METHOD_LABEL[item.method] ?? item.method, 0];
  return departmentBucket(item.departmentName);
}

export const REQUEST_GROUPS = ["status", "type", "dept"] as const;
export type RequestGroup = (typeof REQUEST_GROUPS)[number];
export const REQUEST_GROUP_LABEL: Record<RequestGroup, string> = { status: "Status", type: "Approval type", dept: "Department" };
const REQUEST_STATUS_ORDER = ["IN_PROGRESS", "ON_HOLD", "CHANGES_REQUIRED", "APPROVED", "REJECTED", "CANCELLED"];
export function requestBucket(group: RequestGroup, item: { status: string; workflowName: string; departmentName: string | null }, statusLabel: (status: string) => string): [string, number] {
  if (group === "status") {
    const index = REQUEST_STATUS_ORDER.indexOf(item.status);
    return [statusLabel(item.status), index < 0 ? 99 : index];
  }
  if (group === "type") return [item.workflowName, 0];
  return departmentBucket(item.departmentName);
}

export const DELIVERY_COLUMNS = ["when", "event", "to", "channel", "provider", "status", "reason", "tries"] as const;
export type DeliveryColumn = (typeof DELIVERY_COLUMNS)[number];
export const DELIVERY_GROUPS = ["channel", "status", "provider", "event", "day"] as const;
export type DeliveryGroup = (typeof DELIVERY_GROUPS)[number];
export const DELIVERY_GROUP_LABEL: Record<DeliveryGroup, string> = { channel: "Channel", status: "Status", provider: "Provider", event: "Event", day: "Day" };
const DELIVERY_STATUS_ORDER = ["FAILED", "SKIPPED", "QUEUED", "SENT", "DELIVERED", "READ"];
export function deliveryBucket(group: DeliveryGroup, item: { channel: string; status: string; provider: string; eventType: string; createdAt: Date }): [string, number] {
  if (group === "channel") return [item.channel === "EMAIL" ? "Email" : "WhatsApp", 0];
  if (group === "status") {
    const index = DELIVERY_STATUS_ORDER.indexOf(item.status);
    return [item.channel === "EMAIL" && item.status === "SENT" ? "ACCEPTED" : item.status, index < 0 ? 99 : index];
  }
  if (group === "provider") return [item.provider, 0];
  if (group === "event") return [item.eventType, 0];
  return dayBucket(item.createdAt);
}

export const TEMPLATE_COLUMNS = ["message", "sent_to", "live", "status"] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];
export const TEMPLATE_GROUPS = ["status", "group"] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];
export const TEMPLATE_GROUP_LABEL: Record<TemplateGroup, string> = { status: "Status", group: "Message group" };
const TEMPLATE_STATUS_ORDER = ["Not created", "Draft, not sent", "Rejected by Meta", "Waiting for Meta", "Live", "Replaced"];
export function templateBucket(group: TemplateGroup, item: { statusLabel: string; group: string }): [string, number] {
  if (group === "group") return [item.group || "Other", item.group ? 0 : 9];
  const index = TEMPLATE_STATUS_ORDER.indexOf(item.statusLabel);
  return [item.statusLabel, index < 0 ? 50 : index];
}

export const AI_HISTORY_COLUMNS = ["person", "conversation", "chat", "messages", "last"] as const;
export type AiHistoryColumn = (typeof AI_HISTORY_COLUMNS)[number];
export const AI_HISTORY_GROUPS = ["person", "chat", "day"] as const;
export type AiHistoryGroup = (typeof AI_HISTORY_GROUPS)[number];
export const AI_HISTORY_GROUP_LABEL: Record<AiHistoryGroup, string> = { person: "Person", chat: "Chat", day: "Day (last activity)" };
export function aiHistoryBucket(group: AiHistoryGroup, item: { ownerName: string; chatLabel: string; updatedAt: Date }): [string, number] {
  if (group === "person") return [item.ownerName, 0];
  if (group === "chat") return [item.chatLabel, 0];
  return dayBucket(item.updatedAt);
}

// Automation → Recent runs (the page's list; the other tables only sort).
export const RUN_GROUPS = ["automation", "result", "how"] as const;
export type RunGroup = (typeof RUN_GROUPS)[number];
export const RUN_GROUP_LABEL: Record<RunGroup, string> = { automation: "Automation", result: "Result", how: "How" };
export function runBucket(group: RunGroup, item: { automationName: string; status: string; trigger: string }): [string, number] {
  if (group === "automation") return [item.automationName, 0];
  if (group === "result") return item.status === "FAILED" ? ["Failed", 0] : item.status === "OK" ? ["OK", 1] : ["Running", 2];
  return item.trigger === "MANUAL" ? ["Run now", 0] : ["Scheduled", 1];
}
