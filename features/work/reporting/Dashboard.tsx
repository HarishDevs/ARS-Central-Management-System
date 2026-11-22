"use client";

import { BarChart3, GripVertical, Maximize2, MoreHorizontal, Pencil, Plus, Table2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/features/ui/Button";
import { ConfirmDialog, Dialog } from "@/features/ui/Dialog";
import { Menu } from "@/features/ui/Menu";
import { useWorkCall } from "@/features/work/client";
import { RichText } from "@/features/work/RichText";
import { dashboardAction } from "@/app/users/work/reporting-actions";
import { ChartBuilder, TextEditor, type BuilderContext, type ChartDraft } from "@/features/work/reporting/ChartBuilder";
import { ChartTable, ChartView } from "@/features/work/reporting/ChartView";
import { filterCountText, newChartConfig, type ChartConfig, type ChartData, type FieldInfo } from "@/server/work/reporting";

// v1.67.0 (D-375, spec PV §7.1): the project's Dashboard tab. Widgets in
// order (number cards a quarter wide, charts and text half or full width).
// Owners and editors: "Add widget" (Chart, Text), Edit, size, Remove, and
// reorder by dragging a widget's handle, or with the keyboard: focus the
// handle, Space to pick up, arrow keys to move, Space to drop, Escape to
// cancel (announced). Everyone: "View as table" and "View full size".
export interface DashboardWidget {
  id: number;
  kind: "CHART" | "TEXT";
  title: string;
  size: "HALF" | "FULL";
  body: string | null;
  config: ChartConfig | null;
  filters: number;
  data: ChartData | null;
  error: string | null;
  rowVersion: number;
}

type Editing = { kind: "chart"; draft: ChartDraft } | { kind: "text"; draft: { id: number | null; title: string; body: string; size: "HALF" | "FULL"; rowVersion: number | null } } | null;

const spanOf = (widget: DashboardWidget) => (widget.kind === "CHART" && widget.config?.style === "number" && widget.size === "HALF" ? "col-span-1" : widget.size === "FULL" ? "sm:col-span-2 lg:col-span-4" : "sm:col-span-2");

export function Dashboard({ projectId, widgets, fields, sections, people, canEdit, max }: { projectId: number; widgets: DashboardWidget[]; fields: FieldInfo[]; sections: { id: number; name: string }[]; people: { id: number; name: string }[]; canEdit: boolean; max: number }) {
  const { call, pending } = useWorkCall();
  const [order, setOrder] = useState(widgets.map((widget) => widget.id));
  const [editing, setEditing] = useState<Editing>(null);
  const [full, setFull] = useState<number | null>(null);
  const [removing, setRemoving] = useState<DashboardWidget | null>(null);
  const [grabbed, setGrabbed] = useState<{ id: number; from: number[] } | null>(null);
  const [dragging, setDragging] = useState<{ id: number; over: number | null; pointer: number } | null>(null);
  const [live, setLive] = useState("");
  const orderKey = widgets.map((widget) => widget.id).join(",");
  useEffect(() => setOrder(widgets.map((widget) => widget.id)), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const list = order.map((id) => byId.get(id)).filter((widget): widget is DashboardWidget => Boolean(widget));
  const context: BuilderContext = { projectId, fields, sections, people };
  const announce = (text: string) => {
    setLive("");
    setTimeout(() => setLive(text), 50);
  };
  const focusHandle = (id: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-handle="${id}"]`)?.focus({ preventScroll: true }));
  const save = async (next: number[], moved: number) => {
    const before = order;
    setOrder(next);
    announce(`${byId.get(moved)?.title ?? "Widget"} moved to position ${next.indexOf(moved) + 1} of ${next.length}.`);
    focusHandle(moved);
    const result = await call(() => dashboardAction(projectId, { op: "move", ids: next }), { success: false });
    if (!result?.ok) setOrder(before);
  };
  const shift = (ids: number[], id: number, delta: number) => {
    const from = ids.indexOf(id);
    const to = Math.min(ids.length - 1, Math.max(0, from + delta));
    const out = [...ids];
    out.splice(from, 1);
    out.splice(to, 0, id);
    return out;
  };

  // Keyboard: grab, move, drop.
  const onHandleKey = (event: React.KeyboardEvent, widget: DashboardWidget) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!grabbed) {
        setGrabbed({ id: widget.id, from: order });
        announce(`${widget.title} picked up, position ${order.indexOf(widget.id) + 1} of ${order.length}. Use the arrow keys to move it, Space to drop, Escape to cancel.`);
      } else {
        const changed = grabbed.from.join(",") !== order.join(",");
        setGrabbed(null);
        if (changed) void save(order, widget.id);
        else announce(`${widget.title} dropped where it was.`);
      }
      return;
    }
    if (!grabbed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOrder(grabbed.from);
      setGrabbed(null);
      announce(`Move cancelled. ${widget.title} is back at position ${grabbed.from.indexOf(widget.id) + 1}.`);
      focusHandle(widget.id);
      return;
    }
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = shift(order, widget.id, delta);
    setOrder(next);
    announce(`${widget.title}: position ${next.indexOf(widget.id) + 1} of ${next.length}.`);
    focusHandle(widget.id);
  };
  // Pointer: drag the handle; the widget under the pointer shows where it goes.
  const onPointerDown = (event: React.PointerEvent, widget: DashboardWidget) => {
    if (event.button !== 0 || !canEdit) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging({ id: widget.id, over: null, pointer: event.pointerId });
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-widget-id]");
    const over = target ? Number(target.dataset.widgetId) : null;
    if (over !== dragging.over) setDragging({ ...dragging, over: over === dragging.id ? null : over });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    const { id, over } = dragging;
    setDragging(null);
    if (over === null) return;
    const rest = order.filter((item) => item !== id);
    const at = rest.indexOf(over) + (order.indexOf(id) < order.indexOf(over) ? 1 : 0);
    rest.splice(at, 0, id);
    if (rest.join(",") !== order.join(",")) void save(rest, id);
  };

  const fullWidget = full !== null ? byId.get(full) : undefined;
  return (
    <div data-testid="dashboard">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canEdit && (
          <Menu
            label="Add widget"
            align="left"
            trigger={
              <span className="inline-flex items-center gap-1" data-testid="add-widget">
                <Plus aria-hidden="true" className="h-4 w-4" /> Add widget
              </span>
            }
            items={
              list.length >= max
                ? [{ label: `The dashboard is full (${max} widgets). Remove one first.`, onSelect: () => undefined }]
                : [
                    { label: "Chart", icon: <BarChart3 aria-hidden="true" className="h-4 w-4" />, onSelect: () => setEditing({ kind: "chart", draft: { id: null, ...newChartConfig(fields), size: "HALF", rowVersion: null } }) },
                    { label: "Text", icon: <Type aria-hidden="true" className="h-4 w-4" />, onSelect: () => setEditing({ kind: "text", draft: { id: null, title: "Notes", body: "", size: "HALF", rowVersion: null } }) },
                  ]
            }
          />
        )}
        <span className="text-caption text-ink-muted">
          {list.length} of {max} widgets. Figures count only tasks you can see; they refresh while this page is open.
        </span>
      </div>
      {list.length === 0 && <p className="card px-5 py-8 text-center text-ink-muted">This dashboard has no widgets.{canEdit ? " Use Add widget to add a chart or some text." : ""}</p>}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Widgets" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDragging(null)}>
        {list.map((widget) => (
          <WidgetCard
            key={widget.id}
            widget={widget}
            span={spanOf(widget)}
            canEdit={canEdit}
            grabbed={grabbed?.id === widget.id}
            dropTarget={dragging?.over === widget.id}
            lifted={dragging?.id === widget.id}
            onHandleKey={(event) => onHandleKey(event, widget)}
            onHandleBlur={() => {
              if (grabbed?.id !== widget.id) return;
              const changed = grabbed.from.join(",") !== order.join(",");
              setGrabbed(null);
              if (changed) void save(order, widget.id);
            }}
            onPointerDown={(event) => onPointerDown(event, widget)}
            onEdit={() =>
              setEditing(
                widget.kind === "CHART" && widget.config
                  ? { kind: "chart", draft: { id: widget.id, title: widget.title, config: widget.config, size: widget.size, rowVersion: widget.rowVersion } }
                  : { kind: "text", draft: { id: widget.id, title: widget.title, body: widget.body ?? "", size: widget.size, rowVersion: widget.rowVersion } },
              )
            }
            onFull={() => setFull(widget.id)}
            onRemove={() => setRemoving(widget)}
            onMove={(delta) => void save(shift(order, widget.id, delta), widget.id)}
            onResize={() =>
              void call(() =>
                dashboardAction(projectId, { op: "save", id: widget.id, kind: widget.kind, title: widget.title, config: widget.config ?? undefined, body: widget.body, size: widget.size === "FULL" ? "HALF" : "FULL", rowVersion: widget.rowVersion }),
              )
            }
            index={order.indexOf(widget.id)}
            count={order.length}
          />
        ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only" data-testid="dashboard-live">
        {live}
      </p>
      {editing?.kind === "chart" && <ChartBuilder open context={context} draft={editing.draft} onClose={() => setEditing(null)} />}
      {editing?.kind === "text" && <TextEditor open projectId={projectId} draft={editing.draft} onClose={() => setEditing(null)} />}
      {fullWidget && (
        <Dialog open onClose={() => setFull(null)} title={fullWidget.title} size="lg" footer={<Button size="sm" variant="secondary" onClick={() => setFull(null)}>Close</Button>}>
          <div data-testid="widget-full">
            {fullWidget.data ? (
              <>
                <ChartView data={fullWidget.data} title={fullWidget.title} />
                <h3 className="mb-2 mt-4 text-label font-semibold">The figures</h3>
                <ChartTable data={fullWidget.data} title={fullWidget.title} />
              </>
            ) : fullWidget.body ? (
              <RichText text={fullWidget.body} />
            ) : (
              <p className="text-ink-muted">{fullWidget.error}</p>
            )}
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void call(() => dashboardAction(projectId, { op: "remove", id: target.id }));
        }}
        title="Remove widget?"
        body={`"${removing?.title ?? ""}" is removed from the dashboard for everyone. The tasks stay as they are.`}
        confirmLabel="Remove widget"
        tone="danger"
        busy={pending}
      />
    </div>
  );
}

function WidgetCard({
  widget,
  span,
  canEdit,
  grabbed,
  dropTarget,
  lifted,
  onHandleKey,
  onHandleBlur,
  onPointerDown,
  onEdit,
  onFull,
  onRemove,
  onMove,
  onResize,
  index,
  count,
}: {
  widget: DashboardWidget;
  span: string;
  canEdit: boolean;
  grabbed: boolean;
  dropTarget: boolean;
  lifted: boolean;
  onHandleKey: (event: React.KeyboardEvent) => void;
  onHandleBlur: () => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onEdit: () => void;
  onFull: () => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onResize: () => void;
  index: number;
  count: number;
}) {
  const [table, setTable] = useState(false);
  const headingId = `widget-${widget.id}-title`;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (grabbed) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [grabbed, index]);
  const isChart = widget.kind === "CHART";
  const number = isChart && widget.config?.style === "number";
  return (
    <li
      ref={ref}
      data-widget-id={widget.id}
      className={`${span} min-w-0 scroll-m-4 ${lifted ? "opacity-60" : ""}`}
      data-testid="dashboard-widget"
    >
      <section
        aria-labelledby={headingId}
        className={`card flex h-full flex-col px-4 py-3 ${grabbed ? "scale-[1.01] shadow-overlay ring-2 ring-primary-600 motion-reduce:scale-100" : ""} ${dropTarget ? "ring-2 ring-primary-600 ring-offset-2" : ""} has-[[data-widget-handle]:focus-visible]:ring-2 has-[[data-widget-handle]:focus-visible]:ring-primary-600`}
      >
        <header className="mb-2 flex items-start gap-1">
          {canEdit && (
            <button
              type="button"
              data-widget-handle={widget.id}
              aria-label={`Move widget ${widget.title}`}
              aria-pressed={grabbed}
              aria-describedby={`${headingId}-keys`}
              onKeyDown={onHandleKey}
              onBlur={onHandleBlur}
              onPointerDown={onPointerDown}
              className="-ml-1 mt-0.5 shrink-0 cursor-grab touch-none select-none rounded p-0.5 text-ink-faint hover:bg-surface-muted hover:text-ink focus-visible:bg-surface-muted aria-pressed:bg-primary-50 aria-pressed:text-primary-700"
              data-testid="widget-handle"
            >
              <GripVertical aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          <h3 id={headingId} className="line-clamp-2 min-w-0 flex-1 break-words font-semibold" title={widget.title}>
            {widget.title}
          </h3>
          {isChart && widget.data && !number && (
            <button type="button" aria-pressed={table} onClick={() => setTable((value) => !value)} className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink aria-pressed:bg-primary-50 aria-pressed:text-primary-700" aria-label={`View ${widget.title} as table`} title="View as table" data-testid="widget-table-toggle">
              <Table2 aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onFull} className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label={`View ${widget.title} full size`} title="View full size" data-testid="widget-full-open">
            <Maximize2 aria-hidden="true" className="h-4 w-4" />
          </button>
          {canEdit && (
            <>
              <button type="button" onClick={onEdit} className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label={`Edit ${widget.title}`} title={isChart ? "Edit chart" : "Edit text"} data-testid="widget-edit">
                <Pencil aria-hidden="true" className="h-4 w-4" />
              </button>
              <div className="shrink-0">
              <Menu
                label={`More actions for ${widget.title}`}
                trigger={<span className="inline-flex h-6 w-6 items-center justify-center"><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></span>}
                items={[
                  ...(index > 0 ? [{ label: "Move earlier", onSelect: () => onMove(-1) }] : []),
                  ...(index < count - 1 ? [{ label: "Move later", onSelect: () => onMove(1) }] : []),
                  { label: widget.size === "FULL" ? "Make half width" : "Make full width", onSelect: onResize },
                  { label: "Remove widget", tone: "danger" as const, onSelect: onRemove },
                ]}
              />
              </div>
            </>
          )}
        </header>
        {canEdit && (
          <p id={`${headingId}-keys`} className="sr-only">
            {grabbed ? "Arrow keys to move, Space to drop, Escape to cancel." : "Space to pick up and reorder."}
          </p>
        )}
        <div className="min-h-0 flex-1">
          {widget.error ? (
            <p className="rounded-md bg-surface-muted px-3 py-4 text-label text-ink-muted">{widget.error}</p>
          ) : widget.data ? (
            <ChartView data={widget.data} title={widget.title} table={table} />
          ) : (
            <RichText text={widget.body ?? ""} className="text-label" />
          )}
        </div>
        {isChart && widget.config && (
          <footer className="mt-2 text-caption text-ink-muted" data-testid="widget-filters">
            {filterCountText(widget.filters)}
          </footer>
        )}
      </section>
    </li>
  );
}
