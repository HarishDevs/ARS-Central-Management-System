"use client";

import { taskFieldsAction } from "@/app/users/work/actions";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { formatDayRange, todayInIndia } from "@/features/ui/date-range";
import { useWorkCall } from "@/features/work/client";

const indiaDayOf = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

// v1.75.0 (D-399): a list cell's due date: the compact, due-only mode of the
// shared date picker. The cell shows the task's dates as the app writes them
// ("Tomorrow", "30 Nov – 4 Dec" when it has a start); a picked day is saved
// at once (the holiday question still applies).
export function DueCell({ task, toneClass = "", disabled = false, boxed = false }: { task: { id: number; title: string; dueAt: string | null; startsOn?: string | null; isMilestone?: boolean }; toneClass?: string; disabled?: boolean; boxed?: boolean }) {
  const { call } = useWorkCall();
  const due = task.dueAt ? indiaDayOf(task.dueAt) : "";
  const text = formatDayRange(task.isMilestone ? "" : (task.startsOn ?? ""), due, todayInIndia(), true, false); // D-471: dates, not weekday names
  return (
    <span className="block min-w-0" data-due={due || undefined}>
      <DateRangePicker
        mode="single"
        weekdays={false}
        label={`Due date of ${task.title}`}
        dueLabel="Due date"
        dueRequired
        compact
        disabled={disabled}
        value={{ start: "", due }}
        triggerLabel={`Due date of ${task.title}: ${due || "none"}${disabled ? "" : ". Change"}`}
        triggerClass={`flex w-full min-w-0 items-center rounded px-1 text-left text-label hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40 disabled:cursor-default disabled:hover:bg-transparent ${boxed ? "h-8 border border-line" : "h-7"} ${due ? toneClass : "text-ink-faint"}`}
        triggerContent={<span className="truncate">{text || "Set due date"}</span>}
        onCommit={(next) => {
          if (next.due && next.due !== due) void call((choice) => taskFieldsAction(task.id, { dueDay: choice?.moveTo ?? next.due, holidayOk: choice?.holidayOk }), { success: false });
        }}
      />
    </span>
  );
}

// v1.93.0 (D-446): a list cell's start date (the Start date column), the same
// compact picker in single mode; clearing it removes the start date. The server
// checks the right to change it, the milestone rule and the holiday question.
export function StartCell({ task, disabled = false }: { task: { id: number; title: string; startsOn?: string | null }; disabled?: boolean }) {
  const { call } = useWorkCall();
  const start = task.startsOn ?? "";
  const text = formatDayRange("", start, todayInIndia(), true, false);
  return (
    <span className="block min-w-0" data-start={start || undefined} data-testid="start-cell">
      <DateRangePicker
        mode="single"
        weekdays={false}
        label={`Start date of ${task.title}`}
        dueLabel="Start date"
        compact
        disabled={disabled}
        value={{ start: "", due: start }}
        triggerLabel={`Start date of ${task.title}: ${start || "none"}${disabled ? "" : ". Change"}`}
        triggerClass={`flex h-7 w-full min-w-0 items-center rounded px-1 text-left text-label hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40 disabled:cursor-default disabled:hover:bg-transparent ${start ? "" : "text-ink-faint"}`}
        triggerContent={<span className="truncate">{text || "Set start date"}</span>}
        onCommit={(next) => {
          if (next.due !== start) void call((choice) => taskFieldsAction(task.id, { startDay: choice?.moveTo ?? next.due, holidayOk: choice?.holidayOk }), { success: false });
        }}
      />
    </span>
  );
}
