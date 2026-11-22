"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, Link2, Lock, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { Menu } from "@/features/ui/Menu";
import { Dialog } from "@/features/ui/Dialog";
import { AddTaskSplit } from "@/features/work/ViewToolbar";
import { taskFieldsAction } from "@/app/users/work/actions";
import { typedDependencyAction } from "@/app/users/work/schedule-actions";
import { TaskCheck, usePaneLink, useWorkCall } from "@/features/work/client";
import { connectorPath, headerBands, isZoom, PX_PER_DAY, scaleRange, shortDay, STEP_DAYS, STEP_LABEL, visibleRows, ZOOM_LABEL, ZOOMS, zoomIn, zoomOut, type Zoom } from "@/features/work/gantt-scale";
import { addDays, DEP_TYPE_HELP, DEP_TYPE_LABEL, DEP_TYPES, dayDiff, linkBlocks, linkConflict, weekdayOf, type DepType, type TaskDates } from "@/server/work/schedule";

// v1.65.0 (D-373, spec PV §4 Timeline and §5 Gantt): one editable schedule,
// drawn as the Timeline (bars by section) or the Gantt (a left grid with Name,
// Due date and Blocked by, then the bars). Our own HTML/SVG: a time scale with
// Days / Weeks / Months / Quarters and zoom, a today line, shaded weekly offs
// and holidays, bars to drag (move) or stretch (start or due date), with the
// same from the keyboard, milestones as diamonds, dependency connectors
// coloured by state, and new links by dragging a bar's handle onto another bar
// (or from the keyboard: L). Only the rows on screen are drawn (windowing), so
// 300+ tasks scroll smoothly. Every change goes through the server, which
// checks the person's rights and moves dependent tasks per the project's
// Dependencies setting.
export interface ScheduleTask {
  id: number;
  taskNo: string;
  title: string;
  status: string;
  sectionId: number;
  startsOn: string | null;
  dueAt: string; // ISO; mandatory
  isMilestone: boolean;
  assigneeId: number;
  assigneeName: string;
}
export interface ScheduleLink {
  predecessor: number;
  successor: number;
  type: DepType;
  predNo: string;
  predTitle: string;
  predStatus: string;
}

const ROW = 34;
const HEAD = 44;
const OPEN = ["OPEN", "IN_PROGRESS", "BLOCKED"];
const indiaDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const indiaTime = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16);
type Row = { kind: "section"; id: number; name: string; count: number } | { kind: "task"; task: ScheduleTask; index: number };
type Drag = { id: number; kind: "move" | "start" | "end"; x: number; dates: TaskDates; moved: boolean };
type LinkDrag = { from: number; x1: number; y1: number; x2: number; y2: number };
type LinkDialog = { taskId: number; role: "BLOCKED_BY" | "BLOCKING"; otherId: number | null; type: DepType; back: HTMLElement | null };

