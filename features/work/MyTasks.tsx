"use client";

import type { CellMap, FieldView } from "@/server/work/custom-fields";
import { ApprovalBadge, approvalRowClass } from "@/features/work/ApprovalLink";
import { ArrowLeftRight, ChevronDown, ExternalLink, FileDown, FolderKanban, Link2, MessageSquare, MoreHorizontal, Pencil, Plus, Printer, Rss, Settings2, Table2, Trash2, Zap } from "lucide-react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { digestChoiceAction } from "@/app/users/work/actions";
import Link from "next/link";
import { useMemo, useState } from "react";
import { myPlaceAction, myRulesAction, mySectionAction, myTasksTabAction } from "@/app/users/work/actions";
import { Dialog } from "@/features/ui/Dialog";
import { BOARD_SECTIONS, BOARD_SECTIONS_LABEL, MAX_UPCOMING_DAYS, TAB_RANGE_HINT, TAB_RANGE_LABEL, TAB_RANGES, type BoardSections, type MyRules, type TabRange } from "@/server/work/my-sections";
import { openCreateTask, ProjectDot, TaskCheck, usePaneLink, useWorkCall } from "@/features/work/client";
import { Repeat } from "lucide-react";
import { dueLabel, TONE_TEXT } from "@/features/work/format";
import { columnAccent } from "@/features/work/kanban";
import { AddTask, useAutoRefresh } from "@/features/work/ProjectWorkspace";
import { BulkBar } from "@/features/work/MoreParts";
import { TaskGrid, type GridView } from "@/features/work/TaskGrid";
import type { GridConfig, GridTask } from "@/server/work/grid";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { TaskPriorityPill } from "@/features/ui/ChoicePill";

// D-215: My Tasks. The person's own sections: Recently assigned, Today,
// Upcoming, Later (built in) and any they add. Drag a task between sections
// or reorder it (only the person sees this order); tasks move forward to
// Today and Upcoming by themselves as their due date comes near.
export interface MyTaskRow {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  sectionId: number;
  position: number;
  assignedByName: string;
  selfAssigned: boolean;
  projects: { id: number; name: string; color: string }[];
  subtasks: number;
  subtasksOpen: number;
  comments: number;
  isPeriodic: boolean; // D-219
  priority?: string; // v1.47.0: LOW / NORMAL / HIGH / URGENT
  approval?: { requestId: number; requestNo: string; workStep: boolean; linked?: boolean } | null; // v1.42.1
}
export interface MySectionRow {
  id: number;
  name: string;
  system: string | null;
  count?: number; // v1.76.0: tasks placed in it (the delete confirmation)
}

