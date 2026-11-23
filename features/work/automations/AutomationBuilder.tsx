"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, CircleAlert, GitBranch, Plus, Trash2, UserCheck, Zap } from "lucide-react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import {
  becomeAutomationOwnerAction,
  discardAutomationDraftAction,
  newAutomationSecretAction,
  publishAutomationAction,
  saveAutomationAction,
  setAutomationEnabledAction,
} from "@/app/users/work/automation-actions";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { PRIORITY_LABEL, TASK_PRIORITIES } from "@/server/modules/settings";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import {
  allSteps,
  BUILT_IN_FIELD_LABEL,
  BUILT_IN_FIELDS,
  checkRule,
  COMPLETION_LABEL,
  COMPLETION_VALUES,
  conditionField,
  DUE_STATUS_LABEL,
  DUE_STATUSES,
  fieldIdOf,
  fieldKey,
  MAX_CONDITIONS,
  MAX_PATHS,
  NOTIFY_TARGET_LABEL,
  NOTIFY_TARGETS,
  OP_LABEL,
  opNeedsValue,
  opsFor,
  RULE_NAME_MAX,
  STATUS_TRIGGER,
  STATUS_TRIGGER_LABEL,
  STEP_GROUPS,
  STEP_LABEL,
  SUBJECT_LABEL,
  SUBJECTS,
  TRIGGER_GROUPS,
  TRIGGER_LABEL,
  writableField,
  type Condition,
  type FieldInfo,
  type Path,
  type RuleDefinition,
  type RuleProblem,
  type Step,
  type StepType,
  type Subject,
  type Trigger,
  type TriggerType,
} from "@/server/work/automation-rules";

// v1.68.0 (D-380, spec PROJECTS_CUSTOMIZATION §2.3): the automation builder,
// laid out as a vertical flow: the trigger card, the step cards, optional
// Paths (each with its conditions and steps) and Otherwise. Every card is
// added, moved and removed with buttons (no drag), every control is a
// labelled native control, and problems show on their card ("Requires
// setup"); Publish stays off until there are none. Saving keeps a draft; the
// published version keeps running until the draft is published.
export interface BuilderProps {
  ruleId: number;
  projectId: number;
  initial: { name: string; draft: RuleDefinition; rowVersion: number };
  published: boolean;
  version: number;
  draftChanged: boolean;
  enabled: boolean;
  paused: string | null;
  build: boolean;
  owner: { name: string; isMe: boolean; canRun: boolean };
  sections: { id: number; name: string }[];
  fields: FieldInfo[];
  forms: { id: number; name: string }[];
  projects: { id: number; name: string; sections: { id: number; name: string }[] }[];
  people: { id: number; label: string }[];
  webhookUrl: string | null;
  maxSteps: number;
}

