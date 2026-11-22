"use client";

import { TaskPriorityPill, priorityControlProps } from "@/features/ui/ChoicePill";
import { ApprovalBadge, approvalRowClass } from "@/features/work/ApprovalLink";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, ChevronDown, ChevronRight, Filter, GitBranch, Layers, Lock, MessageSquare, MoreHorizontal, Plus, Repeat, Search, Settings2, Users, X } from "lucide-react";
import Link from "next/link";
import { useProjectsOn } from "@/features/work/projects-access";
import { LockedProjectName } from "@/features/ui/ComingSoon";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FoldAllButtons } from "@/features/ui/GroupFold";
import { deleteViewAction, densityAction, myTasksTabAction, projectTabAction, saveViewAction, taskFieldsAction, updateViewAction } from "@/app/users/work/actions";
import { UnsavedView } from "@/features/work/UnsavedView";
import { useWindowedLines, WINDOW_FROM } from "@/features/work/useWindowedLines";
import { expandableIds, flattenGrid, keyMove } from "@/server/work/tree";
import { initials } from "@/features/ui/Display";
import { Drop } from "@/features/ui/Drop";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { CREATE_TASK_EVENT, COLOR_HEX, TaskCheck, usePaneLink, useWorkCall } from "@/features/work/client";
import { dueLabel, indiaDayOf, TONE_TEXT } from "@/features/work/format";
import { BulkBar, FieldInput, type FieldView } from "@/features/work/MoreParts";
import { FieldFilterRows, FieldGlyph, FieldValueEditor, openFieldDialog } from "@/features/work/FieldControls";
import type { CellMap } from "@/server/work/custom-fields";
import { AddTask } from "@/features/work/ProjectWorkspace";
import { CollaboratorsCell, TagsCell } from "@/features/work/GridCellEditors";
import { ColumnResizer } from "@/features/work/ColumnResizer";
import { useColumnWidths, type ColumnDefault } from "@/features/work/useColumnWidths";
import {
  applyGrid,
  columnSortState,
  COLUMN_LABEL,
  COMPLETED_RANGES,
  FILTER_FIELDS,
  FILTER_LABEL,
  filterCount,
  GROUP_LABEL,
  gridUrlState,
  groupsStartFolded,
  nextColumnSort,
  SORT_LABEL,
  SORTS,
  type FilterField,
  type GridColumn,
  type GridConfig,
  type GridGroup,
  type GridGroupOut,
  type GridTask,
  type SortableColumn,
} from "@/server/work/grid";

// D-220 (owner's Asana screenshots): the one task table of the Tasks area.
// Toolbar: "+ Add task ▾" on the left; Filters: N ×, Sort, Groups: N ×,
// Options, Search on the right. Body: numbered rows in groups (with an
// avatar when grouped by a person), a tick, the name with its comment count,
// then the chosen columns. A tab can be saved from Options.
export interface GridView {
  scope: "MY_TASKS" | "PROJECT";
  scopeId: number;
  canSave: boolean;
  current: { id: number; name: string } | null;
  // v1.61.0 (D-367): a project tab of the new strip ("pm_foundations"): its key
  // ("t12", or "vLIST" before the strip is stored), name, and the phase A tools
  // (Unsaved changes, Save view, Reset, the group menu).
  tabKey?: string;
  tabName?: string;
  phaseA?: boolean;
}

const COMPLETED_LABEL: Record<(typeof COMPLETED_RANGES)[number], string> = { none: "Hide", all: "All completed", today: "Completed today", week: "Past 7 days", month: "Past 30 days" };
const WIDTH: Record<GridColumn, number> = { due: 130, assignee: 190, collaborators: 150, createdBy: 160, projects: 210, visibility: 180, priority: 160, tags: 150 };
const FIELD_WIDTH = 150;

