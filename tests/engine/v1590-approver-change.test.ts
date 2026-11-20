import { describe, expect, it } from "vitest";
import { changeByApprover, decide, putOnHold, startInstance } from "@/server/engine/engine";
import { EngineError, type EngineEvent, type InstanceState, type WorkflowDefinition } from "@/server/engine/types";
import { approval, chain, ctx, makeDirectory, user } from "../helpers/engine-fixtures";

// v1.59.0 (D-357, owner: "approver can change the approval details"): the
// approver the request waits on changes its values and/or the levels to come.
const dir = makeDirectory();
const pending = (state: InstanceState, nodeId?: string) => state.tasks.filter((task) => task.status === "PENDING" && (!nodeId || task.nodeId === nodeId));
const ofType = <T extends EngineEvent["type"]>(events: readonly EngineEvent[], type: T) => events.filter((event): event is Extract<EngineEvent, { type: T }> => event.type === type);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof EngineError ? error.code : String(error);
  }
  return "no error";
};
const approve = (def: WorkflowDefinition, state: InstanceState, nodeId: string, form: Parameters<typeof ctx>[0] = {}) => {
  const task = pending(state, nodeId)[0]!;
  return decide(def, state, { taskId: task.id, actorId: task.approverId, decision: "APPROVE" }, ctx(form), dir).state;
};

describe("an approver changes the values", () => {
  const def = chain(approval("a", [user(7)]), approval("c", [user(9)]));

  it("their level starts again in a new round with the new values; earlier approvals stand; everyone is told", () => {
    const state = approve(def, startInstance(def, ctx({ qty: 5 }), dir).state, "a", { qty: 5 });
    const taskId = pending(state, "c")[0]!.id;
    const result = changeByApprover(def, state, { taskId, actorId: 9, reason: "Corrected the quantity", fieldKeys: ["qty"], fieldLabels: ["Quantity"], levelsChanged: false }, ctx({ qty: 4 }), dir, { previousFormData: { qty: 5 } });
    expect(result.state.status).toBe("IN_PROGRESS");
    expect(result.state.round).toBe(2);
    expect(result.state.nodes.a!.status).toBe("APPROVED");
    expect(pending(result.state, "c").map((task) => task.approverId)).toEqual([9]);
    expect(pending(result.state, "c")[0]!.id).not.toBe(taskId); // a fresh approval on the new values
    expect(ofType(result.events, "DETAILS_CHANGED")).toEqual([
      { type: "DETAILS_CHANGED", nodeId: "c", actorId: 9, reason: "Corrected the quantity", fieldKeys: ["qty"], fieldLabels: ["Quantity"], levelsChanged: false, round: 2, earlierApproverIds: [7] },
    ]);
    expect(ofType(result.events, "RESUBMITTED")).toHaveLength(0); // not the requester's resubmission
  });

  it("new values that change the route restart at the earliest affected level (DR-09)", () => {
    const band = { field: "amount", operator: "LT" as const, value: 1000 };
    const routed = chain(approval("a", [user(7)]), approval("b", [user(8)], { type: "ALL" }, { skipIf: band }), approval("c", [user(9)]));
    let state = startInstance(routed, ctx({ amount: 500 }), dir).state;
    state = approve(routed, state, "a", { amount: 500 });
    expect(state.nodes.b!.status).toBe("SKIPPED");
    const result = changeByApprover(routed, state, { taskId: pending(state, "c")[0]!.id, actorId: 9, reason: "Price went up", fieldKeys: ["amount"], levelsChanged: false }, ctx({ amount: 5000 }), dir, { previousFormData: { amount: 500 } });
    expect(result.state.nodes.a!.status).toBe("APPROVED");
    expect(pending(result.state, "b").map((task) => task.approverId)).toEqual([8]);
    expect(result.state.nodes.c!.status).toBe("WAITING");
    expect(ofType(result.events, "ROUTE_CHANGED")[0]).toMatchObject({ added: ["b"], restartNodeIds: ["b"] });
  });
});

describe("an approver changes the levels to come", () => {
  const def = chain(approval("a", [user(7)]), approval("c", [user(9)]));
  const longer = chain(approval("a", [user(7)]), approval("c", [user(9)]), approval("d", [user(5)]));

  it("levels only: nothing restarts; a new level is waited for and reached later", () => {
    const state = approve(def, startInstance(def, ctx(), dir).state, "a");
    const taskId = pending(state, "c")[0]!.id;
    const result = changeByApprover(longer, state, { taskId, actorId: 9, reason: "Finance must see it", fieldKeys: [], levelsChanged: true }, ctx(), dir);
    expect(result.state.round).toBe(1);
    expect(pending(result.state, "c")[0]!.id).toBe(taskId); // their approval still waits
    expect(result.state.nodes.d).toEqual({ status: "WAITING" });
    expect(ofType(result.events, "DETAILS_CHANGED")[0]).toMatchObject({ levelsChanged: true, fieldKeys: [], round: 1 });
    const next = decide(longer, result.state, { taskId, actorId: 9, decision: "APPROVE" }, ctx(), dir).state;
    expect(pending(next, "d").map((task) => task.approverId)).toEqual([5]);
  });

  it("a level that already ran can't be taken out", () => {
    const state = approve(longer, startInstance(longer, ctx(), dir).state, "a");
    const withoutA = chain(approval("c", [user(9)]), approval("d", [user(5)]));
    expect(code(() => changeByApprover(withoutA, state, { taskId: pending(state, "c")[0]!.id, actorId: 9, reason: "Remove a", fieldKeys: [], levelsChanged: true }, ctx(), dir))).toBe("INVALID_ACTION");
  });
});

describe("who and when", () => {
  const def = chain(approval("a", [user(7)]), approval("c", [user(9)]));
  const at = () => approve(def, startInstance(def, ctx(), dir).state, "a");

  it("only the approver it waits on (or their delegate), with a reason, while it is in progress", () => {
    const state = at();
    const taskId = pending(state, "c")[0]!.id;
    const input = { taskId, actorId: 9, reason: "Fix", fieldKeys: ["x"], levelsChanged: false };
    expect(code(() => changeByApprover(def, state, { ...input, actorId: 7 }, ctx(), dir))).toBe("NOT_AUTHORISED");
    expect(code(() => changeByApprover(def, state, { ...input, actorId: 1 }, ctx(), dir))).toBe("NOT_AUTHORISED");
    expect(code(() => changeByApprover(def, state, { ...input, reason: " x " }, ctx(), dir))).toBe("COMMENT_REQUIRED");
    expect(code(() => changeByApprover(def, state, { ...input, fieldKeys: [] }, ctx(), dir))).toBe("INVALID_ACTION");
    const held = putOnHold(state, { taskId, actorId: 9, reason: "Waiting for a quote" }, ctx(), dir).state;
    expect(code(() => changeByApprover(def, held, input, ctx(), dir))).toBe("NOT_IN_PROGRESS");
  });

  it("a delegate covering for the approver can change it, and it says for whom", () => {
    // In the fixture, 12 covers for 7.
    const covered = chain(approval("a", [user(7)]));
    const state = startInstance(covered, ctx(), dir).state;
    const result = changeByApprover(covered, state, { taskId: pending(state)[0]!.id, actorId: 12, reason: "Corrected", fieldKeys: ["x"], levelsChanged: false }, ctx({ x: 2 }), dir, { previousFormData: { x: 1 } });
    expect(ofType(result.events, "DETAILS_CHANGED")[0]).toMatchObject({ actorId: 12, onBehalfOf: 7 });
  });
});
