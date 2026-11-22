"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/features/ui/Button";
import { Dialog } from "@/features/ui/Dialog";
import { useWorkCall } from "@/features/work/client";
import { chartPreviewAction, dashboardAction } from "@/app/users/work/reporting-actions";
import { ChartView } from "@/features/work/reporting/ChartView";
import { FIELD_FILTER_LABEL, filterOps } from "@/server/work/custom-fields";
import {
  AXIS_FIELD_TYPES,
  AXIS_STYLES,
  CHART_STYLE_LABEL,
  CHART_STYLES,
  chartConfigSchema,
  DATE_FIELD_LABEL,
  DATE_FIELDS,
  DATE_UNIT_LABEL,
  DATE_UNITS,
  DIMENSION_LABEL,
  DUE_STATUS_LABEL,
  DUE_STATUSES,
  MAX_METRICS,
  METRIC_FIELD_TYPES,
  RANGE_LABEL,
  RANGES,
  TASK_TYPE_LABEL,
  TASK_TYPES,
  TEXT_BODY_MAX,
  TIME_STYLES,
  WIDGET_TITLE_MAX,
  type ChartConfig,
  type ChartData,
  type ChartDimension,
  type ChartStyle,
  type FieldInfo,
} from "@/server/work/reporting";

// v1.67.0 (D-375, spec PV §7.2 "Edit chart"): the chart builder. A live
// preview (worked out on the server, with the same visibility as the
// dashboard) over the setup: data source, chart style, X-axis (or Group for
// a donut), a second grouping for stacked/grouped bars, metrics (count, or
// the sum/average of a number, formula or timer field; "Add metric" adds a
// series on the same axis, never a second axis), the date range, filters
// (the List's field filters too), data labels, a benchmark line, size.
export interface BuilderContext {
  projectId: number;
  fields: FieldInfo[];
  sections: { id: number; name: string }[];
  people: { id: number; name: string }[];
}
export interface ChartDraft {
  id: number | null;
  title: string;
  config: ChartConfig;
  size: "HALF" | "FULL";
  rowVersion: number | null;
}

const BASE_DIMS = ["assignee", "creator", "section", "type", "completion", "dueStatus", "date"] as const;
const dimValue = (dim: ChartDimension | null) => (!dim ? "" : dim.by === "field" ? `field:${dim.fieldId}` : dim.by);
function dimFrom(value: string, previous: ChartDimension | null): ChartDimension | null {
  if (!value) return null;
  const base = { fieldId: null, dateField: previous?.dateField ?? "due", unit: previous?.unit ?? "week" } as const;
  if (value.startsWith("field:")) return { ...base, by: "field", fieldId: Number(value.slice(6)) };
  return { ...base, by: value as ChartDimension["by"] };
}
const inputClass = "w-full rounded-md border border-line bg-raised px-2 py-1.5 text-label text-ink";
const SINGLE_METRIC: readonly ChartStyle[] = ["number", "donut", "burnup", "burndown"];

