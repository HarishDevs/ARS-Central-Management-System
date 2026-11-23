"use client";

import { createDelegationAction, stopDelegationAction } from "@/app/users/collab-actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { PersonSelect } from "@/features/ui/PersonSelect";

// Out of office (F-30, D-062). userId is set only when IT sets it for someone.
// v1.85.3 (owner): dates may go back up to 30 days (earliest), to record leave already taken.
export function DelegationForm({ people, today, earliest, userId }: { people: { id: number; label: string; detail?: string }[]; today: string; earliest: string; userId?: number }) {
  const { result, pending, formRef, onSubmit } = useActionForm(createDelegationAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      {userId && <input type="hidden" name="userId" value={userId} />}
      <div className="sm:col-span-2">
        <label htmlFor="d-delegate" className="field-label">
          Who approves while you&apos;re away
        </label>
        <PersonSelect id="d-delegate" name="delegateId" options={people} emptyLabel="Choose a person…" />
        <FieldError result={result} name="delegateId" />
      </div>
      <div>
        <label htmlFor="d-from" className="field-label">
          From
        </label>
        <input id="d-from" name="startsOn" type="date" defaultValue={today} min={earliest} aria-describedby="d-dates-hint" className="field-input" />
      </div>
      <div>
        <label htmlFor="d-to" className="field-label">
          To (inclusive)
        </label>
        <input id="d-to" name="endsOn" type="date" min={earliest} aria-describedby="d-dates-hint" className="field-input" />
      </div>
      <p id="d-dates-hint" className="text-caption text-ink-muted sm:col-span-2">
        You can go back up to 30 days to record leave already taken. Dates that are already over are only recorded: nobody is asked to cover them.
      </p>
      <div className="sm:col-span-2">
        <label htmlFor="d-reason" className="field-label">
          Reason <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input id="d-reason" name="reason" maxLength={200} placeholder="e.g. On leave" className="field-input" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pending={pending} className="btn-compact">
          Set out of office
        </SubmitButton>
        <div className="min-w-0 flex-1">
          <ResultMessage result={result} />
        </div>
      </div>
    </form>
  );
}

export function StopDelegationButton({ delegationId }: { delegationId: number }) {
  const { result, pending, onSubmit, confirmBar } = useActionForm(stopDelegationAction, { confirm: "Your delegate stops seeing your approvals straight away.", confirmTitle: "End this out-of-office now?", confirmLabel: "Yes, end it" });
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="delegationId" value={delegationId} />
      <SubmitButton pending={pending} variant="secondary" className="btn-compact">
        End now
      </SubmitButton>
      {result && !result.ok && <ResultMessage result={result} />}
      {confirmBar}
    </form>
  );
}
