"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { archiveAction, binAction, overrideAction, purgeAction, restoreAction } from "@/app/superadmin/control/actions";
import { FieldError, ResultMessage, useActionForm } from "@/features/ui/form";
import { Spinner } from "@/features/ui/Spinner";
import { useTypedConfirm } from "@/features/ui/DangerZone";

// v1.94.0 (D-451..D-458): the Super Admin control panel's forms. Each opens
// in place, asks for a reason (always required, checked on the server too),
// and refreshes the page when done. Destructive ones are red; Delete
// permanently also asks for the item's number to be typed.
const ACTIONS = {
  archive: archiveAction,
  bin: binAction,
  restore: restoreAction,
  override: overrideAction,
} as const;
export type ControlFormKind = keyof typeof ACTIONS;

export function ControlActionForm({
  kind,
  hidden,
  label,
  title,
  note,
  submitLabel,
  danger = false,
  reasonPlaceholder = "Why? (at least 5 characters; it is kept in the item's history and the audit log)",
  children,
  testId,
}: {
  kind: ControlFormKind;
  hidden: Record<string, string | number>;
  label: string; // the button that opens the form
  title: string;
  note?: string;
  submitLabel: string;
  danger?: boolean;
  reasonPlaceholder?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit } = useActionForm(ACTIONS[kind]);
  const router = useRouter();
  const id = useId();
  useEffect(() => {
    if (result?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [result, router]);
  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setOpen(true)} className={`${danger ? "btn-danger-quiet" : "btn-secondary"} btn-compact`} data-testid={testId ? `${testId}-open` : undefined}>
          {label}
        </button>
        {result?.ok && <ResultMessage result={result} />}
      </div>
    );
  }
  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={`${id}-title`}
      className={`space-y-3 rounded-md border p-3 ${danger ? "border-danger-200 bg-danger-50" : "border-line bg-surface-muted"}`}
      data-testid={testId}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p id={`${id}-title`} className={`text-label font-semibold ${danger ? "text-danger-600" : ""}`}>
        {title}
      </p>
      {note && <p className="text-caption text-ink-muted">{note}</p>}
      {children}
      <div>
        <label htmlFor={`${id}-reason`} className="field-label">
          Reason
        </label>
        <textarea
          id={`${id}-reason`}
          name="reason"
          rows={2}
          maxLength={500}
          required
          minLength={5}
          className="field-input h-auto py-2"
          placeholder={reasonPlaceholder}
          aria-describedby={`reason-error`}
        />
        <FieldError result={result} name="reason" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className={
            danger
              ? "btn-compact inline-flex items-center gap-2 rounded-md bg-danger-solid px-3 text-label font-semibold text-on-solid hover:bg-danger-solid-hover disabled:opacity-60"
              : "btn-primary btn-compact inline-flex items-center gap-2"
          }
        >
          {pending && <Spinner />}
          {submitLabel}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className="btn-secondary btn-compact">
          Cancel
        </button>
      </div>
      {result && !result.ok && <ResultMessage result={result} />}
    </form>
  );
}

// Delete permanently: allowed only after 30 days in the bin; the item's number typed to confirm.
export function PurgeForm({ entryId, word, daysLeft, label }: { entryId: number; word: string; daysLeft: number; label: string }) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit } = useActionForm(purgeAction);
  const { field, ready } = useTypedConfirm(word);
  const router = useRouter();
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  if (daysLeft > 0)
    return (
      <p className="text-caption text-ink-muted">
        Delete permanently in {daysLeft} day{daysLeft === 1 ? "" : "s"}
      </p>
    );
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-danger-quiet btn-compact" data-testid="purge-open">
        Delete permanently
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} aria-label={`Delete ${label} permanently`} className="space-y-3 rounded-md border border-danger-200 bg-danger-50 p-3" data-testid="purge-form">
      <input type="hidden" name="entryId" value={entryId} />
      <p className="text-label font-semibold text-danger-600">Delete {label} permanently?</p>
      <p className="text-caption text-ink-muted">
        Its details, history, comments and files are removed for good, with whatever went into the bin with it. The audit log keeps the record that it existed. This can&apos;t be undone.
      </p>
      {field}
      <FieldError result={result} name="confirmText" />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !ready}
          className="btn-compact inline-flex items-center gap-2 rounded-md bg-danger-solid px-3 text-label font-semibold text-on-solid hover:bg-danger-solid-hover disabled:opacity-60"
        >
          {pending && <Spinner />}
          Delete permanently
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className="btn-secondary btn-compact">
          Cancel
        </button>
      </div>
      {result && !result.ok && <ResultMessage result={result} />}
    </form>
  );
}
