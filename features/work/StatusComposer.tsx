"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { statusHighlightsAction, statusReminderAction, statusUpdateAction } from "@/app/users/work/schedule-actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { PersonSelect, type PersonChoice } from "@/features/ui/PersonSelect";
import { RichEditor } from "@/features/ui/RichEditor";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { InlineLoading } from "@/features/ui/Spinner";
import { useWorkCall } from "@/features/work/client";
import { STATUS_KIND_LABEL, STATUS_KINDS } from "@/server/work/access";
import { DEFAULT_HIGHLIGHT_DAYS, HIGHLIGHT_WINDOWS, MAX_EXTRA_RECIPIENTS, statusTitleFor } from "@/server/work/schedule";

// v1.65.0 (D-373, spec PM §3.22): the status update composer: title, status
// (required), owner, dates, the Summary and Next steps sections, a Highlights
// panel (completed milestones and tasks of the last 7, 14 or 30 days, picked
// from the project's data), recipients (the members, plus extra people) and
// the weekly reminder to the project's owner. The server checks everything again.
interface HighlightItem {
  id: number;
  taskNo: string;
  title: string;
  milestone: boolean;
  completedOn: string;
}

export function StatusComposer({
  projectId,
  projectName,
  initial,
  todayDay,
  owner,
  members,
  people,
  startOn,
  dueOn,
  reminder,
  meId,
}: {
  projectId: number;
  projectName: string;
  initial?: string;
  todayDay: string;
  owner: { id: number; name: string };
  members: { id: number; name: string }[];
  people: PersonChoice[];
  startOn: string;
  dueOn: string;
  reminder: boolean;
  meId: number;
}) {
  const { result, pending, onSubmit, formRef } = useActionForm(statusUpdateAction, { resetOnSuccess: true });
  const { call, pending: busy } = useWorkCall();
  const [days, setDays] = useState<number>(DEFAULT_HIGHLIGHT_DAYS);
  const [items, setItems] = useState<HighlightItem[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [extras, setExtras] = useState<number[]>([]);
  const [remind, setRemind] = useState(reminder);
  useEffect(() => {
    let live = true;
    void statusHighlightsAction(projectId, days).then((answer) => {
      if (!live) return;
      const list = answer.ok ? (answer.value?.items ?? []) : [];
      setItems(list);
      // Milestones are picked to start with; tasks are the author's choice.
      setPicked(list.filter((item) => item.milestone).map((item) => item.id));
    });
    return () => {
      live = false;
    };
  }, [projectId, days]);
  useEffect(() => {
    if (result?.ok) {
      setPicked([]);
      setExtras([]);
    }
  }, [result]);
  useEffect(() => {
    if (!initial) return;
    const form = formRef.current;
    form?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    form?.querySelector<HTMLInputElement>("#status-title")?.focus({ preventScroll: true });
  }, [initial, formRef]);
  const memberIds = new Set(members.map((member) => member.id));
  const told = members.filter((member) => member.id !== meId).length + extras.filter((id) => !memberIds.has(id)).length;
  const ownerChoices = [owner, ...members.filter((member) => member.id !== owner.id)];
  const nameOf = (id: number) => people.find((person) => person.id === id)?.label ?? `Person ${id}`;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3" aria-label="Post a status update" id="post-status" data-testid="status-composer">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="highlights" value={picked.join(",")} />
      <input type="hidden" name="highlight_days" value={days} />
      <input type="hidden" name="recipients" value={extras.join(",")} />
      <div>
        <label htmlFor="status-title" className="field-label">
          Headline
        </label>
        <input id="status-title" name="title" maxLength={200} className="field-input" placeholder={statusTitleFor(projectName, todayDay)} />
      </div>
      <fieldset>
        <legend className="field-label">
          Status <span aria-hidden="true">*</span>
        </legend>
        <div className="flex flex-wrap gap-3">
          {STATUS_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 text-label">
              <input type="radio" name="status" value={kind} required defaultChecked={initial === kind} /> {STATUS_KIND_LABEL[kind]}
            </label>
          ))}
        </div>
        <FieldError result={result} name="status" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">Owner</span>
          <select name="owner" defaultValue={owner.id} className="field-input">
            {ownerChoices.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        {/* v1.75.0 (D-399): Start and Due in the shared date range picker (form fields start_on / due_on as before). */}
        <div className="block">
          <span className="field-label">Start – Due</span>
          <DateRangePicker label="Status dates" startLabel="Start date" dueLabel="Due date" defaultValue={{ start: startOn ?? "", due: dueOn ?? "" }} names={{ start: "start_on", due: "due_on" }} testId="status-dates" />
          <FieldError result={result} name="due_on" />
        </div>
      </div>
      <div>
        <span className="field-label" id="status-summary-label">
          Summary
        </span>
        <RichEditor id="status-body" name="body" label="Summary: how is the project going?" maxLength={4000} minHeight={80} placeholder="How is the project going?" />
        <FieldError result={result} name="summary" />
      </div>
      <div>
        <span className="field-label">Next steps</span>
        <RichEditor id="status-next" name="next_steps" label="Next steps: what is next for the team?" maxLength={4000} minHeight={70} placeholder="What is next for the team?" />
      </div>
      <section className="rounded-md border border-line p-3" aria-labelledby="highlights-title" data-testid="status-highlights-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="highlights-title" className="text-label font-semibold">
            Highlights
          </h3>
          <label className="ml-auto flex items-center gap-1 text-caption">
            <span>Completed in the last</span>
            <select className="field-input h-8 w-auto py-0" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Highlights period">
              {HIGHLIGHT_WINDOWS.map((window) => (
                <option key={window} value={window}>
                  {window} days
                </option>
              ))}
            </select>
          </label>
        </div>
        {items === null && <InlineLoading />}
        {items && items.length === 0 && <p className="text-caption text-ink-muted">Nothing was completed in this period.</p>}
        {items && items.length > 0 && (
          <>
            <p className="text-caption text-ink-muted">
              {items.filter((item) => item.milestone).length} milestones and {items.filter((item) => !item.milestone).length} tasks completed. Tick what goes in the update.
            </p>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-center gap-2 text-label">
                    <input type="checkbox" checked={picked.includes(item.id)} onChange={(event) => setPicked((current) => (event.target.checked ? [...current, item.id].slice(0, 30) : current.filter((id) => id !== item.id)))} />
                    <span aria-hidden="true">{item.milestone ? "◆" : "✓"}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="text-caption text-ink-muted">{item.completedOn}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="rounded-md border border-line p-3" aria-labelledby="recipients-title">
        <h3 id="recipients-title" className="text-label font-semibold">
          Recipients
        </h3>
        <p className="text-caption text-ink-muted" data-testid="status-told">
          {told} {told === 1 ? "person" : "people"} will be told: the project&apos;s members{extras.length ? " and the people below" : ""}.
        </p>
        {extras.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {extras.map((id) => (
              <li key={id} className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-caption">
                {nameOf(id)}
                <button type="button" aria-label={`Don't tell ${nameOf(id)}`} onClick={() => setExtras((current) => current.filter((item) => item !== id))} className="rounded hover:text-danger-600">
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {extras.length < MAX_EXTRA_RECIPIENTS && (
          <div className="mt-2">
            <PersonSelect options={people.filter((person) => !extras.includes(person.id) && person.id !== meId)} value={null} onChange={(id) => id && setExtras((current) => [...current, id])} placeholder="Add someone else to tell…" ariaLabel="Add a recipient" compact />
          </div>
        )}
      </section>
      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          checked={remind}
          disabled={busy}
          onChange={(event) => {
            const on = event.target.checked;
            setRemind(on);
            void call(() => statusReminderAction(projectId, on)).then((answer) => answer?.ok || setRemind(!on));
          }}
          data-testid="status-reminder"
        />
        Remind the project owner every Friday to post an update
      </label>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Post status update</SubmitButton>
    </form>
  );
}
