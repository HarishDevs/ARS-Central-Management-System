"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlarmClock, CalendarClock, CheckCircle2, Lock, ListTodo, Send, Table2 } from "lucide-react";
import { RichEditor } from "@/features/ui/RichEditor";
import { ChartView } from "@/features/work/reporting/ChartView";
import { useWorkCall } from "@/features/work/client";
import { summaryAccessRequestAction, summaryNotesAction } from "@/app/users/work/actions";
import { DASHBOARD_RANGE_LABEL, DASHBOARD_RANGES, NOTES_MAX, REQUEST_NOTE_MAX, type DashboardNumber, type SummaryDashboardView } from "@/server/work/summary-extras-rules";

// v1.78.0 (D-405, Task Summary release 3, spec §3.15): the Dashboard and Notes
// tabs of a Task Summary, and Request access on a refused one. The server
// sent only what this person may see.
const NUMBER_ICON: Record<DashboardNumber["key"], { icon: typeof ListTodo; tone: string }> = {
  open: { icon: ListTodo, tone: "text-primary-700" },
  overdue: { icon: AlarmClock, tone: "text-danger-600" },
  today: { icon: CalendarClock, tone: "text-warning-600" },
  done: { icon: CheckCircle2, tone: "text-success-600" },
};

export function SummaryDashboard({ view, rangeHref, readOnly }: { view: SummaryDashboardView; rangeHref: string; readOnly: boolean }) {
  const [tables, setTables] = useState<Record<string, boolean>>({});
  return (
    <section className="space-y-4" aria-label="Dashboard" data-testid="summary-dashboard">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-ink-muted" id="summary-dash-range">
          Completed work from:
        </span>
        <nav aria-labelledby="summary-dash-range" className="inline-flex rounded-md border border-line">
          {DASHBOARD_RANGES.map((range) => (
            <Link
              key={range}
              href={`${rangeHref}${range}`}
              scroll={false}
              aria-current={view.range === range ? "true" : undefined}
              className={`inline-flex h-9 items-center px-3 text-label ${view.range === range ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:text-ink"}`}
              data-testid={`dash-range-${range}`}
            >
              {DASHBOARD_RANGE_LABEL[range]}
            </Link>
          ))}
        </nav>
        {readOnly && <span className="text-caption text-ink-muted">Counts only the tasks you may see.</span>}
      </div>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Numbers">
        {view.numbers.map((number) => {
          const Icon = NUMBER_ICON[number.key].icon;
          return (
            <li key={number.key} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5" data-testid={`dash-number-${number.key}`}>
              <Icon className={`h-5 w-5 shrink-0 ${NUMBER_ICON[number.key].tone}`} aria-hidden="true" />
              <span>
                <span className="block text-stat font-semibold leading-none tabular-nums">{number.value.toLocaleString("en-IN")}</span>
                <span className="text-caption text-ink-muted">{number.label}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Charts">
        {view.charts.map((chart) => (
          <li key={chart.key} className="card min-w-0 p-4" data-testid={`dash-chart-${chart.key}`}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 text-label font-semibold">{chart.title}</h3>
              {!chart.data.empty && (
                <button
                  type="button"
                  aria-pressed={Boolean(tables[chart.key])}
                  onClick={() => setTables((current) => ({ ...current, [chart.key]: !current[chart.key] }))}
                  className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink aria-pressed:bg-primary-50 aria-pressed:text-primary-700"
                  aria-label={`View ${chart.title} as table`}
                  title="View as table"
                >
                  <Table2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
            <ChartView data={chart.data} title={chart.title} table={Boolean(tables[chart.key])} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// The person's own notes: rich text, saved by itself a second after typing stops.
export function SummaryNotes({ initial }: { initial: { body: string; rowVersion: number; updatedAt: string | null } }) {
  const [body, setBody] = useState(initial.body);
  const [state, setState] = useState<"saved" | "unsaved" | "saving" | "problem">("saved");
  const [problem, setProblem] = useState("");
  const version = useRef(initial.rowVersion);
  const saved = useRef(initial.body);
  const busy = useRef(false);
  const latest = useRef(initial.body);
  const [again, setAgain] = useState(0); // a save that ended after more typing saves again
  useEffect(() => {
    latest.current = body;
    if (body === saved.current) return;
    setState("unsaved");
    const timer = window.setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      setState("saving");
      const text = body;
      // Called directly (no toast, no page refresh on every save); the status line says how it went.
      const answer = await summaryNotesAction({ body: text, rowVersion: version.current }).catch(() => null);
      busy.current = false;
      if (answer?.ok && typeof answer.rowVersion === "number") {
        version.current = answer.rowVersion;
        saved.current = text;
        setProblem("");
        if (latest.current === text) setState("saved");
        else setAgain((value) => value + 1);
      } else {
        setState("problem");
        setProblem(answer?.message ?? "Couldn't save your notes. Please try again.");
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [body, again]);
  // Unsaved words: the browser asks before leaving.
  useEffect(() => {
    if (state === "saved") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  return (
    <section className="card space-y-2 p-4" aria-labelledby="summary-notes-head" data-testid="summary-notes">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="summary-notes-head" className="flex-1 font-semibold">
          My notes
        </h2>
        <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
          <Lock aria-hidden="true" className="h-3.5 w-3.5" /> Only you can read these
        </span>
      </div>
      <RichEditor name="notes" id="summary-notes-body" label="My notes" placeholder="Jot down anything: plans, reminders, links. Use # for a heading and - for a list." initialText={initial.body} onText={setBody} minHeight={320} maxLength={NOTES_MAX} testId="summary-notes-editor" />
      <p role="status" aria-live="polite" className={`text-caption ${state === "problem" ? "text-danger-600" : "text-ink-muted"}`} data-testid="summary-notes-state">
        {state === "saved" ? (initial.updatedAt || version.current > 0 ? "All changes saved." : "Your notes are saved as you type.") : state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved changes…" : problem}
      </p>
    </section>
  );
}

// Someone else's Notes tab: notes are private to their owner.
export function NotesPrivate({ name }: { name: string }) {
  return (
    <section className="card px-6 py-8 text-center" data-testid="summary-notes-private">
      <Lock aria-hidden="true" className="mx-auto h-6 w-6 text-ink-muted" />
      <h2 className="mt-2 font-semibold">These notes are private</h2>
      <p className="mt-1 text-label text-ink-muted">Only {name} can read their notes, even when they share their Task Summary.</p>
    </section>
  );
}

// On a refused Task Summary: ask its owner for access (they are told and grant it from Share).
export function RequestAccess({ ownerId, ownerName, pending }: { ownerId: number; ownerName: string; pending: boolean }) {
  const { call, pending: busy } = useWorkCall();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(pending);
  if (sent)
    return (
      <p role="status" className="mt-4 text-label text-ink-muted" data-testid="summary-request-sent">
        You&apos;ve asked {ownerName} for access. They&apos;ll see your request when they open Share on their Task Summary.
      </p>
    );
  return (
    <form
      className="mt-4 space-y-2 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => summaryAccessRequestAction({ ownerId, note })).then((result) => result?.ok && setSent(true));
      }}
      data-testid="summary-request-form"
    >
      <label htmlFor="summary-request-note" className="block text-label font-medium">
        Note to {ownerName} <span className="font-normal text-ink-muted">(optional)</span>
      </label>
      <textarea id="summary-request-note" className="field-input min-h-[4.5rem]" maxLength={REQUEST_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why you'd like to see it" />
      <button type="submit" className="btn-primary btn-compact inline-flex w-auto items-center gap-1.5" disabled={busy} aria-busy={busy || undefined} data-testid="summary-request-access">
        <Send aria-hidden="true" className="h-4 w-4" /> Request access
      </button>
    </form>
  );
}
