"use client";

import { useEffect, useState } from "react";
import { assignTicketAction, commentTicketAction, acceptResolutionAction, raiseTicketAction, reopenTicketAction, ticketWorkAction } from "@/app/users/tickets/actions";
import { DynamicFields } from "@/features/requests/DynamicFields";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { FileListInput } from "@/features/ui/FileListInput";
import { RichEditor } from "@/features/ui/RichEditor";
import { PersonSelect, type PersonChoice } from "@/features/ui/PersonSelect";
import { Hint } from "@/features/ui/Hint";
import type { FieldLookups, FormField } from "@/server/forms/fields";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, type TicketPriority } from "@/server/modules/settings";

// v1.55.0 (owner's ticketing brief): the forms of the ticket pages.
import { ACCEPT_ATTRIBUTE as ACCEPT } from "@/server/attachments/files";

export function RaiseTicketForm({
  typeId,
  typeName,
  categoryName,
  form,
  people,
  lookups,
  me,
  priorityChoice,
  defaultPriority,
  submissionKey,
  today,
}: {
  typeId: number;
  typeName: string;
  categoryName: string;
  form: FormField[];
  people: PersonChoice[];
  lookups: FieldLookups;
  me: { name: string; loginId: string; department: string | null; email: string };
  priorityChoice: boolean;
  defaultPriority: TicketPriority;
  submissionKey: string;
  today: string;
}) {
  const { result, pending, onSubmit } = useActionForm(raiseTicketAction);
  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-label="Raise a ticket" data-testid="raise-ticket">
      <input type="hidden" name="type" value={typeId} />
      <input type="hidden" name="submission_key" value={submissionKey} />
      {/* Filled in from your user details (owner's brief §3). */}
      <section className="card grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Your details">
        {[
          ["Employee name", me.name],
          ["Employee ID", me.loginId],
          ["Department", me.department ?? "—"],
          ["Email", me.email],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-caption text-ink-muted">{label}</p>
            <p className="break-words text-label font-medium">{value}</p>
          </div>
        ))}
      </section>
      <section className="card space-y-4 px-5 py-4">
        <p className="text-label">
          <span className="text-ink-muted">Ticket type:</span> <span className="font-medium">{categoryName} · {typeName}</span>
        </p>
        <div>
          <label htmlFor="ticket-title" className="field-label">
            Subject <span className="text-danger-600" aria-hidden="true">*</span>
          </label>
          <input id="ticket-title" name="title" required minLength={3} maxLength={200} className="field-input" aria-required="true" />
          <FieldError result={result} name="title" />
        </div>
        <div>
          {/* v1.55.2 (D-330, owner): the box is headed "Issue Description". */}
          <p className="field-label">
            Issue Description <span className="text-danger-600" aria-hidden="true">*</span>
          </p>
          <RichEditor id="ticket-description" name="description" label="Issue Description" placeholder="Describe the issue: what happened, where, and since when." minHeight={140} maxLength={20000} testId="ticket-description" />
          <FieldError result={result} name="description" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {priorityChoice && (
            <div>
              <label htmlFor="ticket-priority" className="field-label">
                Priority <span className="text-danger-600" aria-hidden="true">*</span>
              </label>
              <select id="ticket-priority" name="priority" defaultValue={defaultPriority} required aria-required="true" className="field-input">
                {TICKET_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {TICKET_PRIORITY_LABEL[priority]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="ticket-required" className="field-label">
              Required date <span className="text-danger-600" aria-hidden="true">*</span>
            </label>
            <input id="ticket-required" name="required_on" type="date" min={today} required aria-required="true" className="field-input" />
            <FieldError result={result} name="required_on" />
          </div>
        </div>
        {form.length > 0 && <DynamicFields fields={form} mode="submit" people={people} lookups={lookups} result={result} />}
        <div>
          <p className="field-label">Attachments</p>
          <FileListInput id="ticket-files" name="attachments" accept={ACCEPT} maxFiles={10} />
        </div>
        <FieldError result={result} name="form" />
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending}>Raise ticket</SubmitButton>
        <ResultMessage result={result} />
      </div>
    </form>
  );
}

// Coordinator: assign (or reassign) to an employee with a target date and remarks.
export function AssignTicketForm({ ticketId, rowVersion, people, current, defaultTarget, today, reassign }: { ticketId: number; rowVersion: number; people: PersonChoice[]; current: number | null; defaultTarget: string; today: string; reassign: boolean }) {
  const { result, pending, onSubmit } = useActionForm(assignTicketAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label={reassign ? "Reassign the ticket" : "Assign the ticket"} data-testid="assign-ticket">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="assign-person" className="field-label">
            Assign to <span className="text-danger-600" aria-hidden="true">*</span>
          </label>
          <PersonSelect id="assign-person" name="assignee" options={people} defaultValue={current} required ariaLabel="Assign to" testId="assign-person" />
          <FieldError result={result} name="assignee" />
        </div>
        <div>
          <label htmlFor="assign-target" className="field-label">
            Target date <span className="text-danger-600" aria-hidden="true">*</span>
          </label>
          <input id="assign-target" name="target" type="date" min={today} defaultValue={defaultTarget} required className="field-input" />
          <FieldError result={result} name="target" />
        </div>
      </div>
      <div>
        <label htmlFor="assign-remarks" className="field-label">
          Remarks for the assignee
        </label>
        <textarea id="assign-remarks" name="remarks" rows={2} maxLength={4000} className="field-input" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} className="btn-compact">
          {reassign ? "Reassign" : "Assign"}
        </SubmitButton>
        <Hint text="Assigning makes a task in the employee's Tasks, linked to this ticket. They work on it there; completing it asks the requester to confirm." align="start" />
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

// Requester: confirm (optional rating 1-5 and feedback) or reopen (reason required).
export function ConfirmTicketForms({ ticketId }: { ticketId: number }) {
  const accept = useActionForm(acceptResolutionAction);
  const reopen = useActionForm(reopenTicketAction);
  const [rating, setRating] = useState<number | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="confirm-ticket">
      <form onSubmit={accept.onSubmit} className="space-y-3 rounded-md border border-line p-4" aria-label="Confirm resolution">
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="rating" value={rating ?? ""} />
        <h3 className="font-semibold">Confirm resolution</h3>
        <fieldset>
          <legend className="field-label">Rating (optional)</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} out of 5`} onClick={() => setRating(rating === value ? null : value)} className={`h-9 w-9 rounded-md border text-label font-semibold ${rating !== null && value <= rating ? "border-warning-600 bg-warning-50 text-warning-600" : "border-line text-ink-muted hover:bg-surface-muted"}`}>
                {value}★
              </button>
            ))}
          </div>
          <FieldError result={accept.result} name="rating" />
        </fieldset>
        <div>
          <label htmlFor="confirm-feedback" className="field-label">
            Feedback (optional)
          </label>
          <textarea id="confirm-feedback" name="feedback" rows={2} maxLength={1000} className="field-input" />
        </div>
        <SubmitButton pending={accept.pending} className="btn-compact">
          Confirm and close
        </SubmitButton>
        <ResultMessage result={accept.result} />
      </form>
      <form onSubmit={reopen.onSubmit} className="space-y-3 rounded-md border border-line p-4" aria-label="Reopen the ticket">
        <input type="hidden" name="ticketId" value={ticketId} />
        <h3 className="font-semibold">Not solved?</h3>
        <div>
          <label htmlFor="reopen-reason" className="field-label">
            Reason <span className="text-danger-600" aria-hidden="true">*</span>
          </label>
          <textarea id="reopen-reason" name="reason" rows={3} required minLength={3} maxLength={2000} className="field-input" />
          <FieldError result={reopen.result} name="reason" />
        </div>
        <SubmitButton pending={reopen.pending} variant="secondary" className="btn-compact">
          Reopen ticket
        </SubmitButton>
        <ResultMessage result={reopen.result} />
      </form>
    </div>
  );
}

// Remarks (and files) on the ticket; coordinators and the assignee may keep one internal.
export function TicketRemarkForm({ ticketId, canInternal }: { ticketId: number; canInternal: boolean }) {
  const { result, pending, onSubmit } = useActionForm(commentTicketAction);
  const [editorKey, setEditorKey] = useState(0);
  // The box empties once the remark is saved.
  useEffect(() => {
    if (result?.ok) setEditorKey((value) => value + 1);
  }, [result]);
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      aria-label="Add a remark"
      data-testid="ticket-remark"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <RichEditor key={editorKey} id="ticket-remark" name="body" label="Remark" minHeight={70} maxLength={4000} testId="ticket-remark-editor" />
      <FieldError result={result} name="body" />
      <FileListInput id="ticket-remark-files" name="attachments" accept={ACCEPT} maxFiles={10} />
      <div className="flex flex-wrap items-center gap-3">
        {canInternal && (
          <label className="flex items-center gap-2 text-label">
            <input type="checkbox" name="internal" value="yes" /> Internal (the requester doesn&apos;t see it)
          </label>
        )}
        <SubmitButton pending={pending} variant="secondary" className="btn-compact">
          Add remark
        </SubmitButton>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

// v1.59.3 (D-362, owner: "For Ticket assignment i dont want task to be created
// instead i want an option to update the task status in the ticket itself"):
// the assignee's controls, on the ticket page (full) and on an Assigned to me
// row (compact): Start work, then Mark resolved with what was done.
export function TicketWorkForm({ ticketId, rowVersion = null, canStart, canResolve, compact = false }: { ticketId: number; rowVersion?: number | null; canStart: boolean; canResolve: boolean; compact?: boolean }) {
  const start = useActionForm(ticketWorkAction);
  const resolve = useActionForm(ticketWorkAction);
  const [resolving, setResolving] = useState(!compact);
  if (!canStart && !canResolve) return null;
  const hidden = (step: "START" | "RESOLVE") => (
    <>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="step" value={step} />
      {rowVersion !== null && <input type="hidden" name="rowVersion" value={rowVersion} />}
    </>
  );
  return (
    <div className={compact ? "space-y-2" : "space-y-4"} data-testid={compact ? "ticket-work-row" : "ticket-work"}>
      {canStart && (
        <form onSubmit={start.onSubmit} className={compact ? "inline" : ""}>
          {hidden("START")}
          <SubmitButton pending={start.pending} variant={compact ? "secondary" : "primary"} className="btn-compact">
            Start work
          </SubmitButton>
          {!compact && <p className="mt-1 text-caption text-ink-muted">Sets it to In progress and tells the requester.</p>}
          <ResultMessage result={start.result} />
        </form>
      )}
      {canResolve && compact && !resolving && (
        <button type="button" className="btn-secondary btn-compact ml-2" onClick={() => setResolving(true)}>
          Mark resolved
        </button>
      )}
      {canResolve && resolving && (
        <form onSubmit={resolve.onSubmit} className={compact ? "space-y-2" : "space-y-3 rounded-md border border-line p-4"} aria-label="Mark resolved">
          {hidden("RESOLVE")}
          {!compact && <h3 className="font-semibold">Mark resolved</h3>}
          <div>
            <label htmlFor={`resolve-${ticketId}${compact ? "-row" : ""}`} className={compact ? "sr-only" : "field-label"}>
              What was done <span className="text-danger-600" aria-hidden="true">*</span>
            </label>
            <textarea id={`resolve-${ticketId}${compact ? "-row" : ""}`} name="remarks" rows={compact ? 2 : 3} required minLength={3} maxLength={4000} className="field-input" placeholder="What was done" />
            <FieldError result={resolve.result} name="remarks" />
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={resolve.pending} className="btn-compact">
              Mark resolved
            </SubmitButton>
            {compact && (
              <button type="button" className="btn-secondary btn-compact" onClick={() => setResolving(false)}>
                Cancel
              </button>
            )}
          </div>
          {!compact && <p className="text-caption text-ink-muted">The requester is asked to confirm (or reopen it) within 4 working days.</p>}
          <ResultMessage result={resolve.result} />
        </form>
      )}
    </div>
  );
}
