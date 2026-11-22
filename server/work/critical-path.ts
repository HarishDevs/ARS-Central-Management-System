// v1.74.0 (D-398): the critical path of a project's schedule (the Gantt's
// "Show critical path" and "Show slack"). Pure and unit-tested; computed on the
// server for the Gantt and again in the browser while a bar is dragged.
//
// The method (critical path method, CPM), in working days:
// - Nodes are the project's tasks. A task lasts its working days from start
//   (From) to due (To), both counted; a task with only a due date lasts 1 day;
//   a milestone lasts 0 days (a point at the end of its due day). Completed
//   tasks take part with their own dates and never move.
// - Time is a count of working days (the Working calendar's weekly offs and
//   the organisation's holidays are skipped). A task occupies [ES, EF) with
//   EF = ES + duration, so "3 days then 2 days" is 5 days, as in a textbook.
// - Edges are the dependencies, with their lag in working days:
//     FS  the waiting task starts after the other finishes   (ES_s ≥ EF_p + lag)
//     SS  starts once the other has started                   (ES_s ≥ ES_p + lag)
//     FF  finishes once the other has finished                (EF_s ≥ EF_p + lag)
//     SF  the app's D-373 rule: the waiting task starts on or before the other
//         one's due date, i.e. the other finishes after it starts
//         (EF_p ≥ ES_s + 1 + lag; the due day may be the start day): an edge from the waiting task's start to the
//         other task's finish.
// - Forward pass: a task starts as early as its links allow, but never before
//   its planned start (the plan is a "start no earlier than"). Completed tasks
//   keep their dates.
// - The end: the latest finish; when the project's To date is earlier than
//   that, the To date (so a late project shows negative slack).
// - Backward pass: latest finish = the end, or earlier if a successor needs it.
// - Slack (total float) = latest start − earliest start. Critical: slack ≤ 0.
//   Every task with slack ≤ 0 is marked, so several equally long paths all show.
// - Tasks outside the project linked by a dependency are left out (their links
//   are counted in `outsideLinks`), as are links to tasks the viewer can't see.
// - Dependencies can't form a loop (the app refuses one), but if the data ever
//   held one, the links inside it are ignored (`loopLinks`) instead of failing.
import { addDays, type DepType, type WorkCalendar } from "@/server/work/schedule";
import { isWorkingDay, taskDurationDays } from "@/server/work/working-days";

export const MAX_CPM_TASKS = 2000; // spec PM: critical path for ≤ 2,000 dated tasks

export interface CpmTask {
  id: number;
  start: string | null; // YYYY-MM-DD (null: a one-day task on its due day)
  due: string; // YYYY-MM-DD
  milestone: boolean;
  done: boolean; // completed: keeps its dates
}
export interface CpmLink {
  predecessor: number; // the task that blocks (blocker)
  successor: number; // the task that waits (blocked)
  type: DepType;
  lag: number; // working days
}
export interface CpmTaskResult {
  id: number;
  duration: number; // working days (milestone 0)
  earlyStart: string; // the day the task could start
  earlyFinish: string; // the day it could finish (a milestone: its day)
  lateStart: string;
  lateFinish: string;
  slack: number; // working days; ≤ 0 is critical
  critical: boolean;
}
export interface CpmResult {
  tasks: Record<number, CpmTaskResult>;
  criticalIds: number[]; // in path order (earliest start, then finish)
  criticalLinks: string[]; // "pred-succ" of links on the critical path that drive their successor
  start: string | null; // the earliest start of the critical path
  end: string | null; // the day the schedule finishes
  days: number; // working days from the critical path's start to the end
  toDate: string | null; // the project's To date
  buffer: number | null; // working days from the end to the To date (negative: late)
  outsideLinks: number; // links to tasks outside this set, left out
  loopLinks: number; // links ignored because they formed a loop
  tooMany: boolean; // over MAX_CPM_TASKS: not computed
}

// Working days as numbers: index i is the i-th working day from `origin`.
class DayIndex {
  private readonly days: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(from: string, to: string, private readonly calendar: WorkCalendar) {
    let day = from;
    for (let guard = 0; day <= to && guard < 40_000; guard += 1) {
      if (isWorkingDay(day, calendar)) {
        this.index.set(day, this.days.length);
        this.days.push(day);
      }
      day = addDays(day, 1);
    }
    if (!this.days.length) {
      this.index.set(from, 0);
      this.days.push(from);
    }
  }
  // The working-day number of `day` (an off day: the next working day).
  ceil(day: string): number {
    let current = day;
    for (let guard = 0; guard < 400; guard += 1) {
      const found = this.index.get(current);
      if (found !== undefined) return found;
      if (current > this.days.at(-1)!) return this.days.length - 1;
      current = addDays(current, 1);
    }
    return this.days.length - 1;
  }
  // The working-day number of `day` (an off day: the working day before).
  floor(day: string): number {
    let current = day;
    for (let guard = 0; guard < 400; guard += 1) {
      const found = this.index.get(current);
      if (found !== undefined) return found;
      if (current < this.days[0]!) return 0;
      current = addDays(current, -1);
    }
    return 0;
  }
  // The day of working-day number i (beyond the range: counted on from its ends).
  day(i: number): string {
    if (i >= 0 && i < this.days.length) return this.days[i]!;
    const step = i < 0 ? -1 : 1;
    let left = i < 0 ? -i : i - (this.days.length - 1);
    let current = i < 0 ? this.days[0]! : this.days.at(-1)!;
    for (let guard = 0; left > 0 && guard < 40_000; guard += 1) {
      current = addDays(current, step);
      if (isWorkingDay(current, this.calendar)) left -= 1;
    }
    return current;
  }
}

