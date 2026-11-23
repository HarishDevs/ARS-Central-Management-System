import Link from "next/link";
import { SafeText } from "@/features/ui/SafeText";
import { recordsTabsOn, RECORDS_TABS, type RecordsTab } from "@/features/admin/RecordsTabs";
import { listRecords, RECORDS_PAGE_SIZE } from "@/lib/db/repositories/records.repository";
import { listTickets } from "@/lib/db/repositories/tickets.repository";
import { listMeetings } from "@/lib/db/repositories/meetings.repository";
import { readRecordFilter } from "@/server/records/filters";
import { isAdminActor } from "@/server/modules/tasks";
import { scopeFor } from "@/server/meetings/service";
import { logError } from "@/lib/logging/logger";
import type { AuthenticatedUser } from "@/types/auth";

// v1.85.0 (D-412, owner's Admin redesign): one search across records on the
// Admin overview. Each kind is searched with its own Records query (the same
// filters, scopes and permission checks as its tab: no new data access); the
// first five of each show, with a link to the full list and each record's pane.
type Hit = { id: number; no: string; title: string };
const SHOWN = 5;

async function search(kind: RecordsTab, q: string, user: AuthenticatedUser): Promise<{ hits: Hit[]; total: number }> {
  if (kind === "tickets") {
    const { items, total } = await listTickets({ scope: "all", categoryId: null, status: null, q, page: 1 }, { id: user.id, isAdmin: isAdminActor(user) });
    return { hits: items.slice(0, SHOWN).map((item) => ({ id: item.id, no: item.ticketNo, title: item.title })), total };
  }
  if (kind === "meetings") {
    const { rows, total } = await listMeetings(await scopeFor(user), { tab: "all", userId: user.id, q, typeId: null, departmentId: null, status: null, from: null, to: null, page: 1, pageSize: SHOWN });
    return { hits: rows.map((row) => ({ id: row.id, no: row.meetingNo, title: row.title })), total };
  }
  const result = await listRecords(kind, readRecordFilter(kind, { q }));
  return { hits: (result.rows as { id: number; no: string; title: string }[]).slice(0, Math.min(SHOWN, RECORDS_PAGE_SIZE)).map((row) => ({ id: row.id, no: row.no, title: row.title })), total: result.total };
}

export async function RecordSearchResults({ user, q }: { user: AuthenticatedUser; q: string }) {
  const kinds = await recordsTabsOn(user);
  const results = await Promise.all(
    kinds.map((kind) =>
      search(kind, q, user).catch((error: unknown) => {
        logError(`admin record search: ${kind} failed`, error);
        return null;
      }),
    ),
  );
  const query = new URLSearchParams({ q }).toString();
  const any = results.some((result) => result && result.total > 0);
  return (
    <div className="mt-4" data-testid="record-search-results">
      <p role="status" className="mb-3 text-label text-ink-muted">
        {any ? `Results for “${q}”` : `Nothing matches “${q}” in any records.`}
      </p>
      {any && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kinds.map((kind, index) => {
            const result = results[index];
            const tab = RECORDS_TABS.find((item) => item.key === kind)!;
            if (result === undefined) return null;
            return (
              <section key={kind} className="card" aria-labelledby={`hits-${kind}`}>
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <h3 id={`hits-${kind}`} className="font-semibold">
                    {tab.label} <span className="text-ink-muted">({result ? result.total.toLocaleString("en-IN") : "—"})</span>
                  </h3>
                  {result && result.total > 0 && (
                    <Link href={`${tab.href}?${query}`} className="link text-label">
                      See all<span className="sr-only"> {tab.label.toLowerCase()}</span>
                    </Link>
                  )}
                </div>
                {result === null ? (
                  <p className="px-4 py-3 text-label text-ink-muted">Couldn&apos;t search these just now.</p>
                ) : result.hits.length === 0 ? (
                  <p className="px-4 py-3 text-label text-ink-muted">No match.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {result.hits.map((hit) => (
                      <li key={hit.id}>
                        <Link href={`${tab.href}?${query}&open=${hit.id}`} className="block px-4 py-2 text-label hover:bg-surface-muted">
                          <span className="font-medium text-primary-700">{hit.no}</span> <SafeText text={hit.title} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
