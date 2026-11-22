"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Diamond, ListPlus, Plus, Search, SquareCheck, X } from "lucide-react";
import { useState } from "react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { CREATE_TASK_EVENT, type CreateTaskDetail } from "@/features/work/client";

// v1.72.0 (D-387, spec PM §3.8, COMPONENT_SPECS §2 "Toolbar"): the parts every
// project view's toolbar shares, in the spec's shape.

const create = (detail: CreateTaskDetail) => window.dispatchEvent(new CustomEvent<CreateTaskDetail>(CREATE_TASK_EVENT, { detail }));

// `[＋ Add task │▾]`: the button opens the Create task dialog for the project;
// the ▾ menu offers Task · Milestone · Section (the spec's Approval is left out, D-001).
// v1.76.0 (D-401): Task Summary offers ▾ with Section too (only when grouped
// by My sections; otherwise it is listed, disabled, with `sectionOff` saying why).
export function AddTaskSplit({ projectId, onSection, milestone = true, sectionOff }: { projectId: number | null; onSection?: () => void; milestone?: boolean; sectionOff?: string }) {
  const items: MenuItem[] = [
    { label: "Task", icon: <SquareCheck className="h-4 w-4" />, hint: "The default", onSelect: () => create({ projectId }) },
    ...(milestone && projectId ? [{ label: "Milestone", icon: <Diamond className="h-4 w-4" />, onSelect: () => create({ projectId, milestone: true }), testId: "add-milestone" }] : []),
    ...(onSection ? [{ label: "Section", icon: <ListPlus className="h-4 w-4" />, onSelect: onSection, testId: "add-section-menu" }] : sectionOff ? [{ label: "Section", icon: <ListPlus className="h-4 w-4" />, disabled: true, hint: sectionOff, testId: "add-section-menu" }] : []),
  ];
  const split = Boolean(projectId) || Boolean(onSection) || Boolean(sectionOff);
  return (
    <span className="inline-flex" data-testid="add-task-split">
      <button type="button" onClick={() => create({ projectId })} className={split ? "tb-split rounded-l-md" : "tb-split rounded-md"}>
        <Plus aria-hidden="true" className="h-4 w-4" /> Add task
      </button>
      {split ? <Menu label="More ways to add" trigger={<ChevronDown aria-hidden="true" className="h-4 w-4" />} buttonClass="tb-split rounded-r-md border-l-0 px-1.5" align="left" menuClass="w-56" items={items} testId="add-task-more" /> : null}
    </span>
  );
}

// The Sort menu (spec PM §3.8.2): one radio list in the spec's order, then
// the direction, then Clear sort. `current` is the chosen entry's key.
// v1.76.0 (D-401, spec §3.8): `chip` shows the count ("Sorts: 1") like Filters
// and Groups; the sort's name moves to the tooltip.
export function SortMenu({ entries, current, dir, onPick, onDir, onClear, label = "Sort", chip = false }: { entries: { key: string; label: string; heading?: boolean }[]; current: string | null; dir: "asc" | "desc"; onPick: (key: string) => void; onDir: (dir: "asc" | "desc") => void; onClear: () => void; label?: string; chip?: boolean }) {
  const chosen = entries.find((entry) => entry.key === current && !entry.heading);
  // The first entry is "no sort" (None / manual order).
  const sorting = Boolean(chosen && chosen.key !== entries[0]?.key);
  const items: MenuItem[] = [
    ...entries.map((entry): MenuItem => (entry.heading ? { kind: "heading", label: entry.label } : { kind: "radio", label: entry.label, checked: entry.key === current, onSelect: () => onPick(entry.key), testId: `sort-${entry.key}` })),
    ...(sorting
      ? [
          { kind: "separator" as const, label: "" },
          { kind: "heading" as const, label: "Order" },
          { kind: "radio" as const, label: "Ascending", icon: <ArrowUp className="h-3.5 w-3.5" />, checked: dir === "asc", onSelect: () => onDir("asc"), testId: "sort-asc" },
          { kind: "radio" as const, label: "Descending", icon: <ArrowDown className="h-3.5 w-3.5" />, checked: dir === "desc", onSelect: () => onDir("desc"), testId: "sort-desc" },
          { kind: "separator" as const, label: "" },
          { label: "Clear sort", icon: <X className="h-4 w-4" />, onSelect: onClear, testId: "sort-clear" },
        ]
      : []),
  ];
  return (
    <span className={sorting ? "tb-pill" : "inline-flex items-center"}>
      <Menu
        label={label}
        title={sorting ? `Sorted by ${chosen!.label}${dir === "desc" ? " (descending)" : ""}` : "Sort"}
        trigger={
          <>
            <ArrowUpDown aria-hidden="true" className="h-4 w-4" /> {sorting ? (chip ? "Sorts: 1" : `Sort: ${chosen!.label}${dir === "desc" ? " (descending)" : ""}`) : "Sort"}
          </>
        }
        buttonClass="tb-btn"
        menuClass="w-60"
        items={items}
        testId="sort-menu"
      />
      {sorting && (
        <button type="button" aria-label="Clear sort" onClick={onClear} className="tb-x">
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// "Search this view": an icon that opens a search box (spec S-06 toolbar).
export function ViewSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(Boolean(value));
  return open || value ? (
    <input autoFocus={!value} type="search" aria-label="Search this view" placeholder="Search this view" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => !value && setOpen(false)} className="field-input h-7 w-48 text-label" />
  ) : (
    <button type="button" aria-label="Search this view" title="Search this view" onClick={() => setOpen(true)} className="tb-btn">
      <Search aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

// The ▾ menu's "Section" asks the view's "Add section" control to open.
export const ADD_SECTION_EVENT = "ars:add-section";