let counter = 0;
const newKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}`.slice(0, 24);
const PRIORITY_OPTIONS = TASK_PRIORITIES.map((code) => ({ value: code, label: PRIORITY_LABEL[code] }));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const num = (value: string) => (value === "" ? null : Number(value));

export function AutomationBuilder(props: BuilderProps) {
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(props.initial.name);
  const [def, setDef] = useState<RuleDefinition>(props.initial.draft);
  const [rowVersion, setRowVersion] = useState(props.initial.rowVersion);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unpublished, setUnpublished] = useState(props.draftChanged);
  const [secret, setSecret] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<RuleProblem[] | null>(null);
  const readOnly = !props.build;

  const change = (update: (current: RuleDefinition) => RuleDefinition) => {
    setDef((current) => update(current));
    setDirty(true);
    setServerProblems(null);
  };
  const context = useMemo(
    () => ({
      sectionIds: props.sections.map((section) => section.id),
      fields: props.fields,
      formIds: props.forms.map((form) => form.id),
      activePeople: new Set(props.people.map((person) => person.id)),
      targetProjects: new Map(props.projects.map((project) => [project.id, project.sections.map((section) => section.id)])),
      maxSteps: props.maxSteps,
    }),
    [props.sections, props.fields, props.forms, props.people, props.projects, props.maxSteps],
  );
  // The same check the server runs on publish.
  const problems = useMemo(() => serverProblems ?? checkRule(name, def, context), [serverProblems, name, def, context]);
  const problemsAt = (where: string) => problems.filter((problem) => problem.where === where).map((problem) => problem.message);
  const stepTotal = allSteps(def).length;

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await saveAutomationAction(props.ruleId, { name, draft: def, rowVersion });
      if (!result.ok) {
        toast({ tone: "error", title: result.message });
        return false;
      }
      setRowVersion(result.value!.rowVersion);
      setDirty(false);
      setUnpublished(true);
      toast({ tone: "success", title: "Draft saved. The published version keeps running until you publish." });
      return true;
    } catch {
      toast({ tone: "error", title: "Couldn't save. Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const result = await publishAutomationAction(props.ruleId);
      if (!result.ok) {
        if (result.problems) setServerProblems(result.problems);
        toast({ tone: "error", title: result.message });
        return;
      }
      setUnpublished(false);
      setRowVersion((value) => value + 1);
      if (result.value?.secret) setSecret(result.value.secret);
      toast({ tone: "success", title: result.message || "Published." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const simple = async (run: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    try {
      const result = await run();
      toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
      if (result.ok) router.refresh();
      return result.ok;
    } finally {
      setBusy(false);
    }
  };

  const status = !props.published ? "Draft" : unpublished || dirty ? `Published (version ${props.version}) · unpublished changes` : `Published (version ${props.version})`;
  return (
    <div className="space-y-4" data-testid="automation-builder">
      <section className="card space-y-3 px-5 py-4" aria-label="Automation">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="rule-name" className="field-label">
              Automation name
            </label>
            <input id="rule-name" className="field-input field-compact" value={name} maxLength={RULE_NAME_MAX} disabled={readOnly} aria-describedby={problemsAt("name").length ? "rule-name-problem" : undefined} onChange={(event) => { setName(event.target.value); setDirty(true); setServerProblems(null); }} />
            {problemsAt("name").map((message) => (
              <p key={message} id="rule-name-problem" className="mt-1 text-caption text-danger-600">
                {message}
              </p>
            ))}
          </div>
          <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${props.published ? "bg-success-50 text-success-600" : "bg-surface-muted text-ink-muted"}`} data-testid="rule-status">
            {status}
          </span>
        </div>
        {props.build && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-compact" disabled={busy || !dirty} onClick={() => void save()} data-testid="rule-save">
              Save draft
            </button>
            <button type="button" className="btn-primary btn-compact" disabled={busy || problems.length > 0} onClick={() => void publish()} data-testid="rule-publish" aria-describedby="rule-problems">
              Publish
            </button>
            {props.published && unpublished && !dirty && (
              <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void simple(() => discardAutomationDraftAction(props.ruleId)).then((ok) => ok && window.location.reload())}>
                Discard draft changes
              </button>
            )}
            <label className="ml-auto inline-flex items-center gap-2 text-label">
              <input type="checkbox" role="switch" checked={props.enabled} disabled={busy} onChange={(event) => void simple(() => setAutomationEnabledAction(props.ruleId, event.target.checked))} data-testid="rule-enabled" />
              Switched on
            </label>
          </div>
        )}
        <p className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
          <UserCheck aria-hidden="true" className="h-4 w-4" />
          Owner: <strong className="text-ink">{props.owner.name}</strong>: the rule acts with this person&apos;s rights, recorded as ARS-CMS Automation.
          {props.build && (!props.owner.isMe || props.paused) && (
            <button type="button" className="link" disabled={busy} onClick={() => void simple(() => becomeAutomationOwnerAction(props.ruleId))} data-testid="become-owner">
              Become owner
            </button>
          )}
          {props.build && !props.owner.isMe && <span data-testid="owner-on-save">If you save or publish a change, you become its owner and {props.owner.name} is told.</span>}
        </p>
        {(props.paused || !props.owner.canRun) && (
          <p className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-label text-warning-600" role="status">
            <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {props.paused ?? "The owner can no longer edit this project, so the rule can't run."} Choose Become owner to run it with your rights.
          </p>
        )}
        <div id="rule-problems" aria-live="polite" className="text-caption">
          {problems.length ? (
            <p className="text-warning-600">
              {problems.length === 1 ? "1 thing" : `${problems.length} things`} to set up before publishing. Cards marked “Requires setup” say what.
            </p>
          ) : (
            <p className="text-success-600">Ready to publish.</p>
          )}
          {problemsAt("rule").map((message) => (
            <p key={message} className="text-danger-600">
              {message}
            </p>
          ))}
        </div>
      </section>

      <ol className="mx-auto max-w-3xl space-y-0" aria-label="Automation flow">
        <FlowItem>
          <TriggerCard trigger={def.trigger} onChange={(trigger) => change((current) => ({ ...current, trigger }))} problems={problemsAt("trigger")} readOnly={readOnly} props={props} />
        </FlowItem>
        <StepList steps={def.steps} label="Step" onChange={(steps) => change((current) => ({ ...current, steps }))} problemsAt={problemsAt} readOnly={readOnly} props={props} canAdd={stepTotal < props.maxSteps} />
        {def.paths.length > 0 ? (
          <FlowItem>
            <section className="card space-y-3 border-l-4 border-l-primary-600 px-4 py-3" aria-labelledby="paths-heading" data-testid="paths-card">
              <h2 id="paths-heading" className="flex items-center gap-2 font-semibold">
                <GitBranch aria-hidden="true" className="h-4 w-4" /> Paths
              </h2>
              <p className="text-caption text-ink-muted">Checked from the top: the first path whose conditions match runs its steps; if none matches, Otherwise runs.</p>
              {def.paths.map((path, index) => (
                <PathCard
                  key={path.key}
                  path={path}
                  index={index}
                  count={def.paths.length}
                  problemsAt={problemsAt}
                  readOnly={readOnly}
                  props={props}
                  canAdd={stepTotal < props.maxSteps}
                  onChange={(next) => change((current) => ({ ...current, paths: current.paths.map((item) => (item.key === path.key ? next : item)) }))}
                  onMove={(delta) => change((current) => ({ ...current, paths: move(current.paths, index, delta) }))}
                  onRemove={() => change((current) => ({ ...current, paths: current.paths.filter((item) => item.key !== path.key), otherwise: current.paths.length === 1 ? [] : current.otherwise }))}
                />
              ))}
              {!readOnly && def.paths.length < MAX_PATHS && (
                <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => change((current) => ({ ...current, paths: [...current.paths, newPath(current.paths.length + 1)] }))}>
                  <Plus aria-hidden="true" className="h-4 w-4" /> Add another path
                </button>
              )}
              <div className="rounded-md border border-line px-3 py-2" data-testid="otherwise">
                <h3 className="text-label font-semibold">Otherwise</h3>
                <StepList steps={def.otherwise} label="Otherwise step" onChange={(otherwise) => change((current) => ({ ...current, otherwise }))} problemsAt={problemsAt} readOnly={readOnly} props={props} nested canAdd={stepTotal < props.maxSteps} />
              </div>
            </section>
          </FlowItem>
        ) : (
          !readOnly && (
            <li className="flex justify-center pt-2">
              <button type="button" className="btn-ghost btn-compact inline-flex items-center gap-1" onClick={() => change((current) => ({ ...current, paths: [newPath(1)] }))} data-testid="add-paths">
                <GitBranch aria-hidden="true" className="h-4 w-4" /> Add paths (if / otherwise)
              </button>
            </li>
          )
        )}
      </ol>
      <p className="text-center text-caption text-ink-muted">
        {stepTotal} of {props.maxSteps} steps used.
      </p>

      {def.trigger?.type === "WEBHOOK" && (
        <section className="card space-y-2 px-5 py-4" aria-labelledby="webhook-heading" data-testid="webhook-card">
          <h2 id="webhook-heading" className="font-semibold">
            Webhook address
          </h2>
          {props.webhookUrl ? (
            <>
              <p className="break-all rounded-md bg-surface-muted px-3 py-2 font-mono text-caption">{props.webhookUrl}</p>
              <p className="text-caption text-ink-muted">
                Send a POST with a JSON body, signed with the secret: header <code>X-ARS-Signature: sha256=&lt;HMAC-SHA256 of the body&gt;</code>, or <code>Authorization: Bearer &lt;secret&gt;</code>. Create: <code>{`{"title": "…", "description": "…", "dueDate": "YYYY-MM-DD", "priority": "NORMAL"}`}</code>. Update: <code>{`{"task": "TSK-… or an ID like PO-12", "dueDate": "…"}`}</code>. At most 60 calls a minute; calls are logged.
              </p>
            </>
          ) : (
            <p className="text-caption text-ink-muted">The address and its secret are made when you publish.</p>
          )}
          {secret && (
            <div className="rounded-md border border-warning-600 px-3 py-2 text-label" role="status">
              <p className="font-semibold">Copy the secret now: it isn&apos;t shown again.</p>
              <p className="break-all font-mono text-caption" data-testid="webhook-secret">
                {secret}
              </p>
              <button type="button" className="link" onClick={() => void copyText(secret).then((done) => toast(done ? { tone: "success", title: "Secret copied." } : { tone: "error", title: COPY_BLOCKED }))}>
                Copy secret
              </button>
            </div>
          )}
          {props.build && props.webhookUrl && (
            <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const result = await newAutomationSecretAction(props.ruleId);
                toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
                if (result.ok && result.value) setSecret(result.value.secret);
              } finally {
                setBusy(false);
              }
            }}>
              Make a new secret
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}
const newPath = (n: number): Path => ({ key: newKey("p"), name: `Path ${n}`, match: "ALL", conditions: [{ subject: "PRIORITY", op: "IS", value: null }], steps: [] });
const newStep = (type: StepType = "MOVE_TO_SECTION"): Step => ({ key: newKey("s"), type });

function FlowItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pb-6 last:pb-0">
      {children}
      <span aria-hidden="true" className="absolute bottom-0 left-1/2 h-6 w-px bg-line" />
    </li>
  );
}
function Problems({ messages, id }: { messages: string[]; id: string }) {
  if (!messages.length) return null;
  return (
    <div id={id} className="rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-600">
      <p className="font-semibold">Requires setup</p>
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

// ---- trigger ------------------------------------------------------------------------------------
function TriggerCard({ trigger, onChange, problems, readOnly, props }: { trigger: Trigger | null; onChange: (trigger: Trigger | null) => void; problems: string[]; readOnly: boolean; props: BuilderProps }) {
  const set = (patch: Partial<Trigger>) => trigger && onChange({ ...trigger, ...patch });
  const field = trigger?.type === "FIELD_CHANGED" ? props.fields.find((item) => item.id === fieldIdOf(trigger.field)) : undefined;
  return (
    <section className="card space-y-3 border-l-4 border-l-warning-600 px-4 py-3" aria-labelledby="trigger-heading" aria-describedby={problems.length ? "trigger-problems" : undefined} data-testid="trigger-card">
      <h2 id="trigger-heading" className="flex items-center gap-2 font-semibold">
        <Zap aria-hidden="true" className="h-4 w-4" /> When this happens (trigger)
      </h2>
      <p className="text-caption text-ink-muted">Tasks in this project.</p>
      <div>
        <p className="field-label" id="trigger-type-label">
          Choose trigger
        </p>
        <TriggerPicker
          value={trigger?.type ?? null}
          disabled={readOnly}
          onPick={(type) => {
            const base: Trigger = { type };
            if (type === "STATUS_CHANGED") base.status = "COMPLETED";
            if (type === "DUE_APPROACHING") base.days = 1;
            if (type === "SCHEDULED") Object.assign(base, { frequency: "DAILY", time: "09:00", filter: [] });
            if (type === "WEBHOOK") base.webhookMode = "CREATE";
            onChange(base);
          }}
        />
      </div>
      {trigger && (trigger.type === "TASK_ADDED" || trigger.type === "MOVED_TO_SECTION" || (trigger.type === "WEBHOOK" && trigger.webhookMode !== "UPDATE")) && (
        <Select id="trigger-section" label={trigger.type === "WEBHOOK" ? "New tasks go to the section" : "Section"} value={trigger.sectionId ?? ""} disabled={readOnly} onChange={(value) => set({ sectionId: num(value) })} options={[{ value: "", label: trigger.type === "WEBHOOK" ? "The first section" : "Any section" }, ...props.sections.map((section) => ({ value: section.id, label: section.name }))]} />
      )}
      {trigger?.type === "FIELD_CHANGED" && (
        <>
          <Select
            id="trigger-field"
            label="Field"
            value={trigger.field ?? ""}
            disabled={readOnly}
            onChange={(value) => set({ field: value || null, value: null })}
            options={[{ value: "", label: "Choose a field" }, ...BUILT_IN_FIELDS.map((key) => ({ value: key, label: BUILT_IN_FIELD_LABEL[key] })), ...props.fields.filter(conditionField).map((item) => ({ value: fieldKey(item.id), label: item.name }))]}
          />
          {trigger.field === "priority" && <Select id="trigger-value" label="Changed to (optional)" value={String(trigger.value ?? "")} disabled={readOnly} onChange={(value) => set({ value: value || null })} options={[{ value: "", label: "Any value" }, ...PRIORITY_OPTIONS]} />}
          {field && (field.type === "SELECT" || field.type === "MULTI_SELECT") && (
            <Select id="trigger-value" label="Changed to (optional)" value={String(trigger.value ?? "")} disabled={readOnly} onChange={(value) => set({ value: value || null })} options={[{ value: "", label: "Any value" }, ...field.options.filter((option) => !option.archived).map((option) => ({ value: option.id, label: option.name }))]} />
          )}
        </>
      )}
      {trigger?.type === "STATUS_CHANGED" && <Select id="trigger-status" label="Change" value={trigger.status ?? "ANY"} disabled={readOnly} onChange={(value) => set({ status: value as Trigger["status"] })} options={STATUS_TRIGGER.map((value) => ({ value, label: STATUS_TRIGGER_LABEL[value] }))} />}
      {trigger?.type === "ASSIGNEE_CHANGED" && <Select id="trigger-person" label="Assigned to" value={trigger.userId ?? ""} disabled={readOnly} onChange={(value) => set({ userId: num(value) })} options={[{ value: "", label: "Anyone" }, ...props.people.map((person) => ({ value: person.id, label: person.label }))]} />}
      {trigger?.type === "DUE_APPROACHING" && <NumberInput id="trigger-days" label="Days before the due date (0 = on the day)" value={trigger.days ?? 0} min={0} max={60} disabled={readOnly} onChange={(days) => set({ days })} />}
      {trigger?.type === "OVERDUE" && <p className="text-caption text-ink-muted">Once, when an open task becomes overdue (checked every few minutes; tasks already overdue when you publish don&apos;t count).</p>}
      {trigger?.type === "FORM_SUBMITTED" && <Select id="trigger-form" label="Form" value={trigger.formId ?? ""} disabled={readOnly} onChange={(value) => set({ formId: num(value) })} options={[{ value: "", label: "Any form of this project" }, ...props.forms.map((form) => ({ value: form.id, label: form.name }))]} />}
      {trigger?.type === "MANUAL" && <p className="text-caption text-ink-muted">Owners and editors run it on one task from the task&apos;s ⋯ menu (Run automation).</p>}
      {trigger?.type === "SCHEDULED" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select id="trigger-frequency" label="How often" value={trigger.frequency ?? "DAILY"} disabled={readOnly} onChange={(value) => set({ frequency: value as "DAILY" | "WEEKLY", weekday: value === "WEEKLY" ? (trigger.weekday ?? 1) : undefined })} options={[{ value: "DAILY", label: "Every day" }, { value: "WEEKLY", label: "Every week" }]} />
            {trigger.frequency === "WEEKLY" && <Select id="trigger-weekday" label="Day" value={trigger.weekday ?? 1} disabled={readOnly} onChange={(value) => set({ weekday: Number(value) })} options={WEEKDAYS.map((day, index) => ({ value: index, label: day }))} />}
            <div>
              <label htmlFor="trigger-time" className="field-label">
                Time (India)
              </label>
              <input id="trigger-time" type="time" className="field-input field-compact" value={trigger.time ?? ""} disabled={readOnly} onChange={(event) => set({ time: event.target.value || undefined })} />
            </div>
          </div>
          <fieldset className="space-y-2 rounded-md border border-line px-3 py-2">
            <legend className="px-1 text-label font-semibold">Which open tasks (all must match; none = every open task, at most 200)</legend>
            <ConditionList conditions={trigger.filter ?? []} prefix="filter" readOnly={readOnly} props={props} onChange={(filter) => set({ filter })} />
          </fieldset>
        </div>
      )}
      {trigger?.type === "WEBHOOK" && (
        <>
          <Select id="trigger-webhook-mode" label="A request" value={trigger.webhookMode ?? "CREATE"} disabled={readOnly} onChange={(value) => set({ webhookMode: value as "CREATE" | "UPDATE" })} options={[{ value: "CREATE", label: "Creates a task" }, { value: "UPDATE", label: "Updates a task (by its number or ID field)" }]} />
          {trigger.webhookMode !== "UPDATE" && <Select id="trigger-webhook-assignee" label="New tasks are assigned to" value={trigger.assigneeId ?? ""} disabled={readOnly} onChange={(value) => set({ assigneeId: num(value) })} options={[{ value: "", label: "The rule's owner" }, ...props.people.map((person) => ({ value: person.id, label: person.label }))]} />}
        </>
      )}
      <Problems messages={problems} id="trigger-problems" />
    </section>
  );
}

// v1.73.0 (D-396, spec PC §2.3-§2.4): the trigger is a dropdown menu, as in
// the spec's builder: first where it starts ("Something happens to a task ›",
// the catalogue grouped as the spec groups it), then Run by hand, On a
// schedule and Web request received. Radio items show the current choice.
const OWN_STARTS: TriggerType[] = ["MANUAL", "SCHEDULED", "WEBHOOK"];
function TriggerPicker({ value, disabled, onPick }: { value: TriggerType | null; disabled: boolean; onPick: (type: TriggerType) => void }) {
  const radio = (type: TriggerType): MenuItem => ({ kind: "radio", close: true, label: TRIGGER_LABEL[type], checked: value === type, onSelect: () => value !== type && onPick(type), testId: `trigger-${type.toLowerCase()}` });
  const inProject = TRIGGER_GROUPS.flatMap((group) => {
    const types = group.types.filter((type) => !OWN_STARTS.includes(type));
    return types.length ? [{ kind: "heading" as const, label: group.label === "Other starts" ? "Forms" : group.label }, ...types.map(radio)] : [];
  });
  const items: MenuItem[] = [
    { kind: "submenu", label: "Something happens to a task", hint: "In this project", items: inProject, testId: "trigger-task-events" },
    { kind: "separator", label: "" },
    ...OWN_STARTS.map(radio),
  ];
  if (disabled) return <p className="field-input field-compact flex items-center" aria-labelledby="trigger-type-label">{value ? TRIGGER_LABEL[value] : "Not set"}</p>;
  return (
    <Menu
      label={`Trigger: ${value ? TRIGGER_LABEL[value] : "Choose what starts this rule"}`}
      align="left"
      className="relative flex"
      buttonClass="field-input field-compact flex w-full items-center justify-between gap-2 text-left"
      menuClass="w-72"
      testId="trigger-type"
      trigger={
        <>
          <span className={`truncate ${value ? "" : "text-ink-muted"}`}>{value ? TRIGGER_LABEL[value] : "Choose what starts this rule"}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
        </>
      }
      items={items}
    />
  );
}

// The step's action, the same way ("Do this"): the spec's action catalogue, grouped.
const stepItems = (current: StepType | null, onPick: (type: StepType) => void): MenuItem[] =>
  STEP_GROUPS.flatMap((group) => [{ kind: "heading" as const, label: group.label }, ...group.types.map((type): MenuItem => ({ kind: current === null ? "item" : "radio", close: true, label: STEP_LABEL[type], checked: current === type, onSelect: () => current !== type && onPick(type), testId: `step-${type.toLowerCase()}` }))]);

// ---- steps --------------------------------------------------------------------------------------
function StepList({ steps, label, onChange, problemsAt, readOnly, props, nested, canAdd }: { steps: Step[]; label: string; onChange: (steps: Step[]) => void; problemsAt: (where: string) => string[]; readOnly: boolean; props: BuilderProps; nested?: boolean; canAdd: boolean }) {
  const items = steps.map((step, index) => (
    <StepCard
      key={step.key}
      step={step}
      title={`${label} ${index + 1}`}
      first={index === 0}
      last={index === steps.length - 1}
      problems={problemsAt(`step:${step.key}`)}
      readOnly={readOnly}
      props={props}
      onChange={(next) => onChange(steps.map((item) => (item.key === step.key ? next : item)))}
      onMove={(delta) => onChange(move(steps, index, delta))}
      onRemove={() => onChange(steps.filter((item) => item.key !== step.key))}
    />
  ));
  // v1.73.0 (D-396, spec PC §2.3 "What happens next?"): Add step is a dropdown of the actions; the new step has the chosen action.
  const add =
    !readOnly &&
    (canAdd ? (
      <Menu
        label={`Add ${label.toLowerCase()}`}
        align="left"
        buttonClass="btn-secondary btn-compact inline-flex items-center gap-1"
        menuClass="w-64"
        testId={nested ? undefined : "add-step"}
        trigger={
          <>
            <Plus aria-hidden="true" className="h-4 w-4" /> Add {label.toLowerCase()} <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </>
        }
        items={stepItems(null, (type) => onChange([...steps, newStep(type)]))}
      />
    ) : (
      <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" disabled aria-label={`Add ${label.toLowerCase()}`} data-testid={nested ? undefined : "add-step"}>
        <Plus aria-hidden="true" className="h-4 w-4" /> Add {label.toLowerCase()}
      </button>
    ));
  if (nested)
    return (
      <div className="space-y-2 pt-2">
        {items}
        {steps.length === 0 && <p className="text-caption text-ink-muted">No steps yet.</p>}
        {add}
      </div>
    );
  return (
    <>
      {items.map((item) => (
        <FlowItem key={item.key}>{item}</FlowItem>
      ))}
      {add && <li className="flex justify-center pb-6">{add}</li>}
    </>
  );
}

function StepCard({ step, title, first, last, problems, readOnly, props, onChange, onMove, onRemove }: { step: Step; title: string; first: boolean; last: boolean; problems: string[]; readOnly: boolean; props: BuilderProps; onChange: (step: Step) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch });
  const id = `step-${step.key}`;
  const field = step.type === "SET_FIELD" ? props.fields.find((item) => item.id === step.fieldId) : undefined;
  const project = step.type === "ADD_TO_PROJECT" ? props.projects.find((item) => item.id === step.projectId) : undefined;
  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30";
  return (
    <section className="card space-y-3 px-4 py-3" aria-labelledby={`${id}-heading`} aria-describedby={problems.length ? `${id}-problems` : undefined} data-testid="step-card">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-heading`} className="flex-1 font-semibold">
          {title}: {STEP_LABEL[step.type]}
        </h3>
        {!readOnly && (
          <>
            <button type="button" className={icon} disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${title} up`} title="Move up">
              <ArrowUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" className={icon} disabled={last} onClick={() => onMove(1)} aria-label={`Move ${title} down`} title="Move down">
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" className={`${icon} hover:text-danger-600`} onClick={onRemove} aria-label={`Delete ${title}`} title="Delete">
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      <div>
        <p className="field-label" id={`${id}-type-label`}>
          Do this
        </p>
        {readOnly ? (
          <p className="field-input field-compact flex items-center" aria-labelledby={`${id}-type-label`}>
            {STEP_LABEL[step.type]}
          </p>
        ) : (
          <Menu
            label={`Do this: ${STEP_LABEL[step.type]}`}
            align="left"
            className="relative flex"
            buttonClass="field-input field-compact flex w-full items-center justify-between gap-2 text-left"
            menuClass="w-64"
            testId="step-type"
            trigger={
              <>
                <span className="truncate">{STEP_LABEL[step.type]}</span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
              </>
            }
            items={stepItems(step.type, (type) => onChange({ key: step.key, type }))}
          />
        )}
      </div>
      {(step.type === "MOVE_TO_SECTION" || step.type === "CREATE_TASK") && (
        <Select id={`${id}-section`} label={step.type === "CREATE_TASK" ? "In the section" : "Section"} value={step.sectionId ?? ""} disabled={readOnly} onChange={(value) => set({ sectionId: num(value) })} options={[{ value: "", label: step.type === "CREATE_TASK" ? "The first section" : "Choose a section" }, ...props.sections.map((section) => ({ value: section.id, label: section.name }))]} />
      )}
      {step.type === "ADD_TO_PROJECT" && (
        <>
          <Select id={`${id}-project`} label="Project (the owner must be an owner or editor; a task is in at most 20 projects)" value={step.projectId ?? ""} disabled={readOnly} onChange={(value) => set({ projectId: num(value), sectionId: null })} options={[{ value: "", label: "Choose a project" }, ...props.projects.map((item) => ({ value: item.id, label: item.name }))]} />
          {project && <Select id={`${id}-target-section`} label="Section" value={step.sectionId ?? ""} disabled={readOnly} onChange={(value) => set({ sectionId: num(value) })} options={[{ value: "", label: "The first section" }, ...project.sections.map((section) => ({ value: section.id, label: section.name }))]} />}
        </>
      )}
      {step.type === "SET_STATUS" && <Select id={`${id}-status`} label="Status" value={step.status ?? ""} disabled={readOnly} onChange={(value) => set({ status: (value || undefined) as Step["status"] })} options={[{ value: "", label: "Choose" }, { value: "COMPLETE", label: "Complete" }, { value: "REOPEN", label: "Incomplete (reopen)" }]} />}
      {step.type === "SET_ASSIGNEE" && <Select id={`${id}-person`} label="Assignee (exactly one person)" value={step.userId ?? ""} disabled={readOnly} onChange={(value) => set({ userId: num(value) })} options={[{ value: "", label: "Choose a person" }, ...props.people.map((person) => ({ value: person.id, label: person.label }))]} />}
      {(step.type === "SET_DUE" || step.type === "CREATE_TASK") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberInput id={`${id}-days`} label={step.type === "SET_DUE" ? "Due after (days from the day it runs)" : "Due after (days; blank = the task's due date)"} value={step.days ?? (step.type === "SET_DUE" ? 0 : "")} min={0} max={365} disabled={readOnly} onChange={(days) => set({ days })} optional={step.type === "CREATE_TASK"} />
          <label className="mt-6 inline-flex items-center gap-2 text-label">
            <input type="checkbox" checked={Boolean(step.workingDays)} disabled={readOnly} onChange={(event) => set({ workingDays: event.target.checked })} /> Count working days (skip weekly offs and holidays)
          </label>
        </div>
      )}
      {step.type === "SET_PRIORITY" && <Select id={`${id}-priority`} label="Priority" value={step.priority ?? ""} disabled={readOnly} onChange={(value) => set({ priority: value || undefined })} options={[{ value: "", label: "Choose" }, ...PRIORITY_OPTIONS]} />}
      {step.type === "SET_FIELD" && (
        <>
          <Select id={`${id}-field`} label="Field" value={step.fieldId ?? ""} disabled={readOnly} onChange={(value) => set({ fieldId: num(value), value: null })} options={[{ value: "", label: "Choose a field" }, ...props.fields.filter(writableField).map((item) => ({ value: item.id, label: item.name }))]} />
          {field && <FieldValue id={`${id}-value`} field={field} value={step.value} people={props.people} disabled={readOnly} onChange={(value) => set({ value })} />}
        </>
      )}
      {step.type === "CREATE_TASK" && (
        <>
          <TextInput id={`${id}-title`} label="New task's name" value={step.title ?? ""} max={200} disabled={readOnly} onChange={(title) => set({ title })} />
          <Select id={`${id}-assignee`} label="Assigned to" value={step.userId ?? ""} disabled={readOnly} onChange={(value) => set({ userId: num(value) })} options={[{ value: "", label: "The same person as the task" }, ...props.people.map((person) => ({ value: person.id, label: person.label }))]} />
        </>
      )}
      {step.type === "CREATE_SUBTASKS" && (
        <>
          <div>
            <label htmlFor={`${id}-titles`} className="field-label">
              Subtask names, one per line (at most 20)
            </label>
            <textarea id={`${id}-titles`} className="field-input min-h-[5rem]" value={(step.titles ?? []).join("\n")} disabled={readOnly} onChange={(event) => set({ titles: event.target.value.split("\n").slice(0, 20).map((line) => line.slice(0, 200)) })} />
          </div>
          <Select id={`${id}-assignee`} label="Assigned to" value={step.userId ?? ""} disabled={readOnly} onChange={(value) => set({ userId: num(value) })} options={[{ value: "", label: "The same person as the task" }, ...props.people.map((person) => ({ value: person.id, label: person.label }))]} />
        </>
      )}
      {(step.type === "ADD_COMMENT" || step.type === "NOTIFY") && (
        <div>
          <label htmlFor={`${id}-text`} className="field-label">
            {step.type === "ADD_COMMENT" ? "Comment (posted by ARS-CMS Automation for this rule)" : "Message"}
          </label>
          <textarea id={`${id}-text`} className="field-input min-h-[4rem]" maxLength={2000} value={step.text ?? ""} disabled={readOnly} onChange={(event) => set({ text: event.target.value })} />
        </div>
      )}
      {step.type === "NOTIFY" && (
        <fieldset className="space-y-0.5">
          <legend className="field-label">Tell (only people who can see the task are told)</legend>
          {NOTIFY_TARGETS.map((target) => (
            <label key={target} className="flex min-h-7 items-center gap-2 text-label">
              <input type="checkbox" checked={(step.targets ?? []).includes(target)} disabled={readOnly} onChange={(event) => set({ targets: event.target.checked ? [...(step.targets ?? []), target] : (step.targets ?? []).filter((item) => item !== target) })} />
              {NOTIFY_TARGET_LABEL[target]}
            </label>
          ))}
        </fieldset>
      )}
      {(step.type === "ADD_COLLABORATORS" || step.type === "NOTIFY") && <PeoplePicker id={`${id}-people`} label={step.type === "NOTIFY" ? "And these people" : "People"} ids={step.userIds ?? []} people={props.people} disabled={readOnly} onChange={(userIds) => set({ userIds })} />}
      <Problems messages={problems} id={`${id}-problems`} />
    </section>
  );
}

