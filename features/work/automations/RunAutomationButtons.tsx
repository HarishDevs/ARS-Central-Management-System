"use client";

import { Zap } from "lucide-react";
import { runAutomationOnTaskAction } from "@/app/users/work/automation-actions";
import { useWorkCall } from "@/features/work/client";

// v1.68.0 (D-380): "Run automation" on one task, for its projects' rules
// whose trigger is "Run by hand" (shown to the projects' owners and editors).
export function RunAutomationButtons({ taskId, rules, compact }: { taskId: number; rules: { id: number; name: string; projectName: string }[]; compact?: boolean }) {
  const { call, pending } = useWorkCall();
  if (!rules.length) return null;
  return (
    <div className={compact ? "border-t border-line pt-1" : "space-y-1"} role="group" aria-label="Run automation" data-testid="run-automation">
      {!compact && <p className="text-caption font-semibold text-ink-muted">Run automation</p>}
      {rules.map((rule) => (
        <button
          key={rule.id}
          type="button"
          disabled={pending}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-label hover:bg-surface-muted"
          onClick={() => void call(() => runAutomationOnTaskAction(rule.id, taskId))}
          title={`From ${rule.projectName}`}
        >
          <Zap aria-hidden="true" className="h-4 w-4 text-warning-600" /> Run “{rule.name}”
        </button>
      ))}
    </div>
  );
}
