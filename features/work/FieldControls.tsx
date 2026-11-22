"use client";

import { AtSign, Calendar, CircleDot, Clock, Hash, Link2, ListChecks, Pause, Play, Plus, Sigma, Tag, Type, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fieldTaskSearchAction, fieldTimerAction, fieldValueAction } from "@/app/users/work/actions";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { useCellPanel } from "@/features/work/GridCellEditors";
import { useWorkCall } from "@/features/work/client";
import { FIELD_FILTER_LABEL, filterOps, timerText, type FieldCell, type FieldFilter, type FieldType, type FieldView } from "@/server/work/custom-fields";

// v1.64.0 (D-371, PM phase B part 1, spec PC §8.9): how custom field values
// show and change in the List, on Board cards and in the task pane. Every
// control is a native input, select or button (keyboard and screen reader
// friendly); popovers move focus in and Escape closes them. The server checks
// every change again (fieldValueAction).

export const FIELD_ICON: Record<FieldType, typeof Type> = {
  TEXT: Type,
  NUMBER: Hash,
  SELECT: CircleDot,
  MULTI_SELECT: ListChecks,
  DATE: Calendar,
  PEOPLE: Users,
  FORMULA: Sigma,
  ID: Tag,
  TIMER: Clock,
  REFERENCE: Link2,
  LOOKUP: AtSign,
};
export function FieldGlyph({ kind, className = "h-3.5 w-3.5" }: { kind: FieldType; className?: string }) {
  const Icon = FIELD_ICON[kind];
  return <Icon aria-hidden="true" className={`shrink-0 text-ink-muted ${className}`} />;
}

