"use client";

import { ArrowDown, ArrowUp, GripVertical, Info, Lock, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fieldDefAction, fieldLibraryAction } from "@/app/users/work/actions";
import { Dialog } from "@/features/ui/Dialog";
import { InlineLoading } from "@/features/ui/Spinner";
import { useWorkCall } from "@/features/work/client";
import { FIELD_DIALOG_EVENT, FieldGlyph, OPTION_COLOR_NAMES, optionStyle } from "@/features/work/FieldControls";
import {
  cleanIdPrefix,
  DEFAULT_CONFIG,
  FIELD_TYPE_HELP,
  FIELD_TYPE_LABEL,
  FIELD_TYPES,
  formatNumber,
  idText,
  LEGACY_TYPES,
  NOTIFY_TYPES,
  NUMBER_FORMAT_LABEL,
  NUMBER_FORMATS,
  type FieldConfig,
  type FieldType,
  type FieldView,
} from "@/server/work/custom-fields";
import { formulaText } from "@/server/work/formula";
import { checkFormulaText, FormulaEditor } from "@/features/work/FormulaEditor";

// v1.64.0 (D-371, spec PC §8.3–8.8): the Add field dialog (Create new /
// Choose from library) and the same dialog to edit a field. One instance per
// page, opened by openFieldDialog() from the List's column menu, the "+"
// column, the Fields settings and the Customize link. The server checks
// every rule again.
interface OptionRow {
  key: string;
  id: number | null;
  name: string;
  color: number;
  archived: boolean;
}
type LibraryItem = { id: number; name: string; kind: string; description: string | null; options: string[]; usage: number; createdBy: string };

let rowKey = 0;
const newRow = (color: number): OptionRow => ({ key: `n${(rowKey += 1)}`, id: null, name: "", color, archived: false });

export function FieldDialogHost({ projectId, projectName, fields, customiseRole, planning }: { projectId: number; projectName: string; fields: FieldView[]; customiseRole: "EDITOR" | "OWNER"; planning: boolean }) {
  const [open, setOpen] = useState<{ fieldId: number | null } | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => setOpen({ fieldId: (event as CustomEvent<{ fieldId?: number }>).detail?.fieldId ?? null });
    window.addEventListener(FIELD_DIALOG_EVENT, onOpen);
    return () => window.removeEventListener(FIELD_DIALOG_EVENT, onOpen);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  if (!open) return null;
  const editing = open.fieldId ? (fields.find((field) => field.id === open.fieldId) ?? null) : null;
  return <FieldDialog key={open.fieldId ?? "new"} projectId={projectId} projectName={projectName} fields={fields} editing={editing} customiseRole={customiseRole} planning={planning} onClose={close} />;
}

