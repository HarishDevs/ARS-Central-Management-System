"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { CheckCheck, X } from "lucide-react";
import { bulkApproveAction } from "@/app/users/actions";
import { Button } from "@/features/ui/Button";
import { ConfirmDialog } from "@/features/ui/Dialog";
import type { BulkOutcome } from "@/server/approvals/bulk";

// v1.90.0 (D-429, owner: "In Waiting for me page in the table itself I want
// select and bulk approval option"). Row tick boxes (table rows and phone
// cards) join one selection by their `form` attribute (the rows stay server
// components, like BulkSelect); the bar shows "N selected", Approve and
// Clear, and one optional comment for every approval. Approve asks first
// ("Approve 7 requests?"); the server approves each one on its own through
// the same engine path as a single approval and the summary lists what was
// approved and what wasn't, with the reason and a link. Approve only: no
// bulk Reject (owner). Work tasks and requests on hold have no box.
export const QUEUE_BULK_FORM = "queue-bulk-approve";
export const QUEUE_BULK_MAX = 50; // = BULK_MAX on the server
const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${QUEUE_BULK_FORM}"][name="approve"]`)];
// Only boxes that can be seen count (the table on wide screens, the cards on a phone).
const shownBoxes = () => boxes().filter((box) => box.getClientRects().length > 0);
const chosenKeys = () => [...new Set(shownBoxes().filter((box) => box.checked).map((box) => box.value))];
const announce = () => document.dispatchEvent(new Event("change"));

function useChosen(): string[] {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setKeys(chosenKeys());
    sync();
    document.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return keys;
}
function clearAll() {
  for (const box of boxes()) box.checked = false;
  announce();
}

// One row's box: its value is "<requestId>:<taskKey>"; a table row and its
// phone card share it, so ticking one ticks the other.
export function QueueRowSelect({ value, label, card = false }: { value: string; label: string; card?: boolean }) {
  return (
    <input
      type="checkbox"
      name="approve"
      value={value}
      form={QUEUE_BULK_FORM}
      aria-label={label}
      data-testid={card ? "queue-select-card" : "queue-select"}
      className={`${card ? "mt-1 h-5 w-5" : "h-4 w-4"} shrink-0 cursor-pointer accent-[color:var(--color-primary-600)]`}
      onChange={(event) => {
        for (const twin of boxes()) if (twin !== event.target && twin.value === value) twin.checked = event.target.checked;
      }}
    />
  );
}

