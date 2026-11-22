"use client";

import { ApprovalBadge, approvalRowClass } from "@/features/work/ApprovalLink";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, ChevronDown, ChevronRight, GitBranch, GripVertical, Heart, Lock, MessageSquare, Plus, Repeat, Trash2, Diamond } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dropTarget, focusNeighbour, lift, moveLifted, positionText, previewColumn, type Lifted } from "@/features/work/board-keys";
import { addSectionAction, fieldValueAction, projectTabAction, moveTaskAction, quickAddAction, quickAddManyAction, sectionAction, taskFieldsAction } from "@/app/users/work/actions";
import { TaskCheck, usePaneLink, useWorkCall } from "@/features/work/client";
import { dueLabel, indiaDayOf, TONE_TEXT } from "@/features/work/format";
import { columnAccent, initialsOf } from "@/features/work/kanban";
import { BulkBar, FieldInput, type FieldView } from "@/features/work/MoreParts";
import { TaskGrid, type GridView } from "@/features/work/TaskGrid";
import { TaskPriorityPill, priorityControlProps } from "@/features/ui/ChoicePill";
import { PersonSelect } from "@/features/ui/PersonSelect";
import type { GridConfig, GridTask } from "@/server/work/grid";
import { inside } from "@/features/ui/inside";
import { FoldAllButtons } from "@/features/ui/GroupFold";
import { sortRows, type SortDir } from "@/server/lists/sorting";
import { ColumnResizer } from "@/features/work/ColumnResizer";
import { useColumnWidths, type ColumnDefault } from "@/features/work/useColumnWidths";
import { useLiveRefresh } from "@/features/work/useLiveRefresh";
import { UnsavedView } from "@/features/work/UnsavedView";
import { DEFAULT_BOARD, type BoardConfig } from "@/server/work/view-tabs";
import { FieldChip, FieldFilterRows, FieldValueEditor } from "@/features/work/FieldControls";
import { boardMovable, fieldGroups, matchFieldFilter, viewDef, type CellMap, type FieldCell, type FieldFilter } from "@/server/work/custom-fields";

// D-215: a project's List and Board. Sections hold tasks in the order the
// team set (drag, or Alt+↑/↓ on a row); a sort other than "Manual" only
// changes what this person sees and turns dragging off. Add a task with the
// box at the end of a section (Enter adds and keeps the box for the next one;
// pasting several lines adds one task per line).
export interface BoardTask {
  id: number;
  taskNo: string;
  title: string;
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "ELEVATED" | "IMPORTANT" | "HIGH" | "URGENT";
  assigneeId: number;
  assigneeName: string;
  assigneeDepartment?: string | null; // v1.57.3 (D-341)
  dueAt: string | null;
  sectionId: number;
  position: number;
  subtasks: number;
  subtasksOpen: number;
  comments: number;
  likes: number;
  blockedBy: number;
  isMilestone: boolean;
  isPeriodic?: boolean; // D-219
  approval?: { requestId: number; requestNo: string; workStep: boolean; linked?: boolean } | null; // v1.42.1
  tags: { id: number; name: string }[];
}
export interface BoardSection {
  id: number;
  name: string;
}
type Sort = "manual" | "due" | "priority" | "title" | "assignee";
type GroupBy = "section" | "assignee" | "department" | "due" | "priority";
const PRIORITY_NAME = { URGENT: "Critical", HIGH: "Most Important", IMPORTANT: "Important", ELEVATED: "High", NORMAL: "Normal", LOW: "Low" } as const;
const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const OPEN = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4, LOW: 5 } as const;