function FieldDialog({ projectId, projectName, fields, editing, customiseRole, planning, onClose }: { projectId: number; projectName: string; fields: FieldView[]; editing: FieldView | null; customiseRole: "EDITOR" | "OWNER"; planning: boolean; onClose: () => void }) {
  const { call, pending } = useWorkCall();
  const [tab, setTab] = useState<"new" | "library">("new");
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<FieldType>(editing?.kind ?? "SELECT"); // BR-PROJ-070: Single-select by default
  const [description, setDescription] = useState(editing?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(editing?.description));
  const [options, setOptions] = useState<OptionRow[]>(() =>
    editing?.choices?.length ? editing.choices.map((choice) => ({ key: `o${choice.id}`, id: choice.id, name: choice.name, color: choice.color, archived: choice.archived })) : [newRow(1), newRow(2)],
  );
  const [config, setConfig] = useState<FieldConfig>({ ...DEFAULT_CONFIG, ...(editing?.config ?? {}) });
  const names = useMemo(() => new Map(fields.map((field) => [field.id, field.name])), [fields]);
  const [formula, setFormula] = useState(() => (editing?.config?.formula ? formulaText(editing.config.formula, names) : ""));
  const [formulaTab, setFormulaTab] = useState<"formula" | "format">("formula");
  const [idPrefix, setIdPrefix] = useState(editing?.idPrefix ?? "");
  const [library, setLibrary] = useState(editing?.library ?? false);
  const [notify, setNotify] = useState(editing?.notify ?? false);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const types = planning ? FIELD_TYPES : LEGACY_TYPES;
  const references = fields.filter((field) => field.kind === "REFERENCE" && field.id !== editing?.id);
  const targets = fields.filter((field) => !["FORMULA", "LOOKUP", "REFERENCE"].includes(field.kind) && field.id !== editing?.id);
  const set = (change: Partial<FieldConfig>) => setConfig((value) => ({ ...value, ...change }));

  // The formula as typed ([Field name] + 2) becomes {f12} + 2 for the server;
  // v1.88.0 (D-418): checked live with the server's rules (types, limits).
  const formulaCheck = type === "FORMULA" ? checkFormulaText(formula, fields, editing?.id ?? null) : null;
  // Formatting is for a formula that reads right and gives a number.
  const formatOk = formulaCheck?.ok === true && formulaCheck.type === "number";

  const submit = async () => {
    setError("");
    let formulaValue = config.formula;
    if (type === "FORMULA") {
      if (!formulaCheck) return setError("Formula: Write a formula.");
      if (!formulaCheck.ok) return setError(`Formula: ${formulaCheck.message}`);
      formulaValue = formulaCheck.expr;
    }
    if (type === "ID" && !editing && !cleanIdPrefix(idPrefix)) return setError("Give a prefix: capital letters or digits, starting with a letter (for example PO).");
    const input = {
      name,
      type,
      description: showDescription ? description : null,
      library: type === "ID" ? true : library,
      notify: NOTIFY_TYPES.includes(type) ? notify : false,
      config: { ...config, formula: formulaValue },
      options: options.filter((row) => row.name.trim()).map((row) => ({ id: row.id, name: row.name, color: row.color, archived: row.archived })),
      idPrefix: type === "ID" ? idPrefix : null,
    };
    const result = await call(() => fieldDefAction(projectId, editing ? { op: "update", fieldId: editing.id, input } : { op: "create", input }));
    if (result?.ok) onClose();
    else if (result) setError(result.message);
  };

  const moveOption = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= options.length) return;
    setOptions((rows) => {
      const next = [...rows];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setLive(`${options[index]!.name || "Option"} moved to position ${target + 1} of ${options.length}.`);
  };

  const title = editing ? `Edit field: ${editing.name}` : "Add field";
  const accessText = customiseRole === "OWNER" ? "Only this project's admins (owners) add and change its fields." : "This project's owners and editors add and change its fields.";
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        tab === "new" ? (
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary btn-compact" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary btn-compact" disabled={!name.trim() || pending || (formulaCheck !== null && !formulaCheck.ok)} onClick={() => void submit()} data-testid="field-dialog-save">
              {editing ? "Save field" : "Create field"}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4" data-testid="field-dialog">
        {!editing && planning && (
          <div role="tablist" aria-label="Add field" className="flex gap-1 border-b border-line">
            {(["new", "library"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                id={`field-tab-${key}`}
                aria-controls={`field-panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = key === "new" ? "library" : "new";
                    setTab(next);
                    document.getElementById(`field-tab-${next}`)?.focus();
                  }
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-label ${tab === key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                {key === "new" ? "Create new" : "Choose from library"}
              </button>
            ))}
          </div>
        )}
        {tab === "library" ? (
          <LibraryPanel projectId={projectId} inProject={fields.map((field) => field.id)} onAdded={onClose} />
        ) : (
          <div id="field-panel-new" role={!editing && planning ? "tabpanel" : undefined} aria-labelledby={!editing && planning ? "field-tab-new" : undefined} className="space-y-4">
            <p className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-caption text-ink-muted">
              <Info aria-hidden="true" className="h-4 w-4 shrink-0" />
              {editing?.library ? "A library field: changes show in every project that uses it." : `This field ${editing ? "belongs to" : "will be added to"} ${projectName}.`}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="field-title" className="field-label">
                  Field title <span aria-hidden="true" className="text-danger-600">*</span>
                </label>
                <input id="field-title" data-autofocus required aria-required="true" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} className="field-input" placeholder="e.g. Stage, Cost, Reviewer" />
              </div>
              <div>
                <label htmlFor="field-type" className="field-label">
                  Field type
                </label>
                <select id="field-type" value={type} disabled={Boolean(editing)} onChange={(event) => setType(event.target.value as FieldType)} className="field-input" aria-describedby="field-type-help">
                  {types.map((item) => (
                    <option key={item} value={item}>
                      {FIELD_TYPE_LABEL[item]}
                    </option>
                  ))}
                </select>
                <p id="field-type-help" className="mt-1 flex items-center gap-1 text-caption text-ink-muted">
                  <FieldGlyph kind={type} /> {editing ? "The type can't change after the field is made." : FIELD_TYPE_HELP[type]}
                </p>
              </div>
            </div>
            {showDescription ? (
              <div>
                <label htmlFor="field-description" className="field-label">
                  Description
                </label>
                <textarea id="field-description" rows={2} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} className="field-input h-auto py-2" />
              </div>
            ) : (
              <button type="button" className="link inline-flex items-center gap-1 text-label" onClick={() => setShowDescription(true)}>
                <Plus aria-hidden="true" className="h-4 w-4" /> Add description
              </button>
            )}

            {(type === "SELECT" || type === "MULTI_SELECT") && (
              <fieldset className="space-y-2" data-testid="field-options">
                <legend className="field-label">Options</legend>
                <ol className="space-y-1.5">
                  {options.map((row, index) => (
                    <li key={row.key} className={`flex items-center gap-1.5 ${row.archived ? "opacity-60" : ""}`}>
                      <span aria-hidden="true" className="text-ink-faint">
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <select
                        aria-label={`Colour of option ${index + 1}`}
                        value={row.color}
                        onChange={(event) => setOptions((rows) => rows.map((item) => (item.key === row.key ? { ...item, color: Number(event.target.value) } : item)))}
                        className="field-input field-compact w-28 py-0 text-label"
                        style={optionStyle(row.color)}
                      >
                        {OPTION_COLOR_NAMES.map((label, color) => (
                          <option key={color} value={color}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Option ${index + 1}`}
                        value={row.name}
                        maxLength={60}
                        placeholder="Type an option name"
                        onChange={(event) => setOptions((rows) => rows.map((item) => (item.key === row.key ? { ...item, name: event.target.value } : item)))}
                        onKeyDown={(event) => {
                          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                            event.preventDefault();
                            moveOption(index, event.key === "ArrowUp" ? -1 : 1);
                          }
                        }}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        className="field-input field-compact min-w-0 flex-1 text-label"
                      />
                      <button type="button" aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => moveOption(index, -1)} className="rounded p-1 text-ink-muted hover:bg-surface-muted disabled:opacity-30">
                        <ArrowUp aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Move option ${index + 1} down`} disabled={index === options.length - 1} onClick={() => moveOption(index, 1)} className="rounded p-1 text-ink-muted hover:bg-surface-muted disabled:opacity-30">
                        <ArrowDown aria-hidden="true" className="h-4 w-4" />
                      </button>
                      {row.id ? (
                        <button type="button" onClick={() => setOptions((rows) => rows.map((item) => (item.key === row.key ? { ...item, archived: !item.archived } : item)))} className="rounded px-1.5 py-1 text-caption text-ink-muted hover:bg-surface-muted" aria-label={`${row.archived ? "Bring back" : "Archive"} option ${row.name}`}>
                          {row.archived ? "Bring back" : "Archive"}
                        </button>
                      ) : (
                        <button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setOptions((rows) => rows.filter((item) => item.key !== row.key))} className="rounded p-1 text-ink-muted hover:bg-surface-muted">
                          <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <button type="button" className="link inline-flex items-center gap-1 text-label" onClick={() => setOptions((rows) => [...rows, newRow((rows.length % 8) + 1)])}>
                  <Plus aria-hidden="true" className="h-4 w-4" /> Add an option
                </button>
                <p className="text-caption text-ink-muted">Archived options stay on tasks but can&apos;t be chosen again. Alt + ↑ / ↓ moves an option.</p>
              </fieldset>
            )}

            {(type === "NUMBER" || (type === "FORMULA" && formulaTab === "format" && formatOk)) && <NumberFormat config={config} set={set} />}

            {type === "DATE" && (
              <label className="flex items-center gap-2 text-label">
                <input type="checkbox" checked={config.withTime} onChange={(event) => set({ withTime: event.target.checked })} /> Include a time
              </label>
            )}

            {type === "FORMULA" && (
              <div className="space-y-2">
                <div role="tablist" aria-label="Formula and formatting" className="flex gap-1">
                  {(["formula", "format"] as const).map((key) => {
                    const locked = key === "format" && !formatOk;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={formulaTab === key}
                        aria-disabled={locked || undefined}
                        disabled={locked}
                        title={locked ? (formulaCheck?.ok ? "This formula gives a date; formatting is for numbers." : "Check the formula is written correctly to use the formatting options.") : undefined}
                        onClick={() => setFormulaTab(key)}
                        className={`rounded-md px-3 py-1 text-label disabled:cursor-not-allowed disabled:opacity-50 ${formulaTab === key ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:bg-surface-muted"}`}
                      >
                        {key === "formula" ? "Formula" : "Formatting"}
                      </button>
                    );
                  })}
                </div>
                {formulaTab === "format" && !formatOk && (
                  <p className="text-caption text-ink-muted" data-testid="format-locked">
                    {formulaCheck?.ok ? "This formula gives a date, shown as a date; formatting is for numbers." : "Check the formula is written correctly to use the formatting options."}
                  </p>
                )}
                {formulaTab === "formula" && <FormulaEditor projectId={projectId} fields={fields} editingId={editing?.id ?? null} formula={formula} setFormula={setFormula} check={formulaCheck} name={name} setName={setName} />}
              </div>
            )}

            {type === "ID" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="field-prefix" className="field-label">
                    Prefix
                  </label>
                  <input id="field-prefix" value={idPrefix} disabled={Boolean(editing)} maxLength={10} onChange={(event) => setIdPrefix(event.target.value.toUpperCase())} placeholder="PO, REQ, JOB" className="field-input font-mono" />
                </div>
                <div>
                  <p className="field-label">Preview</p>
                  <p className="pt-2 font-mono text-label" data-testid="id-preview" aria-live="polite">
                    {cleanIdPrefix(idPrefix) ? idText(cleanIdPrefix(idPrefix)!, 1) : "—"}
                  </p>
                </div>
                <p className="text-caption text-ink-muted sm:col-span-2">Every task in the project gets the next number now, and each new task when it is added. Numbers never change.</p>
              </div>
            )}
            {type === "TIMER" && <p className="text-caption text-ink-muted">Shows the time spent as hours and minutes (h:mm). Everyone who may work on the task starts and stops their own timer; the field adds them up.</p>}
            {type === "REFERENCE" && <p className="text-caption text-ink-muted">Source: tasks. Each task can link up to 20 other tasks you can see.</p>}
            {type === "LOOKUP" &&
              (references.length === 0 ? (
                <p role="alert" className="rounded-md bg-warning-50 px-3 py-2 text-label text-warning-700">
                  No reference fields are available to use; create one first.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="field-reference" className="field-label">
                      Reference field
                    </label>
                    <select id="field-reference" value={config.referenceFieldId ?? ""} disabled={Boolean(editing)} onChange={(event) => set({ referenceFieldId: event.target.value ? Number(event.target.value) : null })} className="field-input">
                      <option value="">Choose…</option>
                      {references.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="field-target" className="field-label">
                      Field to show from the linked task
                    </label>
                    <select id="field-target" value={config.targetFieldId ?? ""} onChange={(event) => set({ targetFieldId: event.target.value ? Number(event.target.value) : null })} className="field-input">
                      <option value="">Choose…</option>
                      {targets.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

            {planning && (
              <div className="space-y-2 border-t border-line pt-3">
                <label className="flex items-start gap-2 text-label">
                  <input type="checkbox" className="mt-1" checked={type === "ID" || library} disabled={type === "ID" || Boolean(editing?.library)} onChange={(event) => setLibrary(event.target.checked)} data-testid="field-library" />
                  <span>
                    Add to the ARS field library
                    <span className="block text-caption text-ink-muted">{type === "ID" ? "ID fields are always library fields, so numbers stay unique across projects." : "Other projects can then use it; changes show everywhere."}</span>
                  </span>
                </label>
                {NOTIFY_TYPES.includes(type) && (
                  <label className="flex items-start gap-2 text-label">
                    <input type="checkbox" className="mt-1" checked={notify} onChange={(event) => setNotify(event.target.checked)} data-testid="field-notify" />
                    <span>
                      Notify collaborators when this field&apos;s value is changed
                      <span className="block text-caption text-ink-muted">The task&apos;s followers get a notification.</span>
                    </span>
                  </label>
                )}
                <p className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <Lock aria-hidden="true" className="h-3.5 w-3.5" /> Access: {accessText} {library || editing?.library ? "A library field is changed only by its creator and the IT team." : ""}
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-label text-danger-600">
                {error}
              </p>
            )}
            <span role="status" aria-live="polite" className="sr-only">
              {live}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function NumberFormat({ config, set }: { config: FieldConfig; set: (change: Partial<FieldConfig>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="number-format">
      <div>
        <label htmlFor="field-format" className="field-label">
          Format
        </label>
        <select id="field-format" value={config.format} onChange={(event) => set({ format: event.target.value as FieldConfig["format"] })} className="field-input">
          {NUMBER_FORMATS.map((format) => (
            <option key={format} value={format}>
              {NUMBER_FORMAT_LABEL[format]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="field-decimals" className="field-label">
          Decimal places
        </label>
        <select id="field-decimals" value={config.decimals} onChange={(event) => set({ decimals: Number(event.target.value) })} className="field-input">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="field-label">Example</p>
        <p className="pt-2 tabular-nums text-label" data-testid="number-example" aria-live="polite">
          {formatNumber(1000, config)}
        </p>
      </div>
      {config.format === "currency" && (
        <div>
          <label htmlFor="field-symbol" className="field-label">
            Currency symbol
          </label>
          <input id="field-symbol" value={config.symbol} maxLength={5} onChange={(event) => set({ symbol: event.target.value })} className="field-input" />
        </div>
      )}
      {config.format === "unit" && (
        <>
          <div>
            <label htmlFor="field-unit" className="field-label">
              Unit
            </label>
            <input id="field-unit" value={config.unit} maxLength={12} onChange={(event) => set({ unit: event.target.value })} placeholder="kg, hrs, MT" className="field-input" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-label">
            <input type="checkbox" checked={config.unitBefore} onChange={(event) => set({ unitBefore: event.target.checked })} /> Unit before the number
          </label>
        </>
      )}
    </div>
  );
}

function LibraryPanel({ projectId, inProject, onAdded }: { projectId: number; inProject: number[]; onAdded: () => void }) {
  const { call, pending } = useWorkCall();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => void fieldLibraryAction(q).then((result) => setItems(result.ok ? (result.value ?? []) : [])), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div id="field-panel-library" role="tabpanel" aria-labelledby="field-tab-library" className="space-y-3" data-testid="field-library-panel">
      <label className="flex items-center gap-2">
        <Search aria-hidden="true" className="h-4 w-4 text-ink-muted" />
        <span className="sr-only">Search the field library</span>
        <input type="search" data-search-kind="finder" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search the field library" className="field-input field-compact" />
      </label>
      {items === null ? (
        <InlineLoading />
      ) : items.length === 0 ? (
        <p className="text-label text-ink-muted">No library fields{q ? " match" : " yet"}. Tick “Add to the ARS field library” when you create a field to share it.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Library fields">
          {items.map((item) => {
            const added = inProject.includes(item.id);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-label">
                <FieldGlyph kind={item.kind as FieldType} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.name}</span> <span className="text-caption text-ink-muted">· {FIELD_TYPE_LABEL[item.kind as FieldType] ?? item.kind}</span>
                  <span className="block truncate text-caption text-ink-muted">
                    {item.options.length ? item.options.slice(0, 3).join(", ") + (item.options.length > 3 ? ` +${item.options.length - 3}` : "") : (item.description ?? "No description provided")} · {item.usage} project{item.usage === 1 ? "" : "s"} · by {item.createdBy}
                  </span>
                </span>
                <button type="button" className="btn-secondary btn-compact" disabled={added || pending} aria-label={added ? `${item.name} is in this project` : `Add ${item.name} to this project`} onClick={() => void call(() => fieldDefAction(projectId, { op: "attach", fieldId: item.id })).then((result) => result?.ok && onAdded())}>
                  {added ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

