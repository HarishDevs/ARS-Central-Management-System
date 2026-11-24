"use client";

import { formatDate } from "@/lib/format/date";
import { Clock, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { changeTimeEntryAction, logTimeAction, setEstimateAction, timeTimerAction } from "@/app/users/work/collab-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { useWorkCall } from "@/features/work/client";
import { formatMinutes } from "@/server/work/collab-rules";
import { DateRangePicker } from "@/features/ui/DateRangePicker";

// v1.71.0 (D-384, PM phase E part 2): a task's Time section. Log time by hand
// (day, how long, a note) or with Start/Stop; the task's estimate; every
// entry with who logged it, and totals per person against the estimate.
// People change their own entries; the project's owners and editors (and
// IT) can change anyone's (recorded in the task's history and the audit log).
export interface TimeData {
  taskId: number;
  entries: { id: number; userId: number; userName: string; workDay: string; minutes: number | null; note: string | null; source: "MANUAL" | "TIMER"; startedAt: string | null; edited: boolean; canChange: boolean }[];
  total: number;
  people: { userId: number; name: string; minutes: number }[];
  estimate: number | null; // v1.74.0 (D-398): the effective estimate
  estimateSource?: "MANUAL" | "DATES" | null;
  manualEstimate?: number | null;
  durationDays?: number | null;
  hoursPerDay?: number | null;
  progress: { percent: number | null; over: boolean };
  running: { id: number; startedAt: string } | null;
  canLog: boolean;
  canEstimate: boolean;
  today: string;
}
const dayText = (day: string) => formatDate(day);

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{formatMinutes(Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)))}</>;
}