// v1.54.4 (owner): Task Summary's sections are fixed (Overdue, Due today, Due
// in the next 7 days, Completed today) and follow the dates: "fixed" turns off
// renaming, adding sections, adding into a section and moving between them.
export function MyTasks({ sections, tasks, layout, nowIso, fixed = false }: { sections: MySectionRow[]; tasks: MyTaskRow[]; layout: "LIST" | "BOARD"; nowIso: string; fixed?: boolean }) {
  const { call, pending: busy } = useWorkCall();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [newSection, setNewSection] = useState("");
  const [live, setLive] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const paneLink = usePaneLink();
  useAutoRefresh();
  const inSection = (id: number) => tasks.filter((task) => task.sectionId === id).sort((a, b) => a.position - b.position || a.id - b.id);

  const place = (taskId: number, sectionId: number, beforeId: number | null) => {
    const list = inSection(sectionId).filter((task) => task.id !== taskId);
    const index = beforeId === null ? list.length : Math.max(0, list.findIndex((task) => task.id === beforeId));
    const before = list[index - 1]?.position ?? null;
    const after = list[index]?.position ?? null;
    const position = before !== null && after !== null ? (before + after) / 2 : before !== null ? before + 1024 : after !== null ? after - 1024 : 1024;
    setLive(`Moved to ${sections.find((section) => section.id === sectionId)?.name ?? "section"}.`);
    void call(() => myPlaceAction(taskId, sectionId, position), { success: false });
  };
  const keyMove = (event: React.KeyboardEvent, task: MyTaskRow) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const up = event.key === "ArrowUp";
    if (event.shiftKey) {
      const index = sections.findIndex((section) => section.id === task.sectionId);
      const target = sections[index + (up ? -1 : 1)];
      if (target) place(task.id, target.id, null);
      return;
    }
    const list = inSection(task.sectionId);
    const index = list.findIndex((item) => item.id === task.id);
    if (up && index > 0) place(task.id, task.sectionId, list[index - 1]!.id);
    if (!up && index < list.length - 1) place(task.id, task.sectionId, list[index + 2]?.id ?? null);
  };

  const row = (task: MyTaskRow, card: boolean) => {
    const open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(task.status);
    const due = dueLabel(task.dueAt, now, open);
    return (
      <li
        key={task.id}
        tabIndex={-1}
        draggable={!fixed}
        onDragStart={() => setDragging(task.id)}
        onDragEnd={() => setDragging(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (dragging !== null && dragging !== task.id) place(dragging, task.sectionId, task.id);
          setDragging(null);
        }}
        onKeyDown={(event) => !fixed && keyMove(event, task)}
        data-testid="my-task"
        className={`work-row ${card ? "kanban-card rounded-lg border border-line bg-surface p-3 shadow-card hover:border-line-strong" : "flex items-center gap-2 border-b border-line px-3 py-1.5 hover:bg-surface-muted"} ${approvalRowClass(task.approval)} ${dragging === task.id ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Select ${task.title}`}
            checked={selected.includes(task.id)}
            onChange={(event) => setSelected((value) => (event.target.checked ? [...value, task.id] : value.filter((one) => one !== task.id)))}
          />
          <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={task.status === "CANCELLED"} label={task.title} />
          <Link href={paneLink(task.id)} scroll={false} className={`min-w-0 flex-1 truncate text-label hover:underline ${task.status === "COMPLETED" ? "text-ink-muted line-through" : ""}`}>
            {task.isPeriodic && <Repeat aria-label="Periodic" className="mr-1 inline h-3.5 w-3.5 text-info-600" />}
            {task.title}
          </Link>
          <ApprovalBadge approval={task.approval} size="sm" />
        </div>
        <div className={`flex items-center gap-2 text-caption text-ink-muted ${card ? "mt-1.5 flex-wrap" : "shrink-0"}`}>
          {task.projects.slice(0, 2).map((project) => (
            <span key={project.id} className="inline-flex items-center gap-1">
              <ProjectDot color={project.color} />
              <span className="max-w-32 truncate">{project.name}</span>
            </span>
          ))}
          {!task.selfAssigned && <span className="hidden md:inline">from {task.assignedByName}</span>}
          {task.subtasks > 0 && (
            <span>
              {task.subtasks - task.subtasksOpen}/{task.subtasks} subtasks
            </span>
          )}
          {due && <span className={TONE_TEXT[due.tone]}>{due.text}</span>}
          {task.priority && <TaskPriorityPill priority={task.priority} />}
          {task.comments > 0 && (
            <span className="inline-flex items-center gap-0.5" aria-label={`${task.comments} comment${task.comments === 1 ? "" : "s"}`}>
              <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
              {task.comments}
            </span>
          )}
          <TaskRowMenu task={task} href={paneLink(task.id)} />
        </div>
      </li>
    );
  };

  const sectionHead = (section: MySectionRow, count: number) => (fixed ? <FixedTitle name={section.name} count={count} /> : <SectionTitle section={section} count={count} />);
  const addSection = (
    <form
      className={layout === "BOARD" ? "w-64 shrink-0" : "flex items-center gap-2 px-3 py-3"}
      onSubmit={(event) => {
        event.preventDefault();
        if (newSection.trim() && !busy) void call(() => mySectionAction("ADD", null, newSection)).then((result) => result?.ok && setNewSection(""));
      }}
    >
      <label htmlFor="my-new-section" className="sr-only">
        New section name
      </label>
      <input id="my-new-section" value={newSection} onChange={(event) => setNewSection(event.target.value)} placeholder="New section…" className="field-input h-8 text-label" />
      <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn-secondary btn-compact mt-1 shrink-0">
        Add section
      </button>
    </form>
  );
  const recent = sections.find((section) => section.system === "RECENT");
  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
      {layout === "BOARD" ? (
        <div className="scroll-hint flex gap-3 overflow-x-auto pb-4" data-testid="my-board">
          {sections.map((section, index) => (
            <section
              key={section.id}
              aria-label={section.name}
              className={`kanban-col flex w-board-col shrink-0 flex-col rounded-xl border border-t-4 border-line bg-surface-muted ${columnAccent(index)}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) place(dragging, section.id, null);
                setDragging(null);
              }}
            >
              <div className="px-3 py-2">{sectionHead(section, inSection(section.id).length)}</div>
              <ul className="flex-1 space-y-2 px-2 pb-2">{inSection(section.id).map((task) => row(task, true))}</ul>
              {!fixed && <AddTask mySectionId={section.id} compact />}
            </section>
          ))}
          {!fixed && addSection}
        </div>
      ) : (
        <div className="card" data-testid="my-list">
          {sections.map((section) => (
            <section
              key={section.id}
              aria-label={section.name}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) place(dragging, section.id, null);
                setDragging(null);
              }}
            >
              <div className="border-b border-line px-3 pb-1 pt-3">{sectionHead(section, inSection(section.id).length)}</div>
              <ul>{inSection(section.id).map((task) => row(task, false))}</ul>
              {!fixed && <AddTask mySectionId={section.id} placeholder={`Add a task to ${section.name}…`} />}
            </section>
          ))}
          {!fixed && addSection}
        </div>
      )}
      <BulkBar ids={selected.filter((one) => tasks.some((task) => task.id === one))} clear={() => setSelected([])} />
      {recent && !fixed && <p className="mt-2 text-caption text-ink-muted">New tasks given to you land in {recent.name}. Tasks in Upcoming and Later move to Today on their due date.</p>}
    </div>
  );
}

// v1.73.0 (D-396, spec S-04 board cards / list rows): each task's ⋯ menu:
// Open task details, Copy task link, Go to its project.
function TaskRowMenu({ task, href }: { task: MyTaskRow; href: string }) {
  const toast = useToast();
  const link = `/users/tasks/${task.id}`;
  const items: MenuItem[] = [
    { label: "Open task details", icon: <ExternalLink className="h-4 w-4" />, href },
    { label: "Copy task link", icon: <Link2 className="h-4 w-4" />, onSelect: () => void copyText(`${window.location.origin}${link}`).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${link}` })) },
    ...task.projects.slice(0, 3).map((project) => ({ label: `Go to ${project.name}`, icon: <FolderKanban className="h-4 w-4" />, href: `/users/work/projects/${project.id}` })),
  ];
  return <Menu label={`Actions for ${task.title}`} trigger={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />} buttonClass="grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-surface hover:text-ink" menuClass="w-56" testId="my-task-menu" items={items} />;
}

