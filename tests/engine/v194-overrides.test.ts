import { describe, expect, it } from "vitest";
import { decide, overrideAddApprover, overrideForceStatus, overrideReopen, overrideSkipStep, startInstance } from "@/server/engine/engine";
import { EngineError, type InstanceState } from "@/server/engine/types";
import { approval, chain, ctx, makeDirectory, user } from "../helpers/engine-fixtures";

// v1.94.0 (D-457): Super Admin's logged overrides on the node-graph engine.
// Pure: the same state in, a new state and events out; decisions already
// made stay on record; nobody overrides their own request or approves it.
const directory = makeDirectory();
const SA = 99;
const definition = chain(approval("first", [user(7)]), approval("second", [user(8)]));
const pending = (state: InstanceState, nodeId: string) => state.tasks.filter((task) => task.nodeId === nodeId && task.status === "PENDING");

describe("Super Admin overrides (D-457)", () => {
  it("skips a waiting step: its approvals close as not needed and the next step opens", () => {
    const { state } = startInstance(definition, ctx(), directory);
    const result = overrideSkipStep(definition, state, { nodeId: "first", actorId: SA }, ctx(), directory);
    expect(result.state.nodes.first!.status).toBe("SKIPPED");
    expect(result.state.tasks.find((task) => task.nodeId === "first")!.status).toBe("NOT_REQUIRED");
    expect(pending(result.state, "second").map((task) => task.approverId)).toEqual([8]);
    expect(state.nodes.first!.status).toBe("ACTIVE"); // the input state is untouched
  });

  it("adds an approver to a waiting all-of step, who must then approve too", () => {
    const { state } = startInstance(definition, ctx(), directory);
    let next = overrideAddApprover(definition, state, { nodeId: "first", userId: 9, actorId: SA }, ctx(), directory).state;
    expect(pending(next, "first").map((task) => task.approverId)).toEqual([7, 9]);
    next = decide(definition, next, { taskId: pending(next, "first")[0]!.id, actorId: 7, decision: "APPROVE" }, ctx(), directory).state;
    expect(next.nodes.first!.status).toBe("ACTIVE");
    expect(() => overrideAddApprover(definition, state, { nodeId: "first", userId: 1, actorId: SA }, ctx(), directory)).toThrow(EngineError); // the requester
    expect(() => overrideAddApprover(definition, state, { nodeId: "first", userId: 7, actorId: SA }, ctx(), directory)).toThrow(/already/);
    expect(() => overrideAddApprover(definition, state, { nodeId: "second", userId: 9, actorId: SA }, ctx(), directory)).toThrow(/waiting now/);
  });

  it("forces Approved or Rejected, keeping every decision already made", () => {
    let { state } = startInstance(definition, ctx(), directory);
    state = decide(definition, state, { taskId: pending(state, "first")[0]!.id, actorId: 7, decision: "APPROVE" }, ctx(), directory).state;
    const approved = overrideForceStatus(definition, state, { status: "APPROVED", actorId: SA, reason: "Board approved" }, ctx(), directory);
    expect(approved.state.status).toBe("APPROVED");
    expect(approved.state.tasks.find((task) => task.nodeId === "first")!.status).toBe("APPROVED");
    expect(approved.state.tasks.find((task) => task.nodeId === "second")!.status).toBe("NOT_REQUIRED");
    expect(approved.events.map((event) => event.type)).toContain("INSTANCE_APPROVED");
    const rejected = overrideForceStatus(definition, state, { status: "REJECTED", actorId: SA, reason: "No budget" }, ctx(), directory);
    expect(rejected.state.status).toBe("REJECTED");
    expect(rejected.events).toContainEqual(expect.objectContaining({ type: "INSTANCE_REJECTED", actorId: SA, comment: "No budget" }));
    const cancelled = overrideForceStatus(definition, state, { status: "CANCELLED", actorId: SA, reason: "Not needed" }, ctx(), directory);
    expect(cancelled.state.status).toBe("CANCELLED");
    expect(() => overrideForceStatus(definition, approved.state, { status: "REJECTED", actorId: SA, reason: "Again" }, ctx(), directory)).toThrow(/Reopen/);
  });

  it("reopens a finished request in a new round from the first step; old tasks stay", () => {
    let { state } = startInstance(definition, ctx(), directory);
    state = overrideForceStatus(definition, state, { status: "REJECTED", actorId: SA, reason: "No budget" }, ctx(), directory).state;
    const reopened = overrideReopen(definition, state, { actorId: SA, reason: "Budget found" }, ctx(), directory);
    expect(reopened.state.status).toBe("IN_PROGRESS");
    expect(reopened.state.round).toBe(state.round + 1);
    expect(reopened.state.tasks.length).toBeGreaterThan(state.tasks.length);
    expect(pending(reopened.state, "first").map((task) => task.approverId)).toEqual([7]);
    expect(() => overrideReopen(definition, reopened.state, { actorId: SA, reason: "x" }, ctx(), directory)).toThrow(/finished/);
  });

  it("never on the actor's own request", () => {
    const { state } = startInstance(definition, ctx(), directory);
    const own = ctx({}, SA);
    expect(() => overrideSkipStep(definition, state, { nodeId: "first", actorId: SA }, own, directory)).toThrow(/yourself/);
    expect(() => overrideForceStatus(definition, state, { status: "APPROVED", actorId: SA, reason: "Mine" }, own, directory)).toThrow(/yourself/);
    expect(() => overrideReopen(definition, state, { actorId: SA, reason: "Mine" }, own, directory)).toThrow(/yourself/);
  });
});
