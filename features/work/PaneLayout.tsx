"use client";

import { formatClock, indiaClock, indiaDay } from "@/lib/format/date";
import { CalendarDays, GitBranch, Lock, Globe2, UserRound } from "lucide-react";
import { useState } from "react";
import { privacyAction, taskFieldsAction } from "@/app/users/work/actions";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { formatDayRange, todayInIndia } from "@/features/ui/date-range";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { Avatar } from "@/features/ui/Avatar";
import { useWorkCall, type HolidayChoice } from "@/features/work/client";
import type { PanelData } from "@/features/work/TaskWorkPanel";

// v1.75.0 (D-399, owner's screenshot "use this kind of layout for side bar"):
// the task pane's parts in our theme: the inline task name, the field rows
// (a muted label column and a value column: Assignee, Dates, Dependencies),
// and the visibility banner's "Make public". Every change goes through the
// existing server actions (their rules and the holiday question apply).

const indiaDayOf = (iso: string) => indiaDay(iso);

export function PaneTitle({ taskId, title, canEdit }: { taskId: number; title: string; canEdit: boolean }) {
  const { call } = useWorkCall();
  const [value, setValue] = useState(title);
  if (!canEdit) return <h2 className="text-[22px] font-bold leading-tight text-ink" data-testid="pane-title">{title}</h2>;
  const save = () => {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    void call(() => taskFieldsAction(taskId, { title: next }), { success: false });
  };
  return (
    <h2 className="m-0" data-testid="pane-title">
      <label htmlFor={`pane-title-${taskId}`} className="sr-only">
        Task name
      </label>
      <input
        id={`pane-title-${taskId}`}
        value={value}
        maxLength={200}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setValue(title);
          }
        }}
        className="-mx-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[22px] font-bold leading-tight text-ink hover:border-line focus:border-primary-600 focus:outline-none"
      />
    </h2>
  );
}

// The start–due picker of one task (pane and full page): saved when it closes.
export function TaskDatesPicker({ data, compact = false }: { data: PanelData; compact?: boolean }) {
  const { call } = useWorkCall();
  const dueDay = data.dueAt ? indiaDayOf(data.dueAt) : "";
  const dueTime = data.dueAt ? indiaClock(data.dueAt) : "23:59";
  const may = data.canProgress && data.open && !data.deleted;
  const today = todayInIndia();
  const text = formatDayRange(data.isMilestone ? "" : data.startsOn, dueDay, today);
  return (
    <DateRangePicker
      label="Task dates"
      mode={data.isMilestone ? "single" : "range"}
      dueRequired
      value={{ start: data.isMilestone ? "" : data.startsOn, due: dueDay, dueTime }}
      time={{ due: true }}
      disabled={!may}
      compact={compact}
      testId="task-dates"
      triggerClass="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-label text-ink hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent"
      triggerContent={
        <>
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-ink-muted">
            <CalendarDays className="h-3.5 w-3.5" />
          </span>
          <span className="truncate" data-testid="task-dates-text">
            {text || "No due date"}
          </span>
          {dueDay && dueTime !== "23:59" && <span className="text-caption text-ink-muted">{formatClock(dueTime)}</span>}
        </>
      }
      triggerLabel={`Dates: ${data.startsOn && !data.isMilestone ? `start ${data.startsOn}, ` : ""}due ${dueDay || "none"}${may ? ". Change" : ""}`}
      onCommit={(next) => {
        const change: { dueDay?: string; startDay?: string } = {};
        const time = /^\d{2}:\d{2}$/.test(next.dueTime ?? "") ? next.dueTime! : dueTime;
        if (next.due && (next.due !== dueDay || time !== dueTime)) change.dueDay = `${next.due}T${time}`;
        if (!data.isMilestone && next.start !== data.startsOn) change.startDay = next.start;
        if (!change.dueDay && change.startDay === undefined) return;
        let hit: "due" | "start" = "due";
        void call(async (choice?: HolidayChoice) => {
          const moved = choice?.moveTo;
          const answer = await taskFieldsAction(data.taskId, {
            ...change,
            ...(moved && hit === "due" ? { dueDay: `${moved}T${time}` } : {}),
            ...(moved && hit === "start" ? { startDay: moved } : {}),
            holidayOk: choice?.holidayOk,
          });
          if (!answer.ok && answer.holiday) hit = answer.holiday.field;
          return answer;
        });
      }}
    />
  );
}

