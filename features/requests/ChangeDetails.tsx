"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, PencilLine, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/features/ui/Dialog";
import { DynamicFields } from "@/features/requests/DynamicFields";
import { PeoplePicker } from "@/features/ui/PeoplePicker";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { NO_LOOKUPS } from "@/server/forms/fields";
import { changeDetailsAction, loadChangeDetailsAction, type ChangeDetailsData } from "@/app/users/queue/change-details-actions";
import type { LevelRule } from "@/server/approvals/approver-edit";

// v1.59.0 (D-357, owner: "approver can change the approval details", "can be
// done from the table itself"): Change details on a Waiting for me row opens
// this drawer: the form's values (files stay as they are) and the levels after
// yours, with a reason. The server checks everything again.

type Level = { key: string; label: string; editable: boolean; userIds: number[]; pick: string; rule: LevelRule; changed: boolean };

export function ChangeDetailsButton({ requestId, taskKey, title }: { requestId: number; taskKey: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-compact inline-flex items-center gap-1 whitespace-nowrap" aria-label={`Change details of ${title}`} data-testid="change-details">
        <PencilLine aria-hidden="true" className="h-4 w-4" />
        <span className="hidden lg:inline">Change</span>
      </button>
      {open && <ChangeDetailsDrawer requestId={requestId} taskKey={taskKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeDetailsDrawer({ requestId, taskKey, onClose }: { requestId: number; taskKey: string; onClose: () => void }) {
  const [data, setData] = useState<ChangeDetailsData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadChangeDetailsAction(requestId, taskKey)
      .then((answer) => {
        if (!live) return;
        if (answer.ok) setData(answer.data);
        else setFailed(answer.message);
      })
      .catch(() => live && setFailed("The details couldn't be loaded. Try again."));
    return () => {
      live = false;
    };
  }, [requestId, taskKey]);
  return (
    <Dialog open onClose={onClose} title={data ? `Change details: ${data.requestNo}` : "Change details"} description={data ? `${data.title} · your step: ${data.stepLabel}` : undefined} variant="drawer" size="lg">
      {failed ? <p role="alert" className="text-label text-danger-600">{failed}</p> : data ? <ChangeDetailsForm data={data} onDone={onClose} /> : <p className="text-label text-ink-muted">Loading…</p>}
    </Dialog>
  );
}

function ChangeDetailsForm({ data, onDone }: { data: ChangeDetailsData; onDone: () => void }) {
  const { result, pending, onSubmit } = useActionForm(changeDetailsAction);
  const [levels, setLevels] = useState<Level[]>(() => (data.levels ?? []).map((level) => ({ ...level, changed: false })));
  const [levelsTouched, setLevelsTouched] = useState(false);
  useEffect(() => {
    if (result?.ok) {
      const timer = window.setTimeout(onDone, 900);
      return () => window.clearTimeout(timer);
    }
  }, [result, onDone]);
  const update = (index: number, change: Partial<Level>) => {
    setLevelsTouched(true);
    setLevels((list) => list.map((level, at) => (at === index ? { ...level, ...change, changed: true } : level)));
  };
  const move = (index: number, by: -1 | 1) => {
    setLevelsTouched(true);
    setLevels((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const levelsJson = levelsTouched
    ? JSON.stringify(levels.map((level) => (level.key === "new" || level.key.startsWith("new-") ? { key: "new", label: level.label, userIds: level.userIds, rule: level.rule } : level.changed ? { key: level.key, label: level.label, ...(level.userIds.length ? { userIds: level.userIds } : {}), rule: level.rule } : { key: level.key })))
    : "";
  const fileFields = new Set(data.form.filter((field) => field.type === "ATTACHMENT").map((field) => field.key));
  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="change-details-form">
      <input type="hidden" name="requestId" value={data.requestId} />
      <input type="hidden" name="taskKey" value={data.taskKey} />
      <input type="hidden" name="changeValues" value="1" />
      <input type="hidden" name="levels" value={levelsJson} />
      <section aria-labelledby="cd-values">
        <h3 id="cd-values" className="mb-1 font-semibold">
          Values
        </h3>
        <p className="mb-3 text-caption text-ink-muted">Change any value. Files stay as they are. New values start your level again, so everyone at it sees them; earlier approvals stand unless the new values change the route.</p>
        <DynamicFields fields={data.form} mode="resubmit" people={data.people} lookups={data.lookups ?? NO_LOOKUPS} initial={data.initial} existingFiles={data.existingFiles} locked={(key) => fileFields.has(key)} result={result} />
      </section>
      {data.levels && (
        <section aria-labelledby="cd-levels">
          <h3 id="cd-levels" className="mb-1 font-semibold">
            Levels after yours
          </h3>
          <p className="mb-3 text-caption text-ink-muted">Change who approves, add a level or remove one. Levels up to yours stay as they are. Approvers must be able to approve (Manager and above); not the requester or you.</p>
          <ol className="space-y-3" data-testid="cd-levels">
            {levels.map((level, index) => (
              <li key={level.key + index} className="rounded-md border border-line p-3">
                {level.editable ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 text-label">
                        <span className="field-label">Level name</span>
                        <input className="field-input h-9" value={level.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} />
                      </label>
                      <label className="text-label">
                        <span className="field-label">Who must approve</span>
                        <select className="field-input h-9" value={level.rule} onChange={(event) => update(index, { rule: event.target.value as LevelRule })}>
                          <option value="ALL">Everyone picked</option>
                          <option value="ANY_ONE">Any one of them</option>
                        </select>
                      </label>
                      <button type="button" className="btn-secondary btn-compact" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${level.label} up`}>
                        <ArrowUp aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-secondary btn-compact" onClick={() => move(index, 1)} disabled={index === levels.length - 1} aria-label={`Move ${level.label} down`}>
                        <ArrowDown aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-danger-quiet btn-compact"
                        onClick={() => {
                          setLevelsTouched(true);
                          setLevels((list) => list.filter((_, at) => at !== index));
                        }}
                        aria-label={`Remove ${level.label}`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                    {level.pick && level.userIds.length === 0 && <p className="text-caption text-ink-muted">Now: {level.pick}. Pick people to replace it.</p>}
                    <PeoplePicker label="Approvers" options={data.approvers} value={level.userIds} onChange={(ids) => update(index, { userIds: ids })} max={50} />
                  </div>
                ) : (
                  <p className="text-label">
                    <span className="font-medium">{level.label}</span> <span className="text-ink-muted">· {level.pick || "Specific people"} · stays as it is</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn-secondary btn-compact mt-3 inline-flex items-center gap-1"
            onClick={() => {
              setLevelsTouched(true);
              setLevels((list) => [...list, { key: `new-${Date.now()}`, label: `Level ${list.length + 2}`, editable: true, userIds: [], pick: "", rule: "ALL", changed: true }]);
            }}
            data-testid="cd-add-level"
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add a level
          </button>
        </section>
      )}
      <section>
        <label htmlFor="cd-reason" className="field-label">
          Reason for the change <span className="text-danger-600">*</span>
        </label>
        <textarea id="cd-reason" name="reason" required minLength={3} maxLength={1000} rows={3} className="field-input" data-autofocus placeholder="e.g. Corrected the quantity after checking with stores" />
        <FieldError result={result} name="reason" />
        <p className="mt-1 text-caption text-ink-muted">The requester and everyone who already approved are told what changed and why.</p>
      </section>
      <ResultMessage result={result} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </div>
    </form>
  );
}
