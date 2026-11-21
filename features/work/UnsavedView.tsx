"use client";

import { RotateCcw } from "lucide-react";

// v1.61.0 (D-367, spec PRJ-15): a view's filters, sort, groups and columns
// change only what this person sees until someone who may edit the project
// presses "Save view" (then everyone sees the tab that way). Reset goes back
// to the saved view.
export function UnsavedView({ canSave, onSave, onReset, pending }: { canSave: boolean; onSave: () => void; onReset: () => void; pending?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="unsaved-view">
      <span className="rounded-full bg-warning-50 px-2 py-0.5 text-caption font-medium text-warning-600">Unsaved changes</span>
      <button type="button" onClick={onReset} className="tb-btn" data-testid="reset-view">
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> Reset
      </button>
      {canSave && (
        <button type="button" onClick={onSave} disabled={pending} className="btn-primary btn-compact" data-testid="save-view">
          Save view
        </button>
      )}
    </span>
  );
}
