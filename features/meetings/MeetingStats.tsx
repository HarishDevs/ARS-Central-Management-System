import type { DashboardMeeting } from "@/lib/db/repositories/meetings.repository";
import { onTime } from "@/server/meetings/rules";
import { SortTh } from "@/features/ui/SortTh";
import { nextDir, parseColumnSort, sortHref, sortRows, type SortDir } from "@/server/lists/sorting";

// v1.51.1: the meeting figures shared by the Meeting dashboard and the
// Meetings view of Home (one calculation, so both always agree).
export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export interface Tally {
  name: string;
  meetings: number;
  held: number;
  cancelled: number;
  pointsOnTime: number;
  pointsJudged: number;
  startOnTime: number;
  startJudged: number;
  momOnTime: number;
  momJudged: number;
  present: number;
  invited: number;
  actions: number;
  done: number;
  overdue: number;
}

export const emptyTally = (name: string): Tally => ({
  name,
  meetings: 0,
  held: 0,
  cancelled: 0,
  pointsOnTime: 0,
  pointsJudged: 0,
  startOnTime: 0,
  startJudged: 0,
  momOnTime: 0,
  momJudged: 0,
  present: 0,
  invited: 0,
  actions: 0,
  done: 0,
  overdue: 0,
});

export function addToTally(tally: Tally, row: DashboardMeeting) {
  tally.meetings += 1;
  if (row.status === "CANCELLED") {
    tally.cancelled += 1;
    return;
  }
  const facts = onTime(row); // v1.51.2: the Coordinator's ticks
  if (row.actualStart) tally.held += 1;
  if (facts.agendaOnTime !== null) {
    tally.pointsJudged += 1;
    if (facts.agendaOnTime) tally.pointsOnTime += 1;
  }
  if (facts.startedOnTime !== null) {
    tally.startJudged += 1;
    if (facts.startedOnTime) tally.startOnTime += 1;
  }
  if (facts.momOnTime !== null) {
    tally.momJudged += 1;
    if (facts.momOnTime) tally.momOnTime += 1;
  }
  if (row.actualStart) {
    tally.present += row.present;
    tally.invited += row.participants;
  }
  tally.actions += row.actions;
  tally.done += row.actionsDone;
  tally.overdue += row.actionsOverdue;
}

// Totals, by meeting type and by department.
export function tallyMeetings(rows: readonly DashboardMeeting[]) {
  const total = emptyTally("All meetings");
  const byType = new Map<string, Tally>();
  const byDepartment = new Map<string, Tally>();
  const into = (map: Map<string, Tally>, key: string) => {
    if (!map.has(key)) map.set(key, emptyTally(key));
    return map.get(key)!;
  };
  for (const row of rows) {
    addToTally(total, row);
    addToTally(into(byType, row.typeName), row);
    addToTally(into(byDepartment, row.departmentName ?? "No department"), row);
  }
  const sorted = (map: Map<string, Tally>) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { total, byType: sorted(byType), byDepartment: sorted(byDepartment) };
}

export function kpisOf(total: Tally) {
  return [
    { label: "Meetings", value: String(total.meetings) },
    { label: "Held", value: String(total.held) },
    { label: "Points in time", value: pct(total.pointsOnTime, total.pointsJudged) },
    { label: "Started on time", value: pct(total.startOnTime, total.startJudged) },
    { label: "MOM in time", value: pct(total.momOnTime, total.momJudged) },
    { label: "Attendance", value: pct(total.present, total.invited) },
    { label: "Actions done", value: `${total.done} of ${total.actions}` },
    { label: "Actions overdue", value: String(total.overdue) },
  ];
}

export function KpiGrid({ total }: { total: Tally }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="meeting-kpis">
      {kpisOf(total).map((kpi) => (
        <div key={kpi.label} className="card px-4 py-3">
          <dt className="text-caption text-ink-muted">{kpi.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{kpi.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): every column of a tally table sorts both ways. Rates sort by
// their percentage (no figure yet = last); "Actions done" by the count done.
export const TALLY_SORTS = ["name", "held", "cancelled", "points", "start", "mom", "attendance", "done", "overdue"] as const;
export type TallySort = (typeof TALLY_SORTS)[number];
const TALLY_SORT_LABEL: Record<TallySort, string> = {
  name: "Name",
  held: "Held",
  cancelled: "Cancelled",
  points: "Points in time",
  start: "Started on time",
  mom: "MOM in time",
  attendance: "Attendance",
  done: "Actions done",
  overdue: "Overdue",
};
const rate = (part: number, whole: number) => (whole ? part / whole : null);
export function tallySortValue(row: Tally, column: TallySort): string | number | null {
  switch (column) {
    case "name":
      return row.name;
    case "held":
      return row.held;
    case "cancelled":
      return row.cancelled;
    case "points":
      return rate(row.pointsOnTime, row.pointsJudged);
    case "start":
      return rate(row.startOnTime, row.startJudged);
    case "mom":
      return rate(row.momOnTime, row.momJudged);
    case "attendance":
      return rate(row.present, row.invited);
    case "done":
      return row.done;
    default:
      return row.overdue;
  }
}
export const sortTallies = (rows: readonly Tally[], column: TallySort | null, dir: SortDir): Tally[] => (column ? sortRows(rows, (row) => tallySortValue(row, column), dir) : [...rows]);

// `sort` makes the titles sortable: the page's address and query, and a prefix
// for this table's columns (?sortBy=<prefix>.<column>) so two tables on one
// page never clash (only one is sorted at a time; the other keeps its order).
export function TallyTable({ caption, rows: given, sort }: { caption: string; rows: Tally[]; sort?: { prefix: string; path: string; query: Record<string, unknown> } }) {
  const columns = TALLY_SORTS.map((column) => `${sort?.prefix ?? "tally"}.${column}`);
  const chosen = parseColumnSort(sort?.query ?? {}, columns);
  const column = chosen.sortBy ? (chosen.sortBy.slice(chosen.sortBy.indexOf(".") + 1) as TallySort) : null;
  const rows = sort ? sortTallies(given, column, chosen.dir) : given;
  return (
    <div className="card overflow-x-auto">
      <table className="data-table">
        <caption className="px-4 py-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr>
            {TALLY_SORTS.map((key, index) =>
              sort ? (
                <SortTh key={key} label={TALLY_SORT_LABEL[key]} column={columns[index]!} sortBy={chosen.sortBy} dir={chosen.dir} href={sortHref(sort.path, sort.query, columns[index]!, nextDir(chosen, columns[index]!))} />
              ) : (
                <th key={key} scope="col">
                  {TALLY_SORT_LABEL[key]}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.held}</td>
              <td>{row.cancelled}</td>
              <td>{pct(row.pointsOnTime, row.pointsJudged)}</td>
              <td>{pct(row.startOnTime, row.startJudged)}</td>
              <td>{pct(row.momOnTime, row.momJudged)}</td>
              <td>{pct(row.present, row.invited)}</td>
              <td>
                {row.done} of {row.actions}
              </td>
              <td>{row.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
