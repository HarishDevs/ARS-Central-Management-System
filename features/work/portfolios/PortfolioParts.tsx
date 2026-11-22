"use client";

import { ExternalLink, Link2, MoreHorizontal, Star, UserPlus } from "lucide-react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
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

// v1.73.0 (D-396, spec PORTFOLIOS §3.1 #9 "Show options"): a portfolio card's
// ⋯ menu on the Portfolios page: Open, Copy portfolio link, star, Join.
export function PortfolioCardMenu({ portfolioId, name, starred, canJoin }: { portfolioId: number; name: string; starred: boolean; canJoin: boolean }) {
  const { call } = useWorkCall();
  const toast = useToast();
  const href = `/users/work/portfolios/${portfolioId}`;
  const items: MenuItem[] = [
    { label: "Open portfolio", icon: <ExternalLink className="h-4 w-4" />, href },
    { label: "Copy portfolio link", icon: <Link2 className="h-4 w-4" />, onSelect: () => void copyText(`${window.location.origin}${href}`).then((done) => toast(done ? { tone: "success", title: "Portfolio link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${href}` })) },
    { label: starred ? "Remove from starred" : "Add to starred", icon: <Star className="h-4 w-4" />, onSelect: () => void call(() => portfolioCommandAction(portfolioId, "STAR"), { success: false }) },
    ...(canJoin ? [{ label: "Join portfolio", icon: <UserPlus className="h-4 w-4" />, onSelect: () => void call(() => portfolioCommandAction(portfolioId, "JOIN")) }] : []),
  ];
  return <Menu label={`Options for ${name}`} title="Options" trigger={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />} buttonClass="grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink" menuClass="w-52" testId="portfolio-card-menu" items={items} />;
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
