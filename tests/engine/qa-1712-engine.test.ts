import { describe, expect, it } from "vitest";
import { changeByApprover, decide, putOnHold, askForInformation, reassignTask, recall, resolveBlocked, resubmit, resume, startInstance } from "@/server/engine/engine";
import { EngineError, type InstanceState, type WorkflowDefinition } from "@/server/engine/types";
import { approval, chain, ctx, decision, edge, end, makeDirectory, start, user } from "../helpers/engine-fixtures";

// v1.71.2 QA fixes (D-388, D-390).
//   1 Requester (HOD 3), 2 Manager, 3 HOD, 7 ED, 8 MD, 9 CFO, 12 may act for 7.
const dir = makeDirectory();
const pending = (state: InstanceState, nodeId?: string) => state.tasks.filter((task) => task.status === "PENDING" && task.round === state.round && (!nodeId || task.nodeId === nodeId));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof EngineError ? error.code : String(error);
  }
  return "OK";
};

describe("nobody acts on an approval of their own request (D-388, QA logic #1 and #5)", () => {
  // The ED (7) approves; 12 is the ED's out-of-office delegate and raises the request.
  const def = chain(approval("ed", [user(7)]));
  const asRequester = ctx({}, 12);
  const started = () => startInstance(def, asRequester, dir).state;

  it("a requester covering as the approver's delegate can't pass it on", () => {
    const state = started();
    const task = pending(state, "ed")[0]!;
    expect(code(() => reassignTask(state, { taskId: task.id, toUserId: 8, actorId: 12, reason: "busy", byApprover: true }, asRequester, dir))).toBe("INVALID_REASSIGN");
    // The ED themself still may.
    expect(code(() => reassignTask(state, { taskId: task.id, toUserId: 8, actorId: 7, reason: "busy", byApprover: true }, asRequester, dir))).toBe("OK");
  });

  it("nor put it on hold, ask a question on it, or resume it", () => {
    const state = started();
    const task = pending(state, "ed")[0]!;
    expect(code(() => putOnHold(state, { taskId: task.id, actorId: 12 }, asRequester, dir))).toBe("NOT_AUTHORISED");
    expect(code(() => askForInformation(state, { taskId: task.id, actorId: 12, question: "Q?" }, asRequester, dir))).toBe("NOT_AUTHORISED");
    const held = putOnHold(state, { taskId: task.id, actorId: 7 }, asRequester, dir).state;
    expect(code(() => resume(held, { actorId: 12, requesterId: 12 }, dir))).toBe("NOT_AUTHORISED");
    expect(code(() => resume(held, { actorId: 12, isAdmin: true, requesterId: 12 }, dir))).toBe("NOT_AUTHORISED");
    expect(resume(held, { actorId: 7, requesterId: 12 }, dir).state.status).toBe("IN_PROGRESS");
  });

  it("an IT person can't hand over (or bulk-move) their own request's approvals; another IT person can", () => {
    const state = startInstance(def, ctx({}, 1), dir).state;
    const task = pending(state, "ed")[0]!;
    expect(code(() => reassignTask(state, { taskId: task.id, toUserId: 8, actorId: 1 }, ctx({}, 1), dir))).toBe("INVALID_REASSIGN");
    expect(code(() => reassignTask(state, { taskId: task.id, toUserId: 8, actorId: 99 }, ctx({}, 1), dir))).toBe("OK");
  });

  it("an IT person can't choose who approves a blocked step of their own request (ASSIGN); RETRY stays open", () => {
    const blocked = chain(approval("x", [user(11)])); // 11 is inactive: the step blocks
    const state = startInstance(blocked, ctx({}, 1), dir).state;
    expect(code(() => resolveBlocked(blocked, state, { nodeId: "x", actorId: 1, reason: "assign", action: "ASSIGN", userIds: [8] }, ctx({}, 1), dir))).toBe("INVALID_ACTION");
    expect(code(() => resolveBlocked(blocked, state, { nodeId: "x", actorId: 1, reason: "again", action: "RETRY" }, ctx({}, 1), dir))).toBe("OK");
    expect(code(() => resolveBlocked(blocked, state, { nodeId: "x", actorId: 99, reason: "assign", action: "ASSIGN", userIds: [8] }, ctx({}, 1), dir))).toBe("OK");
  });
});

