"use client";

import { useState } from "react";
import { projectScheduleAction } from "@/app/users/work/schedule-actions";
import { useWorkCall } from "@/features/work/client";
import { SHIFT_MODE_LABEL, SHIFT_MODES, type ShiftMode } from "@/server/work/schedule";

// v1.65.0 (D-373, spec PM §3.11 tabs Dependencies and Scheduling): what
// dependent tasks do when a task they wait for moves, and whether those moves
// count working days only (the Working calendar's weekly offs and holidays).
// Saved as soon as a choice changes; owners only (the server checks again).
export function DependenciesPanel({ projectId, mode, canManage }: { projectId: number; mode: ShiftMode; canManage: boolean }) {
  const { call, pending } = useWorkCall();
  const [value, setValue] = useState<ShiftMode>(mode);
  return (
    <fieldset disabled={!canManage || pending} data-testid="dependencies-settings">
      <legend className="mb-2 text-caption text-ink-muted">When a task&apos;s dates change, its dependent tasks (in this project) …</legend>
      <div className="space-y-1.5">
        {SHIFT_MODES.map((option) => (
          <label key={option} className="flex items-start gap-2 text-label">
            <input
              type="radio"
              name={`shift-${projectId}`}
              value={option}
              checked={value === option}
              onChange={() => {
                const before = value;
                setValue(option);
                void call(() => projectScheduleAction(projectId, { mode: option })).then((result) => result?.ok || setValue(before));
              }}
              className="mt-1"
            />
            <span>{SHIFT_MODE_LABEL[option]}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-caption text-ink-muted">Done tasks never move. Dates are moved for everyone in one go, the task&apos;s history says why, and the person who moved it can Undo for 15 minutes.</p>
      {!canManage && <p className="mt-1 text-caption text-ink-muted">Only the project&apos;s owners can change this.</p>}
    </fieldset>
  );
}

export function SchedulingPanel({ projectId, skipOffDays, canManage }: { projectId: number; skipOffDays: boolean; canManage: boolean }) {
  const { call, pending } = useWorkCall();
  const [value, setValue] = useState(skipOffDays);
  return (
    <div data-testid="scheduling-settings">
      <label className="flex items-start gap-2 text-label">
        <input
          type="checkbox"
          checked={value}
          disabled={!canManage || pending}
          onChange={(event) => {
            const on = event.target.checked;
            setValue(on);
            void call(() => projectScheduleAction(projectId, { skipOffDays: on })).then((result) => result?.ok || setValue(!on));
          }}
          className="mt-1"
        />
        <span>Skip weekly offs and holidays when moving dependent tasks (the Working calendar set by IT)</span>
      </label>
      <p className="mt-1 text-caption text-ink-muted">Off: a move of 3 days is 3 calendar days. Weekly offs and holidays are also shaded in the Timeline and Gantt.</p>
      {/* v1.74.0 (D-398) */}
      <p className="mt-1 text-caption text-ink-muted">Durations (From to To), estimates from dates and the critical path always count working days.</p>
    </div>
  );
}
