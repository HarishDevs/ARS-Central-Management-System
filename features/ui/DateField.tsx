"use client";

import { useEffect, useRef, useState } from "react";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { isRealDay, longDay } from "@/features/ui/date-range";
import { formatClock } from "@/lib/format/date";

// v1.89.0 stage 4 (D-426, owner: "one design system everywhere"): ONE date
// field for the record forms (meetings, tasks, information, tickets, form
// fields, the palette's filters, admin editors), in place of the native
// date and date-time inputs that showed the
// browser's own "24-11-2026" and its own calendar. It is the shared
// DateRangePicker in single mode (the keyboard grid, the phone's bottom
// sheet, type dd-mm-yyyy or yyyy-mm-dd), plus:
//   - the same name and value as before: a date sends "yyyy-mm-dd", a date
//     and time ("withTime") sends "yyyy-mm-ddTHH:MM" (the datetime-local
//     format), so server actions and form-builder answers read the same text;
//   - the time (withTime) as a time box beside the button (as the picker's
//     own time); choosing a day with no time fills `defaultTime`;
//   - `required` still stops the form: a named input takes part in the
//     browser's check, and an empty one says "Choose a date." under the
//     button (the browser's own bubble is not shown) and focuses the button;
//   - a form reset puts the default back (like a native input);
//   - an `input` event on change, so "unsaved changes" guards notice it.
// The <label htmlFor={id}> outside names the button (the id is the button's).
export function DateField({
  id,
  name,
  label,
  defaultValue = "",
  value,
  onChange,
  required = false,
  min,
  max,
  withTime = false,
  defaultTime = "09:00",
  placeholder = "Choose a date",
  invalid = false,
  describedBy,
  disabled = false,
  compact = false,
  className = "",
  testId,
}: {
  id: string;
  name?: string;
  /** Read with the button and in the picker ("Due", "Date"). */
  label: string;
  defaultValue?: string;
  /** Controlled value ("yyyy-mm-dd" or "yyyy-mm-ddTHH:MM"). */
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  min?: string;
  max?: string;
  withTime?: boolean;
  /** HH:MM filled when a day is chosen and no time is set yet. */
  defaultTime?: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  /** The toolbar height (field-compact). */
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const [round, setRound] = useState(0);
  const [missing, setMissing] = useState(false);
  const proxy = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const touched = useRef(false);
  const current = value ?? own;
  const day = isRealDay(current.slice(0, 10)) ? current.slice(0, 10) : "";
  const [time, setTime] = useState(() => (withTime ? current.slice(11, 16) : ""));
  // A controlled value from outside brings its own time.
  useEffect(() => {
    if (withTime && value !== undefined) setTime(value.slice(11, 16));
  }, [withTime, value]);
  const sent = !day ? "" : withTime ? `${day}T${time || defaultTime}` : day;

  const emit = (nextDay: string, nextTime: string) => {
    touched.current = true;
    const text = !nextDay ? "" : withTime ? `${nextDay}T${nextTime || defaultTime}` : nextDay;
    if (value === undefined) setOwn(text);
    if (text) setMissing(false);
    onChange?.(text);
  };

  // Like a native input, the default comes back when the form is reset.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form || value !== undefined) return;
    const reset = () => {
      setOwn(defaultValue);
      setTime(withTime ? defaultValue.slice(11, 16) : "");
      setMissing(false);
      setRound((was) => was + 1);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [value, defaultValue, withTime]);

  // Tell the form something changed (UnsavedGuard listens for "input").
  useEffect(() => {
    if (!touched.current) return;
    proxy.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [sent]);

  const errorId = `${id}-missing`;
  const described = [describedBy, missing ? errorId : null].filter(Boolean).join(" ") || undefined;
  const spoken = `${label}: ${day ? longDay(day) : "none"}${withTime && day ? `, ${formatClock(time || defaultTime)}` : ""}. Change`;
  const triggerClass = `${compact ? "field-input field-compact" : "field-input"} flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 data-[invalid]:border-danger-600 ${day ? "text-ink" : "text-ink-faint"}`;

  return (
    <span ref={box} className={`relative flex min-w-0 flex-col ${className}`} data-testid={testId}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 [&>span]:flex [&>span]:w-full">
          <DateRangePicker
            key={round}
            mode="single"
            idBase={id}
            triggerId={id}
            triggerLabel={spoken}
            label={label}
            dueLabel={label}
            value={{ start: "", due: day }}
            onChange={(next) => {
              const nextTime = withTime && next.due && !time ? defaultTime : time;
              if (nextTime !== time) setTime(nextTime);
              emit(next.due, nextTime);
            }}
            min={min || undefined}
            max={max || undefined}
            placeholder={placeholder}
            triggerClass={triggerClass}
            triggerDescribedBy={described}
            triggerInvalid={invalid || missing}
            disabled={disabled}
            testId={testId ? `${testId}-picker` : id}
          />
        </span>
        {withTime && (
          <input
            id={`${id}-time`}
            type="time"
            aria-label={`${label} time`}
            value={time}
            disabled={disabled}
            onChange={(event) => {
              setTime(event.target.value);
              emit(day, event.target.value);
            }}
            onBlur={() => {
              // An empty time with a day keeps the default (shown, not guessed later).
              if (day && !time) setTime(defaultTime);
            }}
            className={`${compact ? "field-input field-compact" : "field-input"} w-32 shrink-0`}
          />
        )}
      </span>
      {(name || required) && (
        <input
          ref={proxy}
          name={name}
          value={sent}
          onChange={() => undefined}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          onInvalid={(event) => {
            // Our message under the button instead of the browser's bubble on a hidden box.
            event.preventDefault();
            setMissing(true);
            document.getElementById(id)?.focus();
          }}
          className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
          data-date-value=""
        />
      )}
      {missing && (
        <span id={errorId} role="alert" className="mt-1 text-caption text-danger-600">
          {withTime ? "Choose a date and time." : "Choose a date."}
        </span>
      )}
    </span>
  );
}
