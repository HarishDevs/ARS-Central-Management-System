import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader, EmptyState } from "@/features/shell/PageHeader";
import { NoResults } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { PendingLink } from "@/features/ui/PendingLink";
import { SafeText } from "@/features/ui/SafeText";
import { PriorityPill } from "@/features/ui/ChoicePill";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { listSentBackFor } from "@/lib/db/repositories/approvals.repository";
import { priorityRecord } from "@/server/approvals/priority-lookup";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { applyDefaultListView } from "@/server/lists/views";
import { groupRows } from "@/server/lists/group-rows";
import { listHref } from "@/server/lists/superadmin-lists";
import { applySentBack, daysWaiting, filterCount, parseSentBackFilter, sentBackBucket, sentBackChoices, SENT_BACK_GROUP_LABEL, SENT_BACK_GROUPS, SENT_BACK_PAGE_SIZE, type SentBackRow } from "@/server/lists/sent-back";
import { ListPage } from "@/features/ui/ListPage";

// WEB-05: a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Sent back for changes" };
export const dynamic = "force-dynamic";

const PATH = "/users/queue/sent-back";
const TARGET = "list_sent_back";
const COLUMNS = 9;

// v1.59.1 (D-359, owner: "Sent back for changes: this i dont want as a
// seperate table … Give me a seperate page with table format with all the
// table related features we used so far"): what this person sent back for
// changes, still with the requester. It comes back to Waiting for me as a
// normal approval when the requester resubmits.
export default async function SentBackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const filter = parseSentBackFilter(query);
  const all = await listSentBackFor(user.id);
  const priority = await priorityRecord(all.map((row) => row.requestId), user);
  const now = new Date();
  const rows = applySentBack(all, filter, priority, now);
  const choices = sentBackChoices(all);
  const pages = Math.max(1, Math.ceil(rows.length / SENT_BACK_PAGE_SIZE));
  const page = Math.min(filter.page, pages);
  // Grouped: every row in its group (the list is short); otherwise a page at a time.
  const shown = filter.group ? rows : rows.slice((page - 1) * SENT_BACK_PAGE_SIZE, page * SENT_BACK_PAGE_SIZE);
  const head = sortHeads(PATH, query, filter.sort);
  const count = filterCount(filter);
  const keep = { group: filter.group ?? undefined, sortBy: typeof query.sortBy === "string" ? query.sortBy : undefined, dir: typeof query.dir === "string" ? query.dir : undefined };
  const select = (name: string, label: string, value: string, options: string[]) => (
    <div>
      <label htmlFor={`sb-${name}`} className="field-label">
        {label}
      </label>
      <select id={`sb-${name}`} name={name} defaultValue={value} className="field-input field-compact">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
  const rowOf = (row: SentBackRow) => {
    const days = daysWaiting(row, now);
    return (
      <tr key={row.requestId} data-testid="sent-back-row">
        <td>
          <Link href={`/users/requests/${row.requestId}`} className="link">
            <SafeText text={row.title} />
          </Link>
          <p className="text-caption text-ink-muted">{row.requestNo}</p>
        </td>
        <td>{row.typeName}</td>
        <td>
          <PriorityPill priority={priority[row.requestId]} />
        </td>
        <td>{row.requesterName}</td>
        <td>{row.departmentName ?? "—"}</td>
        <td>
          {row.nodeLabel}
          {row.forName && <p className="text-caption text-ink-muted">for {row.forName}</p>}
        </td>
        <td className="whitespace-nowrap">{formatIndiaTime(row.sentAt)}</td>
        <td className="whitespace-nowrap">{days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</td>
        <td className="max-w-xs text-ink-muted">{row.reason ? <SafeText text={row.reason} /> : "—"}</td>
      </tr>
    );
  };
  return (
    <ListPage
      header={
          <PageHeader
            title="Sent back for changes"
            description="Requests you sent back, now with the requester. Open one to review it; when they resubmit, it is back in Waiting for me for your approval."
          />
      }
    >
      <ListToolbar
        id="sent-back-filters"
        path={PATH}
        label="Filter sent-back requests"
        keep={keep}
        search={{ name: "q", value: filter.q, placeholder: "Search number, title, requester or reason" }}
        filterCount={count}
        clearHref={count || filter.q ? listHref(PATH, query, { q: null, type: null, requester: null, dept: null, step: null, from: null, to: null }) : null}
        group={groupMenu(PATH, query, filter.group, SENT_BACK_GROUPS, SENT_BACK_GROUP_LABEL)}
        filters={
          <>
            {select("type", "Approval type", filter.type, choices.types)}
            {select("requester", "Requester", filter.requester, choices.requesters)}
            {select("dept", "Department", filter.dept, choices.departments)}
            {select("step", "Your step", filter.step, choices.steps)}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="sb-from" className="field-label">
                  Sent back from
                </label>
                <input id="sb-from" name="from" type="date" defaultValue={filter.from} className="field-input field-compact" />
              </div>
              <div>
                <label htmlFor="sb-to" className="field-label">
                  to
                </label>
                <input id="sb-to" name="to" type="date" defaultValue={filter.to} className="field-input field-compact" />
              </div>
            </div>
          </>
        }
      />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      {all.length === 0 ? (
        <EmptyState title="Nothing sent back" body="Requests you send back for changes are listed here until the requester resubmits them." />
      ) : rows.length === 0 ? (
        <NoResults what="sent-back requests" query={filter.q} clearSearchHref={listHref(PATH, query, { q: null })} resetHref={PATH} />
      ) : (
        <FoldScope enabled={Boolean(filter.group)}>
          <div className="card overflow-x-auto" data-testid="sent-back">
            <table className="data-table">
              <caption className="sr-only">Requests you sent back for changes</caption>
              <thead>
                <tr>
                  {head("Request", "request")}
                  {head("Approval type", "type")}
                  {head("Priority", "priority")}
                  {head("Waiting for", "requester")}
                  {head("Department", "department")}
                  {head("Your step", "step")}
                  {head("Sent back", "sent")}
                  {head("With requester", "waiting")}
                  {head("Your reason", "reason")}
                </tr>
              </thead>
              {filter.group ? (
                groupRows(shown, (row) => sentBackBucket(filter.group!, row, priority)).map((section) => (
                  <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={COLUMNS}>
                    {section.items.map(rowOf)}
                  </FoldTbody>
                ))
              ) : (
                <tbody>{shown.map(rowOf)}</tbody>
              )}
            </table>
          </div>
        </FoldScope>
      )}
      {!filter.group && pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-label">
          {page > 1 && (
            <PendingLink className="btn-secondary btn-compact" href={listHref(PATH, query, { page: page - 1 })}>
              ← Previous
            </PendingLink>
          )}
          <span className="text-ink-muted">
            Page {page} of {pages} · {rows.length} requests
          </span>
          {page < pages && (
            <PendingLink className="btn-secondary btn-compact" href={listHref(PATH, query, { page: page + 1 })}>
              Next →
            </PendingLink>
          )}
        </nav>
      )}
    </ListPage>
  );
}
