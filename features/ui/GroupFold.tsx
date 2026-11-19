"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

// v1.57.4 (D-342, owner: "make all the Group by as a collapsible sections"):
// a group's heading folds its rows away and opens them again, in a table
// (FoldTbody) or a list (FoldListGroup). Rows are rendered by the server and
// passed in as children; folding only hides them.
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
  const [open, setOpen] = useState(true);
  // One tbody: the heading row stays, the rows after it hide when folded.
  return (
    <tbody data-testid={testId} data-folded={open ? undefined : "1"} aria-label={typeof label === "string" ? `${label}: ${count}` : undefined} className={open ? "" : "[&>tr:not(:first-child)]:hidden"}>
      <tr className="bg-surface-muted">
        <th scope="rowgroup" colSpan={colSpan} className={`text-left text-label ${headClass}`}>
          <Toggle open={open} onToggle={() => setOpen((value) => !value)} label={label} count={count} hint={hint} />
        </th>
      </tr>
      {children}
    </tbody>
  );
}

export function FoldListGroup({ label, count, children }: { label: React.ReactNode; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <li className="bg-surface-muted px-4 py-1.5 text-label">
        <Toggle open={open} onToggle={() => setOpen((value) => !value)} label={label} count={count} />
      </li>
      <li hidden={!open} className="p-0">
        <ul className="divide-y divide-line">{children}</ul>
      </li>
    </>
  );
}