// Option colours are the eight identity tokens (white text, ≥ 4.5:1 in both themes); 0 = plain.
export const OPTION_COLOR_NAMES = ["None", "Blue", "Violet", "Magenta", "Orange", "Ochre", "Green", "Cyan", "Grey"];
export function optionStyle(color: number): React.CSSProperties | undefined {
  return color >= 1 && color <= 8 ? { backgroundColor: `var(--color-identity-${color})`, color: "#fff" } : undefined;
}
export function OptionChip({ name, color, className = "" }: { name: string; color: number; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-caption font-medium ${color ? "" : "bg-surface-muted text-ink"} ${className}`} style={optionStyle(color)}>
      {name}
    </span>
  );
}

// A value shown, not changed (Board chips, read-only rows).
export function FieldValueText({ field, cell }: { field: FieldView; cell?: FieldCell }) {
  if (!cell || (!cell.text && !cell.timer)) return <span className="text-ink-faint">—</span>;
  if ((field.kind === "SELECT" || field.kind === "MULTI_SELECT") && cell.optionIds?.length)
    return (
      <span className="flex min-w-0 flex-wrap gap-1">
        {cell.optionIds.map((id) => {
          const choice = field.choices?.find((item) => item.id === id);
          return choice ? <OptionChip key={id} name={choice.name} color={choice.color} /> : null;
        })}
      </span>
    );
  if (field.kind === "TIMER") return <span className="tabular-nums">{timerText(cell.timer?.seconds ?? 0)}</span>;
  return <span className={`truncate ${cell.error ? "text-danger-600" : ""}`}>{cell.text}</span>;
}

// Board card chip (spec EV-018): select fields as coloured chips, others "Name: value".
export function FieldChip({ field, cell }: { field: FieldView; cell: FieldCell }) {
  if ((field.kind === "SELECT" || field.kind === "MULTI_SELECT") && cell.optionIds?.length)
    return (
      <>
        {cell.optionIds.map((id) => {
          const choice = field.choices?.find((item) => item.id === id);
          return choice ? (
            <li key={id} title={`${field.name}: ${choice.name}`}>
              <OptionChip name={choice.name} color={choice.color} />
              <span className="sr-only"> ({field.name})</span>
            </li>
          ) : null;
        })}
      </>
    );
  return (
    <li className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-line bg-surface-muted px-2 py-0.5 text-caption text-ink" title={`${field.name}: ${cell.text}`}>
      <span className="text-ink-muted">{field.name}:</span> <span className="truncate">{field.kind === "TIMER" ? timerText(cell.timer?.seconds ?? 0) : cell.text}</span>
    </li>
  );
}

const panelClass = "fixed z-[var(--z-drawer)] w-72 rounded-lg border border-line bg-raised p-3 text-ink shadow-overlay";

// The inline editor of one field on one task.
export function FieldValueEditor({
  taskId,
  field,
  cell,
  canChange,
  label,
  people = [],
  compact = false,
}: {
  taskId: number;
  field: FieldView;
  cell?: FieldCell;
  canChange: boolean;
  label: string; // "Plant of Close ledgers"
  people?: { id: number; label: string; detail?: string }[];
  compact?: boolean;
}) {
  const { call, pending } = useWorkCall();
  const current = cell ?? { text: "", sort: null, edit: "" };
  const save = (value: unknown) => call(() => fieldValueAction(taskId, field.id, value), { success: false });
  const size = compact ? "h-8 py-0 text-label" : "h-9";
  const readOnly = field.kind === "FORMULA" || field.kind === "ID" || field.kind === "LOOKUP";
  if (readOnly)
    return (
      <span aria-label={`${label}: ${current.text || "empty"}${field.kind === "FORMULA" ? " (calculated)" : ""}`} className={`block truncate px-1 text-label ${current.error ? "text-danger-600" : field.kind === "ID" ? "font-mono" : ""}`} data-testid="field-readonly">
        {current.text || <span className="text-ink-faint">—</span>}
      </span>
    );
  if (field.kind === "TIMER") return <TimerControl taskId={taskId} field={field} cell={current} canChange={canChange} label={label} />;
  if (!canChange) return <span className="block px-1 text-label"><FieldValueText field={field} cell={cell} /></span>;
  switch (field.kind) {
    case "TEXT":
      return (
        <input
          key={current.edit}
          aria-label={label}
          defaultValue={current.edit}
          maxLength={500}
          onBlur={(event) => event.target.value.trim() !== current.edit && void save(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
          className={`field-input ${size} w-full`}
        />
      );
    case "NUMBER":
      // Shows the formatted value; the plain number while typing.
      return (
        <input
          key={`${current.edit}|${current.text}`}
          aria-label={label}
          inputMode="decimal"
          defaultValue={current.text}
          onFocus={(event) => {
            event.target.value = current.edit;
          }}
          onBlur={(event) => {
            const typed = event.target.value.trim();
            if (typed !== current.edit) void save(typed);
            else event.target.value = current.text;
          }}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
          className={`field-input ${size} w-full text-right tabular-nums`}
        />
      );
    case "SELECT": {
      const chosen = field.choices?.find((item) => item.id === current.optionIds?.[0]);
      const offered = (field.choices ?? []).filter((item) => !item.archived || item.id === chosen?.id);
      return (
        <select
          key={chosen?.name ?? ""}
          aria-label={label}
          defaultValue={chosen?.name ?? ""}
          onChange={(event) => {
            const pick = offered.find((item) => item.name === event.target.value);
            void save(pick ? pick.id : null);
          }}
          className={`field-input ${size} w-full font-medium`}
          style={chosen ? optionStyle(chosen.color) : undefined}
        >
          <option value="">—</option>
          {offered.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      );
    }
    case "DATE": {
      const [day, time] = current.edit.split("T");
      const send = (nextDay: string, nextTime: string) => {
        const value = nextDay ? (field.config?.withTime && nextTime ? `${nextDay}T${nextTime}` : nextDay) : "";
        if (value !== current.edit) void save(value);
      };
      return (
        <span className="flex w-full gap-1">
          <input key={`d${current.edit}`} type="date" aria-label={label} defaultValue={day ?? ""} onBlur={(event) => send(event.target.value, time ?? "")} className={`field-input ${size} min-w-0 flex-1`} />
          {field.config?.withTime && (
            <input key={`t${current.edit}`} type="time" aria-label={`${label}, time`} defaultValue={time ?? ""} onBlur={(event) => send(day ?? "", event.target.value)} className={`field-input ${size} w-24`} />
          )}
        </span>
      );
    }
    case "MULTI_SELECT":
      return <MultiSelectEditor field={field} cell={current} label={label} pending={pending} onSave={(ids) => void save(ids)} />;
    case "PEOPLE":
      return <PeopleEditor field={field} cell={current} label={label} people={people} pending={pending} onSave={(ids) => void save(ids)} />;
    case "REFERENCE":
      return <ReferenceEditor cell={current} label={label} pending={pending} onSave={(ids) => void save(ids)} />;
    default:
      return null;
  }
}

function PanelButton({ label, children, button, open, onToggle }: { label: string; children: React.ReactNode; button: React.RefObject<HTMLButtonElement | null>; open: boolean; onToggle: () => void }) {
  return (
    <button ref={button} type="button" onClick={onToggle} aria-expanded={open} aria-haspopup="dialog" aria-label={label} className="flex min-h-8 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-label hover:bg-surface-muted" data-testid="field-cell-button">
      {children}
    </button>
  );
}

function MultiSelectEditor({ field, cell, label, pending, onSave }: { field: FieldView; cell: FieldCell; label: string; pending: boolean; onSave: (ids: number[]) => void }) {
  const { spot, button, panel, open, close } = useCellPanel();
  // Ticks show at once; the saved value comes back with the refresh.
  const savedKey = (cell.optionIds ?? []).join(",");
  const [chosen, setChosen] = useState<number[]>(cell.optionIds ?? []);
  useEffect(() => setChosen(savedKey ? savedKey.split(",").map(Number) : []), [savedKey]);
  const pick = (next: number[]) => {
    setChosen(next);
    onSave(next);
  };
  const offered = (field.choices ?? []).filter((item) => !item.archived || chosen.includes(item.id));
  return (
    <>
      <PanelButton label={`${label}: ${cell.text || "none"}. Change`} button={button} open={Boolean(spot)} onToggle={() => (spot ? close() : open())}>
        <FieldValueText field={field} cell={cell} />
      </PanelButton>
      {spot && (
        <div ref={panel} role="dialog" aria-label={label} className={panelClass} style={{ top: spot.top, left: spot.left }}>
          <fieldset className="max-h-64 space-y-1 overflow-y-auto">
            <legend className="mb-1 text-label font-semibold">{field.name}</legend>
            {offered.map((item) => (
              <label key={item.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-label hover:bg-surface-muted">
                <input type="checkbox" disabled={pending} checked={chosen.includes(item.id)} onChange={(event) => pick(event.target.checked ? [...chosen, item.id] : chosen.filter((id) => id !== item.id))} />
                <OptionChip name={item.name} color={item.color} />
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </>
  );
}

function PeopleEditor({ field, cell, label, people, pending, onSave }: { field: FieldView; cell: FieldCell; label: string; people: { id: number; label: string; detail?: string }[]; pending: boolean; onSave: (ids: number[]) => void }) {
  const { spot, button, panel, open, close } = useCellPanel();
  const chosen = cell.userIds ?? [];
  const names = cell.text ? cell.text.split(", ") : [];
  return (
    <>
      <PanelButton label={`${label}: ${cell.text || "nobody"}. Change`} button={button} open={Boolean(spot)} onToggle={() => (spot ? close() : open())}>
        {cell.text ? <span className="truncate">{cell.text}</span> : <Plus aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
      </PanelButton>
      {spot && (
        <div ref={panel} role="dialog" aria-label={label} className={panelClass} style={{ top: spot.top, left: spot.left }}>
          <p className="mb-2 text-label font-semibold">{field.name}</p>
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Chosen people">
            {chosen.map((id, index) => (
              <li key={id} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pl-2 pr-1 text-label">
                {names[index] ?? "Person"}
                <button type="button" disabled={pending} aria-label={`Remove ${names[index] ?? "person"}`} onClick={() => onSave(chosen.filter((one) => one !== id))} className="grid h-6 w-6 place-items-center rounded-full text-ink-faint hover:text-danger-600">
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <PersonSelect ariaLabel={`Add a person to ${label}`} options={people.filter((person) => !chosen.includes(person.id))} value={null} disabled={pending} onChange={(id) => id && onSave([...chosen, id])} emptyLabel="Add a person…" compact />
        </div>
      )}
    </>
  );
}

function ReferenceEditor({ cell, label, pending, onSave }: { cell: FieldCell; label: string; pending: boolean; onSave: (ids: number[]) => void }) {
  const { spot, button, panel, open, close } = useCellPanel();
  const refs = cell.refs ?? [];
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: number; taskNo: string; title: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const timer = setTimeout(() => void fieldTaskSearchAction(q).then((result) => setFound(result.ok ? (result.value ?? []) : [])), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const ids = refs.map((ref) => ref.id);
  return (
    <>
      <PanelButton label={`${label}: ${cell.text || "none"}. Change`} button={button} open={Boolean(spot)} onToggle={() => (spot ? close() : open())}>
        {cell.text ? <span className="truncate">{cell.text}</span> : <Plus aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
      </PanelButton>
      {spot && (
        <div ref={panel} role="dialog" aria-label={label} className={panelClass} style={{ top: spot.top, left: spot.left }}>
          <ul className="mb-2 space-y-1" aria-label="Linked tasks">
            {refs.map((ref) => (
              <li key={ref.id} className="flex items-center gap-1 text-label">
                <Link href={`/users/tasks/${ref.id}`} className="link min-w-0 flex-1 truncate">
                  {ref.taskNo} {ref.title}
                </Link>
                <button type="button" disabled={pending} aria-label={`Remove ${ref.taskNo}`} onClick={() => onSave(ids.filter((one) => one !== ref.id))} className="grid h-6 w-6 place-items-center rounded-full text-ink-faint hover:text-danger-600">
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Find a task by number or title" placeholder="Task number or title" className="field-input h-8 text-label" />
          <ul className="mt-1 space-y-0.5" aria-label="Tasks found">
            {q.trim().length >= 2 &&
              found
                .filter((task) => !ids.includes(task.id))
                .map((task) => (
                  <li key={task.id}>
                    <button type="button" disabled={pending} onClick={() => onSave([...ids, task.id])} className="block w-full truncate rounded px-1 py-0.5 text-left text-label hover:bg-surface-muted">
                      {task.taskNo} {task.title}
                    </button>
                  </li>
                ))}
          </ul>
        </div>
      )}
    </>
  );
}

function TimerControl({ taskId, field, cell, canChange, label }: { taskId: number; field: FieldView; cell: FieldCell; canChange: boolean; label: string }) {
  const { call, pending } = useWorkCall();
  const timer = cell.timer ?? { seconds: 0, runningSince: null, mine: false, others: 0 };
  const [now, setNow] = useState(() => Date.now());
  const [loadedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!timer.runningSince && !timer.others) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [timer.runningSince, timer.others]);
  const running = timer.mine || timer.others > 0;
  const seconds = timer.seconds + (running ? Math.max(0, Math.floor((now - loadedAt) / 1000)) * (Number(timer.mine) + timer.others) : 0);
  return (
    <span className="flex items-center gap-1.5 px-1 text-label">
      <span className="tabular-nums" aria-label={`${label}: ${timerText(seconds)}${running ? ", running" : ""}`}>
        {timerText(seconds)}
      </span>
      {canChange && (
        <button
          type="button"
          disabled={pending}
          aria-pressed={timer.mine}
          aria-label={timer.mine ? `Stop your timer for ${label}` : `Start your timer for ${label}`}
          onClick={() => void call(() => fieldTimerAction(taskId, field.id, timer.mine ? "stop" : "start"), { success: false })}
          className={`grid h-6 w-6 place-items-center rounded-full border ${timer.mine ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line text-ink-muted hover:text-ink"}`}
          data-testid="timer-button"
        >
          {timer.mine ? <Pause aria-hidden="true" className="h-3 w-3" /> : <Play aria-hidden="true" className="h-3 w-3" />}
        </button>
      )}
      {timer.others > 0 && <span className="text-caption text-ink-muted">{timer.others} other{timer.others === 1 ? "" : "s"} timing</span>}
    </span>
  );
}

