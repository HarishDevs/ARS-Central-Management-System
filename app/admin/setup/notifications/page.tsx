import Link from "next/link";
import { EmptyState } from "@/features/ui/Display";
import { TaskPriorityPill } from "@/features/ui/ChoicePill";
import type { Metadata } from "next";
import { Send } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { BroadcastForm } from "@/features/admin/BroadcastForm";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { listRoleCodes } from "@/lib/db/repositories/groups.repository";
import { CATEGORY_TEXT, listAllDevices, listBroadcasts, pushOverview } from "@/server/notifications/broadcast";
import { getPushConfig, pushReady } from "@/server/push/service";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { personLabel } from "@/lib/people/label";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortHead } from "@/features/admin/SortHead";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { applyDefaultListView } from "@/server/lists/views";
import { LatestNote } from "@/features/ui/LatestNote";
import { latestLimit } from "@/features/shell/nav-routes";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { departmentBucket, groupRows, pickGroup } from "@/server/lists/group-rows";
import { groupMenu, monthBucket } from "@/server/admin/lists";

// v1.58.0 (D-354, owner): History and Devices: every column sorts both ways,
// Group by (folded at first; Devices by Department too), saved views
// (list_admin_notifications; the tab is part of the view).
const PATH = "/admin/setup/notifications";
const HISTORY_COLUMNS = ["title", "audience", "sent", "inbox", "devices"] as const;
const HISTORY_GROUPS = [
  { key: "category", label: "Kind" },
  { key: "priority", label: "Priority" },
  { key: "month", label: "Month sent" },
  { key: "sender", label: "Sent by" },
] as const;
const DEVICE_COLUMNS = ["person", "device", "service", "status", "added", "lastUsed"] as const;
const DEVICE_GROUPS = [
  { key: "department", label: "Department" },
  { key: "status", label: "Status" },
  { key: "service", label: "Push service" },
  { key: "deviceType", label: "Device type" },
] as const;
type Query = Record<string, string | undefined>;

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "send", label: "Send" },
  { key: "history", label: "History" },
  { key: "devices", label: "Devices" },
] as const;

