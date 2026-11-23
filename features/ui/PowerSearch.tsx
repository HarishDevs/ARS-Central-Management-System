"use client";

import Link from "next/link";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

// v1.85.0 (D-412, owner's Admin redesign): the power search over a table.
// Each filter in use is a chip: field, operator, value ("Status is Approved",
// "Submitted on or after 1 Nov 2026", "Title contains invoice"), with its ×.
// "Add filter" asks for a field, an operator and a value. Every choice is a
// plain query parameter in the address (bookmarks, Back, saved views and the
// CSV download keep it), and each operator maps to one parameter the page
// already reads, so no new kind of query reaches the server. On a phone the
// chooser opens as a bottom sheet. After the Astryx table-filter template
// (MIT, structure only).
export interface PowerOperator {
  label: string; // "is", "on or after", "contains"
  param: string; // the query parameter it sets
}
export interface PowerField {
  key: string;
  label: string;
  input: "choice" | "text" | "date" | "flag";
  operators: PowerOperator[];
  options?: (readonly [string, string])[]; // value, label (choice)
}

export function powerChips(fields: readonly PowerField[], params: Record<string, string | undefined>): { field: PowerField; operator: PowerOperator; value: string; text: string }[] {
  const out: { field: PowerField; operator: PowerOperator; value: string; text: string }[] = [];
  for (const field of fields) {
    for (const operator of field.operators) {
      const value = params[operator.param];
      if (!value) continue;
      const shown = field.input === "choice" ? (field.options?.find(([option]) => option === value)?.[1] ?? value) : field.input === "flag" ? "yes" : value;
      out.push({ field, operator, value, text: `${field.label} ${operator.label} ${shown}` });
    }
  }
  return out;
}

export { powerHref } from "@/features/ui/power-href";
import { powerHref } from "@/features/ui/power-href";

export function PowerSearch({ base, fields, params, label = "Filters" }: { base: string; fields: PowerField[]; params: Record<string, string | undefined>; label?: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? "");
  const field = fields.find((item) => item.key === fieldKey) ?? fields[0];
  const [operatorParam, setOperatorParam] = useState(field?.operators[0]?.param ?? "");
  const [value, setValue] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const chips = useMemo(() => powerChips(fields, params), [fields, params]);

  useEffect(() => {
    setOperatorParam(field?.operators[0]?.param ?? "");
    setValue(field?.input === "flag" ? "1" : "");
  }, [field]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("select, input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!field || !operatorParam || !value) return;
    setOpen(false);
    router.push(powerHref(base, params, { [operatorParam]: value }));
  };

  return (
    <div className="relative mb-3" data-testid="power-search">
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-ink-faint" />
        {chips.length === 0 && <span className="text-label text-ink-muted">No filters</span>}
        {chips.map((chip) => (
          <span key={chip.operator.param} className="inline-flex items-center gap-1 rounded-full border border-primary-600/40 bg-primary-50 py-0.5 pl-3 pr-1 text-label text-primary-700" data-testid="power-chip">
            <span>
              {chip.field.label} <span className="text-ink-muted">{chip.operator.label}</span> <strong>{chip.field.input === "choice" ? (chip.field.options?.find(([option]) => option === chip.value)?.[1] ?? chip.value) : chip.field.input === "flag" ? "yes" : chip.value}</strong>
            </span>
            <Link href={powerHref(base, params, { [chip.operator.param]: null })} aria-label={`Remove filter: ${chip.text}`} className="grid h-6 w-6 place-items-center rounded-full hover:bg-primary-600/10">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </span>
        ))}
        <button ref={opener} type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls={`${id}-panel`} className="btn-ghost btn-compact inline-flex items-center gap-1" data-testid="power-add">
          <Plus aria-hidden="true" className="h-4 w-4" /> Add filter
        </button>
        {chips.length > 1 && (
          <Link href={powerHref(base, params, Object.fromEntries(chips.map((chip) => [chip.operator.param, null])))} className="link text-label">
            Clear all
          </Link>
        )}
      </div>
      {open && (
        <>
          {/* Phones: the chooser is a bottom sheet over a dimmed page. */}
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-drawer bg-overlay sm:hidden" />
          <div
            ref={panel}
            id={`${id}-panel`}
            role="dialog"
            aria-label="Add a filter"
            className="fixed inset-x-0 bottom-0 z-drawer rounded-t-xl border border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-overlay sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:z-popover sm:mt-1 sm:w-[26rem] sm:rounded-md sm:pb-4"
            data-testid="power-panel"
          >
            <form onSubmit={apply} className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor={`${id}-field`} className="field-label">
                  Field
                </label>
                <select id={`${id}-field`} value={field?.key ?? ""} onChange={(event) => setFieldKey(event.target.value)} className="field-input field-compact">
                  {fields.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-op`} className="field-label">
                  Operator
                </label>
                <select id={`${id}-op`} value={operatorParam} onChange={(event) => setOperatorParam(event.target.value)} className="field-input field-compact">
                  {(field?.operators ?? []).map((operator) => (
                    <option key={operator.param} value={operator.param}>
                      {operator.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-value`} className="field-label">
                  Value
                </label>
                {field?.input === "choice" ? (
                  <select id={`${id}-value`} value={value} onChange={(event) => setValue(event.target.value)} className="field-input field-compact" required>
                    <option value="">Choose…</option>
                    {(field.options ?? []).map(([option, optionLabel]) => (
                      <option key={option} value={option}>
                        {optionLabel}
                      </option>
                    ))}
                  </select>
                ) : field?.input === "flag" ? (
                  <select id={`${id}-value`} value={value} onChange={(event) => setValue(event.target.value)} className="field-input field-compact">
                    <option value="1">Yes</option>
                  </select>
                ) : (
                  <input id={`${id}-value`} type={field?.input === "date" ? "date" : "search"} value={value} onChange={(event) => setValue(event.target.value)} className="field-input field-compact" required maxLength={100} />
                )}
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <button type="submit" className="btn-primary btn-compact" data-testid="power-apply">
                  Apply
                </button>
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-compact">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