// Filter rows on custom fields (List and Board filter panels).
export function FieldFilterRows({ fields, filters, onChange, people }: { fields: FieldView[]; filters: FieldFilter[]; onChange: (filters: FieldFilter[]) => void; people: { id: number; label: string }[] }) {
  if (!fields.length) return null;
  const set = (index: number, change: Partial<FieldFilter>) => onChange(filters.map((item, at) => (at === index ? { ...item, ...change } : item)));
  return (
    <div data-testid="field-filters">
      <p className="mb-2 text-caption font-semibold text-ink-muted">Custom fields</p>
      <div className="space-y-2">
        {filters.map((filter, index) => {
          const field = fields.find((item) => item.id === filter.fieldId);
          if (!field) return null;
          const ops = filterOps(field.kind);
          const needsValue = filter.op !== "empty" && filter.op !== "notEmpty";
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select aria-label="Field" value={filter.fieldId} onChange={(event) => set(index, { fieldId: Number(event.target.value), op: filterOps(fields.find((item) => item.id === Number(event.target.value))!.kind)[0]!, value: "" })} className="field-input h-9 w-40">
                {fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select aria-label={`How ${field.name} is compared`} value={filter.op} onChange={(event) => set(index, { op: event.target.value as FieldFilter["op"] })} className="field-input h-9 w-32">
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {FIELD_FILTER_LABEL[op]}
                  </option>
                ))}
              </select>
              {needsValue &&
                (field.kind === "SELECT" || field.kind === "MULTI_SELECT" ? (
                  <select aria-label={`${field.name} value`} value={filter.value} onChange={(event) => set(index, { value: event.target.value })} className="field-input h-9 min-w-32 flex-1">
                    <option value="">Any</option>
                    {(field.choices ?? []).map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "PEOPLE" ? (
                  <select aria-label={`${field.name} value`} value={filter.value} onChange={(event) => set(index, { value: event.target.value })} className="field-input h-9 min-w-32 flex-1">
                    <option value="me">Me</option>
                    {people.map((person) => (
                      <option key={person.id} value={String(person.id)}>
                        {person.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={`${field.name} value${field.kind === "TIMER" ? " in minutes" : ""}`}
                    type={field.kind === "DATE" ? "date" : "text"}
                    inputMode={field.kind === "NUMBER" || field.kind === "FORMULA" || field.kind === "TIMER" ? "decimal" : undefined}
                    value={filter.value}
                    onChange={(event) => set(index, { value: event.target.value })}
                    className="field-input h-9 min-w-24 flex-1"
                  />
                ))}
              <button type="button" aria-label={`Remove the ${field.name} filter`} onClick={() => onChange(filters.filter((_, at) => at !== index))} className="rounded p-1.5 text-ink-muted hover:bg-surface-muted">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <button type="button" className="inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink" disabled={filters.length >= 10} onClick={() => onChange([...filters, { fieldId: fields[0]!.id, op: filterOps(fields[0]!.kind)[0]!, value: "" }])} data-testid="add-field-filter">
          <Plus aria-hidden="true" className="h-4 w-4" /> Add field filter
        </button>
      </div>
    </div>
  );
}

// The Add/Edit field dialog lives once on the page; anything can open it.
export const FIELD_DIALOG_EVENT = "ars:field-dialog";
export const openFieldDialog = (detail: { fieldId?: number }) => window.dispatchEvent(new CustomEvent(FIELD_DIALOG_EVENT, { detail }));
