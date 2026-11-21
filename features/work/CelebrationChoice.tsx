"use client";

import { useState } from "react";
import { celebrationAction } from "@/app/users/work/actions";
import { useWorkCall } from "@/features/work/client";
import { CELEBRATION_LABEL, CELEBRATIONS, type Celebration } from "@/server/work/pm-rules";

// v1.62.0 (D-368, spec §14): the person's celebrations when they complete a
// task: Off, Occasional (about one in four, the default) or Always. Nothing
// moves when the device asks for reduced motion, whatever is chosen here.
export function CelebrationChoice({ initial, fromDefault }: { initial: Celebration; fromDefault: boolean }) {
  const { call, pending } = useWorkCall();
  const [value, setValue] = useState(initial);
  return (
    <fieldset className="space-y-2" data-testid="celebration-choice">
      <legend className="field-label">Celebrations when you complete a task</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Celebrations">
        {CELEBRATIONS.map((choice) => (
          <label key={choice} className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-label ${value === choice ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line"}`}>
            <input
              type="radio"
              name="celebrations"
              value={choice}
              checked={value === choice}
              disabled={pending}
              onChange={() => {
                const before = value;
                setValue(choice);
                void call(() => celebrationAction(choice)).then((result) => !result?.ok && setValue(before));
              }}
            />
            {CELEBRATION_LABEL[choice]}
          </label>
        ))}
      </div>
      <p className="text-caption text-ink-muted">
        A short burst of colour from the tick{fromDefault ? " (now: the organisation's default)" : ""}. It never shows if your device is set to reduce motion.
      </p>
    </fieldset>
  );
}