// D-252 (owner: "Notification Management Dashboard"): what IT sends to
// people's Inbox and devices, what happened to it, and which devices are
// registered. Push "accepted" means the push service took it, not that the
// person saw it.
export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { user } = await requireArea("admin");
  const query = await searchParams;
  await applyDefaultListView(user.id, "list_admin_notifications", PATH, query);
  const wanted = query.tab;
  const tab = TABS.find((item) => item.key === wanted)?.key ?? "send";
  const [overview, config] = await Promise.all([pushOverview(), getPushConfig()]);
  const cards = [
    { label: "Registered devices", value: overview.devices, help: "Every device people turned notifications on for (expired ones included)." },
    { label: "Active devices", value: overview.activeDevices, help: "Devices a notification can reach now." },
    { label: "People with a device", value: overview.peopleWithDevices, help: "People with at least one active device." },
    { label: "Pushes (30 days)", value: overview.sent30, help: "Phone and desktop notifications queued in the last 30 days." },
    { label: "Accepted by push services", value: overview.accepted30, help: "Taken by the browser's push service. It doesn't prove the person saw it." },
    { label: "Failed", value: overview.failed30, help: "Refused or gone after the retries. The message is still in the person's Inbox." },
  ];

  return (
    <>
      <PageHeader title="Notifications" icon={Send} description="Send a notification to people's Inbox and their phones and computers, and see what happened to it." />
      {!pushReady(config) && (
        <p className="mb-4 rounded-md border border-warning-600/40 bg-warning-50 px-4 py-3 text-label" role="status">
          Phone and desktop notifications are off or have no keys yet (Super Admin → Connections → Phone & desktop notifications). Notices still reach everyone&apos;s Inbox.
        </p>
      )}
      <ul className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="push-overview">
        {cards.map((card) => (
          <li key={card.label} className="card px-4 py-3" title={card.help}>
            <p className="text-caption text-ink-muted">{card.label}</p>
            <p className="mt-1 text-title font-semibold tabular-nums">{card.value.toLocaleString("en-IN")}</p>
          </li>
        ))}
      </ul>
      <nav aria-label="Notifications" className="scroll-hint -mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.map((item) => (
            <li key={item.key}>
              <Link
                href={`/admin/setup/notifications?tab=${item.key}`}
                aria-current={tab === item.key ? "page" : undefined}
                className={`-mb-px block border-b-2 px-3 py-2.5 text-label ${tab === item.key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "send" && <SendTab />}
      {tab !== "send" && (
        <>
          <ListToolbar
            id="notifications-view"
            path={PATH}
            label="Notifications view"
            keep={{}}
            filterCount={0}
            clearHref={null}
            group={groupMenu(PATH, query, tab === "history" ? HISTORY_GROUPS : DEVICE_GROUPS, pickGroup(query.group, (tab === "history" ? HISTORY_GROUPS : DEVICE_GROUPS).map((choice) => choice.key)))}
          />
          <ListViews userId={user.id} target="list_admin_notifications" path={PATH} query={query} />
        </>
      )}
      {tab === "history" && <HistoryTab query={query} />}
      {tab === "devices" && <DevicesTab query={query} />}
    </>
  );
}

async function SendTab() {
  const [people, departments, roles] = await Promise.all([listActiveUserOptions(), listDepartments(), listRoleCodes()]);
  return (
    <section className="card px-5 py-5">
      <BroadcastForm
        people={people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
        departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }))}
        roles={roles}
      />
    </section>
  );
}

async function HistoryTab({ query }: { query: Query }) {
  // v1.72.1 (D-395, QA F-07): the latest 100, and "Show 100 more" up to 1,000.
  const limit = latestLimit(query.limit, 100, 1000);
  const loaded = await listBroadcasts(limit);
  if (!loaded.length) return <EmptyState title="Nothing sent yet" body="Emails, WhatsApp and in-app messages show here once they go out." />;
  const sort = parseColumnSort(query, HISTORY_COLUMNS);
  const group = pickGroup(query.group, HISTORY_GROUPS.map((choice) => choice.key));
  const rows = sort.sortBy
    ? sortRows(loaded, (row) => (sort.sortBy === "title" ? row.title : sort.sortBy === "audience" ? row.audienceText : sort.sortBy === "sent" ? row.createdAt : sort.sortBy === "inbox" ? row.inboxed : row.pushSent), sort.dir)
    : loaded;
  const groups = group
    ? groupRows(rows, (row): [string, number] => (group === "category" ? [CATEGORY_TEXT[row.category], 0] : group === "priority" ? (row.priority === "HIGH" ? ["High priority", 0] : ["Normal", 1]) : group === "month" ? monthBucket(row.createdAt) : [row.createdBy, 0]))
    : null;
  const head = "px-4 py-2 font-medium";
  return (
    <FoldScope enabled={Boolean(group)}>
    <div className="card overflow-x-auto" data-testid="broadcast-history">
      <table className="w-full min-w-[760px] text-left text-label">
        <SortHead
          className="border-b border-line text-caption text-ink-muted"
          path={PATH}
          query={query}
          sort={sort}
          columns={[
            { key: "title", label: "Notification", className: head },
            { key: "audience", label: "Audience", className: head },
            { key: "sent", label: "Sent", className: head },
            { key: "inbox", label: "Inbox", className: `${head} text-right` },
            { key: "devices", label: "Devices", className: head },
          ]}
        />
        <GroupedRows
          rows={rows}
          groups={groups}
          colSpan={5}
          render={(row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{row.title}</p>
                <p className="text-caption text-ink-muted">
                  {CATEGORY_TEXT[row.category]}
                  {row.priority === "HIGH" && (
                    <>
                      {" · "}
                      <TaskPriorityPill priority="HIGH" />
                    </>
                  )}
                </p>
              </td>
              <td className="px-4 py-3 text-ink-muted">{row.audienceText}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {formatIndiaTime(row.createdAt)}
                <p className="text-caption text-ink-muted">by {row.createdBy}</p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.inboxed} / {row.recipients}
              </td>
              <td className="px-4 py-3 text-caption">
                <span className="text-success-600">{row.pushSent} accepted</span>
                {row.pushQueued > 0 && <span> · {row.pushQueued} waiting</span>}
                {row.pushFailed > 0 && <span className="text-danger-600"> · {row.pushFailed} failed</span>}
                {row.pushGone > 0 && <span className="text-ink-muted"> · {row.pushGone} device gone</span>}
                {row.failureCodes && <p className="text-ink-muted">{row.failureCodes}</p>}
              </td>
            </tr>
          )}
        />
      </table>
    </div>
    <LatestNote shown={loaded.length} limit={limit} step={100} max={1000} path={PATH} query={query} what="notifications" />
    </FoldScope>
  );
}

async function DevicesTab({ query }: { query: Query }) {
  // v1.72.1 (D-395, QA F-07): the latest 300, and "Show 300 more" up to 3,000.
  const limit = latestLimit(query.limit, 300, 3000);
  const loaded = await listAllDevices(limit);
  if (!loaded.length) return <p className="card px-5 py-4 text-label text-ink-muted">No device registered yet. People turn notifications on in Profile → App & devices.</p>;
  const deviceText = (row: (typeof loaded)[number]) => `${[row.browser, row.operatingSystem].filter(Boolean).join(" on ") || "A browser"} · ${row.deviceType.toLowerCase()}${row.installed ? " · app" : ""}`;
  const sort = parseColumnSort(query, DEVICE_COLUMNS);
  const group = pickGroup(query.group, DEVICE_GROUPS.map((choice) => choice.key));
  const rows = sort.sortBy
    ? sortRows(loaded, (row) => (sort.sortBy === "person" ? row.person : sort.sortBy === "device" ? deviceText(row) : sort.sortBy === "service" ? row.service : sort.sortBy === "status" ? row.status : sort.sortBy === "added" ? row.createdAt : row.lastUsedAt), sort.dir)
    : loaded;
  const groups = group
    ? groupRows(rows, (row): [string, number] => (group === "department" ? departmentBucket(row.departmentName) : group === "status" ? (row.status === "ACTIVE" ? ["Active", 0] : ["Expired", 1]) : group === "service" ? [row.service, 0] : [row.deviceType.charAt(0) + row.deviceType.slice(1).toLowerCase(), 0]))
    : null;
  const head = "px-4 py-2 font-medium";
  return (
    <FoldScope enabled={Boolean(group)}>
    <div className="card overflow-x-auto" data-testid="admin-devices">
      <table className="w-full min-w-[760px] text-left text-label">
        <SortHead
          className="border-b border-line text-caption text-ink-muted"
          path={PATH}
          query={query}
          sort={sort}
          columns={[
            { key: "person", label: "Person", className: head },
            { key: "device", label: "Device", className: head },
            { key: "service", label: "Push service", className: head },
            { key: "status", label: "Status", className: head },
            { key: "added", label: "Added", className: head },
            { key: "lastUsed", label: "Last accepted", className: head },
          ]}
        />
        <GroupedRows
          rows={rows}
          groups={groups}
          colSpan={6}
          render={(row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                {row.person}
                <p className="text-caption text-ink-muted">{row.loginId}</p>
              </td>
              <td className="px-4 py-3">
                {deviceText(row)}
              </td>
              <td className="px-4 py-3 text-ink-muted">{row.service}</td>
              <td className="px-4 py-3">
                {row.status === "ACTIVE" ? "Active" : "Expired"}
                {row.lastFailureCode && <p className="text-caption text-ink-muted">{row.lastFailureCode}</p>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatIndiaTime(row.createdAt)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{row.lastUsedAt ? formatIndiaTime(row.lastUsedAt) : "Not yet"}</td>
            </tr>
          )}
        />
      </table>
    </div>
    <LatestNote shown={loaded.length} limit={limit} step={300} max={3000} path={PATH} query={query} what="devices" />
    </FoldScope>
  );
}
