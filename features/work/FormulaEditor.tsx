"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formulaPreviewAction } from "@/app/users/work/actions";
import { FIELD_TYPE_LABEL, type FieldType, type FieldView } from "@/server/work/custom-fields";
import { analyseFormula, BUILTIN_LABEL, BUILTINS, FORMULA_FUNCTIONS, FORMULA_MAX_LENGTH, FORMULA_PRESETS, formulaFromText, presetText, type Builtin, type FormulaPreset, type FunctionHelp, type FxField, type FxType } from "@/server/work/formula";

// v1.88.0 (D-418, owner: "use all these as simple formulas"; spec
// FORMULA_FIELDS §2): the Formula tab of the Add field dialog. Simple mode
// (Select field, which lists the task's dates and Today too; operators that
// follow the input's type: a date can only be subtracted), the Functions
// list with a help card for each (click to insert), ready-made formulas (the
// owner's Asana fields), live checking with the same rules as the server and
// a preview on a task of the project. The server checks everything again.
export const FORMULA_SOURCES: readonly FieldType[] = ["NUMBER", "DATE", "FORMULA", "TIMER"];
export type FormulaCheck = { ok: true; expr: string; type: FxType } | { ok: false; message: string } | null;

// The formula as typed, checked (null while it is empty).
export function checkFormulaText(text: string, fields: readonly FieldView[], editingId: number | null): FormulaCheck {
  if (!text.trim()) return null;
  const sources = fields.filter((field) => FORMULA_SOURCES.includes(field.kind) && field.id !== editingId);
  const typed = formulaFromText(text, sources);
  if (!typed.ok) return typed;
  const map = new Map<number, FxField>(fields.map((field) => [field.id, { id: field.id, name: field.name, kind: field.kind, formula: field.config?.formula }]));
  const analysis = analyseFormula(typed.expr, map, editingId);
  return analysis.ok ? { ok: true, expr: typed.expr, type: analysis.type } : { ok: false, message: analysis.message };
}

const OPERATORS = [
  ["+", "plus", "Add"],
  ["−", "minus", "Subtract"],
  ["×", "times", "Multiply"],
  ["÷", "divided by", "Divide"],
] as const;

