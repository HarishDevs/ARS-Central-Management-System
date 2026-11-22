"use client";

import { CalendarPlus, Copy } from "lucide-react";
import { useState } from "react";
import { calendarFeedAction } from "@/app/users/work/extras-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { useWorkCall } from "@/features/work/client";

// v1.70.0 (D-383, "pm_extras"): a person's secret calendar address for My
// Tasks or a project. The address is shown once, when made or rotated (only a
// hash is kept); after that the panel says when it was made and last read.
export function CalendarFeedPanel({ scope, projectId = null, current }: { scope: "MY_TASKS" | "PROJECT"; projectId?: number | null; current: { hint: string; createdAt: string; lastUsedAt: string | null } | null }) {
  const { call, pending } = useWorkCall();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(current);
  const make = async () => {
    const result = await call(() => calendarFeedAction(scope, projectId, "MAKE"));
    if (result?.ok && result.value) {
      setUrl(result.value.url);
      setCopied(false);
      setActive({ hint: result.value.url.slice(-8, -4), createdAt: new Date().toISOString(), lastUsedAt: null });
    }
  };
  const revoke = async () => {
    const result = await call(() => calendarFeedAction(scope, projectId, "REVOKE"));
    if (result?.ok) {
      setUrl(null);
      setActive(null);
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return (
    <div className="space-y-3" data-testid="calendar-feed">
      <p className="text-caption text-ink-muted">
        Add {scope === "PROJECT" ? "this project's" : "your"} open tasks with a due date to Google Calendar, Outlook or your phone&apos;s calendar. The address is personal and secret: anyone who has it can read these task names and dates, so don&apos;t share it. It shows only tasks you can see, and stops if you lose access.
      </p>
      {url && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-muted px-3 py-2">
          <label htmlFor={`feed-url-${scope}-${projectId ?? 0}`} className="field-label">
            Your calendar address (shown only now)
          </label>
          <div className="flex flex-wrap gap-2">
            <input id={`feed-url-${scope}-${projectId ?? 0}`} readOnly value={url} className="field-input h-9 min-w-0 flex-1 font-mono text-caption" onFocus={(event) => event.currentTarget.select()} data-testid="feed-url" />
            <button type="button" className="btn-secondary h-9" onClick={copy}>
              <Copy aria-hidden="true" className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-caption text-ink-muted">In your calendar app choose “Add calendar → From URL” (Google) or “Subscribe from web” (Outlook) and paste it. Calendars refresh it every few hours.</p>
        </div>
      )}
      <p className="text-label" aria-live="polite">
        {active ? `A calendar address ending …${active.hint} is on (made ${when(active.createdAt)}${active.lastUsedAt ? `, last read ${when(active.lastUsedAt)}` : ", not read yet"}).` : "No calendar address yet."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={pending} onClick={make}>
          <CalendarPlus aria-hidden="true" className="h-4 w-4" /> {active ? "Make a new address (the old one stops)" : "Make a calendar address"}
        </button>
        {active && (
          <ConfirmButton className="btn-secondary" title="Stop this calendar address?" body="Calendars using it stop getting your tasks. You can make a new address later." confirmLabel="Stop it" onConfirm={revoke}>
            Stop the address
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}
