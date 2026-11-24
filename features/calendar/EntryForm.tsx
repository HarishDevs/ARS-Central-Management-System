"use client";

import { useEffect, useState } from "react";
import { saveCalendarItemAction } from "@/app/users/calendar-actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { DateRangePicker } from "@/features/ui/DateRangePicker";

export interface EntryValues {
  itemId?: number;
  title: string;
  notes: string;
  allDay: boolean;
  date: string;
  endDate: string;
  start: string;
  end: string;
}

// v1.11.0: a personal calendar entry (times in India time). It syncs to
// Google Calendar when the person has connected it.
export function EntryForm({ values, submitLabel }: { values: EntryValues; submitLabel: string }) {
  const { result, pending, onSubmit, formRef } = useActionForm(saveCalendarItemAction, { resetOnSuccess: values.itemId === undefined });
  const [allDay, setAllDay] = useState(values.allDay);
  // v1.89.0 (D-425): the shared date picker (the app's day format, keyboard grid, phone sheet)
  // instead of native date inputs; the form still sends date / endDate (yyyy-mm-dd).
  const [date, setDate] = useState(values.date);
  const [endDate, setEndDate] = useState(values.endDate);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!result?.ok || values.itemId !== undefined) return;
    setDate(values.date);
    setEndDate(values.endDate);
    setRound((value) => value + 1);
  }, [result, values.date, values.endDate, values.itemId]);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={values.itemId ? "Edit entry" : "New entry"}>
      {values.itemId !== undefined && <input type="hidden" name="itemId" value={values.itemId} />}
      <label className="text-label sm:col-span-2">
        Title
        <input name="title" required maxLength={200} defaultValue={values.title} className="field-input mt-1 w-full" />
        <FieldError result={result} name="title" />
      </label>
      <label className="flex items-center gap-2 text-label sm:col-span-2">
        <input type="checkbox" name="allDay" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} className="h-4 w-4" />
        All day
      </label>
      <div className="text-label">
        <span id={`entry-date-label-${values.itemId ?? "new"}`} className="block">
          {allDay ? "From" : "Date"}
        </span>
        <span className="mt-1 block">
          <DateRangePicker
            key={`d${round}`}
            mode="single"
            idBase={`entry-date-${values.itemId ?? "new"}`}
            label={allDay ? "From" : "Date"}
            dueLabel={allDay ? "From" : "Date"}
            value={{ start: "", due: date }}
            onChange={(next) => setDate(next.due)}
            names={{ due: "date" }}
            placeholder="Choose a day"
            triggerDescribedBy={`entry-date-label-${values.itemId ?? "new"}`}
            testId="entry-date"
          />
        </span>
        <FieldError result={result} name="date" />
      </div>
      {allDay ? (
        <div className="text-label">
          <span id={`entry-end-label-${values.itemId ?? "new"}`} className="block">
            To (optional)
          </span>
          <span className="mt-1 block">
            <DateRangePicker
              key={`e${round}`}
              mode="single"
              idBase={`entry-end-${values.itemId ?? "new"}`}
              label="To"
              dueLabel="To"
              value={{ start: "", due: endDate }}
              onChange={(next) => setEndDate(next.due)}
              min={date || undefined}
              names={{ due: "endDate" }}
              placeholder="Same day"
              triggerDescribedBy={`entry-end-label-${values.itemId ?? "new"}`}
              testId="entry-end-date"
            />
          </span>
          <FieldError result={result} name="endDate" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-label">
            Starts
            <input name="start" type="time" defaultValue={values.start} className="field-input mt-1 w-full" />
            <FieldError result={result} name="start" />
          </label>
          <label className="text-label">
            Ends
            <input name="end" type="time" defaultValue={values.end} className="field-input mt-1 w-full" />
            <FieldError result={result} name="end" />
          </label>
        </div>
      )}
      <label className="text-label sm:col-span-2">
        Notes (optional)
        <textarea name="notes" rows={2} maxLength={2000} defaultValue={values.notes} className="field-input mt-1 w-full" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        <ResultMessage result={result} />
      </div>
    </form>
  );
}