export function TaskGrid({
  rows,
  initial,
  columns,
  groupsAllowed,
  sections,
  sectionHeader,
  onMove,
  addTo,
  people = [],
  projects = [],
  fields = [],
  values = {},
  planning = false,
  customise = false,
  fieldScope,
  meId,
  nowIso,
  view,
  testId = "task-grid",
  bulk = true,
  // D-260 (owner): cells are editable wherever the person may change the task
  // (each task's canEdit, checked again on the server); a table can turn it off.
  editAssignee = true,
  editPriority = true,
  emptyText = "No tasks here.",
  syncUrl = false,
  widthKey,
  subtasks,
  density,
}: {
  rows: GridTask[];
  // v1.61.0 (D-367): each task's subtasks (shown inline, folded), and the person's row density.
  subtasks?: Record<number, GridTask[]>;
  density?: "COMFORTABLE" | "COMPACT";
  initial: GridConfig;
  columns: GridColumn[];
  groupsAllowed: GridGroup[];
  sections?: { id: number; name: string }[];
  sectionHeader?: (section: { id: number; name: string }, count: number) => React.ReactNode;
  onMove?: (taskId: number, sectionId: number, beforeId: number | null) => void;
  addTo?: { projectId?: number; mySections?: boolean };
  people?: { id: number; label: string }[];
  projects?: { id: number; name: string }[];
  fields?: FieldView[];
  values?: CellMap;
  // v1.64.0 (D-371, "pm_planning"): every field type, filter/sort/group by a
  // field and the column menu; `customise` adds "Add field" and "Edit field";
  // `fieldScope` (My Tasks): the fields each task's projects have.
  planning?: boolean;
  customise?: boolean;
  fieldScope?: Record<number, number[]>;
  meId: number;
  nowIso: string;
  view?: GridView;
  testId?: string;
  bulk?: boolean;
  editAssignee?: boolean;
  editPriority?: boolean;
  emptyText?: string;
  // v1.58.0 (D-354): keep the sort and grouping in the address (a page whose
  // saved views are its address, e.g. search results).
  syncUrl?: boolean;
  // Where this table keeps its column widths (ars.gridw:<widthKey>).
  widthKey?: string;
}) {
  const projectsOn = useProjectsOn();
  const { call } = useWorkCall();
  const router = useRouter();
  const paneLink = usePaneLink();
  const [config, setConfig] = useState<GridConfig>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  // v1.58.0 (D-354, owner: "expand or collapse individually and all option ...
  // by default when a group by is selected it should collapse all the group"):
  // a chosen grouping starts with every group folded (sections stay open, see
  // groupsStartFolded); a heading opens one group; Expand all / Collapse all.
  // `toggled` holds the groups opened or closed one by one against `closed`.
  const [fold, setFold] = useState(() => ({ group: `${initial.group}:${initial.groupField ?? ""}`, closed: groupsStartFolded(initial.group, initial.groupField), toggled: new Set<string>() }));
  const [selected, setSelected] = useState<number[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [searching, setSearching] = useState(Boolean(initial.search));
  const openTask = useSearchParams().get("task");
  const lastInitial = useRef(JSON.stringify(initial));
  // v1.61.0 (D-367): keyed by the saved view's text, not the object, so the
  // 15-second refresh (a new but equal object) never wipes unsaved changes.
  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    // v1.58.0 (D-354): with syncUrl the page comes back with the sort and group
    // just put in the address; the filters and search typed here are kept then.
    const fresh = JSON.parse(initialKey) as GridConfig;
    if (syncUrl) {
      if (initialKey === lastInitial.current) return;
      lastInitial.current = initialKey;
      setConfig((current) => (JSON.stringify(gridUrlState(current)) === JSON.stringify(gridUrlState(fresh)) ? current : fresh));
      return;
    }
    setConfig(fresh);
    setSaved(initialKey);
  }, [initialKey, syncUrl]);
  const urlState = JSON.stringify(gridUrlState(config));
  useEffect(() => {
    if (!syncUrl) return;
    const url = new URL(window.location.href);
    for (const name of ["gsort", "gdir", "ggroup", "gfield"]) url.searchParams.delete(name);
    for (const [name, value] of Object.entries(JSON.parse(urlState) as Record<string, string>)) url.searchParams.set(name, value);
    if (url.search !== window.location.search) router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [syncUrl, urlState, router]);
  const foldKey = `${config.group}:${config.groupField ?? ""}`;
  if (fold.group !== foldKey) setFold({ group: foldKey, closed: groupsStartFolded(config.group, config.groupField), toggled: new Set() });
  const toggleGroup = (key: string) => setFold((value) => ({ ...value, toggled: new Set(value.toggled.has(key) ? [...value.toggled].filter((item) => item !== key) : [...value.toggled, key]) }));
  const foldAll = (open: boolean) => setFold((value) => ({ ...value, closed: !open, toggled: new Set() }));
  const today = indiaDayOf(new Date(nowIso));
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const groups = useMemo(() => applyGrid(rows, config, { today, meId, sections, values, fields }), [rows, config, today, meId, sections, values, fields]);
  const shown = config.hidden.length ? columns.filter((column) => !config.hidden.includes(column)) : columns;
  // v1.64.0 (D-371): the field columns this view shows (Options or the column menu hide them).
  const shownFields = planning && config.hiddenFields?.length ? fields.filter((field) => !config.hiddenFields.includes(field.id)) : fields;
  const canDrag = Boolean(onMove) && config.group === "section" && config.sort === "none" && !config.sortField && filterCount(config) === 0 && !config.search;
  // Owner: "all the columns in all the tables should be resizable". Every
  // column but the row number takes its width from one state (drag the right
  // edge of its title; ←/→ when focused; double-click or Enter resets).
  const widthDefaults: ColumnDefault[] = [
    { key: "name", width: 260, flex: true },
    ...shown.map((column) => ({ key: column, width: WIDTH[column] })),
    ...shownFields.map((field) => ({ key: `f${field.id}`, width: FIELD_WIDTH })),
    ...(planning && customise ? [{ key: "addField", width: 44 }] : []),
  ];
  const resize = useColumnWidths(widthKey ?? (testId === "task-grid" ? "taskgrid" : `taskgrid:${testId}`), widthDefaults);
  const gridColumns = { gridTemplateColumns: `40px ${resize.template}` };
  const resizer = (key: string, label: string) => <ColumnResizer column={key} label={label} width={resize.widths[key] ?? widthDefaults.find((column) => column.key === key)?.width} onResize={(width) => resize.setWidth(key, width)} onReset={() => resize.reset(key)} />;
  const set = (changes: Partial<GridConfig>) => setConfig((value) => ({ ...value, ...changes }));
  const dirty = JSON.stringify(config) !== saved;
  const count = filterCount(config);
  const allShown = groups.flatMap((group) => group.rows);
  // v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa
  // in all columns"): every column title sorts by it, first A to Z, again Z to A.
  // The sort is part of the view (saved with Save view / Save as a new tab).
  const sorting = Boolean(config.sortField) || config.sort !== "none";
  const sortName = config.sortField ? (fields.find((field) => field.id === config.sortField)?.name ?? "Field") : SORT_LABEL[config.sort];
  // v1.64.0 (D-371, spec PC §8.10): a field column's own menu.
  const fieldHead = (field: FieldView) => {
    const state = columnSortState(config, field.id);
    const Icon = state === "asc" ? ArrowUp : state === "desc" ? ArrowDown : ArrowUpDown;
    const item = "block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted";
    const close = (event: React.SyntheticEvent) => {
      const details = (event.currentTarget as HTMLElement).closest("details");
      if (details) details.open = false;
    };
    return (
      <span key={field.id} role="columnheader" aria-sort={state === "asc" ? "ascending" : state === "desc" ? "descending" : "none"} className="relative flex min-w-0 items-center gap-1 border-r border-line px-2 py-2" data-column={`f${field.id}`}>
        <button type="button" onClick={() => set(nextColumnSort(config, field.id))} title={`Sort by ${field.name}, ${state === "asc" ? "descending" : "ascending"}`} className={`inline-flex min-w-0 items-center gap-1 hover:text-ink ${state ? "text-ink" : ""}`} data-testid="grid-sort">
          <FieldGlyph kind={field.kind} />
          <span className="truncate">{field.name}</span>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${state ? "" : "opacity-40"}`} />
        </button>
        <Drop label={`Show options for ${field.name} column`} icon={<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />} buttonClass="rounded p-0.5 text-ink-muted hover:bg-surface-muted hover:text-ink" panelClass="left-0 w-56" testId="field-column-menu">
          <div className="space-y-0.5 pt-5">
            <button type="button" className={item} onClick={(event) => { close(event); set({ sort: "none", sortField: field.id, dir: "asc" }); }}>
              Sort ascending
            </button>
            <button type="button" className={item} onClick={(event) => { close(event); set({ sort: "none", sortField: field.id, dir: "desc" }); }}>
              Sort descending
            </button>
            <button type="button" className={item} onClick={(event) => { close(event); set({ fieldFilters: [...(config.fieldFilters ?? []), { fieldId: field.id, op: "notEmpty" as const, value: "" }].slice(0, 10) }); }}>
              Filter by this field
            </button>
            <button type="button" className={item} onClick={(event) => { close(event); set({ groupField: field.id }); }}>
              Group by this field
            </button>
            <button type="button" className={item} onClick={(event) => { close(event); set({ hiddenFields: [...(config.hiddenFields ?? []), field.id] }); }}>
              Hide column
            </button>
            {field.canEdit && (
              <button type="button" className={item} onClick={(event) => { close(event); openFieldDialog({ fieldId: field.id }); }}>
                Edit field
              </button>
            )}
          </div>
        </Drop>
        {resizer(`f${field.id}`, field.name)}
      </span>
    );
  };
  const sortHead = (column: SortableColumn, label: string, className: string, colKey: string) => {
    const state = columnSortState(config, column);
    const Icon = state === "asc" ? ArrowUp : state === "desc" ? ArrowDown : ArrowUpDown;
    const next = state === "asc" ? "descending" : "ascending";
    return (
      <span key={String(column)} role="columnheader" aria-sort={state === "asc" ? "ascending" : state === "desc" ? "descending" : "none"} className={`relative ${className}`} data-column={colKey}>
        <button type="button" onClick={() => set(nextColumnSort(config, column))} title={`Sort by ${label}, ${next}`} className={`inline-flex max-w-full items-center gap-1 hover:text-ink ${state ? "text-ink" : ""}`} data-testid="grid-sort">
          <span className="truncate">{label}</span>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${state ? "" : "opacity-40"}`} />
        </button>
        {resizer(colKey, label)}
      </span>
    );
  };
  // v1.54.2 (owner: "no check boxes; select with Ctrl + click or Shift + click on
  // the task"): Ctrl (or Cmd) + click adds or removes a task; Shift + click
  // selects every task between the last one clicked and this one, in the order
  // shown. A plain click opens the task as before. Esc clears the selection.
  const [anchor, setAnchor] = useState<number | null>(null);
  const pick = (taskId: number, range: boolean) => {
    const order = allShown.map((task) => task.id);
    if (range && anchor !== null && order.includes(anchor)) {
      const from = Math.min(order.indexOf(anchor), order.indexOf(taskId));
      const to = Math.max(order.indexOf(anchor), order.indexOf(taskId));
      const span = order.slice(from, to + 1);
      setSelected((value) => [...new Set([...value, ...span])]);
      return;
    }
    setSelected((value) => (value.includes(taskId) ? value.filter((one) => one !== taskId) : [...value, taskId]));
    setAnchor(taskId);
  };
  useEffect(() => {
    if (!selected.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length]);

  // ---- v1.61.0 (D-367): treegrid lines, subtasks, windowing and roving focus ----
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [gridLive, setGridLive] = useState("");
  const pendingFocus = useRef<string | null>(null);
  const hasSubtasks = Boolean(subtasks && Object.keys(subtasks).length);
  const toggleSubtasks = (taskId: number) => setExpanded((value) => (value.has(taskId) ? new Set([...value].filter((one) => one !== taskId)) : new Set([...value, taskId])));
  const onSubtasksAll = (open: boolean) => {
    setExpanded(open ? new Set(expandableIds(groups, subtasks)) : new Set());
    setGridLive(open ? "All subtasks shown." : "All subtasks hidden.");
  };
  const lines = useMemo(
    () =>
      flattenGrid(groups, {
        isClosed: (key) => fold.closed !== fold.toggled.has(key),
        subtasks,
        expanded,
        hideEmpty: config.hideEmpty,
        addLine: (group) => Boolean((group.sectionId !== null && addTo?.projectId && sections?.some((item) => item.id === group.sectionId)) || (group.sectionId !== null && addTo?.mySections)),
      }),
    [groups, fold, subtasks, expanded, config.hideEmpty, addTo?.projectId, addTo?.mySections, sections],
  );
  const virtual = lines.length >= WINDOW_FROM;
  const lineKeys = useMemo(() => lines.map((line) => line.key), [lines]);
  // The choice shows at once; the server keeps it (densityAction).
  const [rowDensity, setRowDensity] = useState(density);
  useEffect(() => setRowDensity(density), [density]);
  const rowEstimate = rowDensity === "COMPACT" ? 30 : 36;
  const estimate = useCallback((index: number) => (lines[index]?.kind === "group" ? 56 : lines[index]?.kind === "add" ? 40 : rowEstimate), [lines, rowEstimate]);
  const windowed = useWindowedLines(lineKeys, estimate, virtual);
  // v1.64.1 (owner's screenshot): on a table wider than the card, section headings
  // and "Add task" lines span the whole table, so a sideways scroll hid them. They
  // are pinned to the card's visible width (sticky left) instead.
  const scroller = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewWidth(element.clientWidth));
    observer.observe(element);
    setViewWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const pinned: React.CSSProperties = viewWidth ? { position: "sticky", left: 0, width: viewWidth } : { position: "sticky", left: 0 };
  const drawn = lines.slice(windowed.range.start, windowed.range.end).map((line, offset) => ({ line, index: windowed.range.start + offset }));
  const drawnGroups: { group: GridGroupOut; from: number; lines: typeof drawn }[] = [];
  for (const item of drawn) {
    const last = drawnGroups.at(-1);
    if (last && last.group.key === item.line.group.key) last.lines.push(item);
    else drawnGroups.push({ group: item.line.group, from: item.index, lines: [item] });
  }
  const activeKey = focusKey && lineKeys.includes(focusKey) ? focusKey : (lineKeys[0] ?? null);
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const row = windowed.container.current?.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(key)}"]`);
    if (row) {
      pendingFocus.current = null;
      row.focus();
    }
  });
  const focusLine = (index: number) => {
    const line = lines[index];
    if (!line) return;
    pendingFocus.current = line.key;
    setFocusKey(line.key);
    windowed.scrollToIndex(index);
    windowed.container.current?.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(line.key)}"]`)?.focus();
  };
  const onGridKey = (event: React.KeyboardEvent) => {
    const row = event.target as HTMLElement;
    // Only when a whole line has focus; inside a cell the controls keep their keys.
    if (!row.matches("[data-line-index]")) return;
    const index = Number(row.dataset.lineIndex);
    const line = lines[index];
    if (!line) return;
    if (event.key === "Enter" && line.kind === "task") {
      event.preventDefault();
      router.push(paneLink(line.task.id), { scroll: false });
      return;
    }
    if (event.key === " " && line.kind === "task" && bulk && line.parentId === null) {
      event.preventDefault();
      pick(line.task.id, event.shiftKey);
      return;
    }
    const move = keyMove(lines, index, event.key, Math.max(5, Math.floor(window.innerHeight / rowEstimate) - 2));
    if (!move) return;
    event.preventDefault();
    if ("focus" in move) focusLine(move.focus);
    else {
      if (line.kind === "group") {
        toggleGroup(line.group.key);
        setGridLive(`${line.group.name} ${move.open ? "shown" : "hidden"}.`);
      } else if (line.kind === "task") {
        toggleSubtasks(line.task.id);
        setGridLive(`Subtasks of ${line.task.title} ${move.open ? "shown" : "hidden"}.`);
      }
      pendingFocus.current = line.key;
    }
  };

  const saveTab = async () => {
    if (!view) return;
    const name = window.prompt("Name of the new tab", "")?.trim();
    if (!name) return;
    const result = await call(() => saveViewAction(view.scope, view.scopeId, name, config));
    if (result?.ok && result.value) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", String(result.value));
      url.searchParams.delete("task");
      router.push(`${url.pathname}?${url.searchParams}`);
    }
  };

  return (
    <div data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="View options">
        <span className="inline-flex">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(CREATE_TASK_EVENT, { detail: { projectId: addTo?.projectId ?? null } }))} className={addTo?.projectId ? "tb-split rounded-l-md" : "tb-split rounded-md"}>
            <Plus aria-hidden="true" className="h-4 w-4" /> Add task
          </button>
          {/* v1.49.0 (owner: "drop this task-from-templates part"): Add task opens the Create task window; only a project's "Add section" stays here. */}
          {addTo?.projectId && (
            <Drop label="More ways to add" icon={<ChevronDown aria-hidden="true" className="h-4 w-4" />} buttonClass="tb-split rounded-r-md border-l-0 px-1.5">
              <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-label hover:bg-surface-muted" onClick={() => document.querySelector<HTMLInputElement>("#add-section-l")?.focus()}>
                Add section
              </button>
            </Drop>
          )}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-0.5">
          <span className={count ? "tb-pill" : "inline-flex items-center"}>
            <Drop
              label={count ? `Filters: ${count}` : "Filter"}
              icon={
                <>
                  <Filter aria-hidden="true" className="h-4 w-4" /> {count ? `Filters: ${count}` : "Filter"}
                </>
              }
              buttonClass="tb-btn"
              panelClass="w-[min(560px,90vw)] right-0"
              testId="filter-menu"
            >
              <FilterPanel config={config} set={set} people={people} projects={projects} fields={planning ? fields : []} />
            </Drop>
            {count > 0 && (
              <button type="button" aria-label="Clear filters" onClick={() => set({ incomplete: true, completed: "none", dueThisWeek: false, dueNextWeek: false, filters: [], fieldFilters: [] })} className="tb-x">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          <span className={sorting ? "tb-pill" : "inline-flex items-center"}>
            <Drop
              label="Sort"
              icon={
                <>
                  <ArrowUpDown aria-hidden="true" className="h-4 w-4" /> {sorting ? `Sort: ${sortName}${config.dir === "desc" ? " (descending)" : ""}` : "Sort"}
                </>
              }
              buttonClass="tb-btn"
              panelClass="right-0 w-52"
            >
              {SORTS.map((sort) => (
                <label key={sort} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                  <input type="radio" name={`${testId}-sort`} checked={!config.sortField && config.sort === sort} onChange={() => set({ sort, sortField: null })} /> {SORT_LABEL[sort]}
                </label>
              ))}
              {/* v1.58.0 (D-354): the direction of the chosen sort. */}
              {sorting && (
                <div className="mt-1 border-t border-line pt-1" role="radiogroup" aria-label="Order">
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                    <input type="radio" name={`${testId}-dir`} checked={config.dir === "asc"} onChange={() => set({ dir: "asc" })} /> <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> Ascending
                  </label>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                    <input type="radio" name={`${testId}-dir`} checked={config.dir === "desc"} onChange={() => set({ dir: "desc" })} /> <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /> Descending
                  </label>
                </div>
              )}
            </Drop>
            {sorting && (
              <button type="button" aria-label="Default order" onClick={() => set({ sort: "none", sortField: null, dir: "asc" })} className="tb-x">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          <span className={config.group !== "none" || config.groupField ? "tb-pill" : "inline-flex items-center"}>
            <Drop
              label="Group"
              icon={
                <>
                  <Layers aria-hidden="true" className="h-4 w-4" /> {config.group === "none" && !config.groupField ? "Group" : "Groups: 1"}
                </>
              }
              buttonClass="tb-btn"
              panelClass="right-0 w-56"
              testId="group-menu"
            >
              <p className="mb-1 px-2 text-label font-semibold">Groups</p>
              {(["none", ...groupsAllowed] as GridGroup[]).map((group) => (
                <label key={group} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                  <input type="radio" name={`${testId}-group`} checked={config.group === group && !config.groupField} onChange={() => set({ group, groupField: null })} /> {GROUP_LABEL[group]}
                </label>
              ))}
              {/* v1.64.0 (D-371): group by any custom field. */}
              {planning && fields.length > 0 && <p className="mt-2 border-t border-line px-2 pt-2 text-caption font-semibold text-ink-muted">Custom fields</p>}
              {planning &&
                fields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                    <input type="radio" name={`${testId}-group`} checked={config.groupField === field.id} onChange={() => set({ groupField: field.id })} /> {field.name}
                  </label>
                ))}
              {/* v1.58.0 (D-354, owner's screenshot "Expand or collapse groups"): both choices, plainly. */}
              {(config.group !== "none" || config.groupField) && (
                <div className="mt-2 border-t border-line pt-2">
                  <p className="mb-1 px-2 text-caption font-semibold text-ink-muted">Expand or collapse groups</p>
                  <button type="button" className="block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted" onClick={() => foldAll(true)} data-testid="grid-expand-all">
                    Expand all groups
                  </button>
                  <button type="button" className="block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted" onClick={() => foldAll(false)} data-testid="grid-collapse-all">
                    Collapse all groups
                  </button>
                </div>
              )}
            </Drop>
            {(config.group !== "none" || config.groupField) && (
              <button type="button" aria-label="Remove grouping" onClick={() => set({ group: "none", groupField: null })} className="tb-x">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          <span aria-hidden="true" className="tb-sep" />
          <Drop
            label="Options"
            icon={
              <>
                <Settings2 aria-hidden="true" className="h-4 w-4" /> Options
              </>
            }
            buttonClass="tb-btn"
            panelClass="right-0 w-60"
          >
            <p className="mb-1 px-2 text-label font-semibold">Columns</p>
            {columns.map((column) => (
              <label key={column} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                <input
                  type="checkbox"
                  checked={!config.hidden.includes(column)}
                  onChange={(event) => set({ hidden: event.target.checked ? config.hidden.filter((item) => item !== column) : [...config.hidden, column] })}
                />{" "}
                {COLUMN_LABEL[column]}
              </label>
            ))}
            {planning && fields.length > 0 && (
              <div className="mt-2 border-t border-line pt-2" data-testid="field-columns">
                <p className="mb-1 px-2 text-label font-semibold">Fields</p>
                {fields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={!(config.hiddenFields ?? []).includes(field.id)}
                      onChange={(event) => set({ hiddenFields: event.target.checked ? (config.hiddenFields ?? []).filter((id) => id !== field.id) : [...(config.hiddenFields ?? []), field.id] })}
                    />{" "}
                    {field.name}
                  </label>
                ))}
              </div>
            )}
            {hasSubtasks && (
              <div className="mt-2 space-y-1 border-t border-line pt-2">
                <p className="mb-1 px-2 text-label font-semibold">Subtasks</p>
                <button type="button" className="block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted" onClick={() => onSubtasksAll(true)} data-testid="subtasks-expand-all">
                  Expand all subtasks
                </button>
                <button type="button" className="block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted" onClick={() => onSubtasksAll(false)} data-testid="subtasks-collapse-all">
                  Collapse all subtasks
                </button>
              </div>
            )}
            {density && (
              <div className="mt-2 border-t border-line pt-2" role="radiogroup" aria-label="Row density">
                <p className="mb-1 px-2 text-label font-semibold">Rows</p>
                {(["COMFORTABLE", "COMPACT"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
                    <input type="radio" name={`${testId}-density`} checked={rowDensity === choice} onChange={() => { setRowDensity(choice); void call(() => densityAction(choice), { success: false }); }} data-testid={`density-${choice.toLowerCase()}`} />{" "}
                    {choice === "COMPACT" ? "Compact" : "Comfortable"}
                  </label>
                ))}
              </div>
            )}
            {view?.canSave && (
              <div className="mt-2 space-y-1 border-t border-line pt-2">
                <button type="button" className="block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted" onClick={() => void saveTab()}>
                  Save as a new tab…
                </button>
                {view.current && !view.phaseA && (
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-label text-danger-600 hover:bg-danger-50"
                    onClick={() => void call(() => deleteViewAction(view.current!.id)).then((result) => result?.ok && router.push(window.location.pathname))}
                  >
                    Delete tab “{view.current.name}”
                  </button>
                )}
              </div>
            )}
          </Drop>
          {searching ? (
            <input
              autoFocus
              type="search"
              aria-label="Search this view"
              placeholder="Search this view"
              value={config.search}
              onChange={(event) => set({ search: event.target.value })}
              onBlur={() => !config.search && setSearching(false)}
              className="field-input h-7 w-48 text-label"
            />
          ) : (
            <button type="button" aria-label="Search this view" onClick={() => setSearching(true)} className="tb-btn">
              <Search aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          {dirty && view?.phaseA && view.tabKey && (
            <UnsavedView
              canSave={view.canSave}
              onReset={() => setConfig(JSON.parse(saved) as GridConfig)}
              onSave={() => void call(() => (view.scope === "MY_TASKS" ? myTasksTabAction({ op: "save", key: view.tabKey!, config }) : projectTabAction(view.scopeId, { op: "save", key: view.tabKey!, config }))).then((result) => result?.ok && setSaved(JSON.stringify(config)))}
            />
          )}
          {dirty && !view?.phaseA && view?.canSave && view.current && (
            <button type="button" className="btn-primary btn-compact" onClick={() => void call(() => updateViewAction(view.current!.id, config)).then((result) => result?.ok && setSaved(JSON.stringify(config)))}>
              Save view
            </button>
          )}
        </span>
      </div>

      {(config.group !== "none" || config.groupField) && groups.length > 0 && <FoldAllButtons onAll={foldAll} testId={`${testId}-fold-all`} />}
      <div ref={scroller} className="overflow-x-auto rounded-lg border border-line bg-surface" data-density={rowDensity === "COMPACT" ? "compact" : undefined}>
        {/* v1.61.0 (D-367, spec PRJ-03): an ARIA treegrid. Group headings are level 1,
            tasks level 2 (1 without groups), subtasks one deeper; one line takes Tab
            (roving focus), the arrow keys move and fold, Enter opens the task. Long
            tables draw only the lines near the screen (useWindowedLines). */}
        <div
          ref={windowed.container}
          role="treegrid"
          aria-label="Tasks"
          aria-rowcount={lines.length + 1}
          aria-multiselectable={bulk || undefined}
          className="w-max min-w-full"
          onKeyDown={onGridKey}
          data-virtual={virtual ? "on" : undefined}
          data-line-count={lines.length}
        >
          <div role="row" aria-rowindex={1} style={gridColumns} className="sticky top-0 z-10 grid min-h-header-row border-b border-line bg-surface text-caption font-medium text-ink-muted">
            <span role="columnheader" className="px-2 py-2">
              #
            </span>
            {sortHead("name", "Name", "border-r border-line px-2 py-2", "name")}
            {shown.map((column) => sortHead(column, COLUMN_LABEL[column], "truncate border-r border-line px-2 py-2", column))}
            {planning ? shownFields.map((field) => fieldHead(field)) : fields.map((field) => sortHead(field.id, field.name, "truncate border-r border-line px-2 py-2", `f${field.id}`))}
            {planning && customise && (
              <span role="columnheader" className="flex items-center justify-center">
                <button type="button" aria-label="Add field" title="Add field" onClick={() => openFieldDialog({})} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="grid-add-field">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </button>
              </span>
            )}
          </div>
          {allShown.length === 0 && !(config.group === "section" && sections?.length) && <p style={pinned} className="px-4 py-8 text-center text-label text-ink-muted">{emptyText}</p>}
          {windowed.range.padTop > 0 && <div aria-hidden="true" style={{ height: windowed.range.padTop }} data-testid="grid-spacer-top" />}
          {drawnGroups.map((chunk) => {
            const group = chunk.group;
            const section = group.sectionId !== null ? (sections?.find((item) => item.id === group.sectionId) ?? null) : null;
            return (
              <div
                key={`${group.key}-${chunk.from}`}
                role="rowgroup"
                aria-label={group.name || "Tasks"}
                onDragOver={(event) => canDrag && event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null && section && onMove) onMove(dragging, section.id, null);
                  setDragging(null);
                }}
              >
                {chunk.lines.map(({ line, index }) => {
                  const lineProps = {
                    "aria-rowindex": index + 2,
                    "aria-level": line.level,
                    tabIndex: line.key === activeKey ? 0 : -1,
                    "data-line-key": line.key,
                    "data-line-index": index,
                    ref: windowed.measure(line.key),
                    onFocus: (event: React.FocusEvent) => {
                      if (event.target === event.currentTarget) setFocusKey(line.key);
                    },
                  } as const;
                  if (line.kind === "group")
                    return (
                      <div key={line.key} role="row" aria-expanded={line.expanded} {...lineProps} className="border-b border-line focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                        <div role="gridcell" style={pinned} className="flex items-center gap-2 px-2 pb-2 pt-5" data-testid="group-heading">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-expanded={line.expanded}
                            aria-label={`${line.expanded ? "Hide" : "Show"} ${group.name}`}
                            onClick={() => toggleGroup(group.key)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface-muted"
                          >
                            {line.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          {group.person && <PersonDot name={group.person} size="md" />}
                          {section && sectionHeader ? (
                            sectionHeader(section, group.rows.length)
                          ) : (
                            <h3 className="flex items-center gap-2 text-card-title font-semibold">
                              {group.name} <span className="text-caption font-normal text-ink-muted">{group.rows.length}</span>
                            </h3>
                          )}
                          {view?.phaseA && <GroupMenu name={group.name} hideEmpty={config.hideEmpty} onHideEmpty={(on) => set({ hideEmpty: on })} onFoldAll={foldAll} subtasks={hasSubtasks ? onSubtasksAll : undefined} />}
                        </div>
                      </div>
                    );
                  if (line.kind === "add")
                    return (
                      <div key={line.key} role="row" {...lineProps} className="focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                        <div role="gridcell" style={pinned}>{section && addTo?.projectId ? <AddTask projectId={addTo.projectId} sectionId={section.id} /> : group.sectionId !== null ? <AddTask mySectionId={group.sectionId} placeholder={`Add a task to ${group.name}…`} /> : null}</div>
                      </div>
                    );
                  const task = line.task;
                  const sub = line.parentId !== null;
                  const open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(task.status);
                  const due = dueLabel(task.dueAt, now, open);
                  const isOpen = openTask === String(task.id);
                  const rowDrag = canDrag && !sub;
                  return (
                    <div
                      key={line.key}
                      role="row"
                      {...lineProps}
                      aria-expanded={line.expandable ? line.expanded : undefined}
                      style={gridColumns}
                      draggable={rowDrag}
                      onDragStart={() => rowDrag && setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={(event) => rowDrag && event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (dragging !== null && dragging !== task.id && section && onMove && !sub) onMove(dragging, section.id, task.id);
                        setDragging(null);
                      }}
                      data-testid={sub ? "subtask-row" : "task-row"}
                      data-task-id={task.id}
                      aria-selected={bulk && !sub ? selected.includes(task.id) : undefined}
                      onClickCapture={(event) => {
                        if (sub || !bulk || !(event.ctrlKey || event.metaKey || event.shiftKey)) return;
                        // Controls inside the row (due date, priority, people…) keep their own clicks.
                        if ((event.target as HTMLElement).closest("input, select, textarea, button, [role='combobox'], [role='listbox']")) return;
                        event.preventDefault();
                        event.stopPropagation();
                        pick(task.id, event.shiftKey);
                      }}
                      className={`work-row group grid min-h-row select-none items-center border-b border-line text-label hover:bg-surface-muted focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${approvalRowClass(task.approval)} ${isOpen ? "bg-row-active outline outline-1 -outline-offset-1 outline-primary-600" : ""} ${selected.includes(task.id) && !sub ? "bg-row-active shadow-[inset_3px_0_0_var(--color-primary-600)]" : ""} ${dragging === task.id ? "opacity-50" : ""}`}
                    >
                      <span role="gridcell" className="px-2 text-caption tabular-nums text-ink-faint">
                        {line.number ?? ""}
                      </span>
                      <span role="gridcell" className="flex min-w-0 items-center gap-2 border-r border-line px-2 py-1 [contain:inline-size]" style={sub ? { paddingLeft: 28 } : undefined}>
                        {line.expandable ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={`${line.expanded ? "Hide" : "Show"} subtasks of ${task.title}`}
                            onClick={() => toggleSubtasks(task.id)}
                            className="-ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-muted"
                            data-testid="toggle-subtasks"
                          >
                            {line.expanded ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
                          </button>
                        ) : hasSubtasks && !sub ? (
                          <span aria-hidden="true" className="-ml-1 inline-block w-6" />
                        ) : null}
                        <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={!task.canComplete} label={task.title} />
                        <Link href={paneLink(task.id)} scroll={false} title={task.title} className={`line-clamp-2 min-w-0 break-words hover:underline ${task.status === "COMPLETED" ? "text-ink-muted line-through" : "text-ink"}`}>
                          {task.title}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2 text-caption text-ink-muted">
                          <ApprovalBadge approval={task.approval} size="sm" />
                          {task.isPeriodic && (
                            <span role="img" aria-label="Periodic" title="Periodic: repeats" className="text-info-600">
                              <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {task.subtasks > 0 && (
                            <span title="Subtasks" className="inline-flex items-center gap-0.5">
                              {task.subtasks} <GitBranch aria-hidden="true" className="h-3 w-3" />
                            </span>
                          )}
                          {task.comments > 0 && (
                            <span title={`${task.comments} comment${task.comments === 1 ? "" : "s"}`} className="inline-flex items-center gap-0.5">
                              {task.comments} <MessageSquare aria-hidden="true" className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </span>
                      {shown.map((column) => (
                        <span key={column} role="gridcell" className="flex min-w-0 items-center border-r border-line px-2 py-1">
                          {column === "due" &&
                            (task.canEdit && open ? (
                              <DueInput task={task} toneClass={due ? TONE_TEXT[due.tone] : ""} />
                            ) : (
                              <span className={due ? TONE_TEXT[due.tone] : "text-ink-faint"}>{due?.text ?? <CalendarDays aria-hidden="true" className="h-4 w-4" />}</span>
                            ))}
                          {column === "assignee" &&
                            (editAssignee && people.length > 0 && task.canEdit && open ? (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <PersonDot name={task.assigneeName} />
                                <PersonSelect
                                  ariaLabel={`Assignee of ${task.title}`}
                                  options={people.some((person) => person.id === task.assigneeId) ? people : [{ id: task.assigneeId, label: task.assigneeName }, ...people]}
                                  value={task.assigneeId}
                                  onChange={(id) => {
                                    if (id !== null && id !== task.assigneeId) void call(() => taskFieldsAction(task.id, { assigneeId: id }));
                                  }}
                                  compact
                                  floating
                                  className="min-w-0 flex-1 text-label"
                                />
                              </span>
                            ) : (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <PersonDot name={task.assigneeName} />
                                <span className="truncate">{task.assigneeName}</span>
                              </span>
                            ))}
                          {column === "collaborators" && <CollaboratorsCell taskId={task.id} title={task.title} followers={task.followers} people={people} canEdit={task.canEdit && open && people.length > 0} />}
                          {column === "createdBy" && (
                            <span className="truncate text-ink-muted" title="Who made the task (can't be changed)">
                              {task.createdByName}
                            </span>
                          )}
                          {column === "projects" && (
                            <span className="flex min-w-0 gap-1">
                              {task.projects.slice(0, 2).map((project) =>
                                !projectsOn ? (
                                  <LockedProjectName key={project.id} name={project.name} />
                                ) : (
                                  <Link
                                    key={project.id}
                                    href={`/users/work/projects/${project.id}`}
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface-muted px-1.5 py-0.5 hover:border-line-strong"
                                  >
                                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: COLOR_HEX[project.color] ?? COLOR_HEX.gray }} />
                                    <span className="truncate">{project.name}</span>
                                  </Link>
                                ),
                              )}
                            </span>
                          )}
                          {column === "visibility" && (
                            <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                              {task.projects.length ? <Users aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                              <span className="truncate">{task.projects.length ? `${task.projects[0]!.name} members` : "Collaborators"}</span>
                            </span>
                          )}
                          {column === "priority" &&
                            (editPriority && task.canEdit && open ? (
                              <select
                                aria-label={`Priority of ${task.title}`}
                                value={task.priority}
                                onChange={(event) => void call(() => taskFieldsAction(task.id, { priority: event.target.value }), { success: false })}
                                {...priorityControlProps(task.priority)}
                                className={`rounded-full border-0 px-2 py-0.5 text-caption ${priorityControlProps(task.priority).className}`}
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
                            ))}
                          {column === "tags" && <TagsCell taskId={task.id} title={task.title} tags={task.tags} canEdit={task.canEdit && open} />}
                        </span>
                      ))}
                      {shownFields.map((field) => (
                        <span key={field.id} role="gridcell" className="min-w-0 border-r border-line px-1">
                          {sub || (fieldScope && !fieldScope[task.id]?.includes(field.id)) ? null : planning ? (
                            <FieldValueEditor taskId={task.id} field={field} cell={values[task.id]?.[field.id]} label={`${field.name} of ${task.title}`} canChange={task.canEdit} people={people} compact />
                          ) : (
                            <FieldInput taskId={task.id} field={{ ...field, name: `${field.name} of ${task.title}` }} value={values[task.id]?.[field.id]?.edit ?? ""} canChange={task.canEdit} compact />
                          )}
                        </span>
                      ))}
                      {planning && customise && <span role="gridcell" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {windowed.range.padBottom > 0 && <div aria-hidden="true" style={{ height: windowed.range.padBottom }} data-testid="grid-spacer-bottom" />}
        </div>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {gridLive}
      </span>
      {bulk && allShown.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted" data-testid="select-hint">
          <span>
            <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-ink">Ctrl</kbd> + click a task to select several
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-semibold text-ink">Shift</kbd> + click to select a range
          </span>
          <span aria-hidden="true">·</span>
          <button type="button" className="link" onClick={() => setSelected(allShown.map((task) => task.id))}>
            Select all shown
          </button>
          {selected.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="link" onClick={() => setSelected([])}>
                Clear selection (Esc)
              </button>
            </>
          )}
        </p>
      )}
      {bulk && (
        <BulkBar
          ids={selected.filter((one) => rows.some((task) => task.id === one))}
          clear={() => setSelected([])}
          people={people.length ? people : undefined}
          sections={addTo?.projectId ? sections : undefined}
          projectId={addTo?.projectId}
        />
      )}
    </div>
  );
}

// The Filters panel (screenshot): Quick filters as chips, then field filters.
function FilterPanel({ config, set, people, projects, fields }: { config: GridConfig; set: (changes: Partial<GridConfig>) => void; people: { id: number; label: string }[]; projects: { id: number; name: string }[]; fields: FieldView[] }) {
  const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-label ${on ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line text-ink hover:border-line-strong"}`;
  const options = (field: FilterField): [string, string][] => {
    switch (field) {
      case "completion":
        return [
          ["incomplete", "Incomplete tasks"],
          ["completed", "Completed tasks"],
        ];
      case "assignee":
      case "createdBy":
        return [["me", "Me"], ...people.map((person) => [String(person.id), person.label] as [string, string])];
      case "project":
        return [["none", "No project"], ...projects.map((project) => [String(project.id), project.name] as [string, string])];
      case "priority":
        return [
          ["URGENT", "Critical"],
          ["HIGH", "Most Important"],
          ["IMPORTANT", "Important"],
          ["ELEVATED", "High"],
          ["ELEVATED", "High"],
          ["NORMAL", "Normal"],
        ];
      case "kind":
        return [
          ["periodic", "Periodic"],
          ["adhoc", "Ad hoc"],
        ];
      case "due":
        return [
          ["overdue", "Overdue"],
          ["today", "Today"],
          ["next7", "Next 7 days"],
          ["none", "No due date"],
        ];
      case "tag":
        return [];
    }
  };
  return (
    <div className="space-y-4">
      <p className="flex items-center justify-between font-semibold">
        Filters
        <button type="button" className="link text-caption font-normal" onClick={() => set({ incomplete: true, completed: "none", dueThisWeek: false, dueNextWeek: false, filters: [], fieldFilters: [] })}>
          Clear
        </button>
      </p>
      <div>
        <p className="mb-2 text-caption font-semibold text-ink-muted">Quick filters</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={config.incomplete} className={chip(config.incomplete)} onClick={() => set({ incomplete: !config.incomplete })}>
            Incomplete tasks
          </button>
          <span className="inline-flex items-center">
            <button
              type="button"
              aria-pressed={config.completed !== "none"}
              data-testid="show-completed"
              className={`${chip(config.completed !== "none")} rounded-r-none`}
              onClick={() => set({ completed: config.completed === "none" ? "all" : "none" })}
            >
              Completed tasks
            </button>
            <select
              aria-label="Which completed tasks"
              value={config.completed}
              onChange={(event) => set({ completed: event.target.value as GridConfig["completed"] })}
              className={`${chip(config.completed !== "none")} rounded-l-none border-l-0 py-1 pr-6`}
            >
              {COMPLETED_RANGES.map((range) => (
                <option key={range} value={range}>
                  {COMPLETED_LABEL[range]}
                </option>
              ))}
            </select>
          </span>
          <button type="button" aria-pressed={config.dueThisWeek} className={chip(config.dueThisWeek)} onClick={() => set({ dueThisWeek: !config.dueThisWeek, dueNextWeek: false })}>
            Due this week
          </button>
          <button type="button" aria-pressed={config.dueNextWeek} className={chip(config.dueNextWeek)} onClick={() => set({ dueNextWeek: !config.dueNextWeek, dueThisWeek: false })}>
            Due next week
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold text-ink-muted">All filters</p>
        <div className="space-y-2">
          {config.filters.map((filter, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                aria-label="Filter field"
                value={filter.field}
                onChange={(event) =>
                  set({ filters: config.filters.map((item, at) => (at === index ? { field: event.target.value as FilterField, value: options(event.target.value as FilterField)[0]?.[0] ?? "" } : item)) })
                }
                className="field-input h-9 w-48"
              >
                {FILTER_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {FILTER_LABEL[field]}
                  </option>
                ))}
              </select>
              {filter.field === "tag" ? (
                <input
                  aria-label="Tag"
                  value={filter.value}
                  onChange={(event) => set({ filters: config.filters.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)) })}
                  className="field-input h-9 flex-1"
                />
              ) : filter.field === "assignee" || filter.field === "createdBy" ? (
                // "Me" stands first, where the empty choice goes.
                <PersonSelect
                  ariaLabel="Filter value"
                  options={people}
                  value={filter.value === "me" || !/^\d+$/.test(filter.value) ? null : Number(filter.value)}
                  onChange={(id) => set({ filters: config.filters.map((item, at) => (at === index ? { ...item, value: id === null ? "me" : String(id) } : item)) })}
                  emptyLabel="Me"
                  compact
                  className="flex-1"
                />
              ) : (
                <select
                  aria-label="Filter value"
                  value={filter.value}
                  onChange={(event) => set({ filters: config.filters.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)) })}
                  className="field-input h-9 flex-1"
                >
                  {options(filter.field).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" aria-label="Remove this filter" onClick={() => set({ filters: config.filters.filter((_, at) => at !== index) })} className="rounded p-1.5 text-ink-muted hover:bg-surface-muted">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink"
            onClick={() => set({ filters: [...config.filters, { field: "assignee", value: "me" }] })}
            disabled={config.filters.length >= 10}
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add filter
          </button>
        </div>
      </div>
      <FieldFilterRows fields={fields} filters={config.fieldFilters ?? []} onChange={(fieldFilters) => set({ fieldFilters })} people={people} />
    </div>
  );
}

function DueInput({ task, toneClass }: { task: GridTask; toneClass: string }) {
  const { call } = useWorkCall();
  const before = task.dueAt ? indiaDayOf(new Date(task.dueAt)) : "";
  return (
    <input
      key={task.dueAt ?? "none"}
      type="date"
      aria-label={`Due date of ${task.title}`}
      defaultValue={before}
      onBlur={(event) => {
        const input = event.target;
        const picked = input.value;
        if (picked !== before)
          void call((choice) => taskFieldsAction(task.id, { dueDay: choice?.moveTo ?? picked, holidayOk: choice?.holidayOk }), { success: false }).then((result) => {
            if (!result?.ok) input.value = before;
          });
      }}
      className={`w-full border-0 bg-transparent text-label focus:outline-none ${toneClass} ${before ? "" : "text-ink-faint"}`}
    />
  );
}

export function PersonDot({ name, size = "sm", ring }: { name: string; size?: "sm" | "md"; ring?: boolean }) {
  return (
    <span
      title={name}
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-50 font-semibold text-primary-700 ${ring ? "border-2 border-surface" : ""} ${size === "md" ? "h-8 w-8 text-caption" : "h-6 w-6 text-[length:calc(10px*var(--text-scale,1))]"}`}
    >
      {initials(name)}
    </span>
  );
}

// v1.61.0 (D-367, spec PRJ-17 section menu): a group heading's own menu.
function GroupMenu({ name, hideEmpty, onHideEmpty, onFoldAll, subtasks }: { name: string; hideEmpty: boolean; onHideEmpty: (on: boolean) => void; onFoldAll: (open: boolean) => void; subtasks?: (open: boolean) => void }) {
  const close = (event: React.SyntheticEvent) => {
    const details = (event.currentTarget as HTMLElement).closest("details");
    if (details) details.open = false;
  };
  const item = "block w-full rounded px-2 py-1 text-left text-label hover:bg-surface-muted";
  return (
    <Drop label={`More for ${name}`} icon={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />} buttonClass="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" panelClass="left-0 w-60" testId="group-menu-more">
      <div className="space-y-0.5 pt-5">
        <label className="flex items-center gap-2 rounded px-2 py-1 text-label hover:bg-surface-muted">
          <input type="checkbox" checked={hideEmpty} onChange={(event) => onHideEmpty(event.target.checked)} data-testid="hide-empty-groups" /> Hide empty groups
        </label>
        {subtasks && (
          <>
            <button type="button" className={item} onClick={(event) => { close(event); subtasks(true); }}>
              Expand all subtasks
            </button>
            <button type="button" className={item} onClick={(event) => { close(event); subtasks(false); }}>
              Collapse all subtasks
            </button>
          </>
        )}
        <button type="button" className={item} onClick={(event) => { close(event); onFoldAll(true); }}>
          Expand all groups
        </button>
        <button type="button" className={item} onClick={(event) => { close(event); onFoldAll(false); }}>
          Collapse all groups
        </button>
      </div>
    </Drop>
  );
}
