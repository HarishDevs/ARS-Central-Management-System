"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { portfolioCommandAction } from "@/app/users/work/portfolio-actions";
import { useWorkCall } from "@/features/work/client";

// v1.69.0 (D-382): small shared pieces of the portfolio screens.
export function PortfolioStar({ portfolioId, starred, name }: { portfolioId: number; starred: boolean; name: string }) {
  const { call } = useWorkCall();
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={`${starred ? "Unstar" : "Star"} ${name}`}
      title={starred ? "Starred: shown in the sidebar" : "Star to keep it in the sidebar"}
      onClick={() => void call(() => portfolioCommandAction(portfolioId, "STAR"), { success: false })}
      className={`rounded p-1 ${starred ? "text-warning-600" : "text-ink-faint hover:text-warning-600"}`}
      data-testid="portfolio-star"
    >
      <Star aria-hidden="true" className="h-4 w-4" fill={starred ? "currentColor" : "none"} />
    </button>
  );
}

export function PortfolioCommandButton({ portfolioId, command, label, danger, confirmText }: { portfolioId: number; command: "JOIN" | "LEAVE" | "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE"; label: string; danger?: boolean; confirmText?: string }) {
  const { call, pending } = useWorkCall();
  const [asking, setAsking] = useState(false);
  if (asking)
    return (
      <span className="inline-flex flex-wrap items-center gap-2 rounded-md bg-danger-50 px-2 py-1 text-label" role="group" aria-label={`Confirm: ${label}`}>
        {confirmText}
        <button type="button" className="btn-danger btn-compact" disabled={pending} onClick={() => void call(() => portfolioCommandAction(portfolioId, command)).then(() => setAsking(false))}>
          {pending ? "Working…" : `Yes, ${label.toLowerCase()}`}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </span>
    );
  return (
    <button type="button" disabled={pending} className={`${danger ? "btn-danger" : "btn-secondary"} btn-compact`} onClick={() => (confirmText ? setAsking(true) : void call(() => portfolioCommandAction(portfolioId, command)))}>
      {label}
    </button>
  );
}

// Task progress (BR-PORT-008): a bar and the words ("4 of 6 tasks done (66%)").
export function ProgressMeter({ percent, text }: { percent: number; text: string }) {
  return (
    <div className="flex min-w-36 items-center gap-2">
      <div role="meter" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text} className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-caption text-ink-muted" data-testid="task-progress">
        {text}
      </span>
    </div>
  );
}
