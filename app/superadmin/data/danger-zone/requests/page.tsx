import type { Metadata } from "next";
import { BackLink } from "@/features/ui/BackLink";
import { NoResults } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import Link from "next/link";
import { PendingLink } from "@/features/ui/PendingLink";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { RequestStatusPill } from "@/features/requests/StatusPill";
import { PriorityPill } from "@/features/ui/ChoicePill";
import { priorityRecord } from "@/server/approvals/priority-lookup";
import { DeleteRequestButton } from "@/features/superadmin/DeleteRequestButton";
import { BulkDeleteRequests, RequestRowCheckbox, SelectAllRequests } from "@/features/superadmin/BulkDeleteRequests";
import { listAllRequests } from "@/lib/db/repositories/request-admin.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { SafeText } from "@/features/ui/SafeText";
import { REQUEST_STATUS_OPTIONS, STATUS_WORD } from "@/features/ui/labels";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { REQUEST_COLUMNS, REQUEST_GROUP_LABEL, REQUEST_GROUPS, listHref, requestBucket } from "@/server/lists/superadmin-lists";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Delete requests" };

const STATUS_OPTIONS = REQUEST_STATUS_OPTIONS;
const PATH = "/superadmin/data/danger-zone/requests";
const TARGET = "list_super_requests";

