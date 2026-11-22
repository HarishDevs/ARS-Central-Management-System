"use client";

import { Lock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { dependencyTargetsAction, typedDependencyAction } from "@/app/users/work/schedule-actions";
import { usePaneLink, useWorkCall } from "@/features/work/client";
import { DEP_TYPE_HELP, DEP_TYPE_LABEL, DEP_TYPES, isDepType, linkBlocks, type DepType } from "@/server/work/schedule";

// v1.65.0 (D-373, spec PV §16.2): the task's dependencies in the pane and on
// the task page: "Blocked by" and "Blocking" lists with each link's type
// (changeable), lag (0, read-only for now) and the other task's due date; and
// "Add dependency": a Blocked by / Blocking toggle, a search across every
// project the person can see (name and project), and a type picker.
export interface DependencyView {
  id: number;
  taskNo: string;
  title: string;
  status: string;
  type?: string;
  lag?: number;
  dueAt?: string | null;
}
type Found = { id: number; taskNo: string; title: string; projectName: string | null; dueAt: string | null; status: string };
const OPEN = ["OPEN", "IN_PROGRESS", "BLOCKED"];
const dueText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "");
const typeOf = (item: DependencyView): DepType => (isDepType(item.type) ? item.type : "FS");

export function DependencyEditor({ taskId, title, blockedBy, blocking, canChange }: { taskId: number; title: string; blockedBy: DependencyView[]; blocking: DependencyView[]; canChange: boolean }) {
  const { call, pending } = useWorkCall();
  const paneLink = usePaneLink();
  const [role, setRole] = useState<"BLOCKED_BY" | "BLOCKING">("BLOCKED_BY");
  const [type, setType] = useState<DepType>("FS");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void dependencyTargetsAction(text, taskId).then((answer) => {
        if (!live) return;
        setFound(answer.ok ? (answer.value ?? []) : []);
        setActive(-1);
        setOpen(true);
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, taskId]);
  const choose = (item: Found) => {
    setOpen(false);
    setQuery("");
    setFound([]);
    void call(() => typedDependencyAction(taskId, item.id, role, type, true)).then(() => input.current?.focus());
  };
  const row = (item: DependencyView, side: "BLOCKED_BY" | "BLOCKING") => {
    const linkType = typeOf(item);
    const holding = side === "BLOCKED_BY" && linkBlocks(linkType, item.status);
    return (
      <li key={`${side}-${item.id}`} className="flex flex-wrap items-center gap-2" data-testid="dependency-row">
        {holding ? <Lock aria-label="Still holding this task back" className="h-3.5 w-3.5 text-warning-600" /> : OPEN.includes(item.status) ? <span className="w-3.5" /> : <span aria-label="Done">✓</span>}
        <Link href={paneLink(item.id)} className="link font-mono text-caption">
          {item.taskNo}
        </Link>
        <span className={`min-w-0 flex-1 truncate ${OPEN.includes(item.status) ? "" : "text-ink-muted line-through"}`}>{item.title}</span>
        {item.dueAt && <span className="text-caption text-ink-muted">due {dueText(item.dueAt)}</span>}
        {canChange ? (
          <select
            aria-label={`Type of the link with ${item.taskNo}`}
            className="field-input h-7 w-auto py-0 text-caption"
            value={linkType}
            disabled={pending}
            onChange={(event) => void call(() => typedDependencyAction(taskId, item.id, side, event.target.value, true))}
          >
            {DEP_TYPES.map((value) => (
              <option key={value} value={value}>
                {value} · {DEP_TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded bg-surface-muted px-1.5 text-caption" title={DEP_TYPE_LABEL[linkType]}>
            {linkType}
          </span>
        )}
        <span className="text-caption text-ink-muted" title="Lag can't be changed yet">
          lag {item.lag ?? 0} d
        </span>
        {canChange && (
          <button type="button" aria-label={`Remove the link with ${item.taskNo}`} disabled={pending} onClick={() => void call(() => typedDependencyAction(taskId, item.id, side, linkType, false))} className="rounded p-1 text-ink-faint hover:text-danger-600">
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-3" data-testid="dependency-editor">
      <div>
        <h3 className="text-label font-semibold">Blocked by</h3>
        {blockedBy.length === 0 ? <p className="text-label text-ink-muted">Nothing: it can start any time.</p> : <ul className="mt-1 space-y-1 text-label">{blockedBy.map((item) => row(item, "BLOCKED_BY"))}</ul>}
      </div>
      <div>
        <h3 className="text-label font-semibold">Blocking</h3>
        {blocking.length === 0 ? <p className="text-label text-ink-muted">No task waits for this one.</p> : <ul className="mt-1 space-y-1 text-label">{blocking.map((item) => row(item, "BLOCKING"))}</ul>}
      </div>
      {canChange && (
        <div className="space-y-2 rounded-md border border-line p-2">
          <p className="text-label font-semibold">Add dependency</p>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="This task is" className="flex overflow-hidden rounded-md border border-line text-label">
              {(["BLOCKED_BY", "BLOCKING"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`px-2 py-1 ${role === value ? "bg-primary-solid text-on-solid" : "hover:bg-surface-muted"}`}>
                  {value === "BLOCKED_BY" ? "Blocked by" : "Blocking"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-label">
              <span>Type</span>
              <select className="field-input h-8 w-auto py-0" value={type} onChange={(event) => setType(event.target.value as DepType)} data-testid="dependency-type">
                {DEP_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {DEP_TYPE_LABEL[value]} ({value})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-caption text-ink-muted">
            {role === "BLOCKED_BY" ? `"${title}"` : "The other task"}: {DEP_TYPE_HELP[type].charAt(0).toLowerCase() + DEP_TYPE_HELP[type].slice(1)}
          </p>
          <div className="relative">
            <input
              ref={input}
              role="combobox"
              aria-expanded={open && found.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-label={role === "BLOCKED_BY" ? "Find the task it waits for" : "Find the task that waits for it"}
              placeholder="Find a task by name or number"
              className="field-input"
              value={query}
              disabled={pending}
              data-testid="dependency-search"
              onChange={(event) => setQuery(event.target.value)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setActive((index) => Math.min(found.length - 1, index + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(0, index - 1));
                } else if (event.key === "Enter" && open && found[active >= 0 ? active : 0]) {
                  event.preventDefault();
                  choose(found[active >= 0 ? active : 0]!);
                } else if (event.key === "Escape" && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
            />
            {open && query.trim().length >= 2 && (
              <ul id={listId} role="listbox" aria-label="Tasks" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg">
                {found.length === 0 && (
                  <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-1.5 text-label text-ink-muted">
                    No task found that you can see.
                  </li>
                )}
                {found.map((item, index) => (
                  <li
                    key={item.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`cursor-pointer px-3 py-1.5 text-label ${index === active ? "bg-surface-muted" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                    data-testid="dependency-option"
                  >
                    <span className="block truncate">{item.title}</span>
                    <span className="block truncate text-caption text-ink-muted">
                      {item.taskNo}
                      {item.projectName ? ` · ${item.projectName}` : ""}
                      {item.dueAt ? ` · due ${dueText(item.dueAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
