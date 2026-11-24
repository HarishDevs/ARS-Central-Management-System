"use client";

import { createDelegationAction, stopDelegationAction } from "@/app/users/collab-actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { DateRangePicker, type DateRangeValue } from "@/features/ui/DateRangePicker";
import { addDays } from "@/features/ui/date-range";
import { useEffect, useState } from "react";

// D-415: at most 90 days, both ends counted (checkDelegationInput says the same on the server).
const MAX_DAYS = 90;

// Out of office (F-30, D-062). userId is set only when IT sets it for someone.
// v1.85.3 (owner): dates may go back up to 30 days (earliest), to record leave already taken.
export function DelegationForm({ people, today, earliest, userId }: { people: { id: number; label: string; detail?: string }[]; today: string; earliest: string; userId?: number }) {
  const { result, pending, formRef, onSubmit } = useActionForm(createDelegationAction, { resetOnSuccess: true });
  // v1.89.0 (D-425): the shared date picker (From – To) instead of two native date inputs. The D-415
  // rules stay: the earliest day is 30 days back (min), and once From is chosen the last day
  // offered is From + 89 (90 days). A saved out-of-office starts the picker again from today.
  const fresh: DateRangeValue = { start: today, due: "" };
  const [dates, setDates] = useState<DateRangeValue>(fresh);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!result?.ok) return;
    setDates({ start: today, due: "" });
    setRound((value) => value + 1);
  }, [result, today]);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      {userId && <input type="hidden" name="userId" value={userId} />}
      <div className="sm:col-span-2">
        <label htmlFor="d-delegate" className="field-label">
          Who approves while you&apos;re away
        </label>
        {/* v1.89.0 (D-424, FORM-02): the error is tied to the picker (marked, and read with it through aria-describedby;
            aria-invalid is not allowed on the picker's button role, ARIA 1.2). */}
        <PersonSelect
          id="d-delegate"
          name="delegateId"
          options={people}
          emptyLabel="Choose a person…"
          ariaInvalid={Boolean(result && !result.ok && result.fieldErrors?.delegateId)}
          ariaDescribedBy={result && !result.ok && result.fieldErrors?.delegateId ? "delegateId-error" : undefined}
        />
        <FieldError result={result} name="delegateId" />
      </div>
      <div className="sm:col-span-2">
        <span id="d-dates-label" className="field-label">
          Away from – to (inclusive)
        </span>
        <DateRangePicker
          key={round}
          idBase="d-dates"
          label="Out of office dates"
          startLabel="From"
          dueLabel="To"
          value={dates}
          onChange={setDates}
          min={earliest}
          max={dates.start ? addDays(dates.start, MAX_DAYS - 1) : ""}
          names={{ start: "startsOn", due: "endsOn" }}
          placeholder="Choose dates"
          triggerDescribedBy="d-dates-label d-dates-hint"
          testId="delegation-dates"
        />
      </div>
      <p id="d-dates-hint" className="text-caption text-ink-muted sm:col-span-2">
        You can go back up to 30 days to record leave already taken, for up to 90 days at a time. Dates that are already over are only recorded: nobody is asked to cover them.
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
