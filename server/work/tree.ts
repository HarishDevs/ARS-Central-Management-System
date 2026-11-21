import type { GridGroupOut, GridTask } from "@/server/work/grid";

// v1.61.0 (D-367, PM phase A, spec PRJ-03 List): the task table as an ARIA
// treegrid. Its lines (group headings, tasks, their subtasks, the add-task
// line) are flattened here so the table can number them (aria-rowindex), draw
// only the ones on screen (windowing) and move focus with the arrow keys.
// Pure and unit-tested.

export function childrenByParent(items: readonly { parentId: number | null; row: GridTask }[]): Record<number, GridTask[]> {
  const out: Record<number, GridTask[]> = {};
  for (const item of items) {
    if (item.parentId === null) continue;
    (out[item.parentId] ??= []).push(item.row);
  }
  return out;
}

export type Line =
  | { kind: "group"; key: string; level: number; group: GridGroupOut; expanded: boolean; count: number }
  | { kind: "task"; key: string; level: number; group: GridGroupOut; task: GridTask; number: number | null; parentId: number | null; expandable: boolean; expanded: boolean }
  | { kind: "add"; key: string; level: number; group: GridGroupOut };

export interface FlattenOptions {
  isClosed: (groupKey: string) => boolean;
  subtasks?: Record<number, GridTask[]>;
  expanded?: ReadonlySet<number>;
  hideEmpty?: boolean;
  addLine?: (group: GridGroupOut) => boolean;
}

export function flattenGrid(groups: readonly GridGroupOut[], options: FlattenOptions): Line[] {
  const lines: Line[] = [];
  const named = groups.some((group) => Boolean(group.name));
  const kept = options.hideEmpty ? groups.filter((group) => group.rows.length > 0 || !group.name) : groups;
  for (const group of kept) {
    const closed = Boolean(group.name) && options.isClosed(group.key);
    const base = named && group.name ? 2 : 1;
    if (group.name) lines.push({ kind: "group", key: `g:${group.key}`, level: 1, group, expanded: !closed, count: group.rows.length });
    if (closed) continue;
    group.rows.forEach((task, index) => {
      const children = options.subtasks?.[task.id] ?? [];
      const expandable = children.length > 0;
      const expanded = expandable && Boolean(options.expanded?.has(task.id));
      lines.push({ kind: "task", key: `t:${group.key}:${task.id}`, level: base, group, task, number: index + 1, parentId: null, expandable, expanded });
      if (expanded)
        for (const child of children)
          lines.push({ kind: "task", key: `s:${group.key}:${task.id}:${child.id}`, level: base + 1, group, task: child, number: null, parentId: task.id, expandable: false, expanded: false });
    });
    if (options.addLine?.(group)) lines.push({ kind: "add", key: `a:${group.key}`, level: base, group });
  }
  return lines;
}

// Every task that has subtasks loaded (for "Expand all subtasks").
export const expandableIds = (groups: readonly GridGroupOut[], subtasks?: Record<number, GridTask[]>) => groups.flatMap((group) => group.rows.filter((task) => (subtasks?.[task.id]?.length ?? 0) > 0).map((task) => task.id));

// ---- windowing ------------------------------------------------------------------------
// Which lines to draw: those inside the viewport plus `overscan` either side.
// `heights` are the lines' heights in order (measured, or an estimate);
// `scrollTop` is how far the table's top has scrolled above the viewport.
export interface WindowRange {
  start: number; // first line drawn
  end: number; // one past the last line drawn
  padTop: number; // space for the lines above
  padBottom: number; // space for the lines below
  total: number;
}
export function prefixSums(heights: readonly number[]): number[] {
  const sums = new Array<number>(heights.length + 1);
  sums[0] = 0;
  for (let index = 0; index < heights.length; index += 1) sums[index + 1] = sums[index]! + Math.max(0, heights[index]!);
  return sums;
}
// The first index whose bottom is below `offset` (binary search on the sums).
function lineAt(sums: readonly number[], offset: number): number {
  let low = 0;
  let high = sums.length - 2;
  if (high < 0) return 0;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sums[mid + 1]! <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function computeWindow(heights: readonly number[], scrollTop: number, viewport: number, overscan = 10): WindowRange {
  const sums = prefixSums(heights);
  const total = sums[heights.length]!;
  if (!heights.length) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };
  const top = Math.max(0, Math.min(scrollTop, total));
  const bottom = Math.max(top, Math.min(total, scrollTop + Math.max(0, viewport)));
  const start = Math.max(0, lineAt(sums, top) - overscan);
  const end = Math.min(heights.length, lineAt(sums, Math.max(top, bottom - 0.5)) + 1 + overscan);
  return { start, end, padTop: sums[start]!, padBottom: total - sums[end]!, total };
}
// The scroll offset that brings line `index` into view (top of it).
export const offsetOf = (heights: readonly number[], index: number) => prefixSums(heights)[Math.max(0, Math.min(index, heights.length))]!;

// ---- keyboard (roving focus) ------------------------------------------------------------
// What a key does on the focused line: move focus, or fold/unfold.
export type KeyMove = { focus: number } | { toggle: number; open: boolean } | null;
export function keyMove(lines: readonly Line[], index: number, key: string, pageSize = 10): KeyMove {
  if (index < 0 || index >= lines.length) return lines.length ? { focus: 0 } : null;
  const line = lines[index]!;
  const clamp = (value: number) => Math.max(0, Math.min(lines.length - 1, value));
  switch (key) {
    case "ArrowDown":
      return { focus: clamp(index + 1) };
    case "ArrowUp":
      return { focus: clamp(index - 1) };
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: lines.length - 1 };
    case "PageDown":
      return { focus: clamp(index + pageSize) };
    case "PageUp":
      return { focus: clamp(index - pageSize) };
    case "ArrowRight":
      if (line.kind === "group" && !line.expanded) return { toggle: index, open: true };
      if (line.kind === "task" && line.expandable && !line.expanded) return { toggle: index, open: true };
      if ((line.kind === "group" && line.expanded) || (line.kind === "task" && line.expanded)) return { focus: clamp(index + 1) };
      return null;
    case "ArrowLeft": {
      if ((line.kind === "group" && line.expanded) || (line.kind === "task" && line.expandable && line.expanded)) return { toggle: index, open: false };
      // To the parent line (a subtask's task, a task's group heading).
      for (let at = index - 1; at >= 0; at -= 1) if (lines[at]!.level < line.level) return { focus: at };
      return null;
    }
    default:
      return null;
  }
}
