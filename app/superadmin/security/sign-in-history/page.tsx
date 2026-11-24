import type { Metadata } from "next";
import { PagedRows } from "@/features/ui/PagedRows";
import { PageHeader, EmptyState } from "@/features/shell/PageHeader";
import { NoResults } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { PendingLink } from "@/features/ui/PendingLink";
import { requireArea } from "@/server/authorization/guards";
import { listLoginHistory } from "@/lib/db/repositories/audit.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { SafeText } from "@/features/ui/SafeText";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { LOGIN_COLUMNS, LOGIN_GROUP_LABEL, LOGIN_GROUPS, LOGIN_METHOD_LABEL, listHref, loginBucket } from "@/server/lists/superadmin-lists";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Sign-in history" };

const PAGE_SIZE = 100;
const METHOD = LOGIN_METHOD_LABEL;
const PATH = "/superadmin/security/sign-in-history";
const TARGET = "list_super_logins";

// S8-02 login history (P1-57): every sign-in attempt, who, how, from where,
// and why it failed. Read-only.
export default async function LoginHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): the person's default saved view when nothing is chosen.
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]![0] : query[key]) ?? "";
  const outcome = one("outcome") === "SUCCESS" || one("outcome") === "FAILURE" ? (one("outcome") as "SUCCESS" | "FAILURE") : undefined;
  // v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): a
  // column sort runs in SQL over every sign-in and pages by ?page; the default
  // (newest first) keeps the "Older" keyset paging.
  const sort = parseColumnSort(query, LOGIN_COLUMNS);
  const page = sort.sortBy ? Math.max(1, Math.min(10_000, Number(one("page")) || 1)) : 1;
  const beforeId = !sort.sortBy && /^\d+$/.test(one("before")) ? Number(one("before")) : undefined;
  const items = await listLoginHistory({ outcome, beforeId, sort, offset: (page - 1) * PAGE_SIZE }, PAGE_SIZE);
  const last = items.at(-1);
  // v1.58.0 (D-354, owner): Group by person, outcome, method or department (folded by default).
  const group = pickGroup(query.group, LOGIN_GROUPS);
  const head = sortHeads(PATH, query, sort);
  const keep = { group: group ?? undefined, sortBy: sort.sortBy ?? undefined, dir: sort.sortBy ? sort.dir : undefined };
  const rowOf = (item: (typeof items)[number]) => (
    <tr key={item.id}>
      <td data-label="When" className="whitespace-nowrap">{formatIndiaTime(item.occurredAt)}</td>
      <td data-card-title>
        {item.userName ? <SafeText text={item.userName} /> : <span className="text-ink-faint">Unknown User ID</span>}
        {item.loginId && <p className="text-caption text-ink-muted">{item.loginId}</p>}
        {item.departmentName && <p className="text-caption text-ink-muted">{item.departmentName}</p>}
      </td>
      <td data-label="How">
        {METHOD[item.method]}
        {item.step !== "GOOGLE" && <p className="text-caption text-ink-muted">step: {item.step === "OTP" ? "code" : "password"}</p>}
      </td>
      <td data-label="Outcome">
        <span className={`badge ${item.success ? "bg-success-50 text-success-600" : "bg-danger-50 text-danger-600"}`}>{item.success ? "Signed in" : "Failed"}</span>
        {item.failureReason && <p className="text-caption text-ink-muted">{item.failureReason}</p>}
        {item.newDevice && <p className="text-caption text-warning-600">new device</p>}
      </td>
      <td data-label="From" className="max-w-xs break-words text-caption text-ink-muted">
        {item.ipAddress ?? "—"}
        {item.userAgent && (
          <p className="truncate" title={item.userAgent}>
            {item.userAgent}
          </p>
        )}
      </td>
    </tr>
  );
  return (
    <>
      <PageHeader title="Sign-in history" description="Every sign-in attempt: who, how, from where, and why it failed. Newest first." />
      {/* v1.51.1 (owner): toolbar filters instead of a filter form. */}
      <ListToolbar
        id="login-filters"
        path={PATH}
        label="Filter sign-ins"
        keep={keep}
        filterCount={outcome ? 1 : 0}
        clearHref={outcome ? listHref(PATH, query, { outcome: null }) : null}
        group={groupMenu(PATH, query, group, LOGIN_GROUPS, LOGIN_GROUP_LABEL)}
        filters={
          <div>
            <label htmlFor="outcome" className="field-label">
              Outcome
            </label>
            <select id="outcome" name="outcome" defaultValue={outcome ?? ""} className="field-input field-compact">
              <option value="">All</option>
              <option value="SUCCESS">Signed in</option>
              <option value="FAILURE">Failed</option>
            </select>
          </div>
        }
      />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      {items.length === 0 ? (
        outcome ? (
          <NoResults what="sign-ins" resetHref={PATH} hint={`No ${outcome === "SUCCESS" ? "successful" : "failed"} sign-ins${beforeId || page > 1 ? " before this point" : ""}.`} />
        ) : (
          <EmptyState title="No sign-ins" body={beforeId || page > 1 ? "Nothing older than this." : "Nobody has signed in yet."} />
        )
      ) : (
        <FoldScope enabled={Boolean(group)}>
          <div className="card table-cards overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {head("When", "when")}
                  {head("Who", "who")}
                  {head("How", "how")}
                  {head("Outcome", "outcome")}
                  {head("From", "from")}
                </tr>
              </thead>
              {group ? (
                groupRows(items, (item) => loginBucket(group, item)).map((section) => (
                  <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={5}>
                    {section.items.map(rowOf)}
                  </FoldTbody>
                ))
              ) : (
                <PagedRows colSpan={5}>{items.map(rowOf)}</PagedRows>
              )}
            </table>
          </div>
        </FoldScope>
      )}
      {sort.sortBy ? (
        (page > 1 || items.length === PAGE_SIZE) && (
          <nav aria-label="Pages" className="mt-4 flex items-center gap-3">
            {page > 1 && (
              <PendingLink className="btn-secondary btn-compact" href={listHref(PATH, query, { page: page - 1 })}>
                ← Previous
              </PendingLink>
            )}
            {items.length === PAGE_SIZE && (
              <PendingLink className="btn-secondary btn-compact" href={listHref(PATH, query, { page: page + 1 })}>
                Next →
              </PendingLink>
            )}
          </nav>
        )
      ) : (
        items.length === PAGE_SIZE &&
        last && (
          <div className="mt-4">
            <PendingLink className="btn-secondary btn-compact" href={listHref(PATH, query, { before: last.id })}>
              Older →
            </PendingLink>
          </div>
        )
      )}
    </>
  );
}