// The field rows: a muted label column (about 140 px) and the value.
export function TaskFieldRows({ data, canAssign }: { data: PanelData; canAssign: boolean }) {
  const { call } = useWorkCall();
  const [picking, setPicking] = useState(false);
  const waits = data.blockedBy.length;
  const blocks = data.blocking.length;
  const row = "grid grid-cols-[minmax(6rem,8.75rem)_minmax(0,1fr)] items-center gap-x-3 min-h-9";
  const label = "text-label text-ink-muted";
  return (
    <dl className="space-y-1" data-testid="pane-fields">
      <div className={row} data-testid="pane-row-assignee">
        <dt className={label}>Assignee</dt>
        <dd className="min-w-0">
          {picking && canAssign ? (
            <PersonSelect
              ariaLabel="Assignee"
              options={data.people}
              value={data.assigneeId ?? null}
              onChange={(id) => {
                setPicking(false);
                if (id && id !== data.assigneeId) void call(() => taskFieldsAction(data.taskId, { assigneeId: id }));
              }}
              compact
              floating
              className="w-64 max-w-full text-label"
            />
          ) : (
            <button
              type="button"
              disabled={!canAssign}
              onClick={() => setPicking(true)}
              aria-label={`Assignee: ${data.assigneeName ?? "No assignee"}${canAssign ? ". Change" : ""}`}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-label text-ink hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent"
            >
              {data.assigneeName ? (
                <Avatar name={data.assigneeName} src={null} size="sm" />
              ) : (
                <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-line-strong text-ink-muted">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="truncate">{data.assigneeName ?? "No assignee"}</span>
            </button>
          )}
        </dd>
      </div>
      <div className={row} data-testid="pane-row-dates">
        <dt className={label}>Due date</dt>
        <dd className="min-w-0">
          <TaskDatesPicker data={data} />
        </dd>
      </div>
      <div className={row} data-testid="pane-row-dependencies">
        <dt className={label}>Dependencies</dt>
        <dd className="min-w-0">
          <button
            type="button"
            onClick={() => {
              const section = document.getElementById("work-deps");
              section?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              section?.closest("section")?.querySelector<HTMLElement>("input, button")?.focus();
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />
            {waits || blocks ? `Waiting for ${waits} · blocking ${blocks}` : data.canProgress ? "Add dependencies" : "None"}
          </button>
        </dd>
      </div>
    </dl>
  );
}

// The banner under the pane's bar: who sees the task; "Make public" for a
// project owner (or IT) when the task is in exactly one private project.
export function PaneVisibilityBanner({ text, data }: { text: string; data: PanelData }) {
  const { call, pending } = useWorkCall();
  const [asking, setAsking] = useState(false);
  const only = data.privacy?.length === 1 ? data.privacy[0]! : null;
  const isPrivate = only?.privacy === "PRIVATE";
  const sentence = isPrivate ? "This task is private to members of this project." : text;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-label text-ink-muted" data-testid="visibility-banner">
      {isPrivate || !data.links.length ? <Lock aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Globe2 aria-hidden="true" className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{sentence}</span>
      {isPrivate && only?.canManage && !asking && (
        <button type="button" className="btn-secondary btn-compact" onClick={() => setAsking(true)} data-testid="make-public">
          Make public
        </button>
      )}
      {asking && only && (
        <span className="flex w-full flex-wrap items-center gap-2" role="group" aria-label="Make the project public">
          <span className="text-caption">Everyone at ARS will see the project and its tasks.</span>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={pending}
            onClick={() => void call(() => privacyAction(only.projectId, "ORGANISATION", null), { success: "The project is now public." }).then(() => setAsking(false))}
          >
            Make public
          </button>
          <button type="button" className="btn-secondary btn-compact" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}
