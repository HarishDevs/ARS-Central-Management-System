"use client";

import { ArrowDown, ArrowUp, Check, GripVertical, LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { homeLayoutAction } from "@/app/users/home-actions";
import { Drop } from "@/features/ui/Drop";
import { useToast } from "@/features/ui/Toast";
import { addWidget, moveWidget, placeWidget, removeWidget, resizeWidget, widgetEntry, type WidgetItem, type WidgetKind, type WidgetSize } from "@/server/home/widgets";

// v1.63.0 (D-369, PM-A12, spec HOME_MODULE §3.15, §5.2): the person's Home
// widgets. "Customise" shows each widget's controls: a handle to drag it, or
// (keyboard) focus the handle and press Space to pick it up, ↑ / ↓ to move,
// Space or Enter to drop, Escape to cancel; Alt + ↑ / ↓ moves at once; Move
// up / down buttons; Half or Full width; Remove; and "Add widget". Every step
// is announced. Each change is saved for this person straight away.
export interface BoardWidget {
  kind: WidgetKind;
  size: WidgetSize;
  node: React.ReactNode; // drawn on the server
}

export function HomeWidgets({ widgets, version, addable, extra }: { widgets: BoardWidget[]; version: number; addable: { kind: WidgetKind; title: string; description: string }[]; extra?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<WidgetItem[]>(widgets.map(({ kind, size }) => ({ kind, size })));
  const [at, setAt] = useState(version);
  const [lifted, setLifted] = useState<{ kind: WidgetKind; origin: WidgetItem[] } | null>(null);
  const [dragging, setDragging] = useState<WidgetKind | null>(null);
  const [live, setLive] = useState("");
  const serverKey = `${version}:${widgets.map((item) => `${item.kind}.${item.size}`).join()}`;
  useEffect(() => {
    setLayout(widgets.map(({ kind, size }) => ({ kind, size })));
    setAt(version);
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = new Map(widgets.map((item) => [item.kind, item.node]));
  const title = (kind: WidgetKind) => widgetEntry(kind).title;
  const focusHandle = (kind: WidgetKind) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-handle="${kind}"]`)?.focus());

  const save = (next: WidgetItem[], message: string, options: { refresh?: boolean; before?: WidgetItem[] } = {}) => {
    const before = options.before ?? layout;
    setLayout(next);
    setLive(message);
    start(async () => {
      const result = await homeLayoutAction({ widgets: next, version: at });
      if (result.ok && result.version !== undefined) {
        setAt(result.version);
        if (options.refresh) router.refresh();
        return;
      }
      setLayout(before);
      toast({ tone: "error", title: result.message });
      if (result.conflict) router.refresh();
    });
  };
  const position = (list: WidgetItem[], kind: WidgetKind) => `position ${list.findIndex((item) => item.kind === kind) + 1} of ${list.length}`;
  const move = (kind: WidgetKind, delta: number) => {
    const next = moveWidget(layout, kind, delta);
    if (next.map((item) => item.kind).join() === layout.map((item) => item.kind).join()) return;
    save(next, `${title(kind)} moved to ${position(next, kind)}.`);
    focusHandle(kind);
  };
  const onHandleKey = (event: React.KeyboardEvent, kind: WidgetKind) => {
    const key = event.key;
    if (lifted?.kind === kind) {
      if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        const next = moveWidget(layout, kind, key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1);
        setLayout(next);
        setLive(`${title(kind)}, ${position(next, kind)}.`);
        focusHandle(kind);
      } else if (key === " " || key === "Enter") {
        event.preventDefault();
        setLifted(null);
        if (layout.map((item) => item.kind).join() === lifted.origin.map((item) => item.kind).join()) setLive(`${title(kind)} dropped where it was.`);
        else save(layout, `${title(kind)} dropped at ${position(layout, kind)}.`, { before: lifted.origin });
        focusHandle(kind);
      } else if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setLayout(lifted.origin);
        setLifted(null);
        setLive(`Move cancelled. ${title(kind)} is back at ${position(lifted.origin, kind)}.`);
        focusHandle(kind);
      }
      return;
    }
    if (event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      move(kind, key === "ArrowUp" ? -1 : 1);
    } else if (key === " " || key === "Enter") {
      event.preventDefault();
      setLifted({ kind, origin: layout });
      setLive(`Picked up ${title(kind)}, ${position(layout, kind)}. Use the arrow keys to move it, Space or Enter to drop it, Escape to cancel.`);
    }
  };

  return (
    <div data-testid="home-widgets" data-editing={editing ? "on" : undefined}>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2" role="toolbar" aria-label="Home widgets">
        {editing && (
          <>
            {addable.length > 0 && (
              <Drop
                label="Add widget"
                icon={
                  <span className="inline-flex items-center gap-1.5">
                    <Plus aria-hidden="true" className="h-4 w-4" /> Add widget
                  </span>
                }
                buttonClass="btn-secondary btn-compact inline-flex items-center"
                panelClass="right-0 w-72"
                testId="add-widget"
              >
                <p className="mb-2 font-semibold">Add a widget</p>
                <ul className="space-y-0.5" aria-label="Widgets">
                  {addable.map((entry) => (
                    <li key={entry.kind}>
                      <button
                        type="button"
                        disabled={pending}
                        className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-muted disabled:opacity-60"
                        onClick={(event) => {
                          const details = (event.currentTarget as HTMLElement).closest("details");
                          if (details) details.open = false;
                          save(addWidget(layout, entry.kind), `${entry.title} added at the end.`, { refresh: true });
                        }}
                        data-testid={`add-widget-${entry.kind}`}
                      >
                        <span className="block text-label font-medium">{entry.title}</span>
                        <span className="block text-caption text-ink-muted">{entry.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Drop>
            )}
            <button
              type="button"
              className="btn-secondary btn-compact inline-flex items-center gap-1.5"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Go back to the default widgets? Your note is kept.")) return;
                start(async () => {
                  const result = await homeLayoutAction({ reset: true });
                  toast(result.ok ? { tone: "success", title: result.message } : { tone: "error", title: result.message });
                  router.refresh();
                });
              }}
              data-testid="reset-home"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" /> Reset
            </button>
          </>
        )}
        <button
          type="button"
          aria-pressed={editing}
          onClick={() => {
            setEditing((value) => !value);
            setLifted(null);
            setLive(editing ? "Done customising Home." : "Customising Home. Each widget now has controls to move, resize or remove it.");
          }}
          className={editing ? "btn-primary btn-compact inline-flex items-center gap-1.5" : "btn-secondary btn-compact inline-flex items-center gap-1.5"}
          data-testid="customise-home"
        >
          {editing ? <Check aria-hidden="true" className="h-4 w-4" /> : <LayoutGrid aria-hidden="true" className="h-4 w-4" />}
          {editing ? "Done" : "Customise"}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only" data-testid="home-live">
        {live}
      </span>
      {layout.length === 0 && !extra && (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-label text-ink-muted" data-testid="home-empty">
          No widgets on your Home. Choose <strong>Customise</strong>, then <strong>Add widget</strong>.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-label="Your widgets">
        {layout.map((item, index) => {
          const entry = widgetEntry(item.kind);
          const node = nodes.get(item.kind);
          return (
            <li
              key={item.kind}
              className={`min-w-0 ${item.size === "full" ? "lg:col-span-2" : ""} ${dragging === item.kind ? "opacity-50" : ""} ${lifted?.kind === item.kind ? "rounded-xl outline outline-2 outline-offset-2 outline-focus" : ""}`}
              data-testid="home-widget"
              data-kind={item.kind}
              data-size={item.size}
              onDragOver={(event) => dragging && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging !== item.kind) {
                  const next = placeWidget(layout, dragging, item.kind);
                  save(next, `${title(dragging)} moved to ${position(next, dragging)}.`);
                }
                setDragging(null);
              }}
            >
              {editing && (
                <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-muted px-2 py-1" data-testid="widget-controls">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(item.kind);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onKeyDown={(event) => onHandleKey(event, item.kind)}
                    aria-label={`Move ${entry.title}`}
                    aria-describedby="widget-move-help"
                    aria-pressed={lifted?.kind === item.kind}
                    aria-keyshortcuts="Space Alt+ArrowUp Alt+ArrowDown"
                    className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink"
                    data-widget-handle={item.kind}
                  >
                    <GripVertical aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <span className="mr-auto truncate text-label font-medium">{entry.title}</span>
                  <button type="button" className="tb-btn" aria-label={`Move ${entry.title} up`} disabled={index === 0 || pending} onClick={() => move(item.kind, -1)}>
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button type="button" className="tb-btn" aria-label={`Move ${entry.title} down`} disabled={index === layout.length - 1 || pending} onClick={() => move(item.kind, 1)}>
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </button>
                  {entry.sizes.length > 1 && (
                    <span role="radiogroup" aria-label={`Width of ${entry.title}`} className="inline-flex rounded-md border border-line bg-surface p-0.5">
                      {(["half", "full"] as const)
                        .filter((size) => entry.sizes.includes(size))
                        .map((size) => (
                          <button
                            key={size}
                            type="button"
                            role="radio"
                            aria-checked={item.size === size}
                            disabled={pending}
                            onClick={() => item.size !== size && save(resizeWidget(layout, item.kind, size), `${entry.title} is ${size === "full" ? "full" : "half"} width now.`)}
                            className={`rounded px-2 py-0.5 text-caption ${item.size === size ? "bg-primary-solid font-semibold text-on-solid" : "text-ink-muted hover:text-ink"}`}
                            data-testid={`widget-size-${size}`}
                          >
                            {size === "full" ? "Full width" : "Half width"}
                          </button>
                        ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className="tb-btn text-danger-600"
                    aria-label={`Remove ${entry.title}`}
                    disabled={pending}
                    onClick={() => {
                      save(removeWidget(layout, item.kind), `${entry.title} removed. Add it again with Add widget.`);
                      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="customise-home"]')?.focus());
                    }}
                    data-testid="remove-widget"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              )}
              {node ?? (
                <section className="card px-5 py-6 text-center text-label text-ink-muted" aria-label={entry.title}>
                  Loading {entry.title}…
                </section>
              )}
            </li>
          );
        })}
        {extra && <li className="min-w-0">{extra}</li>}
      </ul>
      {editing && (
        <p id="widget-move-help" className="mt-2 text-caption text-ink-muted">
          To move a widget with the keyboard, focus its handle and press Space, then ↑ or ↓, then Space again (Escape cancels). Alt + ↑ / ↓ moves it at once.
        </p>
      )}
    </div>
  );
}
