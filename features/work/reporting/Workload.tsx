"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Gauge } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/features/ui/Button";
import { Dialog } from "@/features/ui/Dialog";
import { useWorkCall, usePaneLink } from "@/features/work/client";
import { taskFieldsAction } from "@/app/users/work/actions";
import { capacityAction } from "@/app/users/work/reporting-actions";
import { addDays } from "@/server/work/schedule";
import { WORKLOAD_SPAN, type CellState, type WorkloadColumn } from "@/server/work/reporting";

// v1.67.0 (D-375, spec PV §8): the project's Workload tab. A person × day
// (or week) table of the project's assignees and members over 14 days or 8
// weeks: task count, or an effort field (a number field, or a timer field in
// hours), against each person's capacity per working day (weekly offs and
// holidays have none). Over capacity shows a warning icon and the word
// "Over", never colour alone. A cell with work is a button: it lists the
// tasks, each with a link and (for those who may) Reassign.
export interface WorkloadData {
  from: string;
  unit: "day" | "week";
  metric: string;
  metricLabel: string;
  metricKind: "count" | "hours" | "number";
  metrics: { key: string; label: string }[];
  columns: WorkloadColumn[];
  people: { id: number; name: string; perDay: number; own: boolean; cells: { key: string; load: number; capacity: number; state: CellState; taskIds: number[] }[] }[];
  totals: number[];
  tasks: { id: number; taskNo: string; title: string; start: string | null; due: string; assigneeId: number; effort: number | null }[];
  projectDefault: { perDay: number; own: boolean };
  canEdit: boolean;
  today: string;
}

const amount = (value: number, kind: WorkloadData["metricKind"]) => (kind === "hours" ? `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h` : value.toLocaleString("en-IN", { maximumFractionDigits: 1 }));
const unitWord = (kind: WorkloadData["metricKind"], value: number) => (kind === "count" ? (value === 1 ? "task" : "tasks") : kind === "hours" ? "hours" : "");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (day: string) => WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]!;

