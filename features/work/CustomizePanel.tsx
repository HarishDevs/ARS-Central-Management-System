"use client";

import { ChevronRight, FormInput, ListChecks, Plus, Settings2, SlidersHorizontal, X, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { openFieldDialog } from "@/features/work/FieldControls";

// v1.72.0 (D-387, spec PROJECTS_CUSTOMIZATION §1): the header's Customize
// button opens a panel on the right (about 360 px) that sits beside the view:
// "This project", an Add menu (field, form, automation), then the project's
// workflow features with their counts (shown when more than 0): Automations,
// Fields, Forms, and the project's settings. Each row goes to its part of
// the project's settings page. A non-modal dialog: Escape or ✕ closes it and
// focus goes back to the Customize button.
export interface CustomizeCounts {
  fields: number | null; // null: the feature is off for this person
  forms: number | null;
  automations: number | null;
}

export function CustomizeButton({ base, counts, fieldDialog }: { base: string; counts: CustomizeCounts; fieldDialog: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const settings = `${base}/settings`;
  const add: MenuItem[] = [
    ...(counts.fields !== null ? [{ label: "Field", icon: <ListChecks className="h-4 w-4" />, ...(fieldDialog ? { onSelect: () => openFieldDialog({}) } : { href: `${settings}#fields` }) }] : []),
    ...(counts.forms !== null ? [{ label: "Form", icon: <FormInput className="h-4 w-4" />, href: `${settings}#forms` }] : []),
    ...(counts.automations !== null ? [{ label: "Automation", icon: <Zap className="h-4 w-4" />, href: `${settings}#automations` }] : []),
  ];
  const rows: { label: string; count: number | null; href: string; icon: React.ReactNode; group: "AI" | "Workflow" | "Project" }[] = [
    ...(counts.automations !== null ? [{ label: "Automations", count: counts.automations, href: `${settings}#automations`, icon: <Zap className="h-4 w-4" />, group: "AI" as const }] : []),
    ...(counts.fields !== null ? [{ label: "Fields", count: counts.fields, href: `${settings}#fields`, icon: <ListChecks className="h-4 w-4" />, group: "Workflow" as const }] : []),
    ...(counts.forms !== null ? [{ label: "Forms", count: counts.forms, href: `${settings}#forms`, icon: <FormInput className="h-4 w-4" />, group: "Workflow" as const }] : []),
    { label: "Project settings", count: null, href: `${settings}#details`, icon: <SlidersHorizontal className="h-4 w-4" />, group: "Project" },
  ];
  const groupName = { AI: "Rules", Workflow: "Workflow features", Project: "Settings" } as const;
  return (
    <>
      <button ref={button} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)} className="btn-secondary btn-compact inline-flex items-center gap-1" data-testid="customize">
        <Settings2 aria-hidden="true" className="h-4 w-4" /> Customize
      </button>
      {open && (
        <aside ref={panel} role="dialog" aria-modal="false" data-own-escape aria-labelledby={titleId} className="drawer-in fixed bottom-0 right-0 top-topbar z-drawer flex w-full max-w-[360px] flex-col border-l border-line bg-raised text-ink shadow-overlay" data-testid="customize-panel">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 id={titleId} className="flex-1 font-semibold">
              Customize
            </h2>
            <button type="button" aria-label="Close Customize" onClick={close} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            <div>
              <p className="font-semibold">This project</p>
              <p className="text-caption text-ink-muted">View and change its features.</p>
            </div>
            {add.length > 0 && (
              <Menu
                label="Add to this project"
                trigger={
                  <span className="inline-flex items-center gap-1">
                    <Plus aria-hidden="true" className="h-4 w-4" /> Add
                  </span>
                }
                buttonClass="btn-secondary btn-compact"
                align="left"
                testId="customize-add"
                items={add}
              />
            )}
            {(["AI", "Workflow", "Project"] as const).map((group) => {
              const list = rows.filter((row) => row.group === group);
              if (!list.length) return null;
              return (
                <section key={group} aria-label={groupName[group]}>
                  <h3 className="mb-1 text-caption font-semibold text-ink-faint">{groupName[group]}</h3>
                  <ul className="space-y-0.5">
                    {list.map((row) => (
                      <li key={row.label}>
                        <Link href={row.href} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-2 text-label hover:bg-surface-muted" data-testid={`customize-${row.label.toLowerCase().replace(/\s+/g, "-")}`}>
                          <span aria-hidden="true" className="text-ink-muted">
                            {row.icon}
                          </span>
                          <span className="flex-1">{row.label}</span>
                          {row.count ? <span className="text-caption tabular-nums text-ink-muted">{row.count}</span> : null}
                          <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-faint" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}
