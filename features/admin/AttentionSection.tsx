import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge, EmptyState } from "@/features/ui/Display";
import { SafeText } from "@/features/ui/SafeText";
import { Hint } from "@/features/ui/Hint";
import { RecheckRequest, ResendRequestMessages, SnoozeForm } from "@/features/admin/AttentionForms";
import { countByReason, findStuckRequests, STUCK_REASONS, type StuckReason } from "@/server/ops/stuck";
import { getNumberSetting } from "@/server/settings/values";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortHead } from "@/features/admin/SortHead";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { ageBucket, groupHref, groupMenu, monthBucket } from "@/server/admin/lists";

// v1.58.0 (D-354, owner): every column sorts both ways; Group by Why, Waiting
// for or Month (folded at first); saved views (list_admin_attention).
// v1.85.0 (D-412): built into the Admin overview (/admin#attention).
const PATH = "/admin";
const COLUMNS = ["request", "why", "since", "action"] as const;
const GROUPS = [
  { key: "reason", label: "Why" },
  { key: "age", label: "Waiting for" },
  { key: "month", label: "Month" },
] as const;

// FN2 Needs attention: open requests that are stuck, why, since when and
// what to do. Read-only list; every fix is an existing audited action.
// The caller (the overview page) has checked the Admin area and that the
// person may see Needs attention (page key admin.attention).
export async function AttentionSection({ userId, query }: { userId: number; query: { reason?: string; sortBy?: string; dir?: string; group?: string } }) {
  const user = { id: userId };
  const idleDays = (await getNumberSetting("general.stuck_idle_days").catch(() => 7)) || 7;
  const all = await findStuckRequests({ idleDays });
  const counts = countByReason(all);
  const raw = query.reason;
  const reason = raw && raw in STUCK_REASONS ? (raw as StuckReason) : null;
  const filtered = reason ? all.filter((item) => item.reason === reason) : all;
  const sort = parseColumnSort(query, COLUMNS);
  const group = pickGroup(query.group, GROUPS.map((choice) => choice.key));
  const reasonOrder = Object.keys(STUCK_REASONS);
  const items = sort.sortBy
    ? sortRows(filtered, (item) => (sort.sortBy === "request" ? item.requestNo : sort.sortBy === "why" ? STUCK_REASONS[item.reason].label : sort.sortBy === "since" ? item.since : STUCK_REASONS[item.reason].action), sort.dir)
    : filtered;
  const groups = group
    ? groupRows(items, (item): [string, number] => (group === "reason" ? [STUCK_REASONS[item.reason].label, reasonOrder.indexOf(item.reason)] : group === "age" ? ageBucket(item.days) : monthBucket(item.since)))
    : null;
  // The reason chips keep the sort and the group.
  const chipHref = (key: string | null) => groupHref(PATH, { ...query, reason: key ?? undefined }, group);
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-label ${active ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line text-ink-muted hover:bg-surface-muted"}`;

  return (
    <section id="attention" aria-labelledby="attention-title" className="mt-8 scroll-mt-20" data-testid="attention">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 id="attention-title" className="text-section">
          Needs attention <span className="text-ink-muted">({all.length})</span>
        </h2>
        <Hint text={`Open requests that can't move on their own: blocked steps, inactive approvers, unsent messages, and anything with no activity for ${idleDays} days or more.`} align="start" />
      </div>
      <nav aria-label="Filter by reason" className="mb-4 flex flex-wrap gap-2">
        <Link href={chipHref(null)} className={chip(!reason)} aria-current={!reason ? "page" : undefined}>
          All ({all.length})
        </Link>
        {(Object.keys(STUCK_REASONS) as StuckReason[]).map((key) => (
          <Link key={key} href={chipHref(key)} className={chip(reason === key)} aria-current={reason === key ? "page" : undefined}>
            {STUCK_REASONS[key].label} ({counts[key]})
          </Link>
        ))}
      </nav>
      <ListToolbar id="attention-view" path={PATH} label="Needs attention view" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, GROUPS, group)} />
      <ListViews userId={user.id} target="list_admin_attention" path={PATH} query={query} />
      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 aria-hidden="true" className="h-6 w-6" />} title="Nothing needs attention" body="Every open request has someone who can act on it, and all messages have gone out." />
      ) : (
        <FoldScope enabled={Boolean(group)}>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">Requests that need attention</caption>
            <SortHead
              path={PATH}
              query={query}
              sort={sort}
              columns={[
                { key: "request", label: "Request" },
                { key: "why", label: "Why" },
                { key: "since", label: "Since" },
                { key: "action", label: "What to do" },
              ]}
            />
            <GroupedRows
              rows={items}
              groups={groups}
              colSpan={4}
              paged={false}
              render={(item) => (
                <tr key={`${item.requestId}-${item.reason}`}>
                  <td>
                    <Link href={`/users/requests/${item.requestId}`} className="link font-semibold">
                      {item.requestNo}
                    </Link>
                    <span className="block max-w-xs truncate text-caption text-ink-muted">
                      <SafeText text={item.title} />
                    </span>
                  </td>
                  <td>
                    <Badge tone={item.reason === "BLOCKED_STEP" || item.reason === "INACTIVE_APPROVER" ? "danger" : "warning"}>{STUCK_REASONS[item.reason].label}</Badge>
                    {item.detail && <span className="mt-1 block text-caption text-ink-muted">{item.detail}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatIndiaTime(item.since)}
                    <span className="block text-caption text-ink-muted">{item.days === 0 ? "today" : `${item.days} day${item.days === 1 ? "" : "s"}`}</span>
                  </td>
                  <td className="space-y-2">
                    <p className="text-label">{STUCK_REASONS[item.reason].action}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {item.reason === "INACTIVE_APPROVER" && item.personId !== null && (
                        <Link href={`/admin/users/${item.personId}`} className="link text-label">
                          Open the person
                        </Link>
                      )}
                      {item.reason === "MESSAGES_UNSENT" && <ResendRequestMessages requestId={item.requestId} />}
                      {item.reason === "INCONSISTENT" && <RecheckRequest requestId={item.requestId} />}
                    </div>
                    <SnoozeForm requestId={item.requestId} reason={item.reason} requestNo={item.requestNo} />
                  </td>
                </tr>
              )}
            />
          </table>
        </div>
        </FoldScope>
      )}
    </section>
  );
}