// v1.73.0 (D-396, spec S-04 header "My tasks ▾"): the title's actions menu:
// Add task, the morning summary email (on or off), Table with filters, the
// calendar feed (when offered) and Print.
// v1.76.0 (D-401, spec §3.3): plus "Sync / export ▸" with Calendar feed, CSV
// (the current tab, downloaded at once) and Print; the v1.73.0 items stay.
export function MyTasksTitle({ title, digestOn, feed, csvHref }: { title: string; digestOn: boolean; feed: boolean; csvHref?: string }) {
  const { call } = useWorkCall();
  const [digest, setDigest] = useState(digestOn);
  const items: MenuItem[] = [
    { label: "Add task", icon: <Plus className="h-4 w-4" />, onSelect: () => openCreateTask({ projectId: null }) },
    {
      kind: "checkbox",
      label: "Morning summary email",
      hint: "Your day's tasks by email each morning",
      checked: digest,
      onSelect: () => {
        const next = !digest;
        setDigest(next);
        void call(() => digestChoiceAction(next)).then((result) => !result?.ok && setDigest(!next));
      },
      testId: "my-digest",
    },
    { kind: "separator", label: "" },
    { label: "Table with filters", hint: "Every task, on Assigned to me", icon: <Table2 className="h-4 w-4" />, href: "/users/tasks" },
    {
      kind: "submenu",
      label: "Sync / export",
      icon: <ArrowLeftRight className="h-4 w-4" />,
      testId: "my-sync-export",
      items: [
        ...(feed ? [{ label: "Calendar feed", hint: "Subscribe in your calendar app", icon: <Rss className="h-4 w-4" />, href: "#my-tasks-feed" }] : []),
        ...(csvHref ? [{ label: "CSV", hint: "This tab's tasks, as a spreadsheet file", icon: <FileDown className="h-4 w-4" />, href: csvHref, download: true, testId: "my-export-csv" }] : []),
        { label: "Print", icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() },
      ],
    },
    ...(feed ? [{ label: "Calendar feed", hint: "Subscribe in your calendar app", icon: <Rss className="h-4 w-4" />, href: "#my-tasks-feed" }] : []),
    { label: "Print", icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() },
  ];
  return (
    <span className="inline-flex items-center gap-1">
      <h1 className="text-title font-semibold tracking-tight">{title}</h1>
      <Menu label={`Actions for ${title}`} trigger={<ChevronDown aria-hidden="true" className="h-4 w-4" />} align="left" menuClass="w-64" testId="my-tasks-actions" items={items} />
    </span>
  );
}

