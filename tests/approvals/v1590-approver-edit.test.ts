import { describe, expect, it } from "vitest";
import { applyLevelEdits, changedKeys, currentStageIndex, laterLevels } from "@/server/approvals/approver-edit";
import { compileBuilder, type BuilderSpec } from "@/server/workflows/builder";
import { describeEvent } from "@/server/approvals/timeline";
import { messagesForEvents } from "@/server/approvals/messages";

// v1.59.0 (D-357, owner: "approver can change the approval details"): the
// levels after the approver's own, and what the change tells people.
const step = (id: string, label: string, userIds: number[], type?: "WORK") => ({ kind: "STEP" as const, step: { id, label, approvers: { kind: "PEOPLE" as const, userIds }, rule: "ALL" as const, ...(type ? { type } : {}) } });
const spec: BuilderSpec = {
  stages: [
    step("l1", "Manager", [7]),
    step("l2", "HOD", [9]),
    { kind: "PARALLEL", id: "p3", label: "Finance and Stores", steps: [step("f", "Finance", [4]).step, step("s", "Stores", [5]).step], join: "ALL" },
    step("l4", "CFO", [6]),
    step("w5", "Purchase order", [8], "WORK"),
  ],
};
let seq = 0;
const newId = () => `n${++seq}`;

describe("the levels after the approver's own", () => {
  it("finds the approver's level by its step, also inside parallel steps", () => {
    expect(currentStageIndex(spec, "step_l2")).toBe(1);
    expect(currentStageIndex(spec, "step_s")).toBe(2);
    expect(currentStageIndex(spec, "nope")).toBe(-1);
    // the ids compileBuilder really gives
    const compiled = compileBuilder(spec);
    const ids = compiled.ok ? compiled.definition.nodes.map((node) => node.id) : [];
    expect(ids).toEqual(expect.arrayContaining(["step_l2", "par_p3_split", "par_p3_join", "step_f"]));
  });

  it("lists later levels; only single approval steps can be changed", () => {
    expect(laterLevels(spec, "step_l2")).toEqual([
      { key: "p3", label: "Finance and Stores", editable: false, userIds: [], pick: "Steps in parallel", rule: "ALL" },
      { key: "l4", label: "CFO", editable: true, userIds: [6], pick: "", rule: "ALL" },
      { key: "w5", label: "Purchase order", editable: false, userIds: [8], pick: "", rule: "ALL" },
    ]);
  });

  it("changes people, removes and adds levels; levels up to the approver's stay", () => {
    const result = applyLevelEdits(spec, "step_l2", [{ key: "p3" }, { key: "new", label: "Plant head", userIds: [3, 3], rule: "ANY_ONE" }, { key: "w5" }], newId);
    expect(result.ok && result.changed).toBe(true);
    if (!result.ok) return;
    expect(result.spec.stages.slice(0, 2)).toEqual(spec.stages.slice(0, 2));
    expect(result.spec.stages.map((stage) => (stage.kind === "STEP" ? stage.step.label : stage.label))).toEqual(["Manager", "HOD", "Finance and Stores", "Plant head", "Purchase order"]);
    expect(result.spec.stages[3]).toMatchObject({ kind: "STEP", step: { type: "APPROVE", approvers: { kind: "PEOPLE", userIds: [3] }, rule: "ANY_ONE" } });
    const people = applyLevelEdits(spec, "step_l2", [{ key: "p3" }, { key: "l4", userIds: [2] }, { key: "w5" }], newId);
    expect(people.ok && people.spec.stages[3]).toMatchObject({ step: { id: "l4", approvers: { kind: "PEOPLE", userIds: [2] } } });
    const same = applyLevelEdits(spec, "step_l2", [{ key: "p3" }, { key: "l4" }, { key: "w5" }], newId);
    expect(same.ok && same.changed).toBe(false);
  });

  it("refuses to remove or change a level it can't, or a stale one", () => {
    expect(applyLevelEdits(spec, "step_l2", [{ key: "l4" }, { key: "w5" }], newId)).toMatchObject({ ok: false, message: expect.stringContaining("can't be removed") });
    expect(applyLevelEdits(spec, "step_l2", [{ key: "p3", label: "x" }, { key: "l4" }, { key: "w5" }], newId)).toMatchObject({ ok: false, message: expect.stringContaining("can't be changed") });
    expect(applyLevelEdits(spec, "step_l2", [{ key: "l1" }], newId)).toMatchObject({ ok: false });
    expect(applyLevelEdits(spec, "step_l2", [{ key: "p3" }, { key: "l4", userIds: [] }, { key: "w5" }], newId)).toMatchObject({ ok: false });
    expect(applyLevelEdits(spec, "step_l2", [{ key: "p3" }, { key: "new", label: " ", userIds: [3], rule: "ALL" }, { key: "l4" }, { key: "w5" }], newId)).toMatchObject({ ok: false });
  });
});

describe("what changed, and who is told", () => {
  it("compares stored values; line items count as their field", () => {
    expect(changedKeys({ qty: 5, note: "a", items__lines: [{ q: 1 }], empty: "" }, { qty: 4, note: "a", items__lines: [{ q: 2 }] })).toEqual(["qty", "items"]);
  });

  it("the timeline and the messages say who changed what, and why", () => {
    const event = { type: "DETAILS_CHANGED" as const, nodeId: "step_l2", actorId: 9, reason: "Corrected the quantity", fieldKeys: ["qty"], fieldLabels: ["Quantity"], levelsChanged: true, round: 2, earlierApproverIds: [7] };
    expect(describeEvent(event, () => "HOD", (id) => `P${id}`)).toBe('P9 changed Quantity and changed the levels to come at "HOD" (round 2): Corrected the quantity');
    const messages = messagesForEvents([event], { id: 1, requestNo: "CUS-2026-000001", title: "Laptops", requesterId: 1, requesterName: "Ravi" }, { baseUrl: "https://x", adminIds: [], labelOf: () => "HOD" });
    expect(messages.map((message) => [message.userId, message.eventType])).toEqual([
      [1, "REQUEST_DETAILS_CHANGED"],
      [7, "REQUEST_DETAILS_CHANGED"],
    ]);
    expect(messages[0]!.message).toContain("Reason: Corrected the quantity");
  });
});
