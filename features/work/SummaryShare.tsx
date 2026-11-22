"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, Eye, Lock, UserMinus, Users } from "lucide-react";
import { Dialog } from "@/features/ui/Dialog";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { summaryShareAction } from "@/app/users/work/actions";
import { useWorkCall } from "@/features/work/client";

// v1.77.0 (D-404, owner's decision 3; spec §3.4 Manage privacy, §5.3, BR-MYT-014/015):
// Share → Manage privacy for one's own Task Summary, the switcher between the
// summaries a person may open, and the read-only banner.
export interface SharePerson {
  id: number;
  name: string;
  label: string;
}

export function ShareSummaryButton({ shares, managers, people, meId }: { shares: (SharePerson & { grantedAt: string })[]; managers: SharePerson[]; people: { id: number; label: string; detail?: string }[]; meId: number }) {
  const { call, pending } = useWorkCall();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const taken = new Set([meId, ...shares.map((share) => share.id)]);
  const choices = people.filter((person) => !taken.has(person.id));
  const invite = () => {
    if (chosen === null || pending) return;
    void call(() => summaryShareAction({ op: "add", userId: chosen })).then((result) => result?.ok && setChosen(null));
  };
  return (
    <>
      <button type="button" className="btn-secondary btn-compact" onClick={() => setOpen(true)} data-testid="my-share" aria-haspopup="dialog">
        <Lock aria-hidden="true" className="h-4 w-4" /> Share
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Share your Task Summary"
        description="People you add can open your Task Summary, read-only. Each of them sees only the tasks they're already allowed to see."
        testId="my-share-dialog"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-5">
          <section aria-labelledby="share-add-head" className="space-y-2">
            <h3 id="share-add-head" className="text-label font-semibold">
              Add people
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <PersonSelect options={choices} value={chosen} onChange={setChosen} ariaLabel="Person to share with" placeholder="Choose a person…" testId="share-person" />
              </div>
              <button type="button" className="btn-primary btn-compact" disabled={chosen === null || pending} aria-busy={pending || undefined} onClick={invite} data-testid="share-invite">
                Invite
              </button>
            </div>
            {chosen === null && <p className="text-caption text-ink-muted">Choose a person to invite.</p>}
          </section>
          <section aria-labelledby="share-who-head" className="space-y-2">
            <h3 id="share-who-head" className="text-label font-semibold">
              Who can see your Task Summary
            </h3>
            <ul className="divide-y divide-line rounded-lg border border-line" data-testid="share-list">
              <li className="flex items-center gap-2 px-3 py-2 text-label">
                <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1">You (can change it)</span>
              </li>
              {managers.map((person) => (
                <li key={`m${person.id}`} className="flex items-center gap-2 px-3 py-2 text-label" data-testid="share-manager">
                  <Users aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate">{person.label}</span>
                  <span className="shrink-0 text-caption text-ink-muted">Manager above you · read-only</span>
                </li>
              ))}
              {shares.map((person) => (
                <li key={`s${person.id}`} className="flex items-center gap-2 px-3 py-2 text-label" data-testid="share-person-row">
                  <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate">{person.label}</span>
                  <span className="shrink-0 text-caption text-ink-muted">Read-only</span>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption text-danger-600 hover:bg-danger-50"
                    disabled={pending}
                    onClick={() => void call(() => summaryShareAction({ op: "remove", userId: person.id }))}
                    aria-label={`Remove ${person.name}`}
                    data-testid="share-remove"
                  >
                    <UserMinus aria-hidden="true" className="h-4 w-4" /> Remove
                  </button>
                </li>
              ))}
            </ul>
            {!shares.length && <p className="text-caption text-ink-muted">You haven&apos;t shared it with anyone.</p>}
            <p className="text-caption text-ink-muted">Managers above you in the reporting line can always open it, read-only. Nobody can change your tasks, sections or tabs from here.</p>
          </section>
        </div>
      </Dialog>
    </>
  );
}

// The Task Summaries the person may open: their own, those shared with them,
// and their team's (managers, every level).
export function SummarySwitcher({ current, shared, team }: { current: { id: number; name: string } | null; shared: SharePerson[]; team: SharePerson[] }) {
  if (!shared.length && !team.length && !current) return null;
  const href = (id: number) => `/users/work/my-tasks?of=${id}`;
  const items: MenuItem[] = [
    { kind: "radio", label: "My Task Summary", checked: current === null, href: "/users/work/my-tasks", testId: "switch-mine" },
    ...(shared.length ? [{ kind: "heading" as const, label: "Shared with you" }, ...shared.map((person) => ({ kind: "radio" as const, label: person.label, checked: current?.id === person.id, href: href(person.id) }))] : []),
    ...(team.length ? [{ kind: "heading" as const, label: "Your team" }, ...team.map((person) => ({ kind: "radio" as const, label: person.label, checked: current?.id === person.id, href: href(person.id) }))] : []),
  ];
  return (
    <Menu
      label="Open someone's Task Summary"
      trigger={
        <span className="inline-flex items-center gap-1">
          <Users aria-hidden="true" className="h-4 w-4" /> {current ? current.name : "Others"} <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </span>
      }
      buttonClass="btn-secondary btn-compact"
      menuClass="w-72 max-h-96 overflow-y-auto"
      testId="summary-switcher"
      items={items}
    />
  );
}

export function ReadOnlyBanner({ name, why }: { name: string; why: string }) {
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info-600/30 bg-info-50 px-4 py-2.5 text-label" data-testid="summary-readonly">
      <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-info-600" />
      <span className="min-w-0 flex-1">
        Viewing: <strong>{name}&apos;s Task Summary</strong> · read-only. {why}. Only the tasks you may see are listed.
      </span>
      <Link href="/users/work/my-tasks" className="btn-secondary btn-compact" data-testid="summary-back">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to my Task Summary
      </Link>
    </div>
  );
}