function FieldValue({ id, field, value, people, disabled, onChange }: { id: string; field: FieldInfo; value: Step["value"]; people: BuilderProps["people"]; disabled: boolean; onChange: (value: Step["value"]) => void }) {
  if (field.type === "SELECT")
    return <Select id={id} label="Value" value={value === null || value === undefined ? "" : String(value)} disabled={disabled} onChange={(next) => onChange(next === "" ? null : Number(next))} options={[{ value: "", label: "Empty (clears the field)" }, ...field.options.filter((option) => !option.archived).map((option) => ({ value: option.id, label: option.name }))]} />;
  if (field.type === "MULTI_SELECT") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-0.5">
        <legend className="field-label">Values (none = clears the field)</legend>
        {field.options.filter((option) => !option.archived).map((option) => (
          <label key={option.id} className="flex min-h-7 items-center gap-2 text-label">
            <input type="checkbox" checked={chosen.includes(option.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...chosen, option.id] : chosen.filter((item) => item !== option.id))} />
            {option.name}
          </label>
        ))}
      </fieldset>
    );
  }
  if (field.type === "PEOPLE") return <PeoplePicker id={id} label="People (none = clears the field)" ids={Array.isArray(value) ? value : []} people={people} disabled={disabled} onChange={onChange} />;
  if (field.type === "DATE")
    return (
      <div>
        <label htmlFor={id} className="field-label">
          Date (blank = clears the field)
        </label>
        {/* v1.75.0 (D-399): the shared date picker, one day. */}
        <DateRangePicker mode="single" idBase={`${id}-picker`} triggerId={id} label="Date" dueLabel="Date" disabled={disabled} value={{ start: "", due: typeof value === "string" ? value : "" }} onChange={(next) => onChange(next.due || null)} placeholder="No date" triggerClass="field-input field-compact flex w-full items-center gap-2 text-left" />
      </div>
    );
  return <TextInput id={id} label={field.type === "NUMBER" ? "Number (blank = clears the field)" : "Text (blank = clears the field)"} value={value === null || value === undefined ? "" : String(value)} max={500} disabled={disabled} onChange={(next) => onChange(next === "" ? null : next)} inputMode={field.type === "NUMBER" ? "decimal" : undefined} />;
}