function FixedTitle({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="font-semibold">{name}</h2>
      <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-semibold tabular-nums text-ink-muted">{count}</span>
    </div>
  );
}

function SectionTitle({ section, count }: { section: MySectionRow; count: number }) {
  const { call, pending: busy } = useWorkCall();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(section.name);
  if (editing)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void call(() => mySectionAction("RENAME", section.id, name)).then((result) => result?.ok && setEditing(false));
        }}
      >
        <input autoFocus aria-label="Section name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)} className="field-input h-8 text-label" />
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn-secondary btn-compact">
          Save
        </button>
      </form>
    );
  return (
    <div className="flex items-center gap-2">
      <h2 className="font-semibold">{section.name}</h2>
      <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-semibold tabular-nums text-ink-muted">{count}</span>
      <button type="button" aria-label={`Rename ${section.name}`} onClick={() => setEditing(true)} className="rounded p-1 text-ink-faint hover:bg-surface-muted">
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {!section.system && (
        <ConfirmButton ariaLabel={`Delete section ${section.name}`} title={`Delete the section “${section.name}”?`} body={`${section.count ? `Its ${section.count} task${section.count === 1 ? "" : "s"} move` : "Any tasks in it move"} to Recently assigned. The tasks themselves are kept.`} onConfirm={() => call(() => mySectionAction("DELETE", section.id, ""))} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint hover:bg-danger-50 hover:text-danger-600">
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </ConfirmButton>
      )}
    </div>
  );
}