export function Workload({ projectId, data }: { projectId: number; data: WorkloadData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const paneLink = usePaneLink();
  const { call, pending } = useWorkCall();
  const [open, setOpen] = useState<{ personId: number; column: number } | null>(null);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const href = (change: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    query.delete("task");
    for (const [key, value] of Object.entries(change)) query.set(key, value);
    return `${pathname}?${query}`;
  };
  const step = data.unit === "day" ? 7 : 28;
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const people = data.people.map((person) => ({ id: person.id, name: person.name }));
  const opened = open ? data.people.find((person) => person.id === open.personId) : undefined;
  const openedColumn = open ? data.columns[open.column] : undefined;
  const openedCell = opened && open ? opened.cells[open.column] : undefined;

  return (
    <div data-testid="workload">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href({ wfrom: addDays(data.from, -step) })} className="btn-secondary btn-compact inline-flex items-center gap-1" aria-label="Earlier">
          <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Earlier
        </Link>
        <Link href={href({ wfrom: data.today })} className="btn-secondary btn-compact">
          Today
        </Link>
        <Link href={href({ wfrom: addDays(data.from, step) })} className="btn-secondary btn-compact inline-flex items-center gap-1" aria-label="Later">
          Later <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Link>
        <label className="ml-auto inline-flex items-center gap-1 text-label">
          <span className="text-ink-muted">Show</span>
          <select className="rounded-md border border-line bg-raised px-2 py-1 text-label" value={data.unit} onChange={(event) => router.push(href({ wunit: event.target.value }))} data-testid="workload-unit">
            <option value="day">Days ({WORKLOAD_SPAN.day})</option>
            <option value="week">Weeks ({WORKLOAD_SPAN.week})</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1 text-label">
          <span className="text-ink-muted">Measure</span>
          <select className="rounded-md border border-line bg-raised px-2 py-1 text-label" value={data.metric} onChange={(event) => router.push(href({ wmetric: event.target.value }))} data-testid="workload-metric">
            {data.metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </select>
        </label>
        {data.canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setCapacityOpen(true)} icon={<Gauge aria-hidden="true" className="h-4 w-4" />} data-testid="workload-capacity">
            Set capacity
          </Button>
        )}
      </div>
      {data.tasks.length === 0 && (
        <p className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-label text-ink-muted" data-testid="workload-empty">
          No open tasks fall in these {data.unit === "day" ? "days" : "weeks"}. Workload fills in as tasks with due dates (and start dates) are assigned in this project.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-label" data-testid="workload-table">
          <caption className="sr-only">
            Workload by person, {data.metricLabel}, from {data.columns[0]?.label}. Capacity is per working day; weekly offs and holidays have none.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] min-w-40 border-b border-line bg-raised px-3 py-2 text-left">
                Person
              </th>
              {data.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`min-w-14 border-b border-l border-line px-1 py-1 text-center text-caption font-medium ${column.off ? "bg-surface-muted text-ink-muted" : ""} ${column.days.includes(data.today) ? "text-primary-700" : ""}`}
                  title={column.holiday ?? undefined}
                >
                  {data.unit === "day" ? (
                    <>
                      <span className="block">{dayName(column.key)}</span>
                      <span className="block">{column.label}</span>
                      {column.off && <span className="block text-ink-faint">{column.holiday ? "Holiday" : "Off"}</span>}
                    </>
                  ) : (
                    <span>{column.label}</span>
                  )}
                  {column.days.includes(data.today) && <span className="sr-only"> (today)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="sticky left-0 z-[1] border-b border-line bg-raised px-3 py-1.5 text-left font-semibold">
                Total {data.metricKind === "count" ? "tasks" : data.metricLabel.toLowerCase()}
              </th>
              {data.totals.map((total, index) => (
                <td key={data.columns[index]!.key} className={`border-b border-l border-line px-1 py-1.5 text-center tabular-nums ${data.columns[index]!.off ? "bg-surface-muted" : ""}`}>
                  {total ? amount(total, data.metricKind) : ""}
                </td>
              ))}
            </tr>
            {data.people.map((person) => (
              <tr key={person.id} data-testid="workload-row">
                <th scope="row" className="sticky left-0 z-[1] border-b border-line bg-raised px-3 py-1.5 text-left font-normal">
                  <span className="block font-medium">{person.name}</span>
                  <span className="block text-caption text-ink-muted">
                    Capacity {amount(person.perDay, data.metricKind)} a day{person.own ? "" : " (project)"}
                  </span>
                </th>
                {person.cells.map((cell, index) => {
                  const column = data.columns[index]!;
                  const label = `${person.name}, ${data.unit === "day" ? `${dayName(column.key)} ${column.label}` : column.label}: ${amount(cell.load, data.metricKind)} ${unitWord(data.metricKind, cell.load)} of a capacity of ${amount(cell.capacity, data.metricKind)}${cell.state === "over" ? ", over capacity" : ""}.`;
                  return (
                    <td key={column.key} className={`border-b border-l border-line p-0.5 text-center ${column.off ? "bg-surface-muted" : ""}`}>
                      {cell.state === "empty" ? (
                        <span className="sr-only">{`${person.name}: nothing`}</span>
                      ) : (
                        <button
                          type="button"
                          aria-label={label}
                          title={label}
                          onClick={() => setOpen({ personId: person.id, column: index })}
                          className={`flex w-full flex-col items-center rounded px-1 py-1 tabular-nums hover:bg-surface-muted ${cell.state === "over" ? "bg-danger-50 font-semibold text-danger-600" : "bg-primary-50 text-ink"}`}
                          data-testid={cell.state === "over" ? "workload-cell-over" : "workload-cell"}
                        >
                          <span>{amount(cell.load, data.metricKind)}</span>
                          {cell.state === "over" && (
                            <span className="inline-flex items-center gap-0.5 text-caption" aria-hidden="true">
                              <AlertTriangle className="h-3 w-3" /> Over
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-ink-muted">
        A task counts on each working day from its start to its due date{data.metricKind === "count" ? "" : "; its effort is shared out evenly over those days"}. Only open tasks you can see are counted.
      </p>

      {opened && openedColumn && openedCell && (
        <Dialog open onClose={() => setOpen(null)} title={`${opened.name}: ${data.unit === "day" ? `${dayName(openedColumn.key)} ${openedColumn.label}` : openedColumn.label}`} description={`${amount(openedCell.load, data.metricKind)} ${unitWord(data.metricKind, openedCell.load)} of a capacity of ${amount(openedCell.capacity, data.metricKind)}${openedCell.state === "over" ? " (over capacity)" : ""}.`}>
          <ul className="space-y-3" data-testid="workload-tasks">
            {openedCell.taskIds.map((id) => {
              const task = tasks.get(id);
              if (!task) return null;
              return <CellTask key={id} task={task} people={people} canReassign={data.canEdit} pending={pending} href={paneLink(id)} metricKind={data.metricKind} onReassign={(assigneeId) => void call(() => taskFieldsAction(id, { assigneeId }), { success: "Reassigned." }).then((result) => result?.ok && setOpen(null))} />;
            })}
          </ul>
        </Dialog>
      )}
      {capacityOpen && <CapacityDialog projectId={projectId} data={data} onClose={() => setCapacityOpen(false)} save={(input) => call(() => capacityAction(projectId, input), { success: false })} />}
    </div>
  );
}

function CellTask({ task, people, canReassign, pending, href, metricKind, onReassign }: { task: WorkloadData["tasks"][number]; people: { id: number; name: string }[]; canReassign: boolean; pending: boolean; href: string; metricKind: WorkloadData["metricKind"]; onReassign: (assigneeId: number) => void }) {
  const [to, setTo] = useState(task.assigneeId);
  const selectId = useId();
  return (
    <li className="rounded-md border border-line p-2">
      <Link href={href} className="link font-medium">
        {task.taskNo} {task.title}
      </Link>
      <p className="text-caption text-ink-muted">
        {task.start && task.start !== task.due ? `${task.start} to ${task.due}` : `Due ${task.due}`}
        {metricKind !== "count" && task.effort !== null ? ` · ${amount(task.effort, metricKind)}` : ""}
      </p>
      {canReassign && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-caption text-ink-muted">
            Reassign to
          </label>
          <select id={selectId} className="rounded-md border border-line bg-raised px-2 py-1 text-label" value={to} onChange={(event) => setTo(Number(event.target.value))} data-testid="workload-reassign-to">
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={pending || to === task.assigneeId} onClick={() => onReassign(to)} data-testid="workload-reassign">
            Reassign
          </Button>
        </div>
      )}
    </li>
  );
}

function CapacityDialog({ projectId, data, onClose, save }: { projectId: number; data: WorkloadData; onClose: () => void; save: (input: { userId: number | null; metric: string; perDay: number | null }) => Promise<{ ok: boolean } | null> }) {
  const [project, setProject] = useState(String(data.projectDefault.perDay));
  const [own, setOwn] = useState<Record<number, string>>(Object.fromEntries(data.people.filter((person) => person.own).map((person) => [person.id, String(person.perDay)])));
  const [busy, setBusy] = useState(false);
  const unit = data.metricKind === "count" ? "tasks" : data.metricKind === "hours" ? "hours" : data.metricLabel;
  const apply = async () => {
    setBusy(true);
    try {
      const value = Number(project);
      if (project.trim() !== "" && Number.isFinite(value) && (value !== data.projectDefault.perDay || !data.projectDefault.own)) {
        if (!(await save({ userId: null, metric: data.metric, perDay: value }))?.ok) return;
      }
      for (const person of data.people) {
        const text = (own[person.id] ?? "").trim();
        const next = text === "" ? null : Number(text);
        const before = person.own ? person.perDay : null;
        if (next !== null && !Number.isFinite(next)) continue;
        if (next === before) continue;
        if (!(await save({ userId: person.id, metric: data.metric, perDay: next }))?.ok) return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Set capacity"
      description={`${data.metricLabel}: how much each person can take on per working day in this project. Leave a person blank to use the project's capacity.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void apply()} loading={busy} data-testid="capacity-save">
            Save capacity
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-label" data-project={projectId}>
        <label className="flex items-center justify-between gap-3">
          <span className="font-medium">Project capacity ({unit} a day)</span>
          <input type="number" min={0} max={10000} step="0.5" className="w-24 rounded-md border border-line bg-raised px-2 py-1 text-right" value={project} onChange={(event) => setProject(event.target.value)} data-testid="capacity-project" />
        </label>
        <ul className="space-y-2">
          {data.people.map((person) => (
            <li key={person.id}>
              <label className="flex items-center justify-between gap-3">
                <span>{person.name}</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step="0.5"
                  placeholder={project}
                  className="w-24 rounded-md border border-line bg-raised px-2 py-1 text-right"
                  value={own[person.id] ?? ""}
                  onChange={(event) => setOwn((current) => ({ ...current, [person.id]: event.target.value }))}
                  data-testid="capacity-person"
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
