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
  const text = formatDayRange(task.isMilestone ? "" : (task.startsOn ?? ""), due, todayInIndia());
  return (
    <span className="block min-w-0" data-due={due || undefined}>
      <DateRangePicker
        mode="single"
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