// D-220: My Tasks as the shared table (owner's screenshot): your sections as
// groups by default, or any grouping; drag to place (your order only).
export function MyTasksGrid({
  rows,
  sections,
  initial,
  view,
  people,
  projects,
  meId,
  nowIso,
  fixed = false,
  density,
  fields,
  mySections,
  resetTo,
}: {
  rows: GridTask[];
  sections: MySectionRow[];
  // v1.76.0 (D-401): the person's own sections ("My sections" grouping) and the tab's starting view.
  mySections?: MySectionRow[];
  resetTo?: GridConfig;
  initial: GridConfig;
  view: GridView;
  people: { id: number; label: string }[];
  projects: { id: number; name: string }[];
  meId: number;
  nowIso: string;
  fixed?: boolean;
  density?: "COMFORTABLE" | "COMPACT";
  // v1.64.0 (D-371, "pm_planning"): the custom fields of the tasks' projects, their values, and which task has which.
  fields?: { views: FieldView[]; values: CellMap; scope: Record<number, number[]> };
}) {
  const { call } = useWorkCall();
  // v1.76.0 (D-401): moves happen in "My sections" (the person's own order).
  const place = (taskId: number, sectionId: number, beforeId: number | null) => {
    const list = rows.filter((task) => task.mySectionId === sectionId && task.id !== taskId).sort((a, b) => (a.myPosition ?? 0) - (b.myPosition ?? 0) || a.id - b.id);
    const index = beforeId === null ? list.length : Math.max(0, list.findIndex((task) => task.id === beforeId));
    const before = list[index - 1]?.myPosition ?? null;
    const after = list[index]?.myPosition ?? null;
    const position = before !== null && after !== null ? (before + after) / 2 : before !== null ? before + 1024 : after !== null ? after - 1024 : 1024;
    void call(() => myPlaceAction(taskId, sectionId, position), { success: false });
  };
  const addSection = () => {
    const name = window.prompt("Name of the new section", "")?.trim();
    if (name) void call(() => mySectionAction("ADD", null, name));
  };
  const mine = mySections ?? [];
  return (
    <TaskGrid
      rows={rows}
      initial={initial}
      columns={["due", "priority", "collaborators", "createdBy", "projects", "visibility"]} // v1.52.1 (owner): Priority beside the due date
      groupsAllowed={mySections ? ["section", "mySection", "createdBy", "project", "due", "priority", "kind"] : ["section", "assignee", "createdBy", "project", "due", "priority", "kind"]}
      groupLabels={mySections ? { section: "Date sections" } : undefined}
      sections={sections.map((section) => ({ id: section.id, name: section.name }))}
      mySections={mySections?.map((section) => ({ id: section.id, name: section.name }))}
      sectionHeader={(section, count) => {
        const own = mine.find((item) => item.id === section.id);
        if (own) return own.system === "OVERDUE" ? <FixedTitle name={own.name} count={count} /> : <SectionTitle section={own} count={count} />;
        return fixed ? <FixedTitle name={section.name} count={count} /> : <SectionTitle section={sections.find((item) => item.id === section.id)!} count={count} />;
      }}
      onMove={mySections ? place : fixed ? undefined : place}
      moveGroup={mySections ? "mySection" : "section"}
      onAddSection={mySections ? addSection : undefined}
      addTo={mySections || !fixed ? { mySections: true } : undefined}
      resetTo={resetTo}
      people={people}
      projects={projects}
      meId={meId}
      nowIso={nowIso}
      view={view}
      density={density}
      fields={fields?.views}
      values={fields?.values}
      fieldScope={fields?.scope}
      planning={Boolean(fields)}
      testId="my-grid"
      emptyText="Nothing here. Clear the filters, or add a task."
    />
  );
}