// ---- paths and conditions -------------------------------------------------------------------------
function PathCard({ path, index, count, problemsAt, readOnly, props, canAdd, onChange, onMove, onRemove }: { path: Path; index: number; count: number; problemsAt: (where: string) => string[]; readOnly: boolean; props: BuilderProps; canAdd: boolean; onChange: (path: Path) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const id = `path-${path.key}`;
  const problems = problemsAt(`path:${path.key}`);
  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30";
  return (
    <section className="space-y-2 rounded-md border border-line px-3 py-2" aria-labelledby={`${id}-heading`} aria-describedby={problems.length ? `${id}-problems` : undefined} data-testid="path-card">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-heading`} className="flex-1 text-label font-semibold">
          If (path {index + 1}): {path.name || "unnamed"}
        </h3>
        {!readOnly && (
          <>
            <button type="button" className={icon} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move path ${index + 1} up`} title="Move up">
              <ArrowUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" className={icon} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move path ${index + 1} down`} title="Move down">
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" className={`${icon} hover:text-danger-600`} onClick={onRemove} aria-label={`Delete path ${index + 1}`} title="Delete">
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput id={`${id}-name`} label={`Path ${index + 1} name`} value={path.name} max={60} disabled={readOnly} onChange={(name) => onChange({ ...path, name })} />
        <Select id={`${id}-match`} label="Matches when" value={path.match} disabled={readOnly} onChange={(match) => onChange({ ...path, match: match as "ALL" | "ANY" })} options={[{ value: "ALL", label: "All conditions are true" }, { value: "ANY", label: "Any condition is true" }]} />
      </div>
      <ConditionList conditions={path.conditions} prefix={id} readOnly={readOnly} props={props} onChange={(conditions) => onChange({ ...path, conditions })} />
      <Problems messages={problems} id={`${id}-problems`} />
      <div className="border-t border-line pt-1">
        <p className="text-caption font-semibold">Then</p>
        <StepList steps={path.steps} label={`Path ${index + 1} step`} onChange={(steps) => onChange({ ...path, steps })} problemsAt={problemsAt} readOnly={readOnly} props={props} nested canAdd={canAdd} />
      </div>
    </section>
  );
}

