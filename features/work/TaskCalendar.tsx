"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { quickAddAction, taskFieldsAction } from "@/app/users/work/actions";
import { TaskCheck, usePaneLink, useWorkCall } from "@/features/work/client";
import { ChevronDown } from "lucide-react";
import { Menu } from "@/features/ui/Menu";
import { AddTaskSplit } from "@/features/work/ViewToolbar";
import { indiaDayOf } from "@/features/work/format";
import { addDays, dayDiff } from "@/server/work/schedule";

// D-215: tasks on a month grid by due date (India time). Drag a task to
// another day to move its due date; "+" on a day adds a task due that day.
// Undated tasks wait in "No due date".
// v1.65.0 (D-373, "pm_planning", spec PV §6): a Weeks view beside Months
// (Saturday and Sunday share a column; a task with a start date shows on each
// day from start to due), the due time is kept when a task moves (its start
// moves with it), a keyboard move (focus a task, Space to pick it up, ← / →
// a day, ↑ / ↓ a week, Enter or Space to drop, Escape to cancel), and, since
// every task has a due date, a "No start date" panel instead of "No date".
export interface CalendarTask {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  assigneeId: number;
  isMilestone: boolean;
  startsOn?: string | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const indiaTime = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const dayLabel = (day: string) => `${WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]} ${Number(day.slice(8, 10))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1]!.slice(0, 3)}`;

export interface CalendarPlanning {
  unit: "month" | "week";
  week: string; // a day in the week shown
  href: string; // the view's address, ending in "?" or "&"
}

export function TaskCalendar({
  tasks,
  month,
  todayDay,
  canEdit,
  meId,
  projectId,
  monthHref,
  holidays = {},
  planning,
}: {
  tasks: CalendarTask[];
  month: string;
  todayDay: string;
  canEdit: boolean;
  meId: number;
  projectId?: number;
  monthHref: string;
  holidays?: Record<string, string>;
  planning?: CalendarPlanning;
}) {
  const hrefFor = (value: string) => `${monthHref}${value}`;
  const { call, pending: busy } = useWorkCall();
  const paneLink = usePaneLink();
  const [dragging, setDragging] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [lifted, setLifted] = useState<{ id: number; day: string } | null>(null);
  const [said, setSaid] = useState("");
  const [showNoStart, setShowNoStart] = useState(false);
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const week = planning?.unit === "week";
  const weekStart = planning ? mondayOf(planning.week) : todayDay;
  const dueDay = (task: CalendarTask) => (task.dueAt ? indiaDayOf(new Date(task.dueAt)) : null);
  const byDay = useMemo(() => {
    const map = new Map<string, { task: CalendarTask; due: boolean }[]>();
    const put = (day: string, task: CalendarTask, due: boolean) => map.set(day, [...(map.get(day) ?? []), { task, due }]);
    for (const task of tasks) {
      const lift = lifted?.id === task.id ? lifted.day : null;
      const due = lift ?? (task.dueAt ? indiaDayOf(new Date(task.dueAt)) : null);
      if (!due) continue;
      put(due, task, true);
      // Weeks: a task with a start date also shows on each day before its due date.
      if (week && task.startsOn && !lift && task.startsOn < due && dayDiff(task.startsOn, due) <= 62) for (let day = task.startsOn; day < due; day = addDays(day, 1)) put(day, task, false);
    }
    return map;
  }, [tasks, lifted, week]);
  const undated = tasks.filter((task) => !task.dueAt && task.status !== "COMPLETED" && task.status !== "CANCELLED");
  const noStart = tasks.filter((task) => task.dueAt && !task.startsOn && !task.isMilestone && task.status !== "COMPLETED" && task.status !== "CANCELLED");
  const shift = (delta: number) => {
    const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const may = (task: CalendarTask) => canEdit || task.assigneeId === meId;
  // Move a task's due date to `day` (and, with planning, its start by the same number of days; the due time stays).
  const moveTo = (task: CalendarTask, day: string) => {
    const from = dueDay(task);
    if (!from || from === day) return;
    const change: { dueDay: string; startDay?: string } = { dueDay: planning && task.dueAt ? `${day}T${indiaTime(task.dueAt)}` : day };
    if (planning && task.startsOn) change.startDay = addDays(task.startsOn, dayDiff(from, day));
    void call((choice) => taskFieldsAction(task.id, { ...change, ...(choice?.moveTo ? { dueDay: choice.moveTo } : {}), holidayOk: choice?.holidayOk }), { success: "Due date moved." });
  };
  const drop = (day: string) => {
    const task = tasks.find((item) => item.id === dragging);
    setDragging(null);
    if (task && may(task)) moveTo(task, day);
  };
  const onChipKey = (event: React.KeyboardEvent, task: CalendarTask) => {
    if (!planning || !may(task)) return;
    const due = dueDay(task);
    if (!due) return;
    if (!lifted || lifted.id !== task.id) {
      if (event.key === " ") {
        event.preventDefault();
        setLifted({ id: task.id, day: due });
        setSaid(`Picked up ${task.title}, due ${dayLabel(due)}. Use the arrow keys to choose a day, Enter or Space to drop, Escape to cancel.`);
      }
      return;
    }
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
    if (step) {
      event.preventDefault();
      const day = addDays(lifted.day, step);
      setLifted({ id: task.id, day });
      setSaid(`${task.title}: ${dayLabel(day)}${holidays[day] ? `, holiday (${holidays[day]})` : ""}.`);
      // Keep the moving task focused after it is redrawn on its new day.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal-task="${task.id}"][data-cal-due="1"]`)?.focus());
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setLifted(null);
      setSaid(`Move cancelled. ${task.title} stays due ${dayLabel(due)}.`);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const day = lifted.day;
      setLifted(null);
      setSaid(`Dropped ${task.title} on ${dayLabel(day)}.`);
      moveTo(task, day);
    }
  };
  const chip = ({ task, due }: { task: CalendarTask; due: boolean }) => (
    <li
      key={`${task.id}-${due ? "d" : "s"}`}
      draggable={may(task) && due}
      onDragStart={() => setDragging(task.id)}
      tabIndex={planning && due ? 0 : undefined}
      onKeyDown={due ? (event) => onChipKey(event, task) : undefined}
      data-cal-task={task.id}
      data-cal-due={due ? "1" : "0"}
      data-testid="calendar-task"
      aria-label={planning && due ? `${task.title}, due${lifted?.id === task.id ? " (moving)" : ""}${may(task) ? ". Space picks it up to move it" : ""}` : undefined}
      className={`flex items-center gap-1 rounded px-1 py-0.5 text-caption focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${due ? "bg-surface-muted" : "border border-dashed border-line text-ink-muted"} ${lifted?.id === task.id ? "ring-2 ring-warning-600" : ""}`}
    >
      {due ? <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={!may(task)} label={task.title} size="sm" /> : <span aria-hidden="true">→</span>}
      <Link href={paneLink(task.id)} scroll={false} tabIndex={planning && due ? -1 : undefined} className={`min-w-0 truncate hover:underline ${task.status === "COMPLETED" ? "text-ink-muted line-through" : ""}`}>
        {task.isMilestone ? "◆ " : ""}
        {task.title}
      </Link>
    </li>
  );
  const addForm = (day: string) =>
    adding === day && (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || busy) return;
          void call((choice) => quickAddAction({ title, projectId: projectId ?? null, dueDay: choice?.moveTo ?? day, holidayOk: choice?.holidayOk }), { success: "Added." }).then((result) => {
            if (result?.ok) {
              setTitle("");
              setAdding(null);
            }
          });
        }}
      >
        <input autoFocus aria-label={`New task due ${day}`} aria-busy={busy || undefined} readOnly={busy} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setAdding(null)} className="field-input h-7 text-caption" placeholder="Task name, Enter" />
      </form>
    );
  const dayCell = (day: string, label: React.ReactNode, extra = "") => {
    const list = byDay.get(day) ?? [];
    return (
      <div
        key={day}
        role="gridcell"
        aria-label={day}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          drop(day);
        }}
        className={`group border-b border-r border-line p-1 ${extra} ${lifted?.day === day ? "outline outline-2 -outline-offset-2 outline-warning-600" : ""} ${day === todayDay ? "bg-primary-50" : holidays[day] ? "bg-warning-50" : "bg-surface"}`}
      >
        <div className="flex items-center justify-between gap-1">
          {label}
          {holidays[day] && (
            <span className="min-w-0 flex-1 truncate text-caption text-warning-600" title={`Holiday: ${holidays[day]}`} data-testid="calendar-holiday">
              {holidays[day]}
            </span>
          )}
          {canEdit && (
            <button type="button" aria-label={`Add a task due ${day}`} onClick={() => setAdding(day)} className="rounded px-1 text-caption text-ink-faint opacity-0 hover:bg-surface-muted group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:!opacity-100">
              +
            </button>
          )}
        </div>
        <ul className="space-y-0.5">{list.map(chip)}</ul>
        {addForm(day)}
      </div>
    );
  };
  const badge = (day: string, text: string) => (
    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-caption ${day === todayDay ? "bg-primary-solid font-bold text-on-solid" : "text-ink-muted"}`}>{text}</span>
  );
  // v1.72.0 (D-387, spec PV §6, S-12): the unit is a dropdown (Weeks · Months) instead of two side-by-side links.
  const weeksHref = planning ? `${planning.href}cal=week&week=${week ? weekStart : todayDay.slice(0, 7) === month ? todayDay : `${month}-01`}` : "";
  const monthsHref = planning ? `${planning.href}cal=month&month=${week ? weekStart.slice(0, 7) : month}` : "";
  const unitLinks = planning && (
    <span className="ml-auto">
      <Menu
        label={`Calendar unit: ${week ? "Weeks" : "Months"}`}
        trigger={
          <span className="inline-flex items-center gap-1">
            {week ? "Weeks" : "Months"} <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </span>
        }
        buttonClass="btn-secondary btn-compact"
        menuClass="w-40"
        testId="calendar-unit"
        items={[
          { kind: "radio", label: "Weeks", checked: week, href: weeksHref, testId: "calendar-weeks" },
          { kind: "radio", label: "Months", checked: !week, href: monthsHref, testId: "calendar-months" },
        ]}
      />
    </span>
  );
  const weekEnd = addDays(weekStart, 6);
  return (
    <div className={`grid gap-4 ${planning && !showNoStart ? "" : "lg:grid-cols-[minmax(0,1fr)_240px]"}`} data-testid="task-calendar">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Calendar tools">
          {canEdit && projectId ? <AddTaskSplit projectId={projectId} /> : null}
          {week ? (
            <>
              <Link href={`${planning!.href}cal=week&week=${addDays(weekStart, -7)}`} className="btn-secondary btn-compact" aria-label="Previous week">
                ‹
              </Link>
              <Link href={`${planning!.href}cal=week&week=${todayDay}`} className="btn-secondary btn-compact">
                Today
              </Link>
              <Link href={`${planning!.href}cal=week&week=${addDays(weekStart, 7)}`} className="btn-secondary btn-compact" aria-label="Next week">
                ›
              </Link>
              <h2 className="min-w-0 font-semibold sm:min-w-52" data-testid="calendar-week-title">
                {dayLabel(weekStart)} – {dayLabel(weekEnd)} {weekEnd.slice(0, 4)}
              </h2>
            </>
          ) : (
            <>
              <Link href={hrefFor(shift(-1))} className="btn-secondary btn-compact" aria-label="Previous month">
                ‹
              </Link>
              <Link href={hrefFor(todayDay.slice(0, 7))} className="btn-secondary btn-compact">
                Today
              </Link>
              <Link href={hrefFor(shift(1))} className="btn-secondary btn-compact" aria-label="Next month">
                ›
              </Link>
              <h2 className="min-w-0 font-semibold sm:min-w-40">
                {MONTH_NAMES[monthIndex - 1]} {year}
              </h2>
            </>
          )}
          {planning && (
            <button type="button" className="btn-secondary btn-compact" aria-pressed={showNoStart} onClick={() => setShowNoStart((on) => !on)} data-testid="no-start-toggle">
              No start date ({noStart.length})
            </button>
          )}
          {unitLinks}
        </div>
        {planning && (
          <p className="sr-only" role="status" aria-live="polite" data-testid="calendar-live">
            {said}
          </p>
        )}
        {week ? (
          <div role="grid" aria-label={`Week of ${dayLabel(weekStart)}`} className="grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-6" data-testid="calendar-week">
            <div role="row" className="contents">
              {[0, 1, 2, 3, 4].map((offset) => {
                const day = addDays(weekStart, offset);
                return dayCell(day, badge(day, dayLabel(day)), "min-h-48");
              })}
              {/* Saturday and Sunday share one column (spec BR-PROJ-032). */}
              <div className="grid grid-rows-2" role="presentation">
                {[5, 6].map((offset) => {
                  const day = addDays(weekStart, offset);
                  return dayCell(day, badge(day, dayLabel(day)), "min-h-24");
                })}
              </div>
            </div>
          </div>
        ) : (
          <div role="grid" aria-label={`${MONTH_NAMES[monthIndex - 1]} ${year}`} className="grid grid-cols-7 overflow-hidden rounded-lg border border-line">
            {WEEKDAYS.map((day) => (
              <div key={day} role="columnheader" className="border-b border-line bg-surface-muted px-2 py-1 text-caption font-semibold text-ink-faint">
                {day}
              </div>
            ))}
            {Array.from({ length: cells }, (_, index) => {
              const date = index - lead + 1;
              if (date < 1 || date > days) return <div key={index} role="gridcell" className="min-h-24 border-b border-r border-line bg-surface-muted/50" />;
              const day = `${month}-${String(date).padStart(2, "0")}`;
              return dayCell(day, badge(day, String(date)), "min-h-24");
            })}
          </div>
        )}
      </div>
      {!planning && (
        <aside aria-label="No due date" className="card h-fit px-3 py-2" onDragOver={(event) => event.preventDefault()}>
          <h3 className="mb-1 text-label font-semibold">No date ({undated.length})</h3>
          <p className="mb-2 text-caption text-ink-muted">Drag one onto a day to give it a due date.</p>
          <ul className="space-y-1">
            {undated.slice(0, 50).map((task) => (
              <li key={task.id} draggable={may(task)} onDragStart={() => setDragging(task.id)} className="truncate rounded bg-surface-muted px-2 py-1 text-caption">
                <Link href={paneLink(task.id)} scroll={false} className="hover:underline">
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {planning && showNoStart && (
        <aside aria-label="No start date" className="card h-fit px-3 py-2" data-testid="no-start-panel">
          <h3 className="mb-1 text-label font-semibold">No start date ({noStart.length})</h3>
          <p className="mb-2 text-caption text-ink-muted">These show only on their due day. Give one a start date to plan it as a range.</p>
          <ul className="space-y-2">
            {noStart.slice(0, 50).map((task) => (
              <li key={task.id} className="text-caption">
                <Link href={paneLink(task.id)} scroll={false} className="block min-h-6 truncate leading-6 hover:underline">
                  {task.title}
                </Link>
                {may(task) && (
                  <input
                    type="date"
                    aria-label={`Start date for ${task.title}`}
                    max={dueDay(task) ?? undefined}
                    className="field-input mt-0.5 h-7 text-caption"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) void call((choice) => taskFieldsAction(task.id, { startDay: value, holidayOk: choice?.holidayOk }), { success: "Start date set." });
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