// v1.76.0 (D-401, owner): the bar above a Task Summary tab: which tasks it
// shows (Summary window or All my open tasks) and, on a Board, its columns
// (by date or My sections). Saved with the tab at once.
export function TabSettingsBar({ tabKey, range, sections, board }: { tabKey: string; range: TabRange; sections: BoardSections; board: boolean }) {
  const { call, pending } = useWorkCall();
  const save = (change: { range?: TabRange; sections?: BoardSections }) => void call(() => myTasksTabAction({ op: "settings", key: tabKey, ...change }), { success: false });
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="tab-settings">
      <label className="inline-flex items-center gap-2 text-label">
        <span className="text-ink-muted">Show</span>
        <select value={range} disabled={pending} onChange={(event) => save({ range: event.target.value as TabRange })} className="field-input h-8 text-label" data-testid="tab-range" title={TAB_RANGE_HINT[range]}>
          {TAB_RANGES.map((value) => (
            <option key={value} value={value}>
              {TAB_RANGE_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      {board && (
        <label className="inline-flex items-center gap-2 text-label">
          <span className="text-ink-muted">Columns</span>
          <select value={sections} disabled={pending} onChange={(event) => save({ sections: event.target.value as BoardSections })} className="field-input h-8 text-label" data-testid="tab-board-sections">
            {BOARD_SECTIONS.map((value) => (
              <option key={value} value={value}>
                {BOARD_SECTIONS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// v1.76.0 (D-401, spec §3.5 / §4.3): Customise ▸ Rules: the auto-promotion
// presets for My sections. They run every night at midnight (India time),
// from any section, once per due day, and at once when saved.
export function CustomiseButton({ rules }: { rules: MyRules }) {
  const { call, pending } = useWorkCall();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(rules);
  return (
    <>
      <button type="button" className="btn-secondary btn-compact" onClick={() => { setValue(rules); setOpen(true); }} data-testid="my-customise">
        <Settings2 aria-hidden="true" className="h-4 w-4" /> Customise
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Customise Task Summary"
        description="Rules move tasks between your own sections (group a tab by My sections to see them)."
        variant="drawer"
        testId="my-customise-panel"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              aria-busy={pending || undefined}
              data-testid="my-rules-save"
              onClick={() => void call(() => myRulesAction(value)).then((result) => result?.ok && setOpen(false))}
            >
              Save rules
            </button>
          </>
        }
      >
        <section aria-labelledby="my-rules-head" className="space-y-3">
          <h3 id="my-rules-head" className="flex items-center gap-2 font-semibold">
            <Zap aria-hidden="true" className="h-4 w-4 text-primary-700" /> Rules
          </h3>
          <p className="text-caption text-ink-muted">Every night at midnight, from any of your sections, once for each due date. You can move a task back and it stays.</p>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-label">
            <input type="checkbox" checked={value.todayOn} onChange={(event) => setValue({ ...value, todayOn: event.target.checked })} data-testid="rule-today" className="mt-0.5" />
            <span>
              Move to <strong>Today</strong> when the task is due today
            </span>
          </label>
          <div className="rounded-lg border border-line p-3 text-label">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={value.upcomingOn} onChange={(event) => setValue({ ...value, upcomingOn: event.target.checked })} data-testid="rule-upcoming" className="mt-0.5" />
              <span>
                Move to <strong>Upcoming</strong> when the task is due within the next few working days
              </span>
            </label>
            <label className="ml-6 mt-2 flex items-center gap-2">
              <span className="text-ink-muted">Working days</span>
              <input
                type="number"
                min={1}
                max={MAX_UPCOMING_DAYS}
                value={value.upcomingDays}
                disabled={!value.upcomingOn}
                onChange={(event) => setValue({ ...value, upcomingDays: Math.max(1, Math.min(MAX_UPCOMING_DAYS, Math.round(Number(event.target.value) || 1))) })}
                className="field-input h-8 w-20 text-label"
                data-testid="rule-upcoming-days"
              />
            </label>
            <p className="ml-6 mt-1 text-caption text-ink-muted">Weekly offs and holidays don&apos;t count.</p>
          </div>
        </section>
      </Dialog>
    </>
  );
}

// v1.76.0 (D-401, spec §3.16): in the task's details, the assignee picks the
// task's section in their own Task Summary (only they see it).
export function MySectionPicker({ taskId, sections, current }: { taskId: number; sections: MySectionRow[]; current: number | null }) {
  const { call, pending } = useWorkCall();
  const [value, setValue] = useState(current ?? sections.find((section) => section.system === "RECENT")?.id ?? 0);
  const choices = sections.filter((section) => section.system !== "OVERDUE");
  return (
    <div>
      <dt className="text-caption text-ink-muted">
        <label htmlFor={`my-section-${taskId}`}>Task Summary section</label>
      </dt>
      <dd>
        <select
          id={`my-section-${taskId}`}
          value={value}
          disabled={pending}
          onChange={(event) => {
            const next = Number(event.target.value);
            setValue(next);
            void call(() => myPlaceAction(taskId, next, Date.now() / 1000), { success: "Moved. Only you see your sections." });
          }}
          className="field-input mt-1 h-8 text-label"
          data-testid="my-section-picker"
        >
          {choices.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}
