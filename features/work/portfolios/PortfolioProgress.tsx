"use client";

import { useEffect, useId, useRef, useState } from "react";
import { portfolioStatusAction, removePortfolioStatusAction } from "@/app/users/work/portfolio-actions";
import { useWorkCall } from "@/features/work/client";
import { RichText } from "@/features/work/RichText";
import { StatusPill, dayWords } from "@/features/work/portfolios/PortfolioList";
import { STATUS_KIND_LABEL, STATUS_KINDS, type ProjectStatusKind } from "@/server/work/access";

// v1.69.0 (D-382, spec PORTFOLIOS §3.19): Progress: how many of the rows the
// person can see are on track, at risk or off track (by their latest
// status update), the portfolio's own status updates (owners and editors
// post them; a status and a headline or summary are needed) and About.
// The goals block of the spec is not built (no goals in ARS-CMS yet).
export function PortfolioProgress({
  portfolioId,
  counts,
  hidden,
  updates,
  canPost,
  canManage,
  meId,
  initialStatus,
  about,
  fresh,
}: {
  portfolioId: number;
  counts: { onTrack: number; atRisk: number; offTrack: number; total: number };
  hidden: number;
  updates: { id: number; status: ProjectStatusKind; title: string; body: string | null; authorId: number; authorName: string; createdAt: string }[];
  canPost: boolean;
  canManage: boolean;
  meId: number;
  initialStatus?: string;
  about: { ownerName: string; startOn: string | null; dueOn: string | null; description: string; rowVersion: number };
  fresh: boolean; // the latest update is from the last 14 days (worked out on the server)
}) {
  const latest = updates[0] ?? null;
  const card = (label: string, value: number, testId: string) => (
    <div className="card px-4 py-3" data-testid={testId}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-caption text-ink-muted">{label}</p>
    </div>
  );
  return (
    <section aria-label="Progress" className="space-y-4" data-testid="portfolio-progress">
      <h2 className="text-label font-semibold">{latest ? (fresh ? `Latest status: ${STATUS_KIND_LABEL[latest.status]}` : "This portfolio could use a fresh status update.") : "This portfolio has no status yet."}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {card(counts.onTrack === 1 ? "Project on track" : "Projects on track", counts.onTrack, "count-on-track")}
        {card(counts.atRisk === 1 ? "Project at risk" : "Projects at risk", counts.atRisk, "count-at-risk")}
        {card(counts.offTrack === 1 ? "Project off track" : "Projects off track", counts.offTrack, "count-off-track")}
        {card(counts.total === 1 ? "Item in total" : "Items in total", counts.total, "count-total")}
      </div>
      {hidden > 0 && <p className="text-caption text-ink-muted">Counts leave out the {hidden} {hidden === 1 ? "item" : "items"} you can&apos;t see.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {canPost && <StatusComposer portfolioId={portfolioId} initial={initialStatus} />}
          <div className="card px-5 py-4">
            <h3 className="mb-2 font-semibold">Status updates</h3>
            {updates.length === 0 ? (
              <p className="text-label text-ink-muted">No status updates yet.{canPost ? " Post the first one above." : ""}</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="portfolio-updates">
                {updates.map((update) => (
                  <li key={update.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={update.status} />
                      <span className="font-medium">{update.title}</span>
                    </div>
                    <p className="text-caption text-ink-muted">
                      {update.authorName} · {new Date(update.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {update.body && <RichText text={update.body} className="text-label" />}
                    {update.authorId === meId && <RemoveUpdate statusId={update.id} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <aside className="card h-fit px-5 py-4" aria-label="About this portfolio">
          <h3 className="mb-2 font-semibold">About this portfolio</h3>
          <dl className="space-y-2 text-label">
            <div>
              <dt className="text-caption text-ink-muted">Portfolio owner</dt>
              <dd>{about.ownerName}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Dates</dt>
              <dd>{about.startOn || about.dueOn ? `${dayWords(about.startOn)} to ${dayWords(about.dueOn)}` : "No dates"}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Description</dt>
              <dd className="whitespace-pre-line">{about.description || <span className="text-ink-muted">No description.</span>}</dd>
            </div>
          </dl>
          {canManage && <p className="mt-3 text-caption text-ink-muted">Change these with the ⌄ menu beside the name › Edit details.</p>}
        </aside>
      </div>
    </section>
  );
}

function RemoveUpdate({ statusId }: { statusId: number }) {
  const { call, pending } = useWorkCall();
  return (
    <button type="button" className="link text-caption" disabled={pending} onClick={() => void call(() => removePortfolioStatusAction(statusId))}>
      Delete
    </button>
  );
}

function StatusComposer({ portfolioId, initial }: { portfolioId: number; initial?: string }) {
  const { call, pending } = useWorkCall();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState(initial ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!initial) return;
    form.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    form.current?.querySelector<HTMLInputElement>(`#${CSS.escape(`${id}-title`)}`)?.focus({ preventScroll: true });
  }, [initial, id]);
  return (
    <form
      ref={form}
      id="post-status"
      aria-label="Post a status update"
      className="card space-y-3 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!status) return setError("Pick a status.");
        if (!title.trim() && !body.trim()) return setError("Pick a status and add a headline or a summary before posting.");
        setError("");
        void call(() => portfolioStatusAction(portfolioId, { status, title, body })).then((result) => {
          if (result?.ok) {
            setTitle("");
            setBody("");
            setStatus("");
          }
        });
      }}
    >
      <h3 className="font-semibold">Update status</h3>
      <fieldset>
        <legend className="field-label">How is it going?</legend>
        <div className="flex flex-wrap gap-3">
          {STATUS_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 text-label">
              <input type="radio" name={`${id}-status`} value={kind} checked={status === kind} onChange={() => setStatus(kind)} /> {STATUS_KIND_LABEL[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${id}-title`} className="field-label">
          Headline
        </label>
        <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="field-input" placeholder="e.g. Two projects late on vendor quotes" data-testid="status-title" />
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="field-label">
          Summary <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <textarea id={`${id}-body`} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={3} className="field-input" placeholder="What happened, what's blocked, what's next." />
      </div>
      {error && (
        <p role="alert" className="text-label text-danger-600">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending} data-testid="post-status">
        Post status update
      </button>
    </form>
  );
}
