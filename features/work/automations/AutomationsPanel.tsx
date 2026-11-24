"use client";

import { RelativeTime } from "@/features/ui/RelativeTime";
import { EmptyState } from "@/features/ui/Display";
import { Copy, Pencil, Plus, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAutomationAction, deleteAutomationAction, duplicateAutomationAction, setAutomationEnabledAction } from "@/app/users/work/automation-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { useWorkCall } from "@/features/work/client";

// v1.68.0 (D-380, spec PROJECTS_CUSTOMIZATION §2.1): Customize → Automations.
// The project's rules in creation order, each with its trigger, state and
// last run ("Disabled · Last run …", "Never run", "Paused"). Owners and
// editors see it; builders add, edit, switch on/off, duplicate and delete.
export interface RuleRowView {
  id: number;
  name: string;
  trigger: string;
  published: boolean;
  version: number;
  draftChanged: boolean;
  enabled: boolean;
  paused: string | null;
  ownerName: string;
  lastRunAt: string | null;
  lastResult: string | null;
}
// v1.89.0 (D-425, ERR-01): "Last run 2 h ago" depends on now: the relative text is drawn after mount.
export function LastRun({ row }: { row: Pick<RuleRowView, "lastRunAt" | "lastResult"> }) {
  if (!row.lastRunAt) return <>Never run</>;
  const result = row.lastResult === "FAILED" ? " (failed)" : row.lastResult === "SKIPPED" ? " (skipped)" : "";
  return (
    <>
      Last run <RelativeTime at={row.lastRunAt} />
      {result}
    </>
  );
}

export function AutomationsPanel({ projectId, rows, build, limit }: { projectId: number; rows: RuleRowView[]; build: boolean; limit: number }) {
  const { call, pending } = useWorkCall();
  const router = useRouter();
  const base = `/users/work/projects/${projectId}/automations`;
  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30";
  return (
    <div className="space-y-3" data-testid="automations-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">Rules that act on this project&apos;s tasks when something happens, on a schedule or from a web request. Each acts with its owner&apos;s rights. {rows.length} of {limit}.</p>
        {build && (
          <button
            type="button"
            className="btn-primary btn-compact inline-flex shrink-0 items-center gap-1"
            disabled={pending || rows.length >= limit}
            data-testid="add-automation"
            onClick={async () => {
              const result = await call(() => createAutomationAction(projectId), { success: false });
              const id = result?.ok ? (result as { value?: { id: number } }).value?.id : undefined;
              if (id) router.push(`${base}/${id}`);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add automation
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No automations yet" body={build ? "Add one: choose what starts it, then what it does. For example: when a task moves to Done, mark it complete." : "Owners and editors of this project can add automations."} />
      ) : (
        <ul className="divide-y divide-line" aria-label="Automations">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-label" data-testid="automation-row">
              <Zap aria-hidden="true" className={`h-4 w-4 ${row.enabled && row.published && !row.paused ? "text-warning-600" : "text-ink-muted"}`} />
              <span className="min-w-0 flex-1">
                <Link href={`${base}/${row.id}`} className="link font-medium">
                  {row.name}
                </Link>
                {!row.published && <span className="ml-1 rounded-full bg-surface-muted px-2 py-0.5 text-caption font-semibold text-ink-muted">Draft</span>}
                {row.paused && <span className="ml-1 rounded-full bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-600">Paused</span>}
                <span className="block text-caption text-ink-muted" suppressHydrationWarning>
                  {row.trigger} · {row.published ? (
                    <>
                      {!row.enabled ? "Disabled · " : ""}
                      <LastRun row={row} />
                      {row.draftChanged ? " · unpublished changes" : ""}
                    </>
                  ) : (
                    "Not published"
                  )} · owner {row.ownerName}
                </span>
              </span>
              {build && (
                <>
                  <label className="inline-flex items-center gap-1 text-caption">
                    <input type="checkbox" role="switch" checked={row.enabled} disabled={pending} aria-label={`${row.name}: switched on`} onChange={(event) => void call(() => setAutomationEnabledAction(row.id, event.target.checked))} />
                    On
                  </label>
                  <Link href={`${base}/${row.id}`} className={icon} aria-label={`Edit ${row.name}`} title="Edit">
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    className={icon}
                    disabled={pending || rows.length >= limit}
                    aria-label={`Duplicate ${row.name}`}
                    title="Duplicate"
                    onClick={async () => {
                      const result = await call(() => duplicateAutomationAction(row.id));
                      const id = result?.ok ? (result as { value?: { id: number } }).value?.id : undefined;
                      if (id) router.push(`${base}/${id}`);
                    }}
                  >
                    <Copy aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <ConfirmButton
                    className={`${icon} hover:text-danger-600`}
                    ariaLabel={`Delete ${row.name}`}
                    title={`Delete “${row.name}”?`}
                    body="The automation and its run log are removed. What it already changed on tasks stays."
                    onConfirm={() => call(() => deleteAutomationAction(row.id))}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </ConfirmButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