function ConditionList({ conditions, prefix, readOnly, props, onChange }: { conditions: Condition[]; prefix: string; readOnly: boolean; props: BuilderProps; onChange: (conditions: Condition[]) => void }) {
  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => (
        <ConditionRow key={index} condition={condition} id={`${prefix}-c${index}`} n={index + 1} readOnly={readOnly} props={props} onChange={(next) => onChange(conditions.map((item, at) => (at === index ? next : item)))} onRemove={() => onChange(conditions.filter((_, at) => at !== index))} />
      ))}
      {!readOnly && conditions.length < MAX_CONDITIONS && (
        <button type="button" className="link text-label" onClick={() => onChange([...conditions, { subject: "PRIORITY", op: "IS", value: null }])}>
          + Add condition
        </button>
      )}
    </div>
  );
}
function ConditionRow({ condition, id, n, readOnly, props, onChange, onRemove }: { condition: Condition; id: string; n: number; readOnly: boolean; props: BuilderProps; onChange: (condition: Condition) => void; onRemove: () => void }) {
  const field = condition.subject === "FIELD" ? props.fields.find((item) => item.id === condition.fieldId) : undefined;
  const ops = opsFor(condition.subject, field?.type);
  const valueOptions = (): { value: string | number; label: string }[] | null => {
    switch (condition.subject) {
      case "SECTION":
        return props.sections.map((section) => ({ value: section.id, label: section.name }));
      case "ASSIGNEE":
        return props.people.map((person) => ({ value: person.id, label: person.label }));
      case "PRIORITY":
        return PRIORITY_OPTIONS;
      case "DUE_STATUS":
        return DUE_STATUSES.map((value) => ({ value, label: DUE_STATUS_LABEL[value] }));
      case "COMPLETION":
        return COMPLETION_VALUES.map((value) => ({ value, label: COMPLETION_LABEL[value] }));
      case "FIELD":
        if (field?.type === "SELECT" || field?.type === "MULTI_SELECT") return field.options.map((option) => ({ value: option.id, label: option.name }));
        if (field?.type === "PEOPLE") return props.people.map((person) => ({ value: person.id, label: person.label }));
        return null;
      default:
        return null;
    }
  };
  const options = valueOptions();
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label={`Condition ${n}`} data-testid="condition">
      <Select id={`${id}-subject`} label={`Condition ${n}`} value={condition.subject} disabled={readOnly} onChange={(subject) => onChange({ subject: subject as Subject, op: opsFor(subject as Subject)[0]!, value: null, fieldId: null })} options={SUBJECTS.map((subject) => ({ value: subject, label: SUBJECT_LABEL[subject] }))} />
      {condition.subject === "FIELD" && (
        <Select id={`${id}-field`} label="Field" value={condition.fieldId ?? ""} disabled={readOnly} onChange={(value) => {
          const next = props.fields.find((item) => item.id === Number(value));
          onChange({ ...condition, fieldId: num(value), op: opsFor("FIELD", next?.type)[0]!, value: null });
        }} options={[{ value: "", label: "Choose a field" }, ...props.fields.filter(conditionField).map((item) => ({ value: item.id, label: item.name }))]} />
      )}
      <Select id={`${id}-op`} label="Compare" value={condition.op} disabled={readOnly} onChange={(op) => onChange({ ...condition, op: op as Condition["op"] })} options={ops.map((op) => ({ value: op, label: OP_LABEL[op] }))} />
      {opNeedsValue(condition.op) &&
        (options ? (
          <Select id={`${id}-value`} label="Value" value={condition.value === null || condition.value === undefined ? "" : String(condition.value)} disabled={readOnly} onChange={(value) => onChange({ ...condition, value: value === "" ? null : /^\d+$/.test(value) && condition.subject !== "PRIORITY" ? Number(value) : value })} options={[{ value: "", label: "Choose" }, ...options]} />
        ) : field?.type === "DATE" ? (
          <div>
            <label htmlFor={`${id}-value`} className="field-label">
              Value
            </label>
            <DateRangePicker mode="single" idBase={`${id}-value-picker`} triggerId={`${id}-value`} label="Value" dueLabel="Date" disabled={readOnly} value={{ start: "", due: String(condition.value ?? "") }} onChange={(next) => onChange({ ...condition, value: next.due || null })} placeholder="Choose a date" triggerClass="field-input field-compact flex w-full items-center gap-2 text-left" />
          </div>
        ) : (
          <TextInput id={`${id}-value`} label="Value" value={String(condition.value ?? "")} max={500} disabled={readOnly} onChange={(value) => onChange({ ...condition, value: value || null })} />
        ))}
      {!readOnly && (
        <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-danger-600" onClick={onRemove} aria-label={`Remove condition ${n}`} title="Remove">
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ---- small controls ------------------------------------------------------------------------------
function Select({ id, label, value, options, disabled, onChange }: { id: string; label: string; value: string | number; options: { value: string | number; label: string }[]; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} className="field-input field-compact max-w-full" value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
function TextInput({ id, label, value, max, disabled, onChange, inputMode }: { id: string; label: string; value: string; max: number; disabled: boolean; onChange: (value: string) => void; inputMode?: "decimal" }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input id={id} className="field-input field-compact" value={value} maxLength={max} disabled={disabled} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
function NumberInput({ id, label, value, min, max, disabled, onChange, optional }: { id: string; label: string; value: number | ""; min: number; max: number; disabled: boolean; onChange: (value: number | undefined) => void; optional?: boolean }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="field-input field-compact"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") return onChange(optional ? undefined : min);
          const n = Math.max(min, Math.min(max, Math.round(Number(raw))));
          onChange(Number.isFinite(n) ? n : min);
        }}
      />
    </div>
  );
}
function PeoplePicker({ id, label, ids, people, disabled, onChange }: { id: string; label: string; ids: number[]; people: BuilderProps["people"]; disabled: boolean; onChange: (ids: number[]) => void }) {
  const name = (person: number) => people.find((item) => item.id === person)?.label ?? "Someone (inactive)";
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <ul className="flex flex-wrap gap-1" aria-label={`${label}: chosen`}>
        {ids.map((person) => (
          <li key={person} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-caption">
            {name(person)}
            {!disabled && (
              <button type="button" className="text-ink-muted hover:text-danger-600" aria-label={`Remove ${name(person)}`} onClick={() => onChange(ids.filter((item) => item !== person))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && ids.length < 20 && (
        <select id={id} className="field-input field-compact" value="" onChange={(event) => event.target.value && onChange([...ids, Number(event.target.value)])}>
          <option value="">Add a person</option>
          {people.filter((person) => !ids.includes(person.id)).map((person) => (
            <option key={person.id} value={person.id}>
              {person.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