type Anchor = "S" | "F";
interface Edge {
  from: number;
  fromAnchor: Anchor;
  to: number;
  toAnchor: Anchor;
  lag: number;
  key: string; // the original link "pred-succ"
}
// A link as a CPM edge: "to.anchor ≥ from.anchor + lag".
function edgeOf(link: CpmLink): Edge {
  const key = `${link.predecessor}-${link.successor}`;
  const lag = Number.isFinite(link.lag) ? Math.trunc(link.lag) : 0;
  if (link.type === "SS") return { from: link.predecessor, fromAnchor: "S", to: link.successor, toAnchor: "S", lag, key };
  if (link.type === "FF") return { from: link.predecessor, fromAnchor: "F", to: link.successor, toAnchor: "F", lag, key };
  // SF: the other task's due day is on or after the day the waiting task starts (same day allowed),
  // so its finish (the end of its due day) is at least one day after that start.
  if (link.type === "SF") return { from: link.successor, fromAnchor: "S", to: link.predecessor, toAnchor: "F", lag: lag + 1, key };
  return { from: link.predecessor, fromAnchor: "F", to: link.successor, toAnchor: "S", lag, key };
}

export function criticalPath(tasks: readonly CpmTask[], links: readonly CpmLink[], calendar: WorkCalendar, toDate: string | null = null): CpmResult {
  const empty: CpmResult = { tasks: {}, criticalIds: [], criticalLinks: [], start: null, end: null, days: 0, toDate, buffer: null, outsideLinks: 0, loopLinks: 0, tooMany: false };
  if (!tasks.length) return empty;
  if (tasks.length > MAX_CPM_TASKS) return { ...empty, tooMany: true };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  // The range of days to index: every task's dates, the To date, and room either side for lags.
  let lo = toDate ?? tasks[0]!.due;
  let hi = lo;
  for (const task of tasks) {
    for (const day of [task.start ?? task.due, task.due]) {
      if (day < lo) lo = day;
      if (day > hi) hi = day;
    }
  }
  const pad = 60 + Math.min(2000, links.reduce((sum, link) => sum + Math.abs(link.lag || 0), 0));
  const days = new DayIndex(addDays(lo, -pad), addDays(hi, pad + tasks.length * 2), calendar);

  // Planned positions, in working-day numbers.
  const node = new Map<number, { duration: number; plannedStart: number; done: boolean }>();
  for (const task of tasks) {
    const duration = task.milestone ? 0 : taskDurationDays(task.start, task.due, calendar);
    const plannedStart = task.milestone ? days.floor(task.due) + 1 : task.start && task.start < task.due ? days.ceil(task.start) : days.floor(task.due) - duration + 1;
    node.set(task.id, { duration, plannedStart, done: task.done });
  }

  // Edges between tasks in the set; others counted.
  let outsideLinks = 0;
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!byId.has(link.predecessor) || !byId.has(link.successor)) {
      outsideLinks += 1;
      continue;
    }
    if (link.predecessor === link.successor) continue;
    const edge = edgeOf(link);
    if (seen.has(edge.key)) continue;
    seen.add(edge.key);
    edges.push(edge);
  }

  // Order: Kahn's topological sort; nodes in a loop are appended, their loop edges ignored.
  const incoming = new Map<number, Edge[]>();
  const outgoing = new Map<number, Edge[]>();
  const indegree = new Map<number, number>(tasks.map((task) => [task.id, 0]));
  for (const edge of edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const order: number[] = [];
  const queue = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id);
  const placed = new Set<number>();
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    placed.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      const left = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, left);
      if (left === 0) queue.push(edge.to);
    }
  }
  const looped = new Set<string>();
  if (order.length < tasks.length) {
    for (const task of tasks) if (!placed.has(task.id)) order.push(task.id);
    const late = new Set(tasks.filter((task) => !placed.has(task.id)).map((task) => task.id));
    for (const edge of edges) if (late.has(edge.to) && late.has(edge.from)) looped.add(edge.key);
  }
  const position = new Map(order.map((id, i) => [id, i]));
  // Only edges that go forward in the order take part (a loop's back edges don't).
  const usable = (edge: Edge) => !looped.has(edge.key) || position.get(edge.from)! < position.get(edge.to)!;
  const loopLinks = edges.filter((edge) => !usable(edge)).length;

  // Forward pass.
  const es = new Map<number, number>();
  const ef = new Map<number, number>();
  const valueAt = (id: number, anchor: Anchor, map: { s: Map<number, number>; f: Map<number, number> }) => (anchor === "S" ? map.s.get(id)! : map.f.get(id)!);
  for (const id of order) {
    const own = node.get(id)!;
    let start = own.plannedStart;
    if (!own.done) {
      for (const edge of incoming.get(id) ?? []) {
        if (!usable(edge) || !es.has(edge.from)) continue;
        const need = valueAt(edge.from, edge.fromAnchor, { s: es, f: ef }) + edge.lag;
        const asStart = edge.toAnchor === "S" ? need : need - own.duration;
        if (asStart > start) start = asStart;
      }
    }
    es.set(id, start);
    ef.set(id, start + own.duration);
  }
  const latestFinish = Math.max(...order.map((id) => ef.get(id)!));
  const toIndex = toDate ? days.floor(toDate) + 1 : null; // the end of the To day
  const end = toIndex !== null && toIndex < latestFinish ? toIndex : latestFinish;

  // Backward pass.
  const ls = new Map<number, number>();
  const lf = new Map<number, number>();
  for (const id of [...order].reverse()) {
    const own = node.get(id)!;
    let finish = end;
    for (const edge of outgoing.get(id) ?? []) {
      if (!usable(edge) || !ls.has(edge.to)) continue;
      const limit = valueAt(edge.to, edge.toAnchor, { s: ls, f: lf }) - edge.lag;
      const asFinish = edge.fromAnchor === "F" ? limit : limit + own.duration;
      if (asFinish < finish) finish = asFinish;
    }
    lf.set(id, finish);
    ls.set(id, finish - own.duration);
  }

  // Results, in days.
  const out: Record<number, CpmTaskResult> = {};
  // [ES, EF) holds working days ES … EF − 1; a milestone (0 days) sits at the end of day EF − 1.
  const finishDay = (index: number) => days.day(index - 1);
  for (const id of order) {
    const own = node.get(id)!;
    const slack = ls.get(id)! - es.get(id)!;
    out[id] = {
      id,
      duration: own.duration,
      earlyStart: days.day(own.duration === 0 ? es.get(id)! - 1 : es.get(id)!),
      earlyFinish: finishDay(ef.get(id)!),
      lateStart: days.day(own.duration === 0 ? ls.get(id)! - 1 : ls.get(id)!),
      lateFinish: finishDay(lf.get(id)!),
      slack,
      critical: slack <= 0,
    };
  }
  const criticalIds = order.filter((id) => out[id]!.critical).sort((a, b) => es.get(a)! - es.get(b)! || ef.get(a)! - ef.get(b)! || a - b);
  // A link is on the path when both ends are critical and it drives its target (no room between them).
  const criticalLinks = edges
    .filter((edge) => usable(edge) && out[edge.from]?.critical && out[edge.to]?.critical)
    .filter((edge) => {
      const need = valueAt(edge.from, edge.fromAnchor, { s: es, f: ef }) + edge.lag;
      const have = edge.toAnchor === "S" ? es.get(edge.to)! : ef.get(edge.to)!;
      return have <= need;
    })
    .map((edge) => edge.key);
  const pathStart = criticalIds.length ? Math.min(...criticalIds.map((id) => es.get(id)!)) : null;
  return {
    tasks: out,
    criticalIds,
    criticalLinks,
    start: pathStart === null ? null : days.day(pathStart),
    end: days.day(end - 1),
    days: pathStart === null ? 0 : end - pathStart,
    toDate,
    buffer: toIndex === null ? null : toIndex - latestFinish,
    outsideLinks,
    loopLinks,
    tooMany: false,
  };
}

// "Critical path: 6 tasks, 18 working days, ends 12 Dec"
export function criticalSummary(result: CpmResult, dayWords: (day: string) => string): string {
  if (result.tooMany) return `The critical path is worked out for up to ${MAX_CPM_TASKS.toLocaleString("en-IN")} tasks.`;
  if (!result.criticalIds.length || !result.end) return "No critical path: no task with dates.";
  const n = result.criticalIds.length;
  return `Critical path: ${n} task${n === 1 ? "" : "s"}, ${result.days} working day${result.days === 1 ? "" : "s"}, ends ${dayWords(result.end)}`;
}
// "2 working days of slack", "No slack", "3 working days late"
export function slackText(slack: number): string {
  if (slack === 0) return "No slack";
  if (slack < 0) return `${-slack} working day${slack === -1 ? "" : "s"} late`;
  return `${slack} working day${slack === 1 ? "" : "s"} of slack`;
}