// Super Admin → Requests (S11-10, D-086, F-73): every request, searchable,
// with Delete; the Deleted tab lists what was deleted, by whom and why.
export default async function SuperAdminRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): the person's default saved view when nothing is chosen.
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]![0] : query[key]) ?? "";
  const params = { q: one("q"), status: one("status"), page: one("page"), tab: one("tab") };
  const deleted = params.tab === "deleted";
  const q = (params.q ?? "").slice(0, 100);
  const status = params.status ?? "";
  // v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"):
  // every column sorts in SQL across all pages, except Priority (read from
  // each request's form), which sorts the page on screen.
  const sort = parseColumnSort(query, REQUEST_COLUMNS);
  const result = await listAllRequests({ q, status, deleted, page: Number(params.page) || 1, sort });
  // v1.47.0: each request's Priority (the Super Admin sees confidential values).
  const priority = await priorityRecord(result.items.map((item) => item.id), user);
  const items = result.items; // v1.58.1: every column, Priority too, is sorted in SQL
  // v1.58.0 (D-354, owner): Group by status, approval type or department (folded by default).
  const group = pickGroup(query.group, REQUEST_GROUPS);
  const head = sortHeads(PATH, query, sort);
  const link = (changes: { page?: number; tab?: string }) =>
    changes.tab !== undefined ? listHref(PATH, { group: group ?? undefined }, { tab: changes.tab || null }) : listHref(PATH, query, { page: changes.page && changes.page > 1 ? changes.page : null });
  const colSpan = deleted ? 7 : 8;
  const rowOf = (item: (typeof items)[number]) => (
    <tr key={item.id}>
      {!deleted && (
        <td className="w-10" data-card-lead="">
          <RequestRowCheckbox requestId={item.id} requestNo={item.requestNo} />
        </td>
      )}
      <td data-card-title="">
        {deleted ? (
          <span className="font-mono text-label">{item.requestNo}</span>
        ) : (
          <Link href={`/users/requests/${item.id}`} className="link font-mono text-label">
            {item.requestNo}
          </Link>
        )}
        <p className="max-w-xs truncate text-caption text-ink-muted">
          <SafeText text={item.title} />
        </p>
      </td>
      <td data-label="Raised by">
        {item.requesterName}
        {item.departmentName && <p className="text-caption text-ink-muted">{item.departmentName}</p>}
      </td>
      <td data-label="Approval type">{item.workflowName}</td>
      <td data-label="Status">
        <RequestStatusPill status={item.status} validUntil={item.validUntil} />
      </td>
      <td data-label="Priority">
        <PriorityPill priority={priority[item.id]} />
      </td>
      <td data-label={deleted ? "Deleted" : "Raised"} className="whitespace-nowrap text-label text-ink-muted">
        {deleted && item.deletedAt ? (
          <>
            {formatIndiaTime(item.deletedAt)}
            <p className="text-caption">by {item.deletedByName ?? "—"}</p>
          </>
        ) : (
          formatIndiaTime(item.submittedAt)
        )}
      </td>
      <td data-label={deleted ? "Reason" : undefined} className="text-right">
        {deleted ? <span className="text-label">{item.deleteReason}</span> : <DeleteRequestButton requestId={item.id} requestNo={item.requestNo} />}
      </td>
    </tr>
  );
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-label ${active ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:bg-surface-muted"}`;

  return (
    <>
      {/* v1.84.0 (D-411): reached from Data → Danger zone. */}
      <BackLink fallback="/superadmin/data/danger-zone" label="Danger zone" />
      <PageHeader title="Delete requests" description="Every request raised in the app. Delete removes a request from every screen, queue and dashboard; the record stays in the audit log." />
      <nav aria-label="Requests" className="mb-4 flex gap-2">
        <Link href={link({ tab: "" })} className={tabClass(!deleted)} aria-current={!deleted ? "page" : undefined}>
          All requests
        </Link>
        <Link href={link({ tab: "deleted" })} className={tabClass(deleted)} aria-current={deleted ? "page" : undefined}>
          Deleted
        </Link>
      </nav>
      {/* v1.51.1 (owner): toolbar filters instead of a filter form. */}
      <ListToolbar
        id="superadmin-requests-filters"
        path={PATH}
        label="Search requests"
        keep={{ tab: deleted ? "deleted" : undefined, group: group ?? undefined, sortBy: sort.sortBy ?? undefined, dir: sort.sortBy ? sort.dir : undefined }}
        group={groupMenu(PATH, query, group, REQUEST_GROUPS, REQUEST_GROUP_LABEL)}
        search={{ name: "q", value: q, placeholder: "Request number, title or raised by" }}
        filterCount={status ? 1 : 0}
        clearHref={q || status ? listHref(PATH, query, { q: null, status: null }) : null}
        filters={
          <div>
            <label htmlFor="status" className="field-label">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className="field-input field-compact">
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      <p className="mb-2 text-caption text-ink-muted" role="status">
        {result.total === 0 ? "No requests match." : `${result.total.toLocaleString("en-IN")} request${result.total === 1 ? "" : "s"}${result.pages > 1 ? ` · page ${result.page} of ${result.pages}` : ""}`}
      </p>
      {result.items.length === 0 && (q || status) && (
        <NoResults what="requests" query={q} clearSearchHref={`/superadmin/data/danger-zone/requests?${new URLSearchParams({ ...(deleted ? { tab: "deleted" } : {}), ...(status ? { status } : {}) })}`} resetHref={deleted ? "/superadmin/data/danger-zone/requests?tab=deleted" : "/superadmin/data/danger-zone/requests"} />
      )}
      {/* v1.49.5 (owner): tick requests, then Delete selected. */}
      {/* v1.51.1: kept after the last match is deleted, so its "deleted" message stays on screen. */}
      {!deleted && (result.items.length > 0 || Boolean(q)) && <BulkDeleteRequests />}
      {result.items.length > 0 && (
        <FoldScope enabled={Boolean(group)}>
          <section className="card table-cards overflow-x-auto">
            <table className="data-table max-md:p-3">
              <thead>
                <tr>
                  {!deleted && (
                    <th className="w-10">
                      <SelectAllRequests />
                    </th>
                  )}
                  {head("Request", "request")}
                  {head("Raised by", "raised_by")}
                  {head("Approval type", "type")}
                  {head("Status", "status")}
                  {head("Priority", "priority")}
                  {head(deleted ? "Deleted" : "Raised", "when")}
                  {deleted ? (
                    head("Reason", "reason", { className: "text-right" })
                  ) : (
                    <th className="text-right">
                      <span className="sr-only">Action</span>
                    </th>
                  )}
                </tr>
              </thead>
              {group ? (
                groupRows(items, (item) => requestBucket(group, item, (value) => STATUS_WORD[value] ?? value)).map((section) => (
                  <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={colSpan}>
                    {section.items.map(rowOf)}
                  </FoldTbody>
                ))
              ) : (
                <tbody>{items.map(rowOf)}</tbody>
              )}
            </table>
          </section>
        </FoldScope>
      )}
      {result.pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-label">
          {result.page > 1 ? (
            <PendingLink href={link({ page: result.page - 1 })} className="btn-secondary btn-compact">
              ← Newer
            </PendingLink>
          ) : null}
          {result.page < result.pages ? (
            <PendingLink href={link({ page: result.page + 1 })} className="btn-secondary btn-compact">
              Older →
            </PendingLink>
          ) : null}
        </nav>
      )}
    </>
  );
}
