import "server-only";
import Link from "next/link";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileEdit, FileText, Gavel, Inbox, Layers, Repeat2 } from "lucide-react";
import { formDueDays } from "@/server/approvals/form-due";
import { MyRequestsTable, QueueTable } from "@/features/requests/lists";
import { priorityRecord } from "@/server/approvals/priority-lookup";
import { HOME_MINE_COLUMNS, HOME_QUEUE_COLUMNS, homeTableSort, sortMyRequests, sortQueueItems } from "@/server/lists/home-sort";
import { countPendingTasksFor, listAttentionTasksFor, listMyRequests, listPendingTasksFor } from "@/lib/db/repositories/approvals.repository";
import { ErrorState } from "@/features/ui/States";
import { listDrafts } from "@/lib/db/repositories/drafts.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { SafeText } from "@/features/ui/SafeText";
import { approvalDaily, approvalInsights, myRequestCounts } from "@/lib/db/repositories/overview.repository";
import { personProfile } from "@/lib/db/repositories/profile.repository";
import { indiaDayOf } from "@/features/work/format";
import { changePercent, parsePeriod, PREVIOUS_LABEL } from "@/server/work/period";
import { DeleteDraftButton, QuietRefresh, WorkloadChart } from "@/features/home/HomeClient";
import { HomeWidgets } from "@/features/home/HomeWidgets";
import { HomeNotepad } from "@/features/home/HomeNotepad";
import { QuickActions, type QuickAction } from "@/features/home/QuickActions";
import { AttentionWidget, InsightFigures, OverviewHeader, periodKeep, SectionHead, SummaryCards, type AttentionItem, type SummaryCard } from "@/features/home/OverviewParts";
import { hoursText, type WidgetKind } from "@/server/home/widgets";
import type { OverviewWidgets } from "@/server/home/home-service";

// v1.79.0 (D-406, owner: "Match all 3 Overview Screens, it should be
// identically featured"): Home → Approvals, built like My Work: the shared
// header with the period, quick actions with Add widgets / Customise, four
// summary cards, then the person's own widgets. Every list keeps the same
// access rules and queries as before (Waiting for me, My requests); only the
// widgets on the person's layout load their lists.
const RECENT_PAGE_SIZE = 8;

