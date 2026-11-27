import { describe, expect, it } from "vitest";
import { describeEvent, eventKind } from "@/server/approvals/timeline";
import { messagesForEvents } from "@/server/approvals/messages";
import { daysUntilPurge } from "@/lib/db/repositories/superadmin-bin.repository";
import { parseOnBehalfId } from "@/server/superadmin/control/on-behalf";
import { checkReason, confirmWordFor } from "@/server/superadmin/control/service";
import { SUPERADMIN_NAV } from "@/server/panels/superadmin-nav";
import { tabsFor } from "@/server/requests/list-filters";
import { TICKET_EVENT_TEXT } from "@/features/tickets/event-text";

// v1.94.0 (D-451..D-458): the pure parts of Super Admin full control.
const names = (id: number) => ({ 1: "Raiser", 9: "Super", 7: "Approver" })[id] ?? `#${id}`;
const request = { id: 5, requestNo: "CUS-2026-000005", title: "Laptop", requesterId: 1, requesterName: "Raiser" };

describe("timeline words (D-457, D-458)", () => {
  it("say 'Changed by Super Admin' with the reason, and 'Created by Super Admin on behalf of'", () => {
    expect(describeEvent({ type: "SUPER_ADMIN_OVERRIDE", actorId: 9, action: "FORCE_STATUS", reason: "Board approved", summary: "set the status to Approved", notifyIds: [] }, (id) => id, names)).toBe(
      "Changed by Super Admin (Super): set the status to Approved. Reason: Board approved",
    );
    expect(describeEvent({ type: "CREATED_ON_BEHALF", actorId: 9, onBehalfOf: 1 }, (id) => id, names)).toBe("Created by Super Admin (Super) on behalf of Raiser");
    expect(eventKind({ type: "SUPER_ADMIN_OVERRIDE", actorId: 9, action: "REOPEN", reason: "x", summary: "y", notifyIds: [] })).toBe("admin");
    expect(TICKET_EVENT_TEXT.SUPER_ADMIN_OVERRIDE).toBe("Changed by Super Admin");
  });
});

describe("who is told (D-457)", () => {
  it("the requester and the people involved, never the Super Admin", () => {
    const out = messagesForEvents([{ type: "SUPER_ADMIN_OVERRIDE", actorId: 9, action: "CHANGE_APPROVER", reason: "On leave", summary: "changed the approver", notifyIds: [7, 9] }], request, { baseUrl: "https://app.test", adminIds: [] });
    expect(out.map((message) => message.userId).sort()).toEqual([1, 7]);
    expect(out[0]).toMatchObject({ title: "Changed by Super Admin", message: expect.stringContaining("Reason: On leave") });
    const behalf = messagesForEvents([{ type: "CREATED_ON_BEHALF", actorId: 9, onBehalfOf: 1 }], request, { baseUrl: "https://app.test", adminIds: [] });
    expect(behalf).toEqual([expect.objectContaining({ userId: 1, title: "Raised on your behalf" })]);
  });
});

describe("the bin and its checks (D-454, D-455)", () => {
  it("counts whole days until Delete permanently is allowed", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(daysUntilPurge({ purgeAfter: new Date("2026-12-27T10:00:00Z") }, now)).toBe(30);
    expect(daysUntilPurge({ purgeAfter: new Date("2026-11-27T11:00:00Z") }, now)).toBe(1);
    expect(daysUntilPurge({ purgeAfter: new Date("2026-11-27T09:59:59Z") }, now)).toBe(0);
  });
  it("asks for the item's number (or its title when it has none) and a 5-character reason", () => {
    expect(confirmWordFor({ entityNo: "TSK-2026-000001", title: "x" })).toBe("TSK-2026-000001");
    expect(confirmWordFor({ entityNo: null, title: " Old title " })).toBe("Old title");
    expect(checkReason("  ok ")).toMatchObject({ ok: false });
    expect(checkReason("Raised by mistake")).toEqual({ ok: true, reason: "Raised by mistake" });
    expect(checkReason("x".repeat(501))).toMatchObject({ ok: false });
  });
  it("reads the on-behalf person id strictly", () => {
    expect(parseOnBehalfId("42")).toBe(42);
    for (const bad of ["", "4a", "-1", " 4", null, 42]) expect(parseOnBehalfId(bad)).toBeNull();
  });
});

describe("the panel's places (D-451, D-456)", () => {
  it("Control panel and Deleted items are in the Super Admin menu; every request list has Archived", () => {
    expect(SUPERADMIN_NAV.filter((item) => item.section === "Control").map((item) => item.href)).toEqual(["/superadmin/control", "/superadmin/control/bin"]);
    for (const base of ["MINE", "COLLAB", "APPROVED_MINE", "APPROVED_BY_ME"] as const) expect(tabsFor(base).some((tab) => tab.key === "archived")).toBe(true);
  });
});
