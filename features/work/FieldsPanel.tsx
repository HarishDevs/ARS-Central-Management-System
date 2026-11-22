"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { fieldDefAction } from "@/app/users/work/actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { useWorkCall } from "@/features/work/client";
import { FieldGlyph, OptionChip, openFieldDialog } from "@/features/work/FieldControls";
import { FIELD_TYPE_LABEL, type FieldView } from "@/server/work/custom-fields";

// v1.64.0 (D-371, spec PC §8.2): a project's Fields (Customize › Fields):
// each field with its type and an option preview; edit, move, show on Board
// cards, remove from the project (values kept), delete (restorable for 30
// days); then the fields removed from the project and the deleted ones.
export interface GoneField {
  id: number;
  name: string;
  kind: FieldView["kind"];
  library: boolean;
  until?: string; // deleted: "removed for good on …"
  canRestore: boolean;
}
export function FieldsPanel({ projectId, fields, customise, removed, deleted }: { projectId: number; fields: FieldView[]; customise: boolean; removed: GoneField[]; deleted: GoneField[] }) {
  const { call, pending } = useWorkCall();
  const act = (change: Parameters<typeof fieldDefAction>[1]) => call(() => fieldDefAction(projectId, change));
  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30";
  return (
    <div className="space-y-4" data-testid="fields-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">Your own columns for this project&apos;s tasks, shown in the List, on Board cards and on each task.</p>
        {customise && (
          <button type="button" className="btn-primary btn-compact inline-flex items-center gap-1" onClick={() => openFieldDialog({})} data-testid="add-field">
            <Plus aria-hidden="true" className="h-4 w-4" /> Add field
          </button>
        )}
      </div>
      <ul className="divide-y divide-line" aria-label="Fields">
        {fields.length === 0 && <li className="py-2 text-label text-ink-muted">No fields yet. Use custom fields to track stage, cost, plant or whatever brings clarity.</li>}
        {fields.map((field, index) => (
          <li
            key={field.id}
            className="flex flex-wrap items-center gap-2 py-2 text-label"
            tabIndex={customise ? 0 : undefined}
            aria-keyshortcuts={customise ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            onKeyDown={(event) => {
              if (!customise || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.target !== event.currentTarget) return;
              event.preventDefault();
              void act({ op: "move", fieldId: field.id, direction: event.key === "ArrowUp" ? "up" : "down" });
            }}
            data-testid="field-row"
          >
            <FieldGlyph kind={field.kind} className="h-4 w-4" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{field.name}</span>{" "}
              <span className="text-caption text-ink-muted">
                · {FIELD_TYPE_LABEL[field.kind]}
                {field.library ? " · library" : ""}
                {field.notify ? " · notifies followers" : ""}
                {field.kind === "ID" && field.idPrefix ? ` · ${field.idPrefix}-n` : ""}
              </span>
              <span className="mt-0.5 flex flex-wrap gap-1 text-caption text-ink-muted">
                {field.choices?.filter((choice) => !choice.archived).length
                  ? [
                      ...field.choices
                        .filter((choice) => !choice.archived)
                        .slice(0, 4)
                        .map((choice) => <OptionChip key={choice.id} name={choice.name} color={choice.color} />),
                      field.choices.filter((choice) => !choice.archived).length > 4 ? <span key="more">+{field.choices.filter((choice) => !choice.archived).length - 4}</span> : null,
                    ]
                  : (field.description ?? "No description provided")}
              </span>
            </span>
            {customise && (
              <label className="flex items-center gap-1.5 text-caption text-ink-muted">
                <input type="checkbox" checked={field.showOnCards !== false} disabled={pending} onChange={(event) => void act({ op: "cards", fieldId: field.id, show: event.target.checked })} /> On cards
              </label>
            )}
            {customise && (
              <>
                <button type="button" aria-label={`Move ${field.name} up`} disabled={index === 0 || pending} onClick={() => void act({ op: "move", fieldId: field.id, direction: "up" })} className={icon}>
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Move ${field.name} down`} disabled={index === fields.length - 1 || pending} onClick={() => void act({ op: "move", fieldId: field.id, direction: "down" })} className={icon}>
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                </button>
              </>
            )}
            {field.canEdit && (
              <button type="button" aria-label={`Edit field ${field.name}`} onClick={() => openFieldDialog({ fieldId: field.id })} className={icon}>
                <Pencil aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
            {customise && (
              <ConfirmButton
                ariaLabel={`Remove ${field.name} from this project`}
                title={`Remove “${field.name}” from this project?`}
                body="The column goes from this project. Its values stay on the tasks and come back if you add the field again."
                confirmLabel="Remove"
                onConfirm={() => act({ op: "remove", fieldId: field.id })}
                className={icon}
              >
                <Undo2 aria-hidden="true" className="h-4 w-4" />
              </ConfirmButton>
            )}
            {field.canEdit && (
              <ConfirmButton
                ariaLabel={`Delete field ${field.name}`}
                title={`Delete the field “${field.name}”?`}
                body={`${field.library ? "It goes from every project that uses it. " : ""}You can restore it, with its values, for 30 days. After that it is removed for good.`}
                confirmLabel="Delete field"
                onConfirm={() => act({ op: "delete", fieldId: field.id })}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint hover:bg-danger-50 hover:text-danger-600"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      {removed.length > 0 && (
        <section aria-labelledby="removed-fields">
          <h3 id="removed-fields" className="mb-1 text-label font-semibold">
            Removed from this project
          </h3>
          <ul className="divide-y divide-line" aria-label="Removed fields">
            {removed.map((field) => (
              <li key={field.id} className="flex items-center gap-2 py-1.5 text-label">
                <FieldGlyph kind={field.kind} />
                <span className="flex-1">
                  {field.name} <span className="text-caption text-ink-muted">· {FIELD_TYPE_LABEL[field.kind]}</span>
                </span>
                {customise && (
                  <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" disabled={pending} onClick={() => void act({ op: "addBack", fieldId: field.id })}>
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> Add back
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {deleted.length > 0 && (
        <section aria-labelledby="deleted-fields">
          <h3 id="deleted-fields" className="mb-1 text-label font-semibold">
            Deleted fields
          </h3>
          <ul className="divide-y divide-line" aria-label="Deleted fields">
            {deleted.map((field) => (
              <li key={field.id} className="flex items-center gap-2 py-1.5 text-label">
                <FieldGlyph kind={field.kind} />
                <span className="flex-1">
                  {field.name} <span className="text-caption text-ink-muted">· removed for good on {field.until}</span>
                </span>
                {field.canRestore && (
                  <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" disabled={pending} onClick={() => void act({ op: "restore", fieldId: field.id })}>
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