export async function ApprovalOverview({
  user,
  query,
  switcher,
  quick,
  widgets,
  greeting,
  overview,
  checklist,
}: {
  user: { id: number; name: string; roles: readonly string[] };
  query: Record<string, string | undefined>;
  switcher: React.ReactNode;
  quick: QuickAction[];
  widgets: OverviewWidgets;
  greeting?: React.ReactNode;
  overview: boolean; // the Classic view's Overview (?view=overview)
  checklist: React.ReactNode; // the first-use checklist, when not done
}) {
  const today = indiaDayOf(new Date());
  const period = parsePeriod({ period: query.period, from: query.from, to: query.to }, today, "month");
  const shown = (kind: WidgetKind) => widgets.layout.some((item) => item.kind === kind);
  const needQueue = shown("ap_waiting");
  const needMine = shown("ap_returned") || shown("ap_recent") || shown("ap_attention");
  // v1.49.6 (owner): no Recently viewed and no Finished in the last 30 days on Home.
  const [queue, waiting, attention, mine, drafts, insights, counts, daily, profile] = await Promise.all([
    needQueue ? listPendingTasksFor(user.id, { limit: 5, offset: 0 }) : Promise.resolve([]),
    countPendingTasksFor(user.id),
    listAttentionTasksFor(user.id, 10),
    needMine ? listMyRequests(user.id) : Promise.resolve([]),
    shown("ap_drafts") ? listDrafts(user.id, query.drafts === "all" ? 20 : 5) : Promise.resolve([]),
    approvalInsights(user.id, period).catch(() => null),
    myRequestCounts(user.id),
    shown("ap_chart") ? approvalDaily(user.id, period).catch(() => null) : Promise.resolve(null),
    personProfile(user.id).catch(() => null),
  ]);
  // v1.47.0 (owner): the Priority pill on every Home widget, one query for them all.
  const priority = await priorityRecord([...queue.map((item) => item.requestId), ...attention.items.map((item) => item.requestId), ...mine.map((item) => item.id)], user);
  // v1.58.1 (owner): every Home table sorts on every column (prefixed keys, one sortBy).
  const sortQuery = { ...query, home: "approvals" }; // a sort stays on the Approvals view
  const queueSort = homeTableSort(sortQuery, "hq", HOME_QUEUE_COLUMNS);
  const attentionSort = homeTableSort(sortQuery, "ha", HOME_QUEUE_COLUMNS);
  const returnedSort = homeTableSort(sortQuery, "hx", HOME_MINE_COLUMNS);
  const recentSort = homeTableSort(sortQuery, "hr", HOME_MINE_COLUMNS);
  const queueShown = sortQueueItems(queue, queueSort, priority);
  const attentionShown = sortQueueItems(attention.items, attentionSort, priority);
  const returnedAll = mine.filter((item) => item.status === "CHANGES_REQUIRED");
  const returned = sortMyRequests(returnedAll, returnedSort, priority);
  // v1.49.6 (owner): My recent requests shows 8 at a time, the rest on pages (?recent=N); a sort covers every page.
  const mineSorted = sortMyRequests(mine, recentSort, priority);
  const recentPages = Math.max(1, Math.ceil(mine.length / RECENT_PAGE_SIZE));
  const recentPage = Math.min(recentPages, Math.max(1, Math.floor(Number(query.recent)) || 1));
  const recentItems = mineSorted.slice((recentPage - 1) * RECENT_PAGE_SIZE, recentPage * RECENT_PAGE_SIZE);
  const keep = { home: "approvals", ...(overview ? { view: "overview" } : {}), ...periodKeep(period, "month"), ...(recentSort.sortBy ? { sortBy: `hr.${recentSort.sortBy}`, dir: recentSort.dir } : {}) };
  const role = [profile?.designationName, profile?.departmentName].filter(Boolean).join(" · ");

  // D-265 / D-406: icon, label, what it counts; each opens the page with that list.
  const cards: SummaryCard[] = [
    { key: "waiting", label: "Waiting for me", note: "Requests awaiting your approval", value: waiting, href: "/users/queue", icon: Inbox, tone: "bg-primary-50 text-primary-700", alert: waiting > 0 },
    { key: "overdue", label: "Overdue for me", note: "Your steps past their due time", value: attention.overdue, href: "/users/queue?show=overdue", icon: AlertTriangle, tone: "bg-warning-50 text-warning-600", alert: attention.overdue > 0, danger: true },
    { key: "open", label: "My open requests", note: "Raised by you, in progress", value: counts.open, href: "/users/requests?status=IN_PROGRESS", icon: FileText, tone: "bg-[color:var(--violet-bg)] text-[color:var(--violet-fg)]" },
    {
      key: "decided",
      label: "Decided by me",
      note: period.label,
      value: insights?.decided ?? 0,
      href: "/users/approved-by-me",
      icon: Gavel,
      tone: "bg-success-50 text-success-600",
      change: { value: insights ? changePercent(insights.decided, insights.decidedBefore) : null, label: PREVIOUS_LABEL[period.key] },
    },
  ];

  const waitingNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="waiting">
      <SectionHead id="waiting" title="Waiting for me" href="/users/queue" count={waiting} linkText={waiting > 5 ? `All ${waiting}` : "View all"} />
      {queue.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center" data-testid="nothing-waiting">
          <span className="relative mb-4 grid h-20 w-20 place-items-center rounded-full bg-primary-50 text-primary-700" aria-hidden="true">
            <Inbox className="h-10 w-10" />
            <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-success-solid text-on-solid ring-4 ring-[color:var(--color-surface)]">
              <CheckCircle2 className="h-5 w-5" />
            </span>
          </span>
          <p className="font-semibold">Nothing waiting for you</p>
          <p className="mt-1 text-label text-ink-muted">Requests that need your approval, and work given to you, appear here.</p>
        </div>
      ) : (
        <QueueTable items={queueShown} priority={priority} formDue={await formDueDays(queue.map((item) => item.requestId))} sort={queueSort} editable />
      )}
    </section>
  );
  // As widgets these always show (before, they were left out when empty), with a line saying there is nothing.
  const dueNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="attention" data-testid="approval-due">
      <SectionHead id="attention" title="Due soon or overdue">
        <span className="text-label text-ink-muted">
          {attention.overdue} overdue · {attention.dueSoon} due within 24 hours
        </span>
      </SectionHead>
      {attention.items.length === 0 ? (
        <p className="py-4 text-label text-ink-muted">None of your approval steps is overdue or due within 24 hours.</p>
      ) : (
        <QueueTable items={attentionShown} priority={priority} formDue={await formDueDays(attention.items.map((item) => item.requestId))} sort={attentionSort} />
      )}
    </section>
  );
  const returnedNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="returned" data-testid="approval-returned">
      <SectionHead id="returned" title="Returned to you for changes" href="/users/requests?status=CHANGES_REQUIRED" count={returned.length > 5 ? returned.length : 0} />
      {returned.length === 0 ? <p className="py-4 text-label text-ink-muted">Nothing returned to you for changes.</p> : <MyRequestsTable items={returned.slice(0, 5)} priority={priority} sort={returnedSort} />}
    </section>
  );
  const recentNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="recent-requests">
      <SectionHead id="recent-requests" title="My recent requests" href="/users/requests" count={mine.length} />
      <MyRequestsTable items={recentItems} priority={priority} sort={recentSort} />
      {recentPages > 1 && (
        <nav aria-label="My recent requests pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-label" data-testid="recent-pages">
          <span className="text-ink-muted">
            {(recentPage - 1) * RECENT_PAGE_SIZE + 1}–{(recentPage - 1) * RECENT_PAGE_SIZE + recentItems.length} of {mine.length}
          </span>
          <span className="flex items-center gap-1">
            {recentPage > 1 && (
              <Link href={`/users?${new URLSearchParams({ ...keep, recent: String(recentPage - 1) })}`} scroll={false} className="btn-secondary btn-compact" aria-label="Previous page">
                ←
              </Link>
            )}
            {Array.from({ length: recentPages }, (_, index) => index + 1).map((value) =>
              value === recentPage ? (
                <span key={value} aria-current="page" className="grid h-8 min-w-8 place-items-center rounded-md bg-primary-solid px-2 font-semibold text-on-solid">
                  {value}
                </span>
              ) : (
                <Link key={value} href={`/users?${new URLSearchParams({ ...keep, recent: String(value) })}`} scroll={false} className="grid h-8 min-w-8 place-items-center rounded-md px-2 hover:bg-surface-muted" aria-label={`Page ${value}`}>
                  {value}
                </Link>
              ),
            )}
            {recentPage < recentPages && (
              <Link href={`/users?${new URLSearchParams({ ...keep, recent: String(recentPage + 1) })}`} scroll={false} className="btn-secondary btn-compact" aria-label="Next page">
                →
              </Link>
            )}
          </span>
        </nav>
      )}
    </section>
  );
  const draftsNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="drafts">
      <SectionHead id="drafts" title="Your drafts" href={`/users?${new URLSearchParams({ ...keep, drafts: "all" })}`} count={drafts.length === 5 && query.drafts !== "all" ? 1 : 0} />
      {drafts.length === 0 ? (
        <p className="py-3 text-label text-ink-muted">No drafts. A request you start is kept here until you submit it.</p>
      ) : (
        <ul className="space-y-2">
          {drafts.map((draft) => (
            <li key={draft.key} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
              <FileEdit aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-700" />
              <span className="min-w-0 flex-1">
                <Link href={draft.href} className="link block truncate font-medium">
                  <SafeText text={draft.title} />
                </Link>
                <span className="block truncate text-caption text-ink-muted">
                  {draft.typeName} · saved {formatIndiaTime(draft.updatedAt)}
                </span>
              </span>
              <DeleteDraftButton draftKey={draft.key} title={draft.title} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const insightsNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="insights" data-testid="quick-insights">
      <h2 id="insights" className="mb-3 flex items-center gap-2 text-[calc(17px*var(--text-scale,1))] font-semibold">
        <BarChart3 aria-hidden="true" className="h-5 w-5 text-primary-700" /> Quick insights
      </h2>
      {insights === null ? (
        <ErrorState variant="inline" body="Insights couldn't be worked out just now. Reload the page to try again." />
      ) : (
        <>
          <InsightFigures
            figures={[
              { icon: <CheckCircle2 className="h-5 w-5" />, tone: "text-success-600", label: "Requests raised", value: String(insights.raised) },
              { icon: <Repeat2 className="h-5 w-5" />, tone: "text-primary-700", label: "Requests approved", value: String(insights.approved) },
              { icon: <Clock3 className="h-5 w-5" />, tone: "text-[color:var(--violet-fg)]", label: "Avg. approval time", value: hoursText(insights.avgHours) },
            ]}
          />
          <p className="mt-2 text-caption text-ink-muted">
            {period.label}: {insights.returned} of your requests sent back for changes; you decided {insights.decided} approval step{insights.decided === 1 ? "" : "s"}. Average time is from submission to final approval.
          </p>
        </>
      )}
    </section>
  );
  // Needs attention (D-406): overdue and due-soon steps, then requests returned to the person.
  const attentionItems: AttentionItem[] = [
    ...attention.items.map((item) => ({
      key: `s${item.requestId}-${item.taskKey}`,
      text: item.overdue ? "Your approval step is overdue" : "Your approval step is due soon",
      detail: `${item.requestNo} · ${item.title}${item.dueAt ? ` · due ${formatIndiaTime(item.dueAt)}` : ""}`,
      href: `/users/requests/${item.requestId}`,
      danger: item.overdue,
    })),
    ...returnedAll.slice(0, 5).map((item) => ({ key: `r${item.id}`, text: "Returned to you for changes", detail: `${item.requestNo} · ${item.title}`, href: `/users/requests/${item.id}`, danger: false })),
  ];
  const attentionNode = <AttentionWidget id="ap-attention" items={attentionItems} empty="Nothing late, due soon or returned to you. Well done." testId="approval-attention" />;
  const chartNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="ap-chart" data-testid="approval-chart">
      <h2 id="ap-chart" className="mb-1 text-[calc(17px*var(--text-scale,1))] font-semibold">
        My approval activity
      </h2>
      <p className="mb-2 text-caption text-ink-muted">{period.key === "week" ? "This week, day by day" : `${period.label}, by day of the week`}: requests you raised and approval steps you decided.</p>
      {daily ? (
        <WorkloadChart assigned={daily.raised} completed={daily.decided} labels={["Raised", "Decided"]} empty="Nothing raised or decided in this period." caption={`Requests raised and steps decided by day, ${period.label.toLowerCase()}`} />
      ) : (
        <ErrorState variant="inline" body="The chart couldn't be worked out just now. Reload the page to try again." />
      )}
    </section>
  );
  const nodeFor = (kind: WidgetKind): React.ReactNode => {
    switch (kind) {
      case "ap_waiting":
        return waitingNode;
      case "ap_due":
        return dueNode;
      case "ap_returned":
        return returnedNode;
      case "ap_recent":
        return recentNode;
      case "ap_drafts":
        return draftsNode;
      case "ap_insights":
        return insightsNode;
      case "ap_attention":
        return attentionNode;
      case "ap_chart":
        return chartNode;
      case "notepad":
        return <HomeNotepad initialText={widgets.note.body} version={widgets.note.version} />;
      default:
        return null;
    }
  };

  return (
    <div data-testid="approval-overview">
      <QuietRefresh />
      <OverviewHeader
        icon={Layers}
        title="Approvals – Overview"
        role={role}
        description="What needs you first, then where your requests are."
        greeting={greeting}
        switcher={switcher}
        period={period}
        periodBase={{ home: "approvals", ...(overview ? { view: "overview" } : {}) }}
        tour
      />
      <QuickActions items={quick} testId="approval-quick-actions" widgets={widgets.editable} />
      {checklist}
      <SummaryCards cards={cards} testId="approval-cards" cardTestId="approval-card" tour />
      <div className="mt-6">
        <HomeWidgets key="approvals" scope="approvals" fixed={!widgets.editable} version={widgets.version} addable={widgets.addable} widgets={widgets.layout.map((item) => ({ kind: item.kind, size: item.size, node: nodeFor(item.kind) }))} />
      </div>
    </div>
  );
}
