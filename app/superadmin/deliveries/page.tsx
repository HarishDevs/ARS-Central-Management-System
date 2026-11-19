import type { Metadata } from "next";
import { PagedRows } from "@/features/ui/PagedRows";
import { PageHeader, EmptyState } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { deliverySummary, listRecentDeliveries, parseDeliveryFilter } from "@/lib/db/repositories/notifications.repository";
import { DeliveryDashboard } from "@/features/superadmin/DeliveryDashboard";
import { RetryButton } from "@/features/superadmin/RetryButton";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { getRunnerHeartbeat, type RunnerHeartbeat } from "@/lib/db/repositories/jobs.repository";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { DELIVERY_COLUMNS, DELIVERY_GROUP_LABEL, DELIVERY_GROUPS, deliveryBucket, type DeliveryColumn } from "@/server/lists/superadmin-lists";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Message deliveries" };

const STATUS_STYLE: Record<string, string> = {
  SENT: "bg-success-50 text-success-600",
  DELIVERED: "bg-success-50 text-success-600",
  READ: "bg-success-50 text-success-600",
  FAILED: "bg-danger-50 text-danger-600",
  SKIPPED: "bg-warning-50 text-warning-600",
  QUEUED: "bg-surface-muted text-ink-muted",
};

// P1-45 delivery log: every email and WhatsApp attempt, with the failure
// code. Message bodies and payloads are never shown.
export const dynamic = "force-dynamic";

const PATH = "/superadmin/deliveries";
const TARGET = "list_super_deliveries";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): the person's default saved view when nothing is chosen.
  await applyDefaultListView(user.id, TARGET, PATH, query);
  // v1.54.16 (owner): a dashboard over the period, and the list filtered the same way.
  const filter = parseDeliveryFilter(query);
  const [latest, heartbeat, summary] = await Promise.all([listRecentDeliveries(200, filter), getRunnerHeartbeat(), deliverySummary(filter)]);
  // v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): the
  // latest 200 for the filters, sorted by any column (both directions).
  const sort = parseColumnSort(query, DELIVERY_COLUMNS);
  const value: Record<DeliveryColumn, (delivery: (typeof latest)[number]) => unknown> = {
    when: (delivery) => delivery.createdAt,
    event: (delivery) => delivery.eventType,
    to: (delivery) => delivery.recipientName,
    channel: (delivery) => (delivery.channel === "EMAIL" ? "Email" : "WhatsApp"),
    provider: (delivery) => delivery.provider,
    status: (delivery) => (delivery.channel === "EMAIL" && delivery.status === "SENT" ? "ACCEPTED" : delivery.status),
    reason: (delivery) => delivery.failureCode,
    tries: (delivery) => delivery.attemptCount,
  };
  const deliveries = sort.sortBy ? sortRows(latest, value[sort.sortBy], sort.dir) : latest;
  // v1.58.0 (D-354, owner): Group by channel, status, provider, event or day (folded by default).
  const group = pickGroup(query.group, DELIVERY_GROUPS);
  const head = sortHeads(PATH, query, sort);
  const rowOf = (delivery: (typeof deliveries)[number]) => (
    <tr key={delivery.id}>
      <td className="whitespace-nowrap">{formatIndiaTime(delivery.createdAt)}</td>
      <td>{delivery.eventType}</td>
      <td>{delivery.recipientName}</td>
      <td>{delivery.channel === "EMAIL" ? "Email" : "WhatsApp"}</td>
      <td className="text-ink-muted">
        {delivery.provider}
        {delivery.providerReference && (
          <p className="max-w-[16rem] truncate text-caption" title={delivery.providerReference}>
            {delivery.providerReference}
          </p>
        )}
      </td>
      <td>
        {/* v1.54.14: an email marked SENT was accepted by the mail server; delivery to the inbox can't be seen from here. */}
        <span className={`badge ${STATUS_STYLE[delivery.status] ?? ""}`} title={delivery.channel === "EMAIL" && delivery.status === "SENT" ? "Accepted by the mail server. Whether it reached the inbox can't be seen from here." : undefined}>
          {delivery.channel === "EMAIL" && delivery.status === "SENT" ? "ACCEPTED" : delivery.status}
        </span>
      </td>
      <td className="text-ink-muted">
        {delivery.failureCode ?? ""}
        {delivery.nextRetryAt && <p className="text-caption">Next try {formatIndiaTime(delivery.nextRetryAt)}</p>}
      </td>
      <td>{delivery.attemptCount}</td>
      <td>{delivery.canRetry && <RetryButton deliveryId={delivery.id} />}</td>
    </tr>
  );
  return (
    <>
      <PageHeader title="Message deliveries" description="How many email and WhatsApp messages went out, by channel, provider and status, and the latest 200 of them for the filters chosen. Failed sends are retried automatically every few minutes by the job runner. SKIPPED with TEMPLATE_NOT_CONFIGURED means the WhatsApp template for that event isn't set up yet." />
      <RunnerStatus heartbeat={heartbeat} />
      <DeliveryDashboard summary={summary} filter={filter} path={PATH} keep={{ group: group ?? undefined, sortBy: sort.sortBy ?? undefined, dir: sort.sortBy ? sort.dir : undefined }} />
      {/* v1.58.0 (D-354, owner): Group by and saved views for the list below (the filters are the dashboard's). */}
      <ListToolbar id="delivery-list" path={PATH} label="Delivery list" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, group, DELIVERY_GROUPS, DELIVERY_GROUP_LABEL)} />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      {deliveries.length === 0 ? (
        <EmptyState title="Nothing here" body="No messages match the period and filters chosen. Sign-in alerts, notifications and test sends appear here." />
      ) : (
        <FoldScope enabled={Boolean(group)}>
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {head("When", "when")}
                  {head("Event", "event")}
                  {head("To", "to")}
                  {head("Channel", "channel")}
                  {head("Provider", "provider")}
                  {head("Status", "status")}
                  {head("Reason", "reason")}
                  {head("Tries", "tries")}
                  <th>
                    <span className="sr-only">Retry</span>
                  </th>
                </tr>
              </thead>
              {group ? (
                groupRows(deliveries, (delivery) => deliveryBucket(group, delivery)).map((section) => (
                  <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={9}>
                    {section.items.map(rowOf)}
                  </FoldTbody>
                ))
              ) : (
                <PagedRows colSpan={9}>{deliveries.map(rowOf)}</PagedRows>
              )}
            </table>
          </div>
        </FoldScope>
      )}
    </>
  );
}

// The cron job calls the runner every 5 minutes; more than 15 minutes of
// silence means it isn't set up or is failing (DEPLOYMENT Part I).
function RunnerStatus({ heartbeat }: { heartbeat: RunnerHeartbeat | null }) {
  const healthy = heartbeat !== null && heartbeat.minutesAgo <= 15;
  const when = heartbeat === null ? "" : heartbeat.minutesAgo < 1 ? "less than a minute ago" : `${heartbeat.minutesAgo} min ago`;
  return (
    <p role="status" className={`mb-4 rounded-md px-3 py-2 text-label ${healthy ? "bg-success-50 text-success-600" : "bg-warning-50 text-warning-600"}`}>
      {heartbeat === null
        ? "Job runner: has never run. Failed sends won't be retried until the cron job is set up (Deployment guide, Part I)."
        : healthy
          ? `Job runner: last ran ${when}.`
          : `Job runner: last ran ${when}. It should run every 5 minutes, so check the cron job (Deployment guide, Part I).`}
    </p>
  );
}