export function ScheduleView({
  mode,
  sections,
  tasks: allTasks,
  links,
  todayDay,
  holidays,
  workingWeekdays,
  canEdit,
  meId,
  projectId,
}: {
  projectId?: number;
  mode: "TIMELINE" | "GANTT";
  sections: { id: number; name: string }[];
  tasks: ScheduleTask[];
  links: ScheduleLink[];
  todayDay: string;
  holidays: Record<string, string>;
  workingWeekdays: number[];
  canEdit: boolean;
  meId: number;
}) {
  const gantt = mode === "GANTT";
  // v1.72.0 (D-387, spec PV §4 "filter Incomplete/Complete/All"): the view's Filter menu.
  const [show, setShow] = useState<"all" | "incomplete" | "completed">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const tasks = useMemo(() => allTasks.filter((task) => (show === "all" || (show === "completed") === (task.status === "COMPLETED")) && (!mineOnly || task.assigneeId === meId)), [allTasks, show, mineOnly, meId]);
  const storageKey = `work.schedule.${mode.toLowerCase()}.zoom`;
  const [zoom, setZoom] = useState<Zoom>(gantt ? "months" : "weeks");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (isZoom(saved)) setZoom(saved);
    } catch {
      /* private window: the default stays */
    }
  }, [storageKey]);
  const chooseZoom = (next: Zoom) => {
    setZoom(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* not kept */
    }
  };
  const { call, pending } = useWorkCall();
  const router = useRouter();
  const paneLink = usePaneLink();
  const hintId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, height: 600, width: 1000 });
  const [narrow, setNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ id: number; dates: TaskDates } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [dialog, setDialog] = useState<LinkDialog | null>(null);
  const [said, setSaid] = useState("");
  const px = PX_PER_DAY[zoom];
  const gridW = gantt ? (narrow ? 170 : 470) : narrow ? 150 : 240;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const datesOf = useCallback((task: ScheduleTask): TaskDates => (preview && preview.id === task.id ? preview.dates : { start: task.isMilestone ? null : task.startsOn, due: indiaDay(task.dueAt) }), [preview]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const range = useMemo(() => scaleRange(tasks.flatMap((task) => [task.startsOn ?? indiaDay(task.dueAt), indiaDay(task.dueAt)]), todayDay, zoom), [tasks, todayDay, zoom]);
  const bands = useMemo(() => headerBands(range.from, range.span, zoom), [range, zoom]);
  const canvasW = range.span * px;
  const at = (day: string) => dayDiff(range.from, day);

  // Rows: each section (collapsible) and its tasks by start date.
  const rows: Row[] = useMemo(() => {
    const known = new Set(sections.map((section) => section.id));
    const out: Row[] = [];
    let index = 0;
    for (const section of sections) {
      const mine = tasks.filter((task) => (known.has(task.sectionId) ? task.sectionId : sections[0]?.id) === section.id).sort((a, b) => (a.startsOn ?? indiaDay(a.dueAt)).localeCompare(b.startsOn ?? indiaDay(b.dueAt)) || a.id - b.id);
      if (!mine.length) continue;
      out.push({ kind: "section", id: section.id, name: section.name, count: mine.length });
      if (collapsed.has(section.id)) continue;
      for (const task of mine) out.push({ kind: "task", task, index: index++ });
    }
    return out;
  }, [sections, tasks, collapsed]);
  const rowOf = useMemo(() => new Map(rows.flatMap((row, i) => (row.kind === "task" ? [[row.task.id, i] as const] : []))), [rows]);
  const taskRows = rows.filter((row): row is Extract<Row, { kind: "task" }> => row.kind === "task");

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView({ top: box.scrollTop, left: box.scrollLeft, height: box.clientHeight, width: box.clientWidth }));
    };
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      box.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  // Open on today.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollLeft = Math.max(0, at(todayDay) * px - 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, range.from]);

  const { first, last } = visibleRows(Math.max(0, view.top - HEAD), view.height, ROW, rows.length);
  const mayEdit = (task: ScheduleTask) => (canEdit || task.assigneeId === meId) && OPEN.includes(task.status);
  const announce = (text: string) => setSaid(text);
  const describe = (dates: TaskDates) => (dates.start && dates.start !== dates.due ? `${shortDay(dates.start, todayDay)} to ${shortDay(dates.due, todayDay)}` : `due ${shortDay(dates.due, todayDay)}`);

  // Save new dates (the due time of day is kept).
  const save = async (task: ScheduleTask, dates: TaskDates) => {
    const old = { start: task.isMilestone ? null : task.startsOn, due: indiaDay(task.dueAt) };
    const change: { dueDay?: string; startDay?: string } = {};
    if (dates.due !== old.due) change.dueDay = `${dates.due}T${indiaTime(task.dueAt)}`;
    if (dates.start !== old.start && dates.start !== null) change.startDay = dates.start;
    if (!change.dueDay && !change.startDay) {
      setPreview(null);
      return;
    }
    const result = await call((choice) => taskFieldsAction(task.id, { ...change, ...(choice?.moveTo ? { dueDay: choice.moveTo } : {}), holidayOk: choice?.holidayOk }), { success: `${task.title}: ${describe(dates)}.` });
    setPreview(null);
    announce(result?.ok ? `Saved: ${task.title}, ${describe(dates)}.` : `Not saved: ${task.title}.`);
  };
  const shifted = (dates: TaskDates, kind: Drag["kind"], days: number, milestone: boolean): TaskDates => {
    if (kind === "move" || milestone) return { start: dates.start ? addDays(dates.start, days) : null, due: addDays(dates.due, days) };
    if (kind === "end") {
      const due = addDays(dates.due, days);
      return { start: dates.start, due: dates.start && due < dates.start ? dates.start : due };
    }
    const start = addDays(dates.start ?? dates.due, days);
    return { start: start > dates.due ? dates.due : start, due: dates.due };
  };

  // ---- pointer: move, stretch, link ------------------------------------------------------
  const onBarDown = (event: React.PointerEvent, task: ScheduleTask, kind: Drag["kind"]) => {
    if (event.button !== 0 || !mayEdit(task)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ id: task.id, kind, x: event.clientX, dates: datesOf(task), moved: false });
  };
  const onBarMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const days = Math.round((event.clientX - drag.x) / px);
    const task = byId.get(drag.id);
    if (!task) return;
    if (days !== 0 || drag.moved) {
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setPreview({ id: drag.id, dates: shifted(drag.dates, drag.kind, days, task.isMilestone) });
    }
  };
  const onBarUp = (task: ScheduleTask) => {
    const was = drag;
    setDrag(null);
    if (!was) return;
    if (!was.moved) {
      setPreview(null);
      if (was.kind === "move") router.push(paneLink(task.id), { scroll: false });
      return;
    }
    if (preview?.id === task.id) void save(task, preview.dates);
  };
  const canvasPoint = (event: React.PointerEvent | PointerEvent) => {
    const box = scroller.current!.getBoundingClientRect();
    return { x: event.clientX - box.left + scroller.current!.scrollLeft - gridW, y: event.clientY - box.top + scroller.current!.scrollTop - HEAD };
  };
  const onHandleDown = (event: React.PointerEvent, task: ScheduleTask) => {
    if (event.button !== 0 || !canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    setLinkDrag({ from: task.id, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  };
  const onHandleMove = (event: React.PointerEvent) => {
    if (!linkDrag) return;
    const point = canvasPoint(event);
    setLinkDrag({ ...linkDrag, x2: point.x, y2: point.y });
  };
  const onHandleUp = (event: React.PointerEvent) => {
    const was = linkDrag;
    setLinkDrag(null);
    if (!was) return;
    const target = (document.elementsFromPoint(event.clientX, event.clientY).find((element) => element instanceof HTMLElement && element.dataset.barId) as HTMLElement | undefined)?.dataset.barId;
    const targetId = target ? Number(target) : null;
    if (targetId && targetId !== was.from) setDialog({ taskId: targetId, role: "BLOCKED_BY", otherId: was.from, type: "FS", back: null });
  };

  // ---- keyboard on a bar -------------------------------------------------------------------
  const focusBar = (index: number) => {
    const target = taskRows[index];
    if (!target) return;
    const box = scroller.current;
    const rowIndex = rowOf.get(target.task.id) ?? 0;
    if (box && (rowIndex * ROW < box.scrollTop || rowIndex * ROW > box.scrollTop + box.clientHeight - HEAD - ROW)) box.scrollTop = Math.max(0, rowIndex * ROW - box.clientHeight / 2);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-bar-index="${index}"]`)?.focus()));
  };
  const onBarKey = (event: React.KeyboardEvent, task: ScheduleTask, index: number) => {
    const step = STEP_DAYS[zoom];
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (preview?.id === task.id) setPreview(null);
      focusBar(index + (event.key === "ArrowUp" ? -1 : 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!mayEdit(task)) return announce("You can't change this task's dates.");
      const sign = event.key === "ArrowLeft" ? -1 : 1;
      const kind: Drag["kind"] = event.shiftKey && event.altKey ? "start" : event.shiftKey ? "end" : "move";
      const next = shifted(datesOf(task), kind, sign * step, task.isMilestone);
      setPreview({ id: task.id, dates: next });
      announce(`${kind === "move" ? "Moved" : kind === "end" ? "Due date" : "Start date"}: ${task.title}, ${describe(next)}. Enter saves, Escape cancels.`);
      return;
    }
    if (event.key === "Escape" && preview?.id === task.id) {
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
      announce(`Cancelled. ${task.title} stays ${describe({ start: task.startsOn, due: indiaDay(task.dueAt) })}.`);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (preview?.id === task.id) void save(task, preview.dates);
      else router.push(paneLink(task.id), { scroll: false });
      return;
    }
    if ((event.key === "l" || event.key === "L") && canEdit) {
      event.preventDefault();
      setDialog({ taskId: task.id, role: "BLOCKED_BY", otherId: null, type: "FS", back: event.currentTarget as HTMLElement });
    }
  };

  // ---- drawing -------------------------------------------------------------------------------
  const offDays = useMemo(() => {
    if (zoom === "months" || zoom === "quarters") return [] as number[];
    const working = new Set(workingWeekdays);
    const out: number[] = [];
    const from = Math.max(0, Math.floor((view.left - gridW) / px) - 2);
    const to = Math.min(range.span, Math.ceil((view.left + view.width) / px) + 2);
    for (let i = from; i < to; i += 1) {
      const day = addDays(range.from, i);
      if (holidays[day] || (working.size > 0 && !working.has(weekdayOf(day)))) out.push(i);
    }
    return out;
  }, [zoom, workingWeekdays, holidays, view.left, view.width, gridW, px, range]);
  const barBox = (task: ScheduleTask) => {
    const dates = datesOf(task);
    const start = at(dates.start ?? dates.due);
    const end = at(dates.due);
    return { left: start * px, width: Math.max(6, (end - start + 1) * px), dates };
  };
  const connectors = links
    .filter((link) => rowOf.has(link.predecessor) && rowOf.has(link.successor))
    .flatMap((link) => {
      const a = rowOf.get(link.predecessor)!;
      const b = rowOf.get(link.successor)!;
      if ((a < first && b < first) || (a > last && b > last)) return [];
      const pred = byId.get(link.predecessor)!;
      const succ = byId.get(link.successor)!;
      const pa = barBox(pred);
      const sb = barBox(succ);
      const x1 = link.type === "SS" ? pa.left : pa.left + pa.width;
      const x2 = link.type === "FF" ? sb.left + sb.width : sb.left;
      const conflict = OPEN.includes(succ.status) && linkConflict(link.type, pa.dates, sb.dates);
      const tone = conflict ? "text-danger-600" : OPEN.includes(pred.status) ? "text-ink-muted" : "text-success-600";
      return [{ key: `${link.predecessor}-${link.successor}`, d: connectorPath(x1, a * ROW + ROW / 2, x2, b * ROW + ROW / 2, ROW), tone, conflict, label: `${pred.title} → ${succ.title} (${DEP_TYPE_LABEL[link.type]})${conflict ? ", dates clash" : ""}` }];
    });
  const predsOf = useMemo(() => {
    const map = new Map<number, ScheduleLink[]>();
    for (const link of links) map.set(link.successor, [...(map.get(link.successor) ?? []), link]);
    return map;
  }, [links]);

  if (!allTasks.length) return <p className="card px-5 py-8 text-center text-ink-muted">Add tasks to see them here.</p>;
  const filters = Number(show !== "all") + Number(mineOnly);
  const todayX = at(todayDay) * px + px / 2;
  const jump = (sign: number) => scroller.current?.scrollBy({ left: sign * STEP_DAYS[zoom] * 4 * px, behavior: "auto" });
  const visible = rows.slice(first, last + 1);
  return (
    <div data-testid={gantt ? "gantt" : "timeline"} className="space-y-2">
      {/* v1.72.0 (D-387, spec PV §4-§5, S-09/S-11): Add task ▾ · ‹ Today › · the unit dropdown · − ＋ · Filter. */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={gantt ? "Gantt tools" : "Timeline tools"}>
        {canEdit && projectId ? <AddTaskSplit projectId={projectId} /> : null}
        <span className="inline-flex items-center gap-1">
          <button type="button" className="btn-secondary btn-compact" aria-label="Previous period" title="Previous period" onClick={() => jump(-1)}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => {
              if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 160);
            }}
          >
            Today
          </button>
          <button type="button" className="btn-secondary btn-compact" aria-label="Next period" title="Next period" onClick={() => jump(1)}>
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-1">
          <Menu
            label={`Zoom unit: ${ZOOM_LABEL[zoom]}`}
            trigger={
              <span className="inline-flex items-center gap-1">
                {ZOOM_LABEL[zoom]} <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </span>
            }
            buttonClass="btn-secondary btn-compact"
            menuClass="w-44"
            testId="schedule-zoom"
            items={ZOOMS.map((item) => ({ kind: "radio" as const, label: ZOOM_LABEL[item], checked: zoom === item, onSelect: () => chooseZoom(item), testId: `zoom-${item}` }))}
          />
          <button type="button" className="btn-secondary btn-compact" aria-label="Zoom out" disabled={zoom === "quarters"} onClick={() => chooseZoom(zoomOut(zoom))}>
            <ZoomOut aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" className="btn-secondary btn-compact" aria-label="Zoom in" disabled={zoom === "days"} onClick={() => chooseZoom(zoomIn(zoom))}>
            <ZoomIn aria-hidden="true" className="h-4 w-4" />
          </button>
          <span className={filters ? "tb-pill" : "inline-flex items-center"}>
            <Menu
              label={filters ? `Filters: ${filters}` : "Filter"}
              trigger={
                <>
                  <Filter aria-hidden="true" className="h-4 w-4" /> {filters ? `Filters: ${filters}` : "Filter"}
                </>
              }
              buttonClass="tb-btn"
              menuClass="w-56"
              testId="schedule-filter"
              items={[
                { kind: "heading", label: "Show" },
                { kind: "radio", label: "Incomplete tasks", checked: show === "incomplete", onSelect: () => setShow("incomplete") },
                { kind: "radio", label: "Completed tasks", checked: show === "completed", onSelect: () => setShow("completed") },
                { kind: "radio", label: "All tasks", checked: show === "all", onSelect: () => setShow("all") },
                { kind: "separator", label: "" },
                { kind: "checkbox", label: "Just my tasks", checked: mineOnly, onSelect: () => setMineOnly((value) => !value) },
              ]}
            />
          </span>
        </span>
        {!tasks.length && <p className="w-full text-label text-ink-muted">No tasks match this filter.</p>}
        <p id={hintId} className="w-full text-caption text-ink-muted">
          {canEdit ? `Drag a bar to move it, its ends to change the dates, its dot to link it. Keys: ← / → move by ${STEP_LABEL[zoom]}, Shift + ← / → the due date, Alt + Shift + ← / → the start, Enter saves, L links.` : "Bars show each task's dates."}
        </p>
        <p className="sr-only" role="status" aria-live="polite" data-testid="schedule-live">
          {said}
        </p>
      </div>
      <div
        ref={scroller}
        role="region"
        aria-label={gantt ? "Gantt chart" : "Timeline"}
        // v1.72.0 (D-387): reachable by keyboard to scroll even when a filter leaves no bars (axe scrollable-region-focusable).
        tabIndex={tasks.length ? undefined : 0}
        className="card relative max-h-[70vh] overflow-auto"
        style={{ height: Math.min(HEAD + rows.length * ROW + 2, 2000) }}
        onPointerMove={(event) => {
          onBarMove(event);
          onHandleMove(event);
        }}
      >
        <div className="relative" style={{ width: gridW + canvasW, height: HEAD + rows.length * ROW }}>
          {/* Header: the grid's column titles (sticky left) and the two time-scale rows. */}
          <div className="sticky top-0 z-[4] flex bg-surface" style={{ height: HEAD, width: gridW + canvasW }}>
            <div className="sticky left-0 z-[4] flex shrink-0 items-end border-b border-r border-line bg-surface-muted text-caption font-semibold text-ink-muted" style={{ width: gridW }}>
              <span className="flex-1 px-3 py-1">Name</span>
              {gantt && !narrow && <span className="w-[90px] px-2 py-1">Due date</span>}
              {gantt && !narrow && <span className="w-[150px] px-2 py-1">Blocked by</span>}
            </div>
            <div className="relative shrink-0 border-b border-line bg-surface-muted text-caption text-ink-muted" style={{ width: canvasW }} aria-hidden="true">
              {bands.top.map((band) => (
                <span key={band.key} className="absolute top-0 h-[22px] truncate border-l border-line px-1 font-semibold leading-[22px]" style={{ left: band.start * px, width: band.days * px }}>
                  {band.label}
                </span>
              ))}
              {bands.bottom
                .filter((band) => (band.start + band.days) * px >= view.left - gridW - 200 && band.start * px <= view.left + view.width + 200)
                .map((band) => (
                  <span key={band.key} className="absolute top-[22px] h-[22px] truncate border-l border-line px-0.5 text-center leading-[22px]" style={{ left: band.start * px, width: band.days * px }}>
                    {band.label}
                  </span>
                ))}
              <span className="absolute bottom-0 h-2 w-2 -translate-x-1/2 rounded-full bg-primary-solid" style={{ left: todayX }} />
            </div>
          </div>
          {/* Shading of weekly offs and holidays, and the today line. */}
          <div className="pointer-events-none absolute z-0" style={{ left: gridW, top: HEAD, width: canvasW, height: rows.length * ROW }} aria-hidden="true">
            {offDays.map((index) => (
              <span key={index} className="absolute inset-y-0 bg-surface-muted" style={{ left: index * px, width: px }} />
            ))}
            <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary-solid" style={{ left: todayX }} data-testid="today-line" />
          </div>
          {/* Connectors (over the bars' row, under the sticky grid). */}
          <svg className="pointer-events-none absolute z-[5]" style={{ left: gridW, top: HEAD }} width={canvasW} height={rows.length * ROW} aria-hidden="true">
            <defs>
              <marker id={`${hintId}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            {connectors.map((line) => (
              <path key={line.key} d={line.d} className={line.tone} stroke="currentColor" strokeWidth={line.conflict ? 2 : 1.5} fill="none" markerEnd={`url(#${hintId}-arrow)`} data-testid="connector" data-conflict={line.conflict ? "1" : "0"}>
                <title>{line.label}</title>
              </path>
            ))}
            {linkDrag && <line x1={linkDrag.x1} y1={linkDrag.y1} x2={linkDrag.x2} y2={linkDrag.y2} className="text-primary-600" stroke="currentColor" strokeDasharray="4 3" strokeWidth={1.5} />}
          </svg>
          <div style={{ height: first * ROW }} />
          {visible.map((row) =>
            row.kind === "section" ? (
              <div key={`s${row.id}`} className="relative z-10 flex" style={{ height: ROW }}>
                <div className="sticky left-0 z-[3] flex shrink-0 items-center border-b border-r border-line bg-surface-muted px-2 text-label font-semibold" style={{ width: gridW }}>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 rounded px-1 hover:bg-surface"
                    aria-expanded={!collapsed.has(row.id)}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                  >
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${collapsed.has(row.id) ? "-rotate-90" : ""}`} />
                    <span className="truncate">{row.name}</span>
                    <span className="text-caption font-normal text-ink-muted">({row.count})</span>
                  </button>
                </div>
                <div className="shrink-0 border-b border-line bg-surface-muted/40" style={{ width: canvasW }} />
              </div>
            ) : (
              <TaskLine
                key={row.task.id}
                task={row.task}
                index={row.index}
                gantt={gantt}
                narrow={narrow}
                gridW={gridW}
                canvasW={canvasW}
                box={barBox(row.task)}
                editable={mayEdit(row.task)}
                canLink={canEdit}
                hintId={hintId}
                todayDay={todayDay}
                preds={predsOf.get(row.task.id) ?? []}
                paneHref={paneLink(row.task.id)}
                dragging={drag?.id === row.task.id}
                previewing={preview?.id === row.task.id}
                describe={describe}
                onDown={onBarDown}
                onUp={onBarUp}
                onKey={onBarKey}
                onHandleDown={onHandleDown}
                onHandleUp={onHandleUp}
                onAddLink={(back) => setDialog({ taskId: row.task.id, role: "BLOCKED_BY", otherId: null, type: "FS", back })}
              />
            ),
          )}
        </div>
      </div>
      {dialog && (
        <LinkDialogBox
          dialog={dialog}
          tasks={tasks}
          pending={pending}
          onClose={() => {
            dialog.back?.focus();
            setDialog(null);
          }}
          onSave={async (value) => {
            const result = await call(() => typedDependencyAction(value.taskId, value.otherId!, value.role, value.type, true));
            if (result?.ok) {
              announce(result.message ?? "Linked.");
              dialog.back?.focus();
              setDialog(null);
            }
          }}
        />
      )}
    </div>
  );
}

function TaskLine({
  task,
  index,
  gantt,
  narrow,
  gridW,
  canvasW,
  box,
  editable,
  canLink,
  hintId,
  todayDay,
  preds,
  paneHref,
  dragging,
  previewing,
  describe,
  onDown,
  onUp,
  onKey,
  onHandleDown,
  onHandleUp,
  onAddLink,
}: {
  task: ScheduleTask;
  index: number;
  gantt: boolean;
  narrow: boolean;
  gridW: number;
  canvasW: number;
  box: { left: number; width: number; dates: TaskDates };
  editable: boolean;
  canLink: boolean;
  hintId: string;
  todayDay: string;
  preds: ScheduleLink[];
  paneHref: string;
  dragging: boolean;
  previewing: boolean;
  describe: (dates: TaskDates) => string;
  onDown: (event: React.PointerEvent, task: ScheduleTask, kind: "move" | "start" | "end") => void;
  onUp: (task: ScheduleTask) => void;
  onKey: (event: React.KeyboardEvent, task: ScheduleTask, index: number) => void;
  onHandleDown: (event: React.PointerEvent, task: ScheduleTask) => void;
  onHandleUp: (event: React.PointerEvent) => void;
  onAddLink: (back: HTMLElement) => void;
}) {
  const done = task.status === "COMPLETED";
  const blocked = preds.some((link) => linkBlocks(link.type, link.predStatus));
  const label = `${task.title}${task.isMilestone ? ", milestone" : ""}, ${describe(box.dates)}${done ? ", completed" : ""}${blocked ? ", waiting for other tasks" : ""}`;
  const due = box.dates.due;
  return (
    <div className="group relative z-10 flex" style={{ height: ROW }} data-testid="schedule-row">
      <div className="sticky left-0 z-[3] flex shrink-0 items-center border-b border-r border-line bg-surface text-label" style={{ width: gridW }}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2">
          <TaskCheck taskId={task.id} done={done} disabled={!editable && !done} label={task.title} size="sm" />
          {blocked && <Lock aria-label="Waiting for other tasks" className="h-3.5 w-3.5 shrink-0 text-warning-600" />}
          <Link href={paneHref} scroll={false} className={`truncate hover:underline ${done ? "text-ink-muted line-through" : ""}`}>
            {task.title}
          </Link>
        </span>
        {gantt && !narrow && (
          <span className="w-[90px] shrink-0 truncate px-2 text-caption text-ink-muted" data-testid="gantt-due">
            {shortDay(due, todayDay)}
          </span>
        )}
        {gantt && !narrow && (
          <span className="flex w-[150px] shrink-0 items-center gap-1 overflow-hidden px-1" data-testid="blocked-by">
            {preds.slice(0, 2).map((link) => (
              <span key={link.predecessor} className="inline-flex min-w-0 max-w-[110px] items-center gap-0.5 truncate rounded bg-surface-muted px-1 text-caption" aria-label={`${link.predTitle}, ${DEP_TYPE_LABEL[link.type]}`}>
                {!OPEN.includes(link.predStatus) && <span aria-hidden="true">✓</span>}
                <span className="truncate">{link.predTitle}</span>
                <span aria-hidden="true" className="text-ink-muted">
                  · {link.type}
                </span>
              </span>
            ))}
            {preds.length > 2 && <span className="text-caption text-ink-muted">+{preds.length - 2}</span>}
            {canLink && (
              <button type="button" className="ml-auto rounded p-0.5 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label={`Add what ${task.title} is blocked by`} onClick={(event) => onAddLink(event.currentTarget)}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </div>
      <div className="relative shrink-0 border-b border-line" style={{ width: canvasW }}>
        {task.isMilestone ? (
          <span
            role="button"
            tabIndex={0}
            data-bar-id={task.id}
            data-bar-index={index}
            data-testid="schedule-bar"
            aria-label={label}
            aria-describedby={hintId}
            title={label}
            onPointerDown={(event) => onDown(event, task, "move")}
            onPointerUp={() => onUp(task)}
            onKeyDown={(event) => onKey(event, task, index)}
            className={`absolute top-[9px] h-4 w-4 rotate-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${done ? "bg-success-solid" : "bg-primary-solid"} ${editable ? "cursor-grab" : ""} ${previewing ? "ring-2 ring-warning-600" : ""}`}
            style={{ left: box.left + box.width / 2 - 8 }}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            data-bar-id={task.id}
            data-bar-index={index}
            data-testid="schedule-bar"
            aria-label={label}
            aria-describedby={hintId}
            title={`${label} · ${task.assigneeName}`}
            onPointerDown={(event) => onDown(event, task, "move")}
            onPointerUp={() => onUp(task)}
            onKeyDown={(event) => onKey(event, task, index)}
            className={`absolute top-[6px] flex h-[22px] items-center overflow-visible rounded text-caption leading-[22px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${done ? "bg-success-solid text-on-solid" : "bg-primary-solid text-on-solid"} ${editable ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""} ${previewing ? "ring-2 ring-warning-600" : ""}`}
            style={{ left: box.left, width: box.width }}
          >
            {editable && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-on-solid/30"
                data-testid="bar-start"
                onPointerDown={(event) => onDown(event, task, "start")}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  onUp(task);
                }}
              />
            )}
            <span className="truncate px-2">{box.width > 60 ? task.title : ""}</span>
            {editable && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-on-solid/30"
                data-testid="bar-end"
                onPointerDown={(event) => onDown(event, task, "end")}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  onUp(task);
                }}
              />
            )}
          </span>
        )}
        {canLink && (
          <span
            aria-hidden="true"
            title="Drag onto another task to link them"
            data-testid="link-handle"
            onPointerDown={(event) => onHandleDown(event, task)}
            onPointerUp={onHandleUp}
            className="absolute top-[11px] z-10 flex h-3 w-3 cursor-crosshair items-center justify-center rounded-full border-2 border-primary-600 bg-surface opacity-0 group-hover:opacity-100 [@media(hover:none)]:!opacity-100"
            style={{ left: box.left + (task.isMilestone ? box.width / 2 + 10 : box.width + 4) }}
          >
            <Link2 className="h-2 w-2" />
          </span>
        )}
        {box.width <= 60 && !task.isMilestone && (
          <span className="pointer-events-none absolute top-[6px] truncate text-caption leading-[22px] text-ink-muted" style={{ left: box.left + box.width + 20, maxWidth: 220 }}>
            {task.title}
          </span>
        )}
      </div>
    </div>
  );
}

// Link two tasks: which way, the other task, the type; lag shown, not editable yet.
function LinkDialogBox({ dialog, tasks, pending, onClose, onSave }: { dialog: LinkDialog; tasks: ScheduleTask[]; pending: boolean; onClose: () => void; onSave: (value: LinkDialog) => void }) {
  const [value, setValue] = useState(dialog);
  const self = tasks.find((task) => task.id === value.taskId);
  const others = tasks.filter((task) => task.id !== value.taskId).sort((a, b) => a.title.localeCompare(b.title));
  // v1.72.2 (D-394, QA visual P4): the shared Dialog (top layer, focus kept inside, themed backdrop).
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Link “${self?.title ?? "task"}”`}
      size="md"
      testId="link-dialog"
      footer={
        <>
          <button type="button" className="btn-secondary btn-compact" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary btn-compact" disabled={!value.otherId || pending} onClick={() => onSave(value)} data-testid="link-save">
            Link
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="field-label">This task</span>
          <select data-autofocus className="field-input" value={value.role} onChange={(event) => setValue({ ...value, role: event.target.value as LinkDialog["role"] })}>
            <option value="BLOCKED_BY">is blocked by (waits for)</option>
            <option value="BLOCKING">is blocking (another task waits for it)</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Other task</span>
          <select className="field-input" value={value.otherId ?? ""} onChange={(event) => setValue({ ...value, otherId: event.target.value ? Number(event.target.value) : null })} data-testid="link-other">
            <option value="">Choose a task</option>
            {others.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} ({task.taskNo})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Type</span>
          <select className="field-input" value={value.type} onChange={(event) => setValue({ ...value, type: event.target.value as DepType })} data-testid="link-type">
            {DEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {DEP_TYPE_LABEL[type]} ({type})
              </option>
            ))}
          </select>
          <span className="mt-1 block text-caption text-ink-muted">{DEP_TYPE_HELP[value.type]}</span>
        </label>
        <p className="text-caption text-ink-muted">Lag: 0 days (lag can&apos;t be changed yet).</p>
      </div>
    </Dialog>
  );
}
