import { allSteps, type ApproverPick, type BuilderInnerStage, type BuilderSpec, type BuilderStage } from "@/server/workflows/builder";

// v1.59.0 (D-357, owner: "approver can change the approval details", "can be
// done from the table itself"): the approver a request is waiting on changes
// its values and the levels still to come. This file is the pure part: which
// levels come after the approver's own, and the new levels after their edits.
// The service (server/approvals/service.ts changeDetailsAsApprover) checks
// the people and runs the engine. Levels before and including the approver's
// own never change, so every step that already ran keeps its id.

export type LevelRule = "ALL" | "ANY_ONE";

// One level after the approver's own, as the editor shows it.
export interface LevelView {
  key: string; // the stage's id (a single step's step id)
  label: string;
  // A single approval step can be changed or removed; anything else (parallel
  // steps, a choice, a work or FYI step) stays as it is.
  editable: boolean;
  userIds: number[]; // specific people (empty when picked another way)
  pick: string; // how the approvers are found, in words, when not specific people
  rule: LevelRule;
}

// What the editor sends back for the levels after the approver's own, in order.
export type LevelEdit = { key: string; label?: string; userIds?: number[]; rule?: LevelRule } | { key: "new"; label: string; userIds: number[]; rule: LevelRule };

const PICK_WORDS: Record<ApproverPick["kind"], string> = {
  PEOPLE: "Specific people",
  ROLE: "A role",
  REQUESTER_MANAGER: "The requester's reporting manager",
  REQUESTER_MANAGERS_MANAGER: "The requester's manager's manager",
  REQUESTER_DEPARTMENT_HOD: "The requester's head of department",
  DEPARTMENT_HOD: "A department's head",
  GROUP: "An approver group",
  FORM_FIELD_USER: "The person named in the form",
  DESIGNATION: "A designation",
  REQUESTER: "The requester",
};

export const stageKey = (stage: BuilderStage): string => (stage.kind === "STEP" ? stage.step.id : stage.id);

// The engine node ids of one stage, as compileBuilder names them: a step is
// `step_<id>`, parallel steps add `par_<id>_split/_join`, a choice `choice_<id>`.
function stageNodeIds(stage: BuilderStage | BuilderInnerStage): string[] {
  if (stage.kind === "STEP") return [`step_${stage.step.id}`];
  if (stage.kind === "PARALLEL") return [`par_${stage.id}_split`, `par_${stage.id}_join`, ...stage.steps.map((step) => `step_${step.id}`)];
  if (stage.kind === "DOA") return allSteps({ stages: [stage] }).map((step) => `step_${step.id}`);
  return [`choice_${stage.id}`, ...[...stage.then, ...stage.otherwise].flatMap(stageNodeIds)];
}

// The index of the top-level stage the open step belongs to (-1: not found).
export function currentStageIndex(spec: BuilderSpec, nodeId: string): number {
  return spec.stages.findIndex((stage) => stageNodeIds(stage).includes(nodeId));
}

const isEditable = (stage: BuilderStage): boolean => stage.kind === "STEP" && (stage.step.type ?? "APPROVE") === "APPROVE";
const stageLabel = (stage: BuilderStage): string => (stage.kind === "STEP" ? stage.step.label : stage.label);

export function laterLevels(spec: BuilderSpec, nodeId: string): LevelView[] | null {
  const index = currentStageIndex(spec, nodeId);
  if (index < 0) return null;
  return spec.stages.slice(index + 1).map((stage) => {
    if (stage.kind === "STEP") {
      const step = stage.step;
      return {
        key: step.id,
        label: step.label,
        editable: isEditable(stage),
        userIds: step.approvers.kind === "PEOPLE" ? [...step.approvers.userIds] : [],
        pick: step.approvers.kind === "PEOPLE" ? "" : PICK_WORDS[step.approvers.kind],
        rule: step.rule === "ANY_ONE" ? "ANY_ONE" : "ALL",
      };
    }
    return { key: stage.id, label: stage.label, editable: false, userIds: [], pick: stage.kind === "PARALLEL" ? "Steps in parallel" : stage.kind === "DOA" ? "By amount (DoA)" : "A choice by the form's values", rule: "ALL" as const };
  });
}

// The spec after the edits, or the reason it can't be done. `newId` gives
// fresh step ids for added levels.
export function applyLevelEdits(spec: BuilderSpec, nodeId: string, edits: readonly LevelEdit[], newId: () => string): { ok: true; spec: BuilderSpec; changed: boolean } | { ok: false; message: string } {
  const index = currentStageIndex(spec, nodeId);
  if (index < 0) return { ok: false, message: "Your level couldn't be found on this request." };
  const before = spec.stages.slice(0, index + 1);
  const later = spec.stages.slice(index + 1);
  const byKey = new Map(later.map((stage) => [stageKey(stage), stage]));
  const used = new Set<string>();
  const next: BuilderStage[] = [];
  for (const edit of edits) {
    if (edit.key === "new") {
      const added = edit as Extract<LevelEdit, { key: "new" }>;
      const label = added.label.trim();
      if (!label) return { ok: false, message: "Give every new level a name." };
      if (added.userIds.length === 0) return { ok: false, message: `Pick at least one approver for "${label}".` };
      next.push({ kind: "STEP", step: { id: newId(), label: label.slice(0, 100), type: "APPROVE", approvers: { kind: "PEOPLE", userIds: [...new Set(added.userIds)] }, rule: added.rule === "ANY_ONE" ? "ANY_ONE" : "ALL" } });
      continue;
    }
    const stage = byKey.get(edit.key);
    if (!stage || used.has(edit.key)) return { ok: false, message: "A level to come has changed meanwhile. Reload and try again." };
    used.add(edit.key);
    const touched = edit.userIds !== undefined || edit.label !== undefined || edit.rule !== undefined;
    if (!touched) {
      next.push(stage);
      continue;
    }
    if (!isEditable(stage) || stage.kind !== "STEP") return { ok: false, message: `"${stageLabel(stage)}" can't be changed here.` };
    const label = (edit.label ?? stage.step.label).trim();
    if (!label) return { ok: false, message: "Every level needs a name." };
    const approvers: ApproverPick = edit.userIds !== undefined ? { kind: "PEOPLE", userIds: [...new Set(edit.userIds)] } : stage.step.approvers;
    if (approvers.kind === "PEOPLE" && approvers.userIds.length === 0) return { ok: false, message: `Pick at least one approver for "${label}".` };
    next.push({ kind: "STEP", step: { ...stage.step, label: label.slice(0, 100), approvers, rule: edit.rule ?? stage.step.rule } });
  }
  for (const [key, stage] of byKey) {
    if (!used.has(key) && !isEditable(stage)) return { ok: false, message: `"${stageLabel(stage)}" can't be removed here.` };
  }
  const result: BuilderSpec = { ...spec, stages: [...before, ...next] };
  return { ok: true, spec: result, changed: JSON.stringify(result.stages) !== JSON.stringify(spec.stages) };
}

// The people a level edit adds as approvers (to check against the rules).
export function addedApprovers(edits: readonly LevelEdit[]): number[] {
  return [...new Set(edits.flatMap((edit) => edit.userIds ?? []))];
}

// The form keys whose stored value changed (line items as a whole).
export function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  return [...keys].filter((key) => !(empty(before[key]) && empty(after[key])) && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)).map((key) => key.replace(/__lines$/, "")).filter((key, index, all) => all.indexOf(key) === index);
}