describe("a handover never gives a step to someone who already voted on it (D-390, QA logic #6)", () => {
  it("refused when the person decided another part of the step as a delegate", () => {
    // ALL of ED (7) and MD (8). 12 approves the ED's part as delegate.
    const def = chain(approval("both", [user(7), user(8)]));
    let state = startInstance(def, ctx(), dir).state;
    const edTask = pending(state, "both").find((task) => task.approverId === 7)!;
    state = decide(def, state, { taskId: edTask.id, actorId: 12, decision: "APPROVE" }, ctx(), dir).state;
    const mdTask = pending(state, "both")[0]!;
    expect(code(() => reassignTask(state, { taskId: mdTask.id, toUserId: 12, actorId: 99 }, ctx(), dir))).toBe("INVALID_REASSIGN");
    expect(code(() => reassignTask(state, { taskId: mdTask.id, toUserId: 9, actorId: 99 }, ctx(), dir))).toBe("OK");
  });
});

describe("the DR-02 human check survives changes, recall and a change of details (D-390, QA logic #2)", () => {
  // start → choice: amount > 1000 → CFO (9) → end; otherwise → end.
  const def: WorkflowDefinition = {
    nodes: [start(), decision("d"), approval("cfo", [user(9)]), end()],
    edges: [edge("start", "d"), edge("d", "cfo", { condition: { field: "amount", operator: "GT", value: 1000 }, order: 1 }), edge("d", "end", { isDefault: true }), edge("cfo", "end")],
  };
  const small = ctx({ amount: 500 });
  const routed = () => {
    const state = startInstance(def, small, dir).state;
    // The route skipped the CFO; the HOD (3) is asked on the CFO's step instead.
    expect(state.humanCheck?.nodeId).toBe("cfo");
    expect(pending(state).map((task) => task.approverId)).toEqual([3]);
    return state;
  };

  it("HOD asks for changes, the requester resubmits: back to the HOD, never the CFO", () => {
    const hodTask = pending(routed())[0]!;
    const asked = decide(def, routed(), { taskId: hodTask.id, actorId: 3, decision: "REQUEST_CHANGES", comment: "fix it" }, small, dir).state;
    expect(asked.changesRequested?.humanCheck).toEqual({ nodeId: "cfo", endNodeId: "end" });
    const again = resubmit(def, asked, "REQUESTING_STEP", small, dir).state;
    expect(pending(again).map((task) => task.approverId)).toEqual([3]);
    expect(again.humanCheck?.nodeId).toBe("cfo");
    const done = decide(def, again, { taskId: pending(again)[0]!.id, actorId: 3, decision: "APPROVE" }, small, dir).state;
    expect(done.status).toBe("APPROVED");
  });

  it("a recall then resubmit goes back to the HOD too", () => {
    const recalled = recall(def, routed(), { actorId: 1, reason: "typo" }, small, dir).state;
    const again = resubmit(def, recalled, "REQUESTING_STEP", small, dir).state;
    expect(pending(again).map((task) => task.approverId)).toEqual([3]);
  });

  it("new values that now take the CFO's branch go to the CFO (the route decides)", () => {
    const recalled = recall(def, routed(), { actorId: 1, reason: "bigger" }, small, dir).state;
    const big = ctx({ amount: 5000 });
    const again = resubmit(def, recalled, "REQUESTING_STEP", big, dir, { previousFormData: { amount: 500 } }).state;
    expect(pending(again).map((task) => task.approverId)).toEqual([9]);
    expect(again.humanCheck).toBeUndefined();
  });

  it("the HOD changing a value keeps the check with the HOD", () => {
    const state = routed();
    const hodTask = pending(state)[0]!;
    const changed = changeByApprover(def, state, { taskId: hodTask.id, actorId: 3, reason: "corrected", fieldKeys: ["note"], levelsChanged: false }, ctx({ amount: 500, note: "x" }), dir, { previousFormData: { amount: 500 } }).state;
    expect(pending(changed).map((task) => task.approverId)).toEqual([3]);
  });

  it("restart from the beginning re-runs the route (and the check) as before", () => {
    const hodTask = pending(routed())[0]!;
    const asked = decide(def, routed(), { taskId: hodTask.id, actorId: 3, decision: "REQUEST_CHANGES", comment: "fix it" }, small, dir).state;
    expect(pending(resubmit(def, asked, "BEGINNING", small, dir).state).map((task) => task.approverId)).toEqual([3]);
  });
});
