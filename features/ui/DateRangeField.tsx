"use client";

import { DateRangePicker } from "@/features/ui/DateRangePicker";

// v1.89.0 (D-425, UIQA-CON-08 batch 5): a labelled From – To field for the filter and
// period forms (Analytics, dashboards, Task / Information filters, reports). It replaces
// two native date inputs (which showed "24-11-2026" in the browser's own format) with the
// shared DateRangePicker: one button that reads the app's day format, the keyboard grid,
// the phone's bottom sheet, and two hidden inputs so a plain GET form sends the same
// names as before (from / to by default).
export function DateRangeField({
  id,
  label = "Dates",
  hint,
  from,
  to,
  names = { start: "from", due: "to" },
  min,
  max,
  pickerLabel,
  testId,
  className,
}: {
  id: string;
  label?: string;
  /** Muted words after the label, e.g. "(custom)". */
  hint?: string;
  from?: string | null;
  to?: string | null;
  names?: { start: string; due: string };
  min?: string;
  max?: string;
  /** The picker dialog's name (default: the label). */
  pickerLabel?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={className} data-testid={testId ? `${testId}-field` : undefined}>
      <span id={`${id}-label`} className="field-label">
        {label}
        {hint ? <span className="font-normal text-ink-faint"> {hint}</span> : null}
      </span>
      <DateRangePicker
        idBase={id}
        label={pickerLabel ?? label}
        startLabel="From"
        dueLabel="To"
        defaultValue={{ start: from ?? "", due: to ?? "" }}
        min={min}
        max={max}
        names={names}
        placeholder="Any dates"
        triggerDescribedBy={`${id}-label`}
        testId={testId ?? id}
      />
    </div>
  );
}
