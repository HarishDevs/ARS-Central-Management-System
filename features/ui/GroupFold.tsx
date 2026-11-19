"use client";

import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";

// v1.57.4 (D-342, owner: "make all the Group by as a collapsible sections"):
// a group's heading folds its rows away and opens them again, in a table
// (FoldTbody) or a list (FoldListGroup). Rows are rendered by the server and
// passed in as children; folding only hides them.
// v1.58.0 (D-352, owner: "expand or collapse individually and all option for all
// the tables group by and by default when a group by is selected it should
// collapse all the group"): groups start folded; FoldScope adds Expand all /
// Collapse all for the groups inside it. Each group can still be opened alone.
type Signal = { open: boolean; n: number };
const FoldContext = createContext<Signal | null>(null);

export function FoldScope({ children, enabled = true, defaultOpen = false, testId = "fold-all" }: { children: React.ReactNode; enabled?: boolean; defaultOpen?: boolean; testId?: string }) {
  const [signal, setSignal] = useState<Signal>({ open: defaultOpen, n: 0 });
  if (!enabled) return <>{children}</>;
  return (
    <FoldContext.Provider value={signal}>
      <FoldAllButtons onAll={(open) => setSignal((current) => ({ open, n: current.n + 1 }))} testId={testId} />
      {children}
    </FoldContext.Provider>
  );
}

// Expand all / Collapse all, for lists whose groups are drawn by their own component.
export function FoldAllButtons({ onAll, testId = "fold-all" }: { onAll: (open: boolean) => void; testId?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-label" role="group" aria-label="Groups" data-testid={testId}>
      <button type="button" onClick={() => onAll(true)} className="btn-ghost btn-compact inline-flex items-center gap-1.5">
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4" /> Expand all
      </button>
      <button type="button" onClick={() => onAll(false)} className="btn-ghost btn-compact inline-flex items-center gap-1.5">
        <ChevronsDownUp aria-hidden="true" className="h-4 w-4" /> Collapse all
      </button>
    </div>
  );
}

// A group's own open state: starts as the scope says (folded by default) and
// follows Expand all / Collapse all; the heading toggles just this group.
function useGroupOpen(): [boolean, () => void] {
  const signal = useContext(FoldContext);
  const [open, setOpen] = useState(signal?.open ?? false);
  useEffect(() => {
    if (signal) setOpen(signal.open);
  }, [signal]);
  return [open, () => setOpen((value) => !value)];
}

function Toggle({ open, onToggle, label, count, hint }: { open: boolean; onToggle: () => void; label: React.ReactNode; count: number; hint?: React.ReactNode }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex max-w-full items-center gap-1.5 text-left font-semibold hover:text-primary-700" data-testid="group-fold">
      {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
      <span>{label}</span> <span className="rounded-full bg-surface px-2 text-caption font-normal tabular-nums text-ink-muted">{count}</span>
      {hint && <span className="ml-1 text-caption font-normal text-ink-muted">{hint}</span>}
    </button>
  );
}

export function FoldTbody({ label, count, colSpan, hint, headClass = "", children, testId }: { label: React.ReactNode; count: number; colSpan: number; hint?: React.ReactNode; headClass?: string; children: React.ReactNode; testId?: string }) {
  const [open, toggle] = useGroupOpen();
  // One tbody: the heading row stays, the rows after it hide when folded.
  return (
    <tbody data-testid={testId} data-folded={open ? undefined : "1"} aria-label={typeof label === "string" ? `${label}: ${count}` : undefined} className={open ? "" : "[&>tr:not(:first-child)]:hidden"}>
      <tr className="bg-surface-muted">
        <th scope="rowgroup" colSpan={colSpan} className={`text-left text-label ${headClass}`}>
          <Toggle open={open} onToggle={toggle} label={label} count={count} hint={hint} />
        </th>
      </tr>
      {children}
    </tbody>
  );
}

export function FoldListGroup({ label, count, children }: { label: React.ReactNode; count: number; children: React.ReactNode }) {
  const [open, toggle] = useGroupOpen();
  return (
    <>
      <li className="bg-surface-muted px-4 py-1.5 text-label">
        <Toggle open={open} onToggle={toggle} label={label} count={count} />
      </li>
      <li hidden={!open} className="p-0">
        <ul className="divide-y divide-line">{children}</ul>
      </li>
    </>
  );
}