export function ChartBuilder({ open, context, draft, onClose }: { open: boolean; context: BuilderContext; draft: ChartDraft; onClose: () => void }) {
  const { call, pending } = useWorkCall();
  const [title, setTitle] = useState(draft.title);
  const [config, setConfig] = useState<ChartConfig>(draft.config);
  const [size, setSize] = useState(draft.size);
  const [preview, setPreview] = useState<{ data: ChartData | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const titleId = useId();
  const latest = useRef(0);
  const timers = context.fields.filter((field) => field.type === "TIMER");
  const axisFields = context.fields.filter((field) => AXIS_FIELD_TYPES.includes(field.type));
  const metricFields = context.fields.filter((field) => METRIC_FIELD_TYPES.includes(field.type));
  const time = config.source === "time";
  const style = config.style;
  const hasAxis = !(style === "number" || TIME_STYLES.includes(style));
  const stackable = style === "stacked" || style === "grouped";
  const multiMetric = !SINGLE_METRIC.includes(style) && !config.series;
  const xIsDate = Boolean(config.x && (config.x.by === "date" || (config.x.by === "field" && context.fields.find((field) => field.id === config.x?.fieldId)?.type === "DATE")));

  // The live preview, a moment after each change.
  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!open) return;
    const ticket = ++latest.current;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      void chartPreviewAction(context.projectId, config)
        .then((result) => {
          if (ticket !== latest.current) return;
          setPreview(result.ok && result.value ? { data: result.value, error: null, loading: false } : { data: null, error: result.message || "Couldn't show this chart.", loading: false });
        })
        .catch(() => ticket === latest.current && setPreview({ data: null, error: "Couldn't show this chart.", loading: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [configKey, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (change: Partial<ChartConfig>) => setConfig((current) => ({ ...current, ...change }));
  const updateFilters = (change: Partial<ChartConfig["filters"]>) => setConfig((current) => ({ ...current, filters: { ...current.filters, ...change } }));
  const setStyle = (next: ChartStyle) =>
    setConfig((current) => {
      const out: ChartConfig = { ...current, style: next };
      if (next === "number" || TIME_STYLES.includes(next)) out.x = null;
      else if (!out.x) out.x = dimFrom(next === "donut" ? "completion" : "section", null);
      if (next !== "stacked" && next !== "grouped") out.series = null;
      else if (!out.series && out.metrics.length < 2) out.series = dimFrom(out.x?.by === "completion" ? "assignee" : "completion", null);
      if (SINGLE_METRIC.includes(next)) out.metrics = out.metrics.slice(0, 1);
      if (TIME_STYLES.includes(next)) {
        out.source = "tasks";
        out.metrics = [{ measure: "count", fieldId: null }];
      }
      if (!AXIS_STYLES.includes(next)) out.benchmark = null;
      if (next !== "donut") out.percent = false;
      return out;
    });
  const toggle = <T,>(list: readonly T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((value) => value !== item));

  const save = async () => {
    const result = await call(() => dashboardAction(context.projectId, { op: "save", id: draft.id, kind: "CHART", title, config, size, rowVersion: draft.rowVersion }));
    if (result?.ok) onClose();
  };
  const dimOptions = (forSeries: boolean) => (
    <>
      {forSeries && <option value="">None: one series per metric</option>}
      {BASE_DIMS.map((dim) => (
        <option key={dim} value={dim}>
          {DIMENSION_LABEL[dim]}
        </option>
      ))}
      {time && <option value="person">{DIMENSION_LABEL.person}</option>}
      {axisFields.map((field) => (
        <option key={field.id} value={`field:${field.id}`}>
          {field.name} (custom field)
        </option>
      ))}
    </>
  );
  const dateControls = (dim: ChartDimension, set: (next: ChartDimension) => void, label: string) => {
    const isDate = dim.by === "date" || (dim.by === "field" && context.fields.find((field) => field.id === dim.fieldId)?.type === "DATE");
    if (!isDate) return null;
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        {dim.by === "date" && !time && (
          <label className="text-caption text-ink-muted">
            {label} date
            <select className={inputClass} value={dim.dateField} onChange={(event) => set({ ...dim, dateField: event.target.value as ChartDimension["dateField"] })}>
              {DATE_FIELDS.map((value) => (
                <option key={value} value={value}>
                  {DATE_FIELD_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-caption text-ink-muted">
          Unit
          <select className={inputClass} value={dim.unit} onChange={(event) => set({ ...dim, unit: event.target.value as ChartDimension["unit"] })}>
            {DATE_UNITS.map((value) => (
              <option key={value} value={value}>
                {DATE_UNIT_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit chart" : "Add chart"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} loading={pending} disabled={!title.trim() || Boolean(preview.error)} data-testid="chart-save">
            {draft.id ? "Save chart" : "Add chart"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="chart-builder">
        <label className="block text-label font-medium" htmlFor={titleId}>
          Title
        </label>
        <input id={titleId} className={inputClass} value={title} maxLength={WIDGET_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} data-autofocus data-testid="chart-title" />
        <section aria-label="Preview" className="rounded-md border border-line p-3">
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-faint">Preview</p>
          {preview.error ? (
            <p role="alert" className="text-label text-danger-600" data-testid="chart-preview-error">
              {preview.error}
            </p>
          ) : preview.data ? (
            <div aria-busy={preview.loading} className={preview.loading ? "opacity-60" : ""}>
              <ChartView data={preview.data} title={title || "Chart"} />
            </div>
          ) : (
            <p className="text-label text-ink-muted">Working it out…</p>
          )}
        </section>

        <fieldset className="space-y-2">
          <legend className="font-semibold">Data source</legend>
          <div className="flex flex-wrap gap-4 text-label">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="source" checked={!time} onChange={() => update({ source: "tasks", timerFieldId: null })} /> Tasks
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="source" checked={time} disabled={!timers.length || TIME_STYLES.includes(style)} onChange={() => update({ source: "time", metrics: [{ measure: "sum", fieldId: null }] })} /> Time entries
            </label>
          </div>
          {!timers.length && <p className="text-caption text-ink-muted">Time entries come from timer fields. Add a timer field to the project to chart them.</p>}
          {time && (
            <label className="block text-caption text-ink-muted">
              Timer field
              <select className={inputClass} value={config.timerFieldId ?? ""} onChange={(event) => update({ timerFieldId: event.target.value ? Number(event.target.value) : null })}>
                <option value="">Every timer field</option>
                {timers.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-semibold">Chart setup</legend>
          <label className="block text-caption text-ink-muted">
            Chart style
            <select className={inputClass} value={style} onChange={(event) => setStyle(event.target.value as ChartStyle)} data-testid="chart-style">
              {CHART_STYLES.map((value) => (
                <option key={value} value={value} disabled={time && TIME_STYLES.includes(value)}>
                  {CHART_STYLE_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          {hasAxis && config.x && (
            <div>
              <label className="block text-caption text-ink-muted">
                {style === "donut" ? "Group" : "X-axis"}
                <select className={inputClass} value={dimValue(config.x)} onChange={(event) => update({ x: dimFrom(event.target.value, config.x) })} data-testid="chart-x">
                  {dimOptions(false)}
                </select>
              </label>
              {dateControls(config.x, (next) => update({ x: next }), "Which")}
            </div>
          )}
          {stackable && (
            <div>
              <label className="block text-caption text-ink-muted">
                {style === "stacked" ? "Stack by" : "Group bars by"}
                <select className={inputClass} value={dimValue(config.series)} onChange={(event) => update({ series: dimFrom(event.target.value, config.series), metrics: event.target.value ? config.metrics.slice(0, 1) : config.metrics })} data-testid="chart-series">
                  {dimOptions(true)}
                </select>
              </label>
              {config.series && dateControls(config.series, (next) => update({ series: next }), "Which")}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-caption text-ink-muted">{style === "donut" ? "Measure" : style === "number" ? "Value" : "Y-axis"}</p>
            {config.metrics.map((metric, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" data-testid="chart-metric">
                <select
                  aria-label={`Metric ${index + 1}`}
                  className={`${inputClass} w-auto`}
                  value={metric.measure}
                  disabled={TIME_STYLES.includes(style)}
                  onChange={(event) => {
                    const measure = event.target.value as ChartConfig["metrics"][number]["measure"];
                    const metrics = config.metrics.map((item, at) => (at === index ? { measure, fieldId: measure === "count" || time ? null : (item.fieldId ?? metricFields[0]?.id ?? null) } : item));
                    update({ metrics });
                  }}
                >
                  <option value="count">{time ? "Number of time entries" : "Number of tasks"}</option>
                  <option value="sum" disabled={!time && !metricFields.length}>
                    {time ? "Total hours" : "Sum of"}
                  </option>
                  <option value="avg" disabled={!time && !metricFields.length}>
                    {time ? "Average hours an entry" : "Average of"}
                  </option>
                </select>
                {!time && metric.measure !== "count" && (
                  <select aria-label={`Field for metric ${index + 1}`} className={`${inputClass} w-auto`} value={metric.fieldId ?? ""} onChange={(event) => update({ metrics: config.metrics.map((item, at) => (at === index ? { ...item, fieldId: Number(event.target.value) } : item)) })}>
                    {metricFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                )}
                {index > 0 && (
                  <button type="button" className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label={`Remove metric ${index + 1}`} onClick={() => update({ metrics: config.metrics.filter((_, at) => at !== index) })}>
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {multiMetric && config.metrics.length < MAX_METRICS && (
              <button type="button" className="inline-flex items-center gap-1 text-label text-primary-600 hover:underline" onClick={() => update({ metrics: [...config.metrics, { measure: "count", fieldId: null }] })} data-testid="chart-add-metric">
                <Plus aria-hidden="true" className="h-4 w-4" /> Add metric
              </button>
            )}
            {config.metrics.length > 1 && <p className="text-caption text-ink-muted">Every metric shares one axis. Metrics of very different sizes read better as separate charts.</p>}
          </div>
          {(TIME_STYLES.includes(style) || xIsDate) && (
            <label className="block text-caption text-ink-muted">
              Dates
              <select className={inputClass} value={config.range} onChange={(event) => update({ range: event.target.value as ChartConfig["range"] })} data-testid="chart-range">
                {RANGES.map((value) => (
                  <option key={value} value={value}>
                    {RANGE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <Filters config={config} context={context} updateFilters={updateFilters} toggle={toggle} />

        <fieldset className="space-y-2 text-label">
          <legend className="font-semibold">Data annotations</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.dataLabels} onChange={(event) => update({ dataLabels: event.target.checked })} /> Data labels
          </label>
          {style === "donut" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={config.percent} onChange={(event) => update({ percent: event.target.checked })} /> Show as percentage
            </label>
          )}
          {AXIS_STYLES.includes(style) && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.benchmark !== null} onChange={(event) => update({ benchmark: event.target.checked ? 0 : null })} data-testid="chart-benchmark-on" /> Benchmark line
              </label>
              {config.benchmark !== null && (
                <input type="number" aria-label="Benchmark value" className={`${inputClass} w-32`} value={config.benchmark} onChange={(event) => update({ benchmark: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })} data-testid="chart-benchmark" />
              )}
            </div>
          )}
        </fieldset>
        <SizeChoice size={size} setSize={setSize} />
      </div>
    </Dialog>
  );
}

function SizeChoice({ size, setSize }: { size: "HALF" | "FULL"; setSize: (size: "HALF" | "FULL") => void }) {
  return (
    <fieldset className="text-label">
      <legend className="font-semibold">Size</legend>
      <div className="mt-1 flex gap-4">
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="size" checked={size === "HALF"} onChange={() => setSize("HALF")} /> Half width
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="size" checked={size === "FULL"} onChange={() => setSize("FULL")} /> Full width
        </label>
      </div>
    </fieldset>
  );
}

function CheckList<T extends string | number>({ legend, items, chosen, onChange, testId }: { legend: string; items: { value: T; label: string }[]; chosen: readonly T[]; onChange: (value: T, on: boolean) => void; testId?: string }) {
  if (!items.length) return null;
  return (
    <fieldset data-testid={testId}>
      <legend className="text-caption text-ink-muted">{legend}</legend>
      <div className="mt-1 flex max-h-28 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
        {items.map((item) => (
          <label key={String(item.value)} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={chosen.includes(item.value)} onChange={(event) => onChange(item.value, event.target.checked)} /> {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Filters({ config, context, updateFilters, toggle }: { config: ChartConfig; context: BuilderContext; updateFilters: (change: Partial<ChartConfig["filters"]>) => void; toggle: <T>(list: readonly T[], item: T, on: boolean) => T[] }) {
  const f = config.filters;
  const fieldsById = new Map(context.fields.map((field) => [field.id, field]));
  return (
    <fieldset className="space-y-3 text-label" data-testid="chart-filters">
      <legend className="font-semibold">Filters</legend>
      <div role="radiogroup" aria-label="Completion status" className="flex flex-wrap gap-4">
        {(
          [
            ["all", "All tasks"],
            ["open", "Incomplete"],
            ["done", "Completed"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5">
            <input type="radio" name="completion" checked={f.completion === value} onChange={() => updateFilters({ completion: value })} /> {label}
          </label>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={f.mine} onChange={(event) => updateFilters({ mine: event.target.checked })} /> Only tasks assigned to me
      </label>
      <CheckList legend="Task type" items={TASK_TYPES.map((value) => ({ value, label: TASK_TYPE_LABEL[value] }))} chosen={f.types} onChange={(value, on) => updateFilters({ types: toggle(f.types, value, on) })} />
      <CheckList legend="Due date status" items={DUE_STATUSES.map((value) => ({ value, label: DUE_STATUS_LABEL[value] }))} chosen={f.dueStatus} onChange={(value, on) => updateFilters({ dueStatus: toggle(f.dueStatus, value, on) })} />
      <CheckList legend="Sections" items={context.sections.map((section) => ({ value: section.id, label: section.name }))} chosen={f.sections} onChange={(value, on) => updateFilters({ sections: toggle(f.sections, value, on) })} />
      <CheckList legend="Assignees" items={context.people.map((person) => ({ value: person.id, label: person.name }))} chosen={f.assignees} onChange={(value, on) => updateFilters({ assignees: toggle(f.assignees, value, on) })} />
      <CheckList legend="Creators" items={context.people.map((person) => ({ value: person.id, label: person.name }))} chosen={f.creators} onChange={(value, on) => updateFilters({ creators: toggle(f.creators, value, on) })} />
      {f.fields.map((filter, index) => {
        const field = fieldsById.get(filter.fieldId);
        const ops = field ? filterOps(field.type) : [];
        const choices = field && (field.type === "SELECT" || field.type === "MULTI_SELECT");
        const set = (change: Partial<typeof filter>) => updateFilters({ fields: f.fields.map((item, at) => (at === index ? { ...item, ...change } : item)) });
        return (
          <div key={index} className="flex flex-wrap items-center gap-2" data-testid="chart-field-filter">
            <select aria-label={`Filter ${index + 1}: field`} className={`${inputClass} w-auto`} value={filter.fieldId} onChange={(event) => set({ fieldId: Number(event.target.value), op: filterOps(fieldsById.get(Number(event.target.value))!.type)[0]!, value: "" })}>
              {context.fields.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select aria-label={`Filter ${index + 1}: condition`} className={`${inputClass} w-auto`} value={filter.op} onChange={(event) => set({ op: event.target.value as typeof filter.op })}>
              {ops.map((op) => (
                <option key={op} value={op}>
                  {FIELD_FILTER_LABEL[op]}
                </option>
              ))}
            </select>
            {filter.op !== "empty" && filter.op !== "notEmpty" && (
              choicesFor(field, choices, filter.value, (value) => set({ value }), index)
            )}
            <button type="button" className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label={`Remove filter ${index + 1}`} onClick={() => updateFilters({ fields: f.fields.filter((_, at) => at !== index) })}>
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      {context.fields.length > 0 && f.fields.length < 10 && (
        <button type="button" className="inline-flex items-center gap-1 text-label text-primary-600 hover:underline" onClick={() => updateFilters({ fields: [...f.fields, { fieldId: context.fields[0]!.id, op: filterOps(context.fields[0]!.type)[0]!, value: "" }] })}>
          <Plus aria-hidden="true" className="h-4 w-4" /> Add field filter
        </button>
      )}
    </fieldset>
  );
}
function choicesFor(field: FieldInfo | undefined, choices: boolean | undefined, value: string, set: (value: string) => void, index: number) {
  if (field && choices) {
    const options = field.options ?? [];
    return (
      <select aria-label={`Filter ${index + 1}: value`} className={`${inputClass} w-auto`} value={value} onChange={(event) => set(event.target.value)}>
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={`Filter ${index + 1}: value`}
      className={`${inputClass} w-40`}
      type={field?.type === "DATE" ? "date" : "text"}
      value={value}
      maxLength={100}
      placeholder={field?.type === "PEOPLE" ? "me" : field?.type === "TIMER" ? "minutes" : ""}
      onChange={(event) => set(event.target.value)}
    />
  );
}

// The text widget's editor (title, words, size).
export function TextEditor({ open, projectId, draft, onClose }: { open: boolean; projectId: number; draft: { id: number | null; title: string; body: string; size: "HALF" | "FULL"; rowVersion: number | null }; onClose: () => void }) {
  const { call, pending } = useWorkCall();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [size, setSize] = useState(draft.size);
  const titleId = useId();
  const bodyId = useId();
  const save = async () => {
    const result = await call(() => dashboardAction(projectId, { op: "save", id: draft.id, kind: "TEXT", title, body, size, rowVersion: draft.rowVersion }));
    if (result?.ok) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit text" : "Add text"}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} loading={pending} disabled={!title.trim() || !body.trim()} data-testid="text-save">
            {draft.id ? "Save text" : "Add text"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label htmlFor={titleId} className="block text-label font-medium">
          Title
        </label>
        <input id={titleId} className={inputClass} value={title} maxLength={WIDGET_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} data-autofocus data-testid="text-title" />
        <label htmlFor={bodyId} className="block text-label font-medium">
          Text
        </label>
        <textarea id={bodyId} className={`${inputClass} min-h-32`} value={body} maxLength={TEXT_BODY_MAX} onChange={(event) => setBody(event.target.value)} data-testid="text-body" />
        <p className="text-caption text-ink-muted">Links are made clickable. {body.length} of {TEXT_BODY_MAX} characters.</p>
        <SizeChoice size={size} setSize={setSize} />
      </div>
    </Dialog>
  );
}

export const emptyConfig = (partial: Record<string, unknown>) => chartConfigSchema.parse(partial);