export function TimeSection({ data }: { data: TimeData }) {
  const { call, pending } = useWorkCall();
  const [day, setDay] = useState(data.today);
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  // v1.74.0 (D-398): the box holds the manual estimate only; empty = the estimate from the dates.
  const manual = data.manualEstimate === undefined ? data.estimate : data.manualEstimate;
  const [estimate, setEstimate] = useState(manual ? formatMinutes(manual) : "");
  const fromDates = data.estimateSource === "DATES";
  const durationNote =
    data.durationDays && data.hoursPerDay
      ? `${data.durationDays} working day${data.durationDays === 1 ? "" : "s"} from the start date to the due date${fromDates ? ` × ${data.hoursPerDay} h a day` : ""}`
      : null;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ workDay: "", duration: "", note: "" });
  const log = async () => {
    const result = await call(() => logTimeAction(data.taskId, { workDay: day, duration, note }));
    if (result?.ok) {
      setDuration("");
      setNote("");
    }
  };
  const summary = data.estimate ? `${formatMinutes(data.total)} of ${formatMinutes(data.estimate)} estimated${fromDates ? " from dates" : ""}${data.progress.percent !== null ? ` (${data.progress.percent}%)` : ""}` : `${formatMinutes(data.total)} logged`;
  return (
    <section className="card space-y-3 px-5 py-4" aria-labelledby={`time-${data.taskId}`} data-testid="task-time">
      <h2 id={`time-${data.taskId}`} className="flex items-center gap-2 font-semibold">
        <Clock aria-hidden="true" className="h-4 w-4" /> Time
      </h2>
      <p className={`text-label ${data.progress.over ? "text-danger-600" : "text-ink-muted"}`} data-testid="time-summary">
        {summary}
        {data.progress.over ? " · over the estimate" : ""}
      </p>
      {durationNote && (
        <p className="text-caption text-ink-muted" data-testid="time-estimate-source">
          {fromDates ? `Estimated from dates: ${durationNote}. Set an estimate to replace it.` : data.estimateSource === "MANUAL" ? `Set by hand. Duration: ${durationNote}.` : `Duration: ${durationNote}.`}
        </p>
      )}
      {data.estimate !== null && data.progress.percent !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Time logged against the estimate" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, data.progress.percent)}>
          <div className={`h-full ${data.progress.over ? "bg-danger-600" : "bg-primary-600"}`} style={{ width: `${Math.min(100, data.progress.percent)}%` }} />
        </div>
      )}
      {data.people.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-caption" aria-label="Time by person">
          {data.people.map((person) => (
            <li key={person.userId} className="rounded-full bg-surface-muted px-2 py-0.5">
              {person.name}: {formatMinutes(person.minutes)}
            </li>
          ))}
        </ul>
      )}
      {data.canEstimate && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void call(() => setEstimateAction(data.taskId, estimate));
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-ink-muted">
            Estimate
            <input className="field-input field-compact w-32" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="e.g. 4h" aria-describedby={`estimate-hint-${data.taskId}`} data-testid="time-estimate" />
          </label>
          <button type="submit" className="btn-secondary btn-compact" disabled={pending}>
            Set estimate
          </button>
          <span id={`estimate-hint-${data.taskId}`} className="text-caption text-ink-faint">
            {data.hoursPerDay ? "Like 4h, 90m or 1:30. Empty goes back to the estimate from the dates." : "Like 4h, 90m or 1:30. Empty clears it."}
          </span>
        </form>
      )}
      {data.canLog && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            {data.running ? (
              <>
                <span className="text-label" role="status" data-testid="time-running">
                  Your timer is running: <Elapsed since={data.running.startedAt} />
                </span>
                <button type="button" className="btn-primary btn-compact" disabled={pending} onClick={() => void call(() => timeTimerAction(data.taskId, "stop"))} data-testid="time-stop">
                  <Square aria-hidden="true" className="h-4 w-4" /> Stop
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary btn-compact" disabled={pending} onClick={() => void call(() => timeTimerAction(data.taskId, "start"))} data-testid="time-start">
                <Play aria-hidden="true" className="h-4 w-4" /> Start timer
              </button>
            )}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            aria-label="Log time"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) void log();
            }}
          >
            {/* v1.75.0 (D-399): the shared date picker, one day up to today. */}
            <div className="flex flex-col gap-1 text-caption text-ink-muted">
              Day
              <DateRangePicker mode="single" compact label="Day worked" dueLabel="Day" max={data.today} value={{ start: "", due: day }} onChange={(next) => setDay(next.due)} placeholder="Choose the day" testId="time-day" />
            </div>
            <label className="flex flex-col gap-1 text-caption text-ink-muted">
              How long
              <input className="field-input field-compact w-28" value={duration} required placeholder="1h 30m" onChange={(event) => setDuration(event.target.value)} data-testid="time-duration" />
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-caption text-ink-muted">
              Note (optional)
              <input className="field-input field-compact w-auto" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} data-testid="time-note" />
            </label>
            <button type="submit" className="btn-primary btn-compact" disabled={pending} data-testid="time-log">
              Log time
            </button>
          </form>
        </div>
      )}
      {data.entries.length === 0 ? (
        <p className="text-caption text-ink-muted">No time logged yet.</p>
      ) : (
        <ul className="divide-y divide-line text-label" aria-label="Time entries" data-testid="time-entries">
          {data.entries.map((entry) => (
            <li key={entry.id} className="py-2" data-testid="time-entry">
              {editing === entry.id ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  aria-label={`Change ${entry.userName}'s entry`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!pending) void call(() => changeTimeEntryAction(entry.id, draft)).then((result) => result?.ok && setEditing(null));
                  }}
                >
                  <div className="flex flex-col gap-1 text-caption text-ink-muted">
                    Day
                    <DateRangePicker mode="single" compact label="Day worked" dueLabel="Day" max={data.today} value={{ start: "", due: draft.workDay }} onChange={(next) => setDraft({ ...draft, workDay: next.due })} placeholder="Choose the day" />
                  </div>
                  <label className="flex flex-col gap-1 text-caption text-ink-muted">
                    How long
                    <input className="field-input field-compact w-28" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} />
                  </label>
                  <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-caption text-ink-muted">
                    Note
                    <input className="field-input field-compact w-auto" value={draft.note} maxLength={500} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
                  </label>
                  <button type="submit" className="btn-primary btn-compact" disabled={pending}>
                    Save
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{entry.minutes === null ? "Running" : formatMinutes(entry.minutes)}</span>
                  <span>{entry.userName}</span>
                  <span className="text-caption text-ink-muted">
                    {dayText(entry.workDay)} · {entry.source === "TIMER" ? "timer" : "by hand"}
                    {entry.edited ? " · changed" : ""}
                  </span>
                  {entry.note && <span className="w-full text-caption text-ink-muted">{entry.note}</span>}
                  {entry.canChange && entry.minutes !== null && (
                    <span className="ml-auto flex gap-3 text-caption">
                      <button
                        type="button"
                        className="text-ink-muted hover:text-ink"
                        aria-label={`Change ${entry.userName}'s ${formatMinutes(entry.minutes)} on ${dayText(entry.workDay)}`}
                        onClick={() => {
                          setDraft({ workDay: entry.workDay, duration: formatMinutes(entry.minutes ?? 0), note: entry.note ?? "" });
                          setEditing(entry.id);
                        }}
                      >
                        Change
                      </button>
                      <ConfirmButton title="Delete this time entry?" body={`${formatMinutes(entry.minutes)} by ${entry.userName} on ${dayText(entry.workDay)} is removed from the task's time.`} className="text-ink-muted hover:text-danger-600" onConfirm={() => call(() => changeTimeEntryAction(entry.id, { delete: true }), { success: "Entry deleted." })}>
                        Delete
                      </ConfirmButton>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