export function FormulaEditor({ projectId, fields, editingId, formula, setFormula, check, name, setName }: { projectId: number; fields: FieldView[]; editingId: number | null; formula: string; setFormula: (text: string) => void; check: FormulaCheck; name: string; setName: (name: string) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [pick, setPick] = useState("");
  const [fn, setFn] = useState<FunctionHelp | null>(null);
  const [preset, setPreset] = useState<FormulaPreset | null>(null);
  const [presetField, setPresetField] = useState("");
  const [preview, setPreview] = useState<{ state: "idle" | "busy" | "done" | "none" | "error"; text?: string; taskNo?: string; title?: string; failed?: boolean }>({ state: "idle" });
  const sources = useMemo(() => fields.filter((field) => FORMULA_SOURCES.includes(field.kind) && field.id !== editingId), [fields, editingId]);
  const dateFields = sources.filter((field) => field.kind === "DATE");

  // The type of an input: a date field, a formula that gives a date, or a task date.
  const typeOfInput = (key: string): FxType | null => {
    if (key.startsWith("b:")) return "date";
    const field = sources.find((item) => `f:${item.id}` === key);
    if (!field) return null;
    if (field.kind === "DATE") return "date";
    if (field.kind !== "FORMULA") return "number";
    const checked = checkFormulaText(`[${field.name}]`, fields, editingId);
    return checked?.ok ? checked.type : "number";
  };
  const labelOf = (key: string) => (key.startsWith("b:") ? BUILTIN_LABEL[key.slice(2) as Builtin] : (sources.find((item) => `f:${item.id}` === key)?.name ?? ""));
  // Operators follow the input picked (else the last one in the formula).
  const keyOf = (label: string | undefined): string => {
    const wanted = label?.trim().toLowerCase();
    if (!wanted) return "";
    const field = sources.find((item) => item.name.trim().toLowerCase() === wanted);
    if (field) return `f:${field.id}`;
    const builtin = BUILTINS.find((key) => BUILTIN_LABEL[key].toLowerCase() === wanted);
    return builtin ? `b:${builtin}` : "";
  };
  const inputType = typeOfInput(pick || keyOf(/\[([^\]]+)\]\s*$/.exec(formula)?.[1]));

  // Put text where the cursor is (at the end when the box wasn't used); `back` moves the cursor back.
  const insert = (text: string, back = 0) => {
    const area = box.current;
    const start = area && document.activeElement === area ? area.selectionStart : formula.length;
    const end = area && document.activeElement === area ? area.selectionEnd : formula.length;
    const before = formula.slice(0, start);
    const spaced = before && !/[\s(]$/.test(before) && !/^[),]/.test(text) ? ` ${text}` : text;
    const next = `${before}${spaced}${formula.slice(end)}`;
    setFormula(next);
    requestAnimationFrame(() => {
      const at = before.length + spaced.length - back;
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
    });
  };

  const applyPreset = (item: FormulaPreset, chosen: string | null) => {
    setFormula(presetText(item, chosen));
    if (!name.trim()) setName(item.name);
    setPreset(null);
    setPresetField("");
  };
  const choosePreset = (item: FormulaPreset) => {
    if (!item.needs) return applyPreset(item, null);
    const match = dateFields.find((field) => field.name.trim().toLowerCase() === item.needs!.toLowerCase());
    if (match) return applyPreset(item, match.name);
    setPreset(item);
  };

  // Live preview on a task of the project (after typing stops).
  const expr = check?.ok ? check.expr : null;
  useEffect(() => {
    if (!expr) {
      setPreview({ state: "idle" });
      return;
    }
    let live = true;
    setPreview((value) => ({ ...value, state: "busy" }));
    const timer = setTimeout(() => {
      void formulaPreviewAction(projectId, formula, editingId)
        .then((result) => {
          if (!live) return;
          if (!result.ok) setPreview({ state: "error", text: result.message });
          else if (!result.value) setPreview({ state: "none" });
          else setPreview({ state: "done", ...result.value, failed: result.value.error });
        })
        .catch(() => live && setPreview({ state: "error", text: "Couldn't work out the preview." }));
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The text is sent as typed; `expr` changes whenever it means something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr, projectId, editingId]);

  return (
    <div className="space-y-3" data-testid="formula-builder">
      <div className="space-y-1.5" data-testid="formula-presets">
        <p className="flex items-center gap-1.5 text-label font-medium">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-primary-600" /> Ready-made formulas
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FORMULA_PRESETS.map((item) => (
            <button key={item.key} type="button" className="btn-secondary btn-compact" title={`${item.help} ${item.text}`} aria-label={`Use the ready-made formula ${item.name}: ${item.help}`} onClick={() => choosePreset(item)}>
              {item.name}
            </button>
          ))}
        </div>
        {preset && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-muted px-3 py-2" data-testid="preset-field">
            <div>
              <label htmlFor="preset-date-field" className="field-label">
                {preset.name} needs a date field for “{preset.needs}”
              </label>
              {dateFields.length ? (
                <select id="preset-date-field" value={presetField} onChange={(event) => setPresetField(event.target.value)} className="field-input h-9 w-56">
                  <option value="">Choose a date field</option>
                  {dateFields.map((field) => (
                    <option key={field.id} value={field.name}>
                      {field.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p role="alert" className="text-caption text-warning-700">
                  This project has no date fields. Add a date field called “{preset.needs}” first.
                </p>
              )}
            </div>
            {dateFields.length > 0 && (
              <button type="button" className="btn-primary btn-compact" disabled={!presetField} onClick={() => applyPreset(preset, presetField)}>
                Use {preset.name}
              </button>
            )}
            <button type="button" className="btn-secondary btn-compact" onClick={() => setPreset(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Field to insert" value={pick} onChange={(event) => setPick(event.target.value)} className="field-input h-9 w-52">
          <option value="">Select field</option>
          {sources.length > 0 && (
            <optgroup label="Fields of this project">
              {sources.map((field) => (
                <option key={field.id} value={`f:${field.id}`}>
                  {field.name} ({FIELD_TYPE_LABEL[field.kind]})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Task dates">
            {BUILTINS.map((key) => (
              <option key={key} value={`b:${key}`}>
                {BUILTIN_LABEL[key]}
              </option>
            ))}
          </optgroup>
        </select>
        <button type="button" className="btn-secondary btn-compact" disabled={!pick} onClick={() => insert(`[${labelOf(pick)}]`)}>
          Insert field
        </button>
        {OPERATORS.map(([sign, label, word]) => {
          const off = inputType === "date" && sign !== "−";
          return (
            <button key={sign} type="button" aria-label={`Insert ${label}`} title={off ? `${word}: a date can only be subtracted (use DATEADD to add days)` : word} disabled={off} onClick={() => insert(`${sign} `)} className="h-9 w-9 rounded-md border border-line font-mono hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40">
              {sign}
            </button>
          );
        })}
        {[
          ["(", "open bracket"],
          [")", "close bracket"],
        ].map(([sign, label]) => (
          <button key={sign} type="button" aria-label={`Insert ${label}`} onClick={() => insert(sign!)} className="h-9 w-9 rounded-md border border-line font-mono hover:bg-surface-muted">
            {sign}
          </button>
        ))}
      </div>
      {inputType === "date" && <p className="text-caption text-ink-muted">A date can only be subtracted: date − date gives days. To move a date, use DATEADD or DATESUBTRACT.</p>}

      <label htmlFor="field-formula" className="field-label">
        Formula
      </label>
      <textarea
        ref={box}
        id="field-formula"
        rows={2}
        value={formula}
        maxLength={FORMULA_MAX_LENGTH}
        onChange={(event) => setFormula(event.target.value)}
        placeholder="DAYS([Start date], [Due date])"
        className="field-input h-auto py-2 font-mono"
        aria-describedby="formula-help"
        aria-invalid={check !== null && !check.ok}
        spellCheck={false}
      />
      <p id="formula-help" className={`text-caption ${check && !check.ok ? "text-danger-600" : "text-ink-muted"}`} role={check && !check.ok ? "alert" : undefined} data-testid="formula-check">
        {check && !check.ok
          ? check.message
          : check?.ok
            ? `Looks right: the result is ${check.type === "date" ? "a date" : "a number"}. ${formula.length}/${FORMULA_MAX_LENGTH} characters.`
            : "Fields and task dates go in [brackets]; use numbers, + − × ÷, ( ) and the functions below. A date minus a date gives days. An empty input leaves the result empty (COALESCE gives a fallback)."}
      </p>
      {check?.ok && (
        <p className="rounded-md border border-line px-3 py-2 text-label" aria-live="polite" data-testid="formula-preview">
          <span className="text-ink-muted">Preview: </span>
          {preview.state === "busy" || preview.state === "idle" ? (
            <span className="text-ink-muted">working it out…</span>
          ) : preview.state === "none" ? (
            <span className="text-ink-muted">add a task to the project to see a result.</span>
          ) : preview.state === "error" ? (
            <span className="text-danger-600">{preview.text}</span>
          ) : (
            <>
              <span className={`font-semibold tabular-nums ${preview.failed ? "text-danger-600" : ""}`}>{preview.text || "(empty)"}</span>
              <span className="text-ink-muted">
                {" "}
                on {preview.taskNo} {preview.title}
              </span>
            </>
          )}
        </p>
      )}

      <details className="rounded-md border border-line" data-testid="formula-functions">
        <summary className="cursor-pointer px-3 py-2 text-label font-medium">Functions</summary>
        <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-[11rem_1fr]">
          <ul className="max-h-56 space-y-0.5 overflow-y-auto" aria-label="Functions">
            {FORMULA_FUNCTIONS.map((item) => (
              <li key={item.name}>
                <button type="button" aria-pressed={fn?.name === item.name} onClick={() => setFn(item)} className={`w-full rounded px-2 py-1 text-left font-mono text-label hover:bg-surface-muted ${fn?.name === item.name ? "bg-primary-50 text-primary-700" : ""}`}>
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
          {fn ? (
            <div className="space-y-1.5 text-label" data-testid="function-help">
              <p className="font-mono font-semibold">{fn.signature}</p>
              <p>{fn.help}</p>
              <p className="text-caption text-ink-muted">
                Example: <code className="font-mono">{fn.example}</code>
              </p>
              <button type="button" className="btn-secondary btn-compact" onClick={() => insert(`${fn.name}()`, 1)}>
                Insert {fn.name}
              </button>
            </div>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-caption text-ink-muted">
              <li>Choose a function to see what it does, then Insert it.</li>
              <li>Put fields, dates or numbers inside its brackets, separated by commas.</li>
              <li>Check the brackets are in the right place; the line under the box says when it reads right.</li>
            </ol>
          )}
        </div>
      </details>
    </div>
  );
}