// "Select all on this page" (the rows shown, the current filter).
// v1.91.1 (D-435): a second one in the table's tick-column header; both follow the same boxes.
export function QueueSelectAll({ label = "Select all approvals on this page", testId = "queue-select-all" }: { label?: string; testId?: string }) {
  const [state, setState] = useState<"none" | "some" | "all">("none");
  const [any, setAny] = useState(true);
  useEffect(() => {
    const sync = () => {
      const list = shownBoxes();
      const on = list.filter((box) => box.checked).length;
      setAny(list.length > 0);
      setState(on === 0 ? "none" : on === list.length ? "all" : "some");
    };
    sync();
    document.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  if (!any) return null;
  return (
    <input
      type="checkbox"
      aria-label={label}
      data-testid={testId}
      className="h-4 w-4 cursor-pointer accent-[color:var(--color-primary-600)]"
      checked={state === "all"}
      ref={(element) => {
        if (element) element.indeterminate = state === "some";
      }}
      onChange={(event) => {
        const on = event.target.checked;
        const shown = new Set(shownBoxes().map((box) => box.value));
        for (const box of boxes()) box.checked = on && shown.has(box.value);
        announce();
      }}
    />
  );
}

type Summary = { approved: BulkOutcome[]; notApproved: BulkOutcome[] };

export function QueueBulkBar({ selectable }: { selectable: number }) {
  const keys = useChosen();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, start] = useTransition();
  const commentId = useId();
  const count = keys.length;
  const tooMany = count > QUEUE_BULK_MAX;
  useEffect(() => {
    if (count === 0) setAsking(false);
  }, [count]);
  if (selectable === 0 && !summary) return null;

  const approve = () => {
    setError(null);
    start(async () => {
      try {
        const result = await bulkApproveAction(keys, comment);
        if (!result.ok) {
          setError(result.message);
          setAsking(false);
          return;
        }
        setSummary({ approved: result.outcomes.filter((item) => item.result === "APPROVED"), notApproved: result.outcomes.filter((item) => item.result !== "APPROVED") });
        setAsking(false);
        setComment("");
        clearAll();
        router.refresh();
      } catch {
        setError("Couldn't reach the server. Nothing more was approved; reload to see where things stand.");
        setAsking(false);
      }
    });
  };
  const plural = (n: number) => `${n.toLocaleString("en-IN")} request${n === 1 ? "" : "s"}`;

  return (
    // v1.91.1 (D-435, owner: "select also bring below the table"): the bar is below the table. The form
    // is display:contents so the bar's sticky box is the list wrapper (the page), not the form: with
    // rows selected it sticks to the bottom of the screen until its own place below the table.
    <form id={QUEUE_BULK_FORM} onSubmit={(event) => event.preventDefault()} aria-label="Approve the selected requests" className="contents" data-testid="queue-bulk">
      {summary && (
        <div role="status" className="mt-3 rounded-md border border-line bg-surface px-4 py-3 text-label" data-testid="queue-bulk-summary">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">
              Approved {summary.approved.length.toLocaleString("en-IN")} · Skipped {summary.notApproved.length.toLocaleString("en-IN")}
            </p>
            <button type="button" className="icon-btn-sm" aria-label="Close the summary" onClick={() => setSummary(null)}>
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          {summary.notApproved.length > 0 && (
            <ul className="mt-1 space-y-0.5" aria-label="Not approved">
              {summary.notApproved.map((item) => (
                <li key={`${item.requestId}:${item.taskKey}`}>
                  {item.requestNo ? (
                    <Link href={`/users/requests/${item.requestId}`} className="link">
                      {item.requestNo}
                    </Link>
                  ) : (
                    <span>A request</span>
                  )}
                  <span className="text-ink-muted">: {item.message}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.approved.length > 0 && (
            <p className="mt-1 text-caption text-ink-muted">
              Approved: {summary.approved.map((item, index) => (
                <span key={`${item.requestId}:${item.taskKey}`}>
                  {index > 0 && ", "}
                  <Link href={`/users/requests/${item.requestId}`} className="link">
                    {item.requestNo ?? item.requestId}
                  </Link>
                </span>
              ))}
              . Each was recorded and the people concerned are told, as for a single approval.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-200 bg-danger-50 px-4 py-2 text-label text-danger-700">
          {error}
        </p>
      )}
      {selectable > 0 && (
        <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-4 py-2 ${count > 0 ? "queue-bulk-sticky" : ""}`} data-testid="queue-bulk-bar" data-sticky={count > 0 ? "1" : undefined}>
          <label className="flex min-h-9 items-center gap-2 text-label">
            <QueueSelectAll />
            <span aria-live="polite">{count > 0 ? `${count.toLocaleString("en-IN")} selected` : "Select approvals to approve several at once"}</span>
          </label>
          {count > 0 && (
            <>
              <Button size="sm" onClick={() => setAsking(true)} disabled={busy || tooMany} data-testid="queue-bulk-approve" icon={<CheckCheck aria-hidden="true" className="h-4 w-4" />}>
                Approve {count.toLocaleString("en-IN")}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAll} disabled={busy}>
                Clear
              </Button>
              {tooMany && (
                <p role="alert" className="text-caption text-danger-600">
                  Approve up to {QUEUE_BULK_MAX} at a time.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {count > 0 && (
        <div className="mt-2 max-w-xl">
          <label htmlFor={commentId} className="field-label">
            Comment for every approval (optional)
          </label>
          <textarea id={commentId} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} rows={2} className="field-input h-auto py-2" placeholder="e.g. Checked in the weekly review" data-testid="queue-bulk-comment" />
        </div>
      )}
      <ConfirmDialog
        open={asking && count > 0}
        onCancel={() => setAsking(false)}
        onConfirm={approve}
        busy={busy}
        busyLabel="Approving…"
        title={`Approve ${plural(count)}?`}
        body={
          <>
            Each is approved on its own, as if you opened it and pressed Approve: it is your decision for each one, recorded and told to the people concerned. Anything that can&apos;t be approved here (a work task, on hold, already decided) is skipped and listed.
            {comment.trim() ? <span className="mt-2 block">Comment on each: “{comment.trim()}”</span> : null}
          </>
        }
        confirmLabel={`Approve ${count.toLocaleString("en-IN")}`}
      />
    </form>
  );
}
