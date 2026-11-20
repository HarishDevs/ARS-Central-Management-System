import { describe, expect, it } from "vitest";
import { parseColumnSort } from "@/server/lists/sorting";
import { groupRows } from "@/server/lists/group-rows";
import {
  AUDIT_COLUMNS,
  AUDIT_ORDER,
  LOGIN_COLUMNS,
  LOGIN_ORDER,
  REQUEST_COLUMNS,
  auditBucket,
  dayBucket,
  deliveryBucket,
  listHref,
  loginBucket,
  orderBySql,
  requestBucket,
  requestOrder,
  runBucket,
  templateBucket,
} from "@/server/lists/superadmin-lists";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns ... group, sort can be saved as a view"): the Super Admin lists.
describe("orderBySql", () => {
  it("uses only whitelisted expressions, empty last, with the tiebreak", () => {
    expect(orderBySql(AUDIT_ORDER, { sortBy: "who", dir: "asc" }, "a.id DESC", "a.id DESC")).toBe("ORDER BY (u.name) IS NULL, u.name ASC, a.id DESC");
    expect(orderBySql(LOGIN_ORDER, { sortBy: "when", dir: "desc" }, "l.id DESC", "l.id DESC")).toBe("ORDER BY (l.occurred_at) IS NULL, l.occurred_at DESC, l.id DESC");
  });
  it("falls back to the default order when nothing (or something unknown) is chosen", () => {
    expect(orderBySql(AUDIT_ORDER, { sortBy: null, dir: "asc" }, "a.id DESC", "a.id DESC")).toBe("ORDER BY a.id DESC");
    expect(orderBySql(AUDIT_ORDER, { sortBy: "x; DROP TABLE users" as never, dir: "asc" }, "a.id DESC", "a.id DESC")).toBe("ORDER BY a.id DESC");
  });
  it("never lets the address reach the SQL", () => {
    const sort = parseColumnSort({ sortBy: "a.id; DELETE", dir: "desc" }, AUDIT_COLUMNS);
    expect(sort.sortBy).toBeNull();
    expect(orderBySql(AUDIT_ORDER, sort, "a.id DESC", "a.id DESC")).toBe("ORDER BY a.id DESC");
  });
  it("has an expression for every sortable column", () => {
    for (const column of AUDIT_COLUMNS) expect(AUDIT_ORDER[column]).toBeTruthy();
    for (const column of LOGIN_COLUMNS) expect(LOGIN_ORDER[column]).toBeTruthy();
    const order = requestOrder(false);
    for (const column of REQUEST_COLUMNS) expect(order[column]).toBeTruthy(); // v1.58.1: Priority sorts in SQL too
    expect(requestOrder(true).when).toBe("r.deleted_at");
    expect(requestOrder(false).when).toBe("r.submitted_at");
  });
});

describe("listHref", () => {
  it("keeps the other parameters, drops paging, removes empties", () => {
    expect(listHref("/superadmin/audit", { action: "LOGIN", before: "50", page: "2", group: "day" }, { group: null })).toBe("/superadmin/audit?action=LOGIN");
    expect(listHref("/superadmin/audit", { action: "LOGIN", sortBy: "who", dir: "asc" }, { page: 3 })).toBe("/superadmin/audit?action=LOGIN&sortBy=who&dir=asc&page=3");
    expect(listHref("/superadmin/logins", {}, {})).toBe("/superadmin/logins");
  });
});

describe("Super Admin group buckets", () => {
  const at = new Date("2026-11-18T20:00:00Z"); // 19 Nov in India
  it("days are India days, newest first", () => {
    expect(dayBucket(at)[0]).toBe("2026-11-19");
    const groups = groupRows([{ at: new Date("2026-11-10T06:00:00Z") }, { at }], (row) => dayBucket(row.at));
    expect(groups.map((group) => group.label)).toEqual(["2026-11-19", "2026-11-10"]);
  });
  it("audit: action, who (System last), record type, day", () => {
    const entry = { actorName: null, action: "LOGIN", entityType: "USER", occurredAt: at };
    expect(auditBucket("action", entry)).toEqual(["LOGIN", 0]);
    expect(auditBucket("actor", entry)).toEqual(["System", 9]);
    expect(auditBucket("entity", entry)).toEqual(["USER", 0]);
    expect(auditBucket("day", entry)[0]).toBe("2026-11-19");
  });
  it("sign-ins: person, outcome, method, department", () => {
    const item = { userName: null, success: false, method: "GOOGLE" as const, departmentName: null };
    expect(loginBucket("person", item)).toEqual(["Unknown User ID", 9]);
    expect(loginBucket("result", item)).toEqual(["Failed", 1]);
    expect(loginBucket("method", item)).toEqual(["Google", 0]);
    expect(loginBucket("dept", item)).toEqual(["No department", 9]);
    expect(loginBucket("dept", { ...item, departmentName: "IT" })).toEqual(["IT", 0]);
  });
  it("requests: status in workflow order, type, department", () => {
    const item = { status: "APPROVED", workflowName: "Purchase", departmentName: null };
    expect(requestBucket("status", item, (status) => status.toLowerCase())).toEqual(["approved", 3]);
    expect(requestBucket("type", item, String)).toEqual(["Purchase", 0]);
    expect(requestBucket("dept", item, String)).toEqual(["No department", 9]);
  });
  it("deliveries: an accepted email shows as ACCEPTED; failures first", () => {
    const item = { channel: "EMAIL", status: "SENT", provider: "SMTP", eventType: "LOGIN", createdAt: at };
    expect(deliveryBucket("status", item)).toEqual(["ACCEPTED", 3]);
    expect(deliveryBucket("status", { ...item, status: "FAILED" })).toEqual(["FAILED", 0]);
    expect(deliveryBucket("channel", item)).toEqual(["Email", 0]);
    expect(deliveryBucket("provider", item)).toEqual(["SMTP", 0]);
  });
  it("templates and automation runs", () => {
    expect(templateBucket("status", { statusLabel: "Not created", group: "x" })).toEqual(["Not created", 0]);
    expect(templateBucket("group", { statusLabel: "Live", group: "" })).toEqual(["Other", 9]);
    expect(runBucket("result", { automationName: "A", status: "FAILED", trigger: "CRON" })).toEqual(["Failed", 0]);
    expect(runBucket("how", { automationName: "A", status: "OK", trigger: "MANUAL" })).toEqual(["Run now", 0]);
  });
});