export function ProjectWorkspace({
  projectId,
  layout,
  sections,
  tasks,
  canEdit,
  meId,
  people,
  nowIso,
  fields = [],
  values = {},
  grid,
  density = "COMFORTABLE",
  board,
  planning = false,
  customise = false,
}: {
  // v1.64.0 (D-371): "pm_planning" on (every field type, field filters and
  // columns), and whether this person may add and change the project's fields.
  planning?: boolean;
  customise?: boolean;
  projectId: number;
  layout: "LIST" | "BOARD";
  sections: BoardSection[];
  tasks: BoardTask[];
  canEdit: boolean;
  meId: number;
  people: { id: number; label: string; detail?: string }[];
  nowIso: string;
  fields?: FieldView[]; // D-218: the project's own columns
  values?: CellMap;
  grid?: { rows: GridTask[]; initial: GridConfig; view: GridView; subtasks?: Record<number, GridTask[]> }; // D-220: the List as the shared table
  // v1.61.0 (D-367): the person's row density, and the Board tab's saved view (Save view / Reset).
  density?: "COMFORTABLE" | "COMPACT";
  board?: { initial: BoardConfig; tabKey: string; tabName: string; canSave: boolean };
}) {
  const { call } = useWorkCall();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  // D-219 (screen catalog O-06/O-05/O-07): Filter (quick filters), Sort, Group, Search this view.
  const start = board?.initial ?? DEFAULT_BOARD;
  const [incomplete, setIncomplete] = useState(start.incomplete);
  const [showDone, setShowDone] = useState(start.showDone);
  const [filter, setFilter] = useState(start.search);
  const [mine, setMine] = useState(start.mine);
  const [dueWithin, setDueWithin] = useState<"" | "this" | "next">(start.dueWithin);
  const [sort, setSort] = useState<Sort>(start.sort);
  const [group, setGroup] = useState<GroupBy>("section");
  // v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa"):
  // the direction of the sort, and a project field's id when sorting by its column.
  const [dir, setDir] = useState<SortDir>(start.dir);
  const [sortField, setSortField] = useState<number | null>(start.sortField);
  // v1.64.0 (D-371): filters on custom fields, and Board columns by a field (null = sections).
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>(start.fieldFilters ?? []);
  const [groupField, setGroupField] = useState<number | null>(start.groupField ?? null);
  // v1.61.0 (D-367): a Board tab's view stays unsaved until "Save view"; Reset goes back.
  const [savedBoard, setSavedBoard] = useState<BoardConfig>(start);
  const boardNow: BoardConfig = { incomplete, showDone, mine, dueWithin, sort, dir, sortField, search: filter, fieldFilters, groupField };
  const boardDirty = Boolean(board) && JSON.stringify(boardNow) !== JSON.stringify(savedBoard);
  const resetBoard = () => {
    setIncomplete(savedBoard.incomplete);
    setShowDone(savedBoard.showDone);
    setMine(savedBoard.mine);
    setDueWithin(savedBoard.dueWithin);
    setSort(savedBoard.sort);
    setDir(savedBoard.dir);
    setSortField(savedBoard.sortField);
    setFilter(savedBoard.search);
    setFieldFilters(savedBoard.fieldFilters ?? []);
    setGroupField(savedBoard.groupField ?? null);
  };
  // v1.58.0 (D-354, owner: "by default when a group by is selected it should
  // collapse all the group"): a chosen grouping starts folded; Sections (the
  // project's own structure) stay open. `toggled`: groups opened/closed one by one.
  const [fold, setFold] = useState<{ group: GroupBy; closed: boolean; toggled: Set<string> }>({ group: "section", closed: false, toggled: new Set() });
  if (fold.group !== group) setFold({ group, closed: group !== "section", toggled: new Set() });
  const isClosed = (key: string) => fold.closed !== fold.toggled.has(key);
  const foldAll = (open: boolean) => setFold((value) => ({ ...value, closed: !open, toggled: new Set() }));
  const openTask = useSearchParams().get("task");
  const [dragging, setDragging] = useState<number | null>(null);
  // v1.62.0 (D-368): the Board card lifted from the keyboard (Space).
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const router = useRouter();
  const [live, setLive] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const paneLink = usePaneLink();
  useAutoRefresh();
  // D-218: column widths: select, task, assignee, due, priority, then the project's fields.
  // Owner: "all the columns in all the tables should be resizable": every column
  // but the select box takes its width from one state (header and all rows).
  const widthDefaults: ColumnDefault[] = [
    { key: "title", width: 220, flex: true },
    { key: "assignee", width: 170 },
    { key: "due", width: 130 },
    { key: "priority", width: 110 },
    ...fields.map((field) => ({ key: `f${field.id}`, width: 150 })),
  ];
  const resize = useColumnWidths(`project-list:${projectId}`, widthDefaults);
  const columns = { gridTemplateColumns: `${canEdit ? "28px " : ""}${resize.template}` };

  const visible = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const today = indiaDayOf(now);
    const weekStart = shiftDay(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const inWeek = (task: BoardTask, offset: number) => {
      if (!task.dueAt) return false;
      const day = indiaDayOf(new Date(task.dueAt));
      return day >= shiftDay(weekStart, offset * 7) && day < shiftDay(weekStart, offset * 7 + 7);
    };
    const list = tasks.filter(
      (task) =>
        ((incomplete && OPEN.has(task.status)) || (showDone && task.status === "COMPLETED")) &&
        (!mine || task.assigneeId === meId) &&
        (!dueWithin || inWeek(task, dueWithin === "this" ? 0 : 1)) &&
        words.every((word) => `${task.title} ${task.taskNo} ${task.assigneeName} ${task.tags.map((tag) => tag.name).join(" ")}`.toLowerCase().includes(word)) &&
        fieldFilters.every((item) => {
          const field = fields.find((one) => one.id === item.fieldId);
          return !field || matchFieldFilter(field.kind, values[task.id]?.[item.fieldId], item, meId);
        }),
    );
    // v1.58.0 (D-354): each sort reads one value; "desc" reverses it; empty values stay last.
    const manualOrder = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
    if (sortField !== null) return sortRows(manualOrder, (task) => values[task.id]?.[sortField]?.sort ?? null, dir);
    const by: Record<Exclude<Sort, "manual">, (task: BoardTask) => unknown> = {
      due: (task) => task.dueAt,
      priority: (task) => PRIORITY_RANK[task.priority],
      title: (task) => task.title,
      assignee: (task) => task.assigneeName,
    };
    return sort === "manual" ? manualOrder : sortRows(manualOrder, by[sort], dir);
  }, [tasks, incomplete, showDone, mine, dueWithin, meId, filter, sort, now, dir, sortField, values, fieldFilters, fields]);
  const filterCount = Number(!incomplete) + Number(showDone) + Number(mine) + Number(Boolean(dueWithin)) + fieldFilters.length;
  const manual = sort === "manual" && sortField === null && !filter && !mine && !dueWithin && group === "section" && fieldFilters.length === 0 && groupField === null;
  const canDrag = canEdit && manual;

  const inSection = (sectionId: number) => visible.filter((task) => task.sectionId === sectionId);
  // The list's groups: sections (with adding and dragging), or a field.
  const groups = useMemo((): { key: string; name: string; section: BoardSection | null; rows: BoardTask[] }[] => {
    if (group === "section") return sections.map((section) => ({ key: `s${section.id}`, name: section.name, section, rows: visible.filter((task) => task.sectionId === section.id) }));
    const today = indiaDayOf(now);
    const bucket = (task: BoardTask): [string, number] => {
      if (group === "assignee") return [task.assigneeName, 0];
      // v1.57.3 (D-341, owner: "in all the Group option add department wise Group by").
      if (group === "department") return task.assigneeDepartment ? [task.assigneeDepartment, 0] : ["No department", 9];
      if (group === "priority") return [PRIORITY_NAME[task.priority], PRIORITY_RANK[task.priority]];
      if (!task.dueAt) return ["No due date", 6];
      const day = indiaDayOf(new Date(task.dueAt));
      if (day < today) return ["Overdue", 0];
      if (day === today) return ["Today", 1];
      if (day <= shiftDay(today, 7)) return ["Next 7 days", 2];
      if (day <= shiftDay(today, 30)) return ["Next 30 days", 3];
      return ["Later", 4];
    };
    const map = new Map<string, { order: number; rows: BoardTask[] }>();
    for (const task of visible) {
      const [name, order] = bucket(task);
      map.set(name, { order, rows: [...(map.get(name)?.rows ?? []), task] });
    }
    return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([name, value]) => ({ key: `g${name}`, name, section: null, rows: value.rows }));
  }, [group, sections, visible, now]);
  // v1.58.0 (D-354): a sortable column title of the list.
  const sortHead = (column: Exclude<Sort, "manual"> | number, label: string) => {
    const colKey = typeof column === "number" ? `f${column}` : column;
    const active = typeof column === "number" ? sortField === column : sortField === null && sort === column;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    const next = active && dir === "asc" ? "descending" : "ascending";
    return (
      <span key={String(column)} role="columnheader" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className="relative truncate pr-2" data-column={colKey}>
        <button
          type="button"
          onClick={() => {
            setDir(active && dir === "asc" ? "desc" : "asc");
            if (typeof column === "number") {
              setSortField(column);
              setSort("manual");
            } else {
              setSortField(null);
              setSort(column);
            }
          }}
          title={`Sort by ${label}, ${next}`}
         
          className={`inline-flex max-w-full items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
          data-testid="list-sort"
        >
          <span className="truncate">{label}</span>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "opacity-40"}`} />
        </button>
        <ColumnResizer
          column={colKey}
          label={label}
          width={resize.widths[colKey] ?? widthDefaults.find((item) => item.key === colKey)?.width}
          onResize={(width) => resize.setWidth(colKey, width)}
          onReset={() => resize.reset(colKey)}
        />
      </span>
    );
  };
  const focusAdd = () => document.querySelector<HTMLInputElement>("[data-work-add]")?.focus();

  // A move: into `sectionId`, before `beforeId` (null: at the end).
  const move = async (taskId: number, sectionId: number, beforeId: number | null) => {
    const list = tasks.filter((task) => task.sectionId === sectionId && task.id !== taskId).sort((a, b) => a.position - b.position);
    const index = beforeId === null ? list.length : list.findIndex((task) => task.id === beforeId);
    const afterId = index > 0 ? list[index - 1]!.id : null;
    const task = tasks.find((item) => item.id === taskId);
    const section = sections.find((item) => item.id === sectionId);
    setLive(`Moved ${task?.title ?? "task"} to ${section?.name ?? "section"}.`);
    await call(() => moveTaskAction({ taskId, projectId, sectionId, beforeId: index >= 0 && index < list.length ? list[index]!.id : null, afterId }), { success: false });
  };
  // Alt+↑/↓ moves a row; Alt+Shift+↑/↓ moves it to the previous/next section.
  const keyMove = (event: React.KeyboardEvent, task: BoardTask) => {
    if (!event.altKey || !canDrag || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const up = event.key === "ArrowUp";
    if (event.shiftKey) {
      const index = sections.findIndex((section) => section.id === task.sectionId);
      const target = sections[index + (up ? -1 : 1)];
      if (target) void move(task.id, target.id, null);
      return;
    }
    const list = inSection(task.sectionId);
    const index = list.findIndex((item) => item.id === task.id);
    if (up && index > 0) void move(task.id, task.sectionId, list[index - 1]!.id);
    if (!up && index < list.length - 1) void move(task.id, task.sectionId, list[index + 2]?.id ?? null);
  };

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3" role="toolbar" aria-label="View options">
      {canEdit && (
        <button type="button" onClick={focusAdd} className="btn-primary btn-compact inline-flex items-center gap-1">
          <Plus aria-hidden="true" className="h-4 w-4" /> Add task
        </button>
      )}
      <span className="ml-auto" />
      <Popover label={filterCount ? `Filters: ${filterCount}` : "Filter"} active={filterCount > 0} testId="filter-menu">
        <p className="mb-2 flex items-center justify-between text-label font-semibold">
          Filters
          {filterCount > 0 && (
            <button
              type="button"
              className="link text-caption font-normal"
              onClick={() => {
                setIncomplete(true);
                setShowDone(false);
                setMine(false);
                setDueWithin("");
                setFieldFilters([]);
              }}
            >
              Clear
            </button>
          )}
        </p>
        <div className="space-y-1.5 text-label">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={incomplete} onChange={(event) => setIncomplete(event.target.checked)} /> Incomplete tasks
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} data-testid="show-completed" /> Completed tasks
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Just my tasks
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dueWithin === "this"} onChange={(event) => setDueWithin(event.target.checked ? "this" : "")} /> Due this week
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dueWithin === "next"} onChange={(event) => setDueWithin(event.target.checked ? "next" : "")} /> Due next week
          </label>
        </div>
        {planning && fields.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <FieldFilterRows fields={fields} filters={fieldFilters} onChange={setFieldFilters} people={people} />
          </div>
        )}
      </Popover>
      {planning && layout === "BOARD" && fields.length > 0 && (
        <label className="flex items-center gap-1.5 text-label">
          <span className="text-ink-muted">Columns</span>
          <select aria-label="Columns" value={groupField ?? ""} onChange={(event) => setGroupField(event.target.value ? Number(event.target.value) : null)} className="field-input h-8 w-auto py-0 text-label" data-testid="board-columns">
            <option value="">Sections</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5 text-label">
        <span className="text-ink-muted">Sort</span>
        <select
          aria-label="Sort"
          value={sortField !== null ? `f${sortField}` : sort}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith("f")) {
              setSortField(Number(value.slice(1)));
              setSort("manual");
            } else {
              setSortField(null);
              setSort(value as Sort);
            }
          }}
          className="field-input h-8 w-auto py-0 text-label"
        >
          <option value="manual">None (manual order)</option>
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
          <option value="assignee">Assignee</option>
          <option value="title">Alphabetical</option>
          {fields.map((field) => (
            <option key={field.id} value={`f${field.id}`}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
      {/* v1.58.0 (D-354): ascending or descending. */}
      {(sort !== "manual" || sortField !== null) && (
        <label className="flex items-center gap-1.5 text-label">
          <span className="sr-only">Order</span>
          <select aria-label="Order" value={dir} onChange={(event) => setDir(event.target.value as SortDir)} className="field-input h-8 w-auto py-0 text-label">
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      )}
      {layout === "LIST" && (
        <label className="flex items-center gap-1.5 text-label">
          <span className="text-ink-muted">Group</span>
          <select aria-label="Group" value={group} onChange={(event) => setGroup(event.target.value as GroupBy)} className="field-input h-8 w-auto py-0 text-label">
            <option value="section">Sections</option>
            <option value="assignee">Assignee</option>
            <option value="department">Department</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
          </select>
        </label>
      )}
      <label className="ml-auto flex items-center" htmlFor="project-filter">
        <span className="sr-only">Search this view</span>
        <input id="project-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search this view" className="field-input h-8 w-52 text-label" />
      </label>
      {board && boardDirty && (
        <UnsavedView
          canSave={board.canSave}
          onReset={resetBoard}
          onSave={() => void call(() => projectTabAction(projectId, { op: "save", key: board.tabKey, config: boardNow })).then((result) => result?.ok && setSavedBoard(boardNow))}
        />
      )}
      {canEdit && !manual && <span className="w-full text-caption text-ink-muted">Dragging is off while a sort, filter or grouping is on.</span>}
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
    </div>
  );

  if (layout === "BOARD") {
    // v1.62.0 (D-368): each column's cards in the order shown; a lifted card
    // (keyboard move) shows at its new place until dropped.
    // v1.64.0 (D-371): columns by a custom field: a single-select field's
    // options (and "No ..."), moving a card sets the option; other types group
    // the cards read-only.
    const byField = planning && groupField !== null ? fields.find((field) => field.id === groupField) : undefined;
    const fieldMovable = Boolean(byField && boardMovable(byField.kind) && canEdit);
    const today = indiaDayOf(now);
    const boardCols: { key: string; name: string; section: BoardSection | null; optionId: number | null }[] = byField
      ? (() => {
          const def = viewDef(byField);
          const named = new Map<string, { order: number; optionId: number | null }>();
          if (byField.kind === "SELECT") (byField.choices ?? []).filter((choice) => !choice.archived).forEach((choice, index) => named.set(choice.name, { order: index, optionId: choice.id }));
          for (const task of visible) for (const [name, order] of fieldGroups(def, values[task.id]?.[byField.id], today)) if (!named.has(name)) named.set(name, { order, optionId: byField.choices?.find((choice) => choice.name === name)?.id ?? null });
          if (!named.has(`No ${byField.name}`)) named.set(`No ${byField.name}`, { order: 1e9, optionId: null });
          return [...named.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([name, info]) => ({ key: `f${name}`, name, section: null, optionId: info.optionId }));
        })()
      : sections.map((section) => ({ key: `s${section.id}`, name: section.name, section, optionId: null }));
    const columns = byField
      ? boardCols.map((col) => visible.filter((task) => fieldGroups(viewDef(byField), values[task.id]?.[byField.id], today).some(([name]) => name === col.name)).map((task) => task.id))
      : sections.map((section) => inSection(section.id).map((task) => task.id));
    const canMoveCards = byField ? fieldMovable : canDrag;
    // A drop into column `col`: a section move, or setting the field's option.
    const dropInto = async (taskId: number, col: number, beforeId: number | null) => {
      const target = boardCols[col];
      if (!target) return;
      if (target.section) return move(taskId, target.section.id, beforeId);
      if (byField && fieldMovable) {
        setLive(`${byField.name} set to ${target.optionId ? target.name : "nothing"}.`);
        await call(() => fieldValueAction(taskId, byField.id, target.optionId), { success: false });
      }
    };
    const byId = new Map(visible.map((task) => [task.id, task]));
    const focusCard = (id: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)?.focus());
    const cardKeys = (event: React.KeyboardEvent<HTMLLIElement>, task: BoardTask) => {
      if (event.altKey) return keyMove(event, task); // Alt+arrows as before
      if (event.target !== event.currentTarget) return; // keys inside the card's own buttons and links
      const key = event.key;
      if (lifted) {
        const name = (col: number) => boardCols[col]?.name ?? "the column";
        if (key.startsWith("Arrow")) {
          event.preventDefault();
          const next = moveLifted(columns, lifted, key);
          setLifted(next);
          setLive(positionText(columns, next, name(next.col)));
          focusCard(task.id);
        } else if (key === " " || key === "Enter") {
          event.preventDefault();
          const target = dropTarget(columns, lifted);
          const where = positionText(columns, lifted, name(target.col));
          setLifted(null);
          if (boardCols[target.col] && target.moved && (!byField || target.col !== lifted.fromCol)) {
            setLive(`Dropped ${task.title}. ${where}`);
            void dropInto(task.id, target.col, target.beforeId).then(() => setLive(`Dropped ${task.title}. ${where}`));
          } else setLive(`Dropped ${task.title}. It stays where it was.`);
          focusCard(task.id);
        } else if (key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setLifted(null);
          setLive(`Move cancelled. ${task.title} is back in ${name(lifted.fromCol)}.`);
          focusCard(task.id);
        }
        return;
      }
      if (key === " ") {
        event.preventDefault();
        if (!canMoveCards) {
          setLive(!canEdit ? "You can't move tasks in this project." : byField ? `Cards can't be moved between ${byField.name} columns.` : "Moving is off while a sort, filter or search is on.");
          return;
        }
        const start = lift(columns, task.id);
        if (!start) return;
        setLifted(start);
        setLive(`Picked up ${task.title}. ${positionText(columns, start, boardCols[start.col]?.name ?? "")} Use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.`);
      } else if (key === "Enter") {
        event.preventDefault();
        router.push(paneLink(task.id), { scroll: false });
      } else if (key.startsWith("Arrow") || key === "Home" || key === "End") {
        const next = focusNeighbour(columns, task.id, key);
        if (next !== null) {
          event.preventDefault();
          focusCard(next);
        }
      }
    };
    return (
      <div>
        {toolbar}
        {canEdit && (
          <p id="board-keys-help" className="sr-only">
            Press Space to pick up a card, the arrow keys to move it between cards and columns, Space or Enter to drop it, Escape to cancel. Alt and the up or down arrow also move it.
          </p>
        )}
        <div className="scroll-hint flex gap-3 overflow-x-auto pb-4" data-testid="board">
          {boardCols.map((boardCol, index) => {
            const section = boardCol.section;
            const ids = previewColumn(columns[index] ?? [], index, lifted);
            const count = columns[index]?.length ?? 0;
            return (
              <section
                key={boardCol.key}
                aria-label={`${boardCol.name}, ${count} task${count === 1 ? "" : "s"}`}
                className={`kanban-col flex w-[304px] shrink-0 flex-col rounded-xl border border-t-4 border-line bg-surface-muted ${columnAccent(index)}`}
                onDragOver={(event) => canMoveCards && event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) void dropInto(dragging, index, null);
                  setDragging(null);
                }}
                data-testid="board-column"
              >
                {section ? (
                  <SectionHeader section={section} sections={sections} count={count} canEdit={canEdit} />
                ) : (
                  <h3 className="flex items-center gap-2 px-3 pb-2 pt-3 text-card-title font-semibold">
                    {boardCol.name} <span className="text-caption font-normal text-ink-muted">{count}</span>
                  </h3>
                )}
                <ul className="flex-1 space-y-2 px-2 pb-2" aria-label={`Tasks in ${boardCol.name}`}>
                  {ids.map((id) => {
                    const task = byId.get(id);
                    if (!task) return null;
                    const isLifted = lifted?.taskId === task.id;
                    return (
                      <li
                        key={task.id}
                        tabIndex={0}
                        data-card-id={task.id}
                        aria-label={`${task.title}${isLifted ? ", picked up" : ""}`}
                        aria-describedby={canEdit ? "board-keys-help" : undefined}
                        draggable={canMoveCards && !lifted}
                        onDragStart={() => setDragging(task.id)}
                        onDragEnd={() => setDragging(null)}
                        onDragOver={(event) => canMoveCards && event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (dragging !== null && dragging !== task.id) void dropInto(dragging, index, task.id);
                          setDragging(null);
                        }}
                        onKeyDown={(event) => cardKeys(event, task)}
                        className={`kanban-card rounded-lg border border-line bg-surface p-3.5 shadow-card hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${approvalRowClass(task.approval)} ${dragging === task.id ? "opacity-50" : ""} ${isLifted ? "pm-lifted shadow-overlay" : ""} ${openTask === String(task.id) ? "outline outline-2 outline-primary-600" : ""}`}
                        data-testid="board-card"
                        data-lifted={isLifted || undefined}
                      >
                        <div className="flex items-start gap-2">
                          <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={!(canEdit || task.assigneeId === meId) || task.status === "CANCELLED"} label={task.title} size="sm" />
                          <Link href={paneLink(task.id)} scroll={false} tabIndex={-1} className="line-clamp-2 min-w-0 flex-1 text-label font-medium text-ink hover:underline">
                            {task.isMilestone && <Diamond aria-label="Milestone" className="mr-1 inline h-3.5 w-3.5 text-primary-600" />}
                            <span className={task.status === "COMPLETED" ? "text-ink-muted line-through" : ""}>{task.title}</span>
                          </Link>
                        </div>
                        <FieldChips fields={fields} values={values[task.id]} planning={planning} />
                        <TaskMeta task={task} now={now} />
                      </li>
                    );
                  })}
                </ul>
                {canEdit && section && <AddTask projectId={projectId} sectionId={section.id} compact />}
              </section>
            );
          })}
          {canEdit && !byField && <AddSection projectId={projectId} afterId={sections.at(-1)?.id ?? null} board />}
        </div>
      </div>
    );
  }

  // D-220: the List is the shared task table (Filters, Sort, Groups, Options, saved tabs).
  if (grid)
    return (
      <div data-testid="project-list">
        <TaskGrid
          rows={grid.rows}
          subtasks={grid.subtasks}
          density={density}
          initial={grid.initial}
          columns={["assignee", "due", "priority", "collaborators", "createdBy", "tags"]}
          groupsAllowed={["section", "assignee", "createdBy", "due", "priority", "kind"]}
          sections={sections}
          sectionHeader={(section, count) => <SectionHeader section={section} sections={sections} count={count} canEdit={canEdit} plain />}
          onMove={canEdit ? (taskId, sectionId, beforeId) => void move(taskId, sectionId, beforeId) : undefined}
          addTo={canEdit ? { projectId } : undefined}
          people={people}
          fields={fields}
          values={values}
          planning={planning}
          customise={customise}
          meId={meId}
          nowIso={nowIso}
          view={grid.view}
          widthKey={`project:${projectId}`}
          bulk={canEdit}
          editAssignee={canEdit}
          editPriority={canEdit}
          testId="project-grid"
          emptyText="No tasks match. Clear the filters, or add a task."
        />
        {canEdit && <AddSection projectId={projectId} afterId={sections.at(-1)?.id ?? null} />}
      </div>
    );

  return (
    <div>
      {toolbar}
      {groups.length > 0 && <FoldAllButtons onAll={foldAll} testId="project-fold-all" />}
      <div className="card overflow-x-auto" data-testid="project-list">
        <div role="table" aria-label="Tasks" className="min-w-max">
          <div role="row" style={columns} className="relative grid border-b border-line bg-surface-muted px-3 py-2 text-caption font-semibold uppercase tracking-wide text-ink-faint">
            {canEdit && (
              <span role="columnheader">
                <input
                  type="checkbox"
                  aria-label="Select all shown tasks"
                  checked={visible.length > 0 && visible.every((task) => selected.includes(task.id))}
                  onChange={(event) => setSelected(event.target.checked ? visible.map((task) => task.id) : [])}
                />
              </span>
            )}
            {/* v1.58.0 (D-354): every column title sorts by it, first A to Z, again Z to A. */}
            {sortHead("title", "Task")}
            {sortHead("assignee", "Assignee")}
            {sortHead("due", "Due date")}
            {sortHead("priority", "Priority")}
            {fields.map((field) => sortHead(field.id, field.name))}
            {canEdit && (
              <Link href={`/users/work/projects/${projectId}/settings#fields`} aria-label="Add a field" title="Add a field" className="absolute right-3 rounded px-1 text-ink-faint hover:bg-surface hover:text-ink">
                +
              </Link>
            )}
          </div>
          {groups.map((entry) => {
            const section = entry.section;
            const rows = entry.rows;
            const closed = isClosed(entry.key);
            return (
              <div
                key={entry.key}
                role="rowgroup"
                aria-label={entry.name}
                onDragOver={(event) => canDrag && event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null && section) void move(dragging, section.id, null);
                  setDragging(null);
                }}
              >
                <div className="flex items-center gap-1 border-b border-line px-1 pt-3">
                  <button
                    type="button"
                    aria-expanded={!closed}
                    aria-label={`${closed ? "Show" : "Hide"} ${entry.name}`}
                    onClick={() => setFold((value) => ({ ...value, toggled: new Set(value.toggled.has(entry.key) ? [...value.toggled].filter((item) => item !== entry.key) : [...value.toggled, entry.key]) }))}
                    className="rounded p-1 text-ink-muted hover:bg-surface-muted"
                  >
                    {closed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {section ? (
                    <SectionHeader section={section} sections={sections} count={rows.length} canEdit={canEdit} plain />
                  ) : (
                    <h3 className="flex items-center gap-2 pb-1 font-semibold">
                      {entry.name} <span className="text-caption font-normal text-ink-muted">{rows.length}</span>
                    </h3>
                  )}
                </div>
                {!closed &&
                  rows.map((task) => (
                    <div
                      key={task.id}
                      role="row"
                      tabIndex={-1}
                      draggable={canDrag}
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={(event) => canDrag && event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (dragging !== null && dragging !== task.id && section) void move(dragging, section.id, task.id);
                        setDragging(null);
                      }}
                      onKeyDown={(event) => keyMove(event, task)}
                      data-testid="task-row"
                      data-task-id={task.id}
                      style={columns}
                      className={`work-row group grid items-center border-b border-line px-1 py-1.5 hover:bg-surface-muted ${dragging === task.id ? "opacity-50" : ""} ${selected.includes(task.id) ? "bg-primary-50/50" : ""} ${openTask === String(task.id) ? "bg-primary-50 outline outline-1 -outline-offset-1 outline-primary-600" : ""}`}
                    >
                      {canEdit && (
                        <div role="cell" className="pl-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${task.title}`}
                            checked={selected.includes(task.id)}
                            onChange={(event) => setSelected((value) => (event.target.checked ? [...value, task.id] : value.filter((one) => one !== task.id)))}
                          />
                        </div>
                      )}
                      <div role="cell" className="flex min-w-0 items-center gap-2 pr-2 [contain:inline-size]">
                        <span aria-hidden="true" className={`text-ink-faint ${canDrag ? "cursor-grab opacity-0 group-hover:opacity-100" : "invisible"}`} title="Drag to move (or Alt+↑/↓)">
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={!(canEdit || task.assigneeId === meId) || task.status === "CANCELLED"} label={task.title} />
                        <Link
                          href={paneLink(task.id)} scroll={false}
                          title={task.title}
                          className="line-clamp-2 min-w-0 break-words text-label text-ink hover:underline"
                          aria-keyshortcuts={canDrag ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                        >
                          {task.isMilestone && <Diamond aria-label="Milestone" className="mr-1 inline h-3.5 w-3.5 text-primary-600" />}
                          <span className={task.status === "COMPLETED" ? "text-ink-muted line-through" : ""}>{task.title}</span>
                        </Link>
                        <RowBadges task={task} />
                      </div>
                      <div role="cell" className="min-w-0">
                        {canEdit ? (
                          <PersonSelect
                            ariaLabel={`Assignee of ${task.title}`}
                            options={people.some((person) => person.id === task.assigneeId) ? people : [{ id: task.assigneeId, label: task.assigneeName }, ...people]}
                            value={task.assigneeId}
                            disabled={!OPEN.has(task.status)}
                            onChange={(id) => {
                              if (id !== null && id !== task.assigneeId) void call(() => taskFieldsAction(task.id, { assigneeId: id }));
                            }}
                            compact
                            floating
                            className="w-full max-w-[160px] text-label"
                          />
                        ) : (
                          <span className="block truncate text-label text-ink-muted" title={task.assigneeName}>
                            {task.assigneeName}
                          </span>
                        )}
                      </div>
                      <div role="cell" className="min-w-0">
                        {canEdit || task.assigneeId === meId ? (
                          <input
                            key={task.dueAt ?? "none"}
                            type="date"
                            aria-label={`Due date of ${task.title}`}
                            defaultValue={task.dueAt ? indiaDayOf(new Date(task.dueAt)) : ""}
                            disabled={!OPEN.has(task.status)}
                            onBlur={(event) => {
                              const before = task.dueAt ? indiaDayOf(new Date(task.dueAt)) : "";
                              const input = event.target;
                              const picked = input.value;
                              if (picked !== before)
                                void call((choice) => taskFieldsAction(task.id, { dueDay: choice?.moveTo ?? picked, holidayOk: choice?.holidayOk }), { success: false }).then((result) => {
                                  if (!result?.ok) input.value = before; // refused or cancelled: show the saved date again
                                });
                            }}
                            className={`field-input h-8 w-full max-w-[124px] py-0 text-label ${TONE_TEXT[dueLabel(task.dueAt, now, OPEN.has(task.status))?.tone ?? "neutral"]}`}
                          />
                        ) : (
                          <span className="text-label">{dueLabel(task.dueAt, now, OPEN.has(task.status))?.text ?? "—"}</span>
                        )}
                      </div>
                      <div role="cell" className="min-w-0">
                        {canEdit ? (
                          <select
                            aria-label={`Priority of ${task.title}`}
                            value={task.priority}
                            disabled={!OPEN.has(task.status)}
                            onChange={(event) => void call(() => taskFieldsAction(task.id, { priority: event.target.value }), { success: false })}
                            {...priorityControlProps(task.priority)}
                            className={`field-input h-8 w-full max-w-[100px] py-0 text-label ${priorityControlProps(task.priority).className}`}
                          >
                            <option value="URGENT">Critical</option>
                            <option value="HIGH">Most Important</option>
                            <option value="IMPORTANT">Important</option>
                            <option value="ELEVATED">High</option>
                            <option value="ELEVATED">High</option>
                            <option value="NORMAL">Normal</option>
                          </select>
                        ) : (
                          <TaskPriorityPill priority={task.priority} showNormal />
                        )}
                      </div>
                      {fields.map((field) => (
                        <div key={field.id} role="cell" className="min-w-0 pr-2">
                          {planning ? (
                            <FieldValueEditor taskId={task.id} field={field} cell={values[task.id]?.[field.id]} label={`${field.name} of ${task.title}`} canChange={canEdit || task.assigneeId === meId} people={people} compact />
                          ) : (
                            <FieldInput taskId={task.id} field={{ ...field, name: `${field.name} of ${task.title}` }} value={values[task.id]?.[field.id]?.edit ?? ""} canChange={canEdit || task.assigneeId === meId} compact />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                {!closed && canEdit && section && <AddTask projectId={projectId} sectionId={section.id} />}
              </div>
            );
          })}
          {canEdit && <AddSection projectId={projectId} afterId={sections.at(-1)?.id ?? null} />}
        </div>
      </div>
      <BulkBar ids={selected.filter((one) => tasks.some((task) => task.id === one))} clear={() => setSelected([])} people={people} sections={sections} projectId={projectId} />
    </div>
  );
}

// v1.62.0 (D-368, spec Board card "field chips"): the project's field values
// set on this card (empty ones left out), name and value, at most three.
function FieldChips({ fields, values, planning }: { fields: FieldView[]; values?: Record<number, FieldCell>; planning: boolean }) {
  // v1.64.0 (D-371): only the fields shown on cards (Fields settings); select values as coloured chips.
  const set = fields.filter((field) => field.showOnCards !== false && values?.[field.id] && (values[field.id]!.text !== "" || (field.kind === "TIMER" && (values[field.id]!.timer?.seconds ?? 0) > 0)));
  if (!set.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1" aria-label="Fields" data-testid="card-fields">
      {set.slice(0, 3).map((field) =>
        planning ? (
          <FieldChip key={field.id} field={field} cell={values![field.id]!} />
        ) : (
          <li key={field.id} className="max-w-full truncate rounded-md bg-surface-muted px-1.5 py-0.5 text-caption text-ink">
            <span className="text-ink-muted">{field.name}:</span> {values?.[field.id]?.text}
          </li>
        ),
      )}
      {set.length > 3 && <li className="rounded-md px-1 text-caption text-ink-muted">+{set.length - 3} more</li>}
    </ul>
  );
}

function RowBadges({ task }: { task: BoardTask }) {
  return (
    <span className="ml-1 flex shrink-0 items-center gap-2 text-caption text-ink-muted">
      <ApprovalBadge approval={task.approval} size="sm" />
      {task.isPeriodic && (
        <span role="img" aria-label="Periodic" title="Periodic: repeats" className="inline-flex items-center text-info-600">
          <Repeat aria-hidden="true" className="h-3 w-3" />
        </span>
      )}
      {task.blockedBy > 0 && (
        <span title={`Waiting for ${task.blockedBy} task${task.blockedBy === 1 ? "" : "s"}`} className="inline-flex items-center gap-0.5 text-warning-600">
          <Lock aria-hidden="true" className="h-3 w-3" />
          <span className="sr-only">Waiting for {task.blockedBy}</span>
        </span>
      )}
      {task.subtasks > 0 && (
        <span title="Subtasks done / all" className="inline-flex items-center gap-0.5">
          <GitBranch aria-hidden="true" className="h-3 w-3" />
          {task.subtasks - task.subtasksOpen}/{task.subtasks}
        </span>
      )}
      {task.comments > 0 && (
        <span title="Comments" className="inline-flex items-center gap-0.5">
          <MessageSquare aria-hidden="true" className="h-3 w-3" />
          {task.comments}
        </span>
      )}
      {task.likes > 0 && (
        <span title="Likes" className="inline-flex items-center gap-0.5">
          <Heart aria-hidden="true" className="h-3 w-3" />
          {task.likes}
        </span>
      )}
      {task.tags.slice(0, 2).map((tag) => (
        <span key={tag.id} className="rounded bg-surface-muted px-1.5 text-caption">
          #{tag.name}
        </span>
      ))}
    </span>
  );
}

function TaskMeta({ task, now }: { task: BoardTask; now: Date }) {
  const due = dueLabel(task.dueAt, now, OPEN.has(task.status));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-muted">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-solid text-[10px] font-semibold text-on-solid" aria-hidden="true">
          {initialsOf(task.assigneeName)}
        </span>
        <span className="truncate">{task.assigneeName}</span>
      </span>
      {due && (
        <span className={`inline-flex items-center gap-1 ${TONE_TEXT[due.tone]}`}>
          <CalendarClock aria-hidden="true" className="h-3 w-3" />
          {due.text}
        </span>
      )}
      {/* v1.47.0: the same priority pill as every task table (Low too). */}
      <TaskPriorityPill priority={task.priority} />
      <RowBadges task={task} />
    </div>
  );
}

function SectionHeader({ section, sections, count, canEdit, plain }: { section: BoardSection; sections: BoardSection[]; count: number; canEdit: boolean; plain?: boolean }) {
  const { call, pending } = useWorkCall();
  const [name, setName] = useState(section.name);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState<number>(sections.find((item) => item.id !== section.id)?.id ?? 0);
  useEffect(() => setName(section.name), [section.name]);
  return (
    // v1.66.2 (owner: "reduce the box length based on the available words"): in the
    // List the name box fits its text, and the count and buttons sit beside it.
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${plain ? "pb-1" : "flex-1 px-3 py-2"}`}>
      {canEdit ? (
        <input
          aria-label={`Section name: ${section.name}`}
          value={name}
          size={Math.max(4, Math.min(60, name.length + 1))}
          data-testid="section-name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
          onBlur={() => name.trim() && name.trim() !== section.name && void call(() => sectionAction(section.id, { name }), { success: false })}
          className={`min-w-0 max-w-full rounded border border-transparent bg-transparent px-1 font-semibold text-ink [field-sizing:content] hover:border-line focus:border-primary-600 focus:outline-none ${plain ? "" : "flex-1"}`}
        />
      ) : (
        <h3 className="font-semibold">{section.name}</h3>
      )}
      <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-semibold tabular-nums text-ink-muted">{count}</span>
      {canEdit && sections.length > 1 && (
        <button type="button" aria-label={`Delete section ${section.name}`} title="Delete section" onClick={() => setDeleting((value) => !value)} className="rounded p-1 text-ink-faint hover:bg-danger-50 hover:text-danger-600">
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
      {deleting && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-danger-50 p-2 text-label" role="group" aria-label="Delete section">
          <span>Move its tasks to</span>
          <select aria-label="Move its tasks to" value={moveTo} onChange={(event) => setMoveTo(Number(event.target.value))} className="field-input h-8 w-auto py-0 text-label">
            {sections
              .filter((item) => item.id !== section.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          <button type="button" className="btn-danger btn-compact" disabled={pending} aria-busy={pending || undefined} onClick={() => void call(() => sectionAction(section.id, { deleteMoveTo: moveTo }), { success: "Section deleted." })}>
            {pending ? "Working…" : "Delete section"}
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={() => setDeleting(false)}>
            Keep it
          </button>
        </div>
      )}
    </div>
  );
}

export function AddTask({
  projectId,
  sectionId,
  parentId,
  mySectionId,
  compact,
  placeholder,
  onPlus,
  plusLabel,
}: {
  projectId?: number;
  sectionId?: number;
  parentId?: number;
  mySectionId?: number;
  compact?: boolean;
  placeholder?: string;
  // v1.59.5 (owner): the + opens the full Create task dialog.
  onPlus?: () => void;
  plusLabel?: string;
}) {
  const { call } = useWorkCall();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (titles: string[]) => {
    if (!titles.length || busy) return;
    setBusy(true);
    const target = { projectId: projectId ?? null, sectionId: sectionId ?? null, parentId: parentId ?? null, mySectionId: mySectionId ?? null };
    const result = titles.length === 1 ? await call(() => quickAddAction({ ...target, title: titles[0]! }), { success: false }) : await call(() => quickAddManyAction({ ...target, titles }));
    if (result?.ok) setValue("");
    setBusy(false);
    input.current?.focus();
  };
  return (
    <div className={compact ? "px-2 pb-2" : "flex items-center gap-2 border-b border-line px-3 py-1.5"}>
      {!compact &&
        (onPlus ? (
          <button type="button" onClick={onPlus} aria-label={plusLabel ?? "Open the Create task dialog"} title={plusLabel ?? "Open the Create task dialog"} className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="add-task-plus">
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : (
          <Plus aria-hidden="true" className="h-4 w-4 text-ink-faint" />
        ))}
      <input
        ref={input}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const lines = event.clipboardData.getData("text").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (lines.length > 1) {
            event.preventDefault();
            void add(lines);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (value.trim()) void add([value.trim()]);
          } else if (event.key === "Escape") setValue("");
        }}
        aria-label={placeholder ?? "Add a task"}
        placeholder={placeholder ?? "Add a task… (Enter to add)"}
        data-work-add
        className={compact ? "field-input h-8 w-full text-label" : "h-8 w-full bg-transparent text-label focus:outline-none"}
      />
    </div>
  );
}

function AddSection({ projectId, afterId, board }: { projectId: number; afterId: number | null; board?: boolean }) {
  const { call, pending: busy } = useWorkCall();
  const [name, setName] = useState("");
  return (
    <form
      className={board ? "w-64 shrink-0 rounded-lg border border-dashed border-line p-2" : "flex items-center gap-2 px-3 py-3"}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !busy) void call(() => addSectionAction(projectId, name, afterId), { success: "Section added." }).then((result) => result?.ok && setName(""));
      }}
    >
      <label className="sr-only" htmlFor={`add-section-${board ? "b" : "l"}`}>
        New section name
      </label>
      <input id={`add-section-${board ? "b" : "l"}`} value={name} onChange={(event) => setName(event.target.value)} placeholder="New section…" className="field-input h-8 text-label" />
      <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn-secondary btn-compact mt-0 shrink-0">
        Add section
      </button>
    </form>
  );
}

// v1.61.0 (D-366/D-367): open views stay fresh through the one shared
// refresher (every 15 s while visible, on focus, after every change).
export function useAutoRefresh() {
  useLiveRefresh();
}

// A small toolbar popover (the catalog's Filter): a button that opens a panel.
function Popover({ label, active, testId, children }: { label: string; active?: boolean; testId?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current?.open && !inside(event, box.current)) box.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <details ref={box} className="relative" data-testid={testId}>
      <summary className={`btn-secondary btn-compact cursor-pointer list-none ${active ? "border-primary-600 text-primary-700" : ""}`}>{label}</summary>
      <div className="absolute left-0 z-30 mt-1 w-60 rounded-lg border border-line bg-raised p-3 shadow-overlay">{children}</div>
    </details>
  );
}
