import { describe, expect, it } from "vitest";
import { allowedActions, type MeetingFacts, type MeetingStatus, type MeetingViewer } from "@/server/meetings/rules";

// v1.57.6 (D-346, owner): meeting state-machine gaps.
const meeting = (over: Partial<MeetingFacts> = {}): MeetingFacts => ({
  status: "SCHEDULED",
  ownerId: 1,
  coordinatorId: 2,
  createdBy: 2,
  pointsStatus: "DRAFT",
  pointsPolicy: "LAST_APPROVED",
  confidentiality: "GENERAL",
  ...over,
});
const viewer = (id: number, over: Partial<MeetingViewer> = {}): MeetingViewer => ({ id, isAdmin: false, isManagement: false, isParticipant: false, isDepartmentHod: false, ...over });

describe("v1.57.6 (D-346): points sent to the Owner are never stuck", () => {
  it("the Owner decides SUBMITTED points while the MOM is written or returned", () => {
    for (const status of ["SCHEDULED", "IN_PROGRESS", "AWAITING_MOM", "MOM_RETURNED"] as MeetingStatus[]) {
      expect(allowedActions(meeting({ status, pointsStatus: "SUBMITTED" }), viewer(1)).has("DECIDE_POINTS")).toBe(true);
      // Only the Owner, never the Coordinator, a participant or IT.
      expect(allowedActions(meeting({ status, pointsStatus: "SUBMITTED" }), viewer(2)).has("DECIDE_POINTS")).toBe(false);
      expect(allowedActions(meeting({ status, pointsStatus: "SUBMITTED" }), viewer(3, { isParticipant: true, isAdmin: true })).has("DECIDE_POINTS")).toBe(false);
    }
  });
  it("not once the MOM is with the Owner or later (approving the MOM settles them), and not unless SUBMITTED", () => {
    for (const status of ["MOM_SUBMITTED", "MOM_APPROVED", "CLOSED", "CANCELLED"] as MeetingStatus[])
      expect(allowedActions(meeting({ status, pointsStatus: "SUBMITTED" }), viewer(1)).has("DECIDE_POINTS")).toBe(false);
    for (const pointsStatus of ["DRAFT", "APPROVED", "RETURNED"] as const) expect(allowedActions(meeting({ status: "AWAITING_MOM", pointsStatus }), viewer(1)).has("DECIDE_POINTS")).toBe(false);
  });
  it("the Coordinator still can't edit or resend points after the MOM is entered", () => {
    expect(allowedActions(meeting({ status: "AWAITING_MOM", pointsStatus: "RETURNED" }), viewer(2)).has("EDIT_POINTS")).toBe(false);
    expect(allowedActions(meeting({ status: "MOM_RETURNED", pointsStatus: "DRAFT" }), viewer(2)).has("SUBMIT_POINTS")).toBe(false);
  });
});

describe("v1.57.6 (D-346): no START path; old IN_PROGRESS meetings still finish", () => {
  it("no status offers START (the action no longer exists)", () => {
    const statuses: MeetingStatus[] = ["SCHEDULED", "IN_PROGRESS", "AWAITING_MOM", "MOM_SUBMITTED", "MOM_RETURNED", "MOM_APPROVED", "CLOSED", "CANCELLED"];
    for (const status of statuses) for (const id of [1, 2]) expect([...allowedActions(meeting({ status }), viewer(id))]).not.toContain("START");
  });
  it("an IN_PROGRESS meeting can END and SUBMIT_MOM; END is offered nowhere else", () => {
    const running = allowedActions(meeting({ status: "IN_PROGRESS" }), viewer(2));
    expect(running.has("END")).toBe(true);
    expect(running.has("SUBMIT_MOM")).toBe(true);
    expect(allowedActions(meeting({ status: "SCHEDULED", pointsStatus: "APPROVED" }), viewer(2)).has("END")).toBe(false);
    expect(allowedActions(meeting({ status: "AWAITING_MOM" }), viewer(2)).has("END")).toBe(false);
  });
});
