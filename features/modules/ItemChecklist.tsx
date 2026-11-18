"use client";

import { useState, useTransition } from "react";
import { setItemProvidedAction } from "@/app/users/records/item-actions";
import type { Checklist } from "@/server/records/item-checks";

// v1.57.0 (D-335, owner: "line items with tick boxes to convey whether that
// point is completed or not ... so that the admin can confirm what are all
// provided"). Each item with the quantity asked for and a Provided tick; the
// people handling the record tick, everyone else sees the ticks.
export function ItemChecklist({ entityType, entityId, lists, canTick }: { entityType: "REQUEST" | "TICKET"; entityId: number; lists: Checklist[]; canTick: boolean }) {
  const [state, setState] = useState(lists);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (fieldKey: string, lineNo: number, provided: boolean) => {
    setMessage(null);
    const before = state;
    setState((current) => current.map((list) => (list.fieldKey !== fieldKey ? list : { ...list, lines: list.lines.map((line) => (line.lineNo === lineNo ? { ...line, provided } : line)) })));
    start(async () => {
      const result = await setItemProvidedAction({ entityType, entityId, fieldKey, lineNo, provided });
      if (!result.ok) {
        setState(before);
        setMessage(result.message);
        return;
      }
      setState((current) => current.map((list) => (list.fieldKey !== fieldKey ? list : { ...list, lines: list.lines.map((line) => (line.lineNo === lineNo ? { ...line, checkedBy: result.checkedBy, checkedAt: result.checkedAt } : line)) })));
    });
  };
  return (
    <div className="space-y-4" data-testid="item-checklists">
      {state.map((list) => {
        const done = list.lines.filter((line) => line.provided).length;
        return (
          <section key={list.fieldKey} aria-label={list.label} className="rounded-md border border-line" data-testid={`item-checklist-${list.fieldKey}`}>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <h3 className="text-label font-semibold">{list.label}</h3>
              <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${done === list.lines.length ? "bg-success-50 text-success-600" : "bg-surface-muted text-ink-muted"}`} data-testid="item-progress">
                {done} of {list.lines.length} provided
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-label">
                <caption className="sr-only">{list.label}: items and whether each was provided</caption>
                <thead className="text-left text-caption uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Item
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Qty
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Provided
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.lines.map((line) => (
                    <tr key={line.lineNo}>
                      <td className="px-3 py-2 tabular-nums text-ink-muted">{line.lineNo + 1}</td>
                      <td className={`px-3 py-2 ${line.provided ? "text-ink-muted line-through" : ""}`}>{line.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={line.provided}
                            disabled={!canTick || pending}
                            onChange={(event) => toggle(list.fieldKey, line.lineNo, event.target.checked)}
                            aria-label={`${line.description}: provided`}
                            className="h-4 w-4"
                          />
                          <span className="text-caption text-ink-muted">
                            {line.provided ? (line.checkedBy ? `${line.checkedBy}, ${line.checkedAt}` : "Provided") : line.checkedBy ? `Unticked by ${line.checkedBy}` : canTick ? "Tick when provided" : "Not yet"}
                          </span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {message && (
        <p role="alert" className="text-label text-danger-600">
          {message}
        </p>
      )}
    </div>
  );
}
