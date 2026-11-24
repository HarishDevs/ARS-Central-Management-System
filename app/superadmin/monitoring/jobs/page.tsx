import type { Metadata } from "next";
import { ConsoleLayout } from "@/features/ui/ConsoleLayout";
import { PagedRows } from "@/features/ui/PagedRows";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState, Badge } from "@/features/ui/Display";
import { ResendOutbox, RunJobsNow } from "@/features/admin/AttentionForms";
import { AUTOMATIONS, loadAutomationBoard, type AutomationHealth } from "@/server/ops/automation";
import { listJobRuns } from "@/lib/db/repositories/job-runs.repository";
import { listUnsentOutbox } from "@/lib/db/repositories/outbox.repository";
import { getRunnerHeartbeat } from "@/lib/db/repositories/jobs.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { RUN_GROUP_LABEL, RUN_GROUPS, runBucket } from "@/server/lists/superadmin-lists";

// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): each
// table sorts by any column (one sort on the page at a time); Recent runs can
// be grouped (folded by default); views save the choice. Inventory and the
// unsent list are short work lists, so they sort but don't group.
const INVENTORY_COLUMNS = ["inv_name", "inv_status", "inv_last", "inv_retry", "inv_failure"] as const;
const UNSENT_COLUMNS = ["out_message", "out_request", "out_queued", "out_tries"] as const;
const RUN_COLUMNS = ["run_started", "run_name", "run_how", "run_result", "run_ref"] as const;
const PATH = "/superadmin/monitoring/jobs";
const TARGET = "list_super_automation";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Job runner & automation" };

export const dynamic = "force-dynamic";

const HEALTH: Record<AutomationHealth, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  OK: { tone: "success", label: "Running" },
  LATE: { tone: "warning", label: "Late: missed runs" },
  FAILING: { tone: "danger", label: "Last run failed" },
  NEVER: { tone: "neutral", label: "Never run" },
};

const describeCounts = (counts: Record<string, number | string>) =>
  Object.entries(counts)
    .filter(([, value]) => value !== 0 && value !== "")
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ") || "nothing to do";

// FN11 / Addendum B: every automation, whether it's running, its history,
// and recovery (run now, resend). Super Admin only.
export default async function AutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const raw = Array.isArray(query.job) ? query.job[0] : query.job;
  const job = raw && AUTOMATIONS.some((automation) => automation.key === raw) ? raw : undefined;
  const [board, runs, unsent, heartbeat] = await Promise.all([loadAutomationBoard(), listJobRuns({ jobKey: job, limit: 50 }), listUnsentOutbox(100), getRunnerHeartbeat()]);
  const runnerLate = !heartbeat || heartbeat.minutesAgo > 15;
  const nameOf = new Map(AUTOMATIONS.map((automation) => [automation.key, automation.name]));

  const inventorySort = parseColumnSort(query, INVENTORY_COLUMNS);
  const inventoryValue: Record<(typeof INVENTORY_COLUMNS)[number], (item: (typeof board)[number]) => unknown> = {
    inv_name: (item) => item.automation.name,
    inv_status: (item) => HEALTH[item.health].label,
    inv_last: (item) => item.summary?.lastRun?.startedAt ?? null,
    inv_retry: (item) => item.automation.retry,
    inv_failure: (item) => item.automation.onFailure,
  };
  const inventory = inventorySort.sortBy ? sortRows(board, inventoryValue[inventorySort.sortBy], inventorySort.dir) : board;
  const unsentSort = parseColumnSort(query, UNSENT_COLUMNS);
  const unsentValue: Record<(typeof UNSENT_COLUMNS)[number], (row: (typeof unsent)[number]) => unknown> = {
    out_message: (row) => row.eventType,
    out_request: (row) => row.requestNo,
    out_queued: (row) => row.createdAt,
    out_tries: (row) => row.attempts,
  };
  const unsentRows = unsentSort.sortBy ? sortRows(unsent, unsentValue[unsentSort.sortBy], unsentSort.dir) : unsent;
  const runSort = parseColumnSort(query, RUN_COLUMNS);
  const runName = (run: (typeof runs)[number]) => nameOf.get(run.jobKey) ?? run.jobKey;
  const runValue: Record<(typeof RUN_COLUMNS)[number], (run: (typeof runs)[number]) => unknown> = {
    run_started: (run) => run.startedAt,
    run_name: runName,
    run_how: (run) => (run.trigger === "MANUAL" ? "Run now" : "Scheduled"),
    run_result: (run) => run.status,
    run_ref: (run) => run.runRef,
  };
  const runRows = runSort.sortBy ? sortRows(runs, runValue[runSort.sortBy], runSort.dir) : runs;
  const group = pickGroup(query.group, RUN_GROUPS);
  const inventoryHead = sortHeads(PATH, query, inventorySort);
  const unsentHead = sortHeads(PATH, query, unsentSort);
  const runHead = sortHeads(PATH, query, runSort);
  const runRow = (run: (typeof runs)[number]) => (
    <tr key={run.id}>
      <td data-label="Started" className="whitespace-nowrap">{formatIndiaTime(run.startedAt)}</td>
      <td data-card-title="">{runName(run)}</td>
      <td data-label="How">{run.trigger === "MANUAL" ? "Run now" : "Scheduled"}</td>
      <td data-label="Result" className="text-label">
        <Badge tone={run.status === "OK" ? "success" : run.status === "FAILED" ? "danger" : "neutral"}>{run.status === "OK" ? "OK" : run.status === "FAILED" ? "Failed" : "Running"}</Badge>
        <span className="mt-1 block text-caption text-ink-muted">{run.status === "FAILED" ? run.errorCode : describeCounts(run.counts)}</span>
      </td>
      <td data-label="Reference" className="font-mono text-caption text-ink-muted">{run.runRef.slice(0, 12)}</td>
    </tr>
  );

  return (
    <>
      <PageHeader title="Job runner & automation" description="Background jobs: what each does, whether it is running, its recent runs, and how to recover when something fails.">
        <RunJobsNow label="Run all jobs now" />
      </PageHeader>

      <p role={runnerLate ? "alert" : "status"} className={`mb-4 rounded-md px-3 py-2 text-label ${runnerLate ? "bg-danger-50 text-danger-600" : "bg-success-50 text-success-600"}`}>
        {heartbeat
          ? runnerLate
            ? `The job runner last finished ${heartbeat.minutesAgo} minutes ago. It should run every 5 minutes: check the cPanel cron job and its secret.`
            : `The job runner last finished ${heartbeat.minutesAgo} minute${heartbeat.minutesAgo === 1 ? "" : "s"} ago.`
          : "The job runner has never run. Set up the cPanel cron job (DEPLOYMENT Part I)."}
      </p>
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />

      {/* v1.84.0 (D-411): the console layout: the automations, then the run log. */}
      <ConsoleLayout
        testId="jobs-console"
        listLabel="Automations"
        list={
          <>
      <section aria-labelledby="inventory" className="card table-cards mb-6 overflow-x-auto">
        <h2 id="inventory" className="border-b border-line px-5 py-3 font-semibold">
          Inventory
        </h2>
        <table className="data-table max-md:p-3">
          <thead>
            <tr>
              {inventoryHead("Automation", "inv_name")}
              {inventoryHead("Status", "inv_status")}
              {inventoryHead("Last run", "inv_last")}
              {inventoryHead("Retries and safety", "inv_retry")}
              {inventoryHead("If it fails", "inv_failure")}
            </tr>
          </thead>
          <PagedRows colSpan={5}>
            {inventory.map(({ automation, summary, health }) => (
              <tr key={automation.key}>
                <td className="min-w-56">
                  <span className="font-semibold">{automation.name}</span>
                  <span className="block text-caption text-ink-muted">{automation.what}</span>
                  <span className="block text-caption text-ink-muted">{automation.trigger}</span>
                </td>
                <td data-label="Status" className="whitespace-nowrap">
                  <Badge tone={HEALTH[health].tone}>{HEALTH[health].label}</Badge>
                  {summary && summary.runs24h > 0 && (
                    <span className="mt-1 block text-caption text-ink-muted">
                      {summary.runs24h} runs, {summary.failures24h} failed (24 h)
                    </span>
                  )}
                </td>
                <td data-label="Last run" className="min-w-48 text-label">
                  {summary?.lastRun ? (
                    <>
                      {formatIndiaTime(summary.lastRun.startedAt)}
                      <span className="block text-caption text-ink-muted">{summary.lastRun.status === "FAILED" ? (summary.lastRun.errorCode ?? "Failed") : describeCounts(summary.lastRun.counts)}</span>
                      {summary.lastOkAt && summary.lastRun.status !== "OK" && <span className="block text-caption text-ink-muted">Last good run {formatIndiaTime(summary.lastOkAt)}</span>}
                    </>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                  <Link href={`/superadmin/monitoring/jobs?job=${automation.key}#runs`} className="link mt-1 block text-caption">
                    History
                  </Link>
                </td>
                <td data-label="Retries and safety" className="min-w-56 text-caption">
                  <span className="block">{automation.retry}</span>
                  <span className="block text-ink-muted">{automation.idempotency}</span>
                </td>
                <td data-label="If it fails" className="min-w-56 space-y-2 text-caption">
                  <span className="block">{automation.onFailure}</span>
                  <span className="block text-ink-muted">Recover: {automation.recovery}</span>
                  <span className="block text-ink-muted">Owner: {automation.owner}</span>
                  <RunJobsNow job={automation.key} label="Run now" />
                </td>
              </tr>
            ))}
          </PagedRows>
        </table>
      </section>

      <section aria-labelledby="unsent" className="card table-cards mb-6 overflow-x-auto">
        <h2 id="unsent" className="border-b border-line px-5 py-3 font-semibold">
          Messages not sent ({unsent.length})
        </h2>
        {unsent.length === 0 ? (
          <p className="px-5 py-4 text-label text-ink-muted">Every queued message has been sent.</p>
        ) : (
          <table className="data-table max-md:p-3">
            <thead>
              <tr>
                {unsentHead("Message", "out_message")}
                {unsentHead("Request", "out_request")}
                {unsentHead("Queued", "out_queued")}
                {unsentHead("Tries", "out_tries")}
                <th scope="col">
                  <span className="sr-only">Resend</span>
                </th>
              </tr>
            </thead>
            <PagedRows colSpan={5}>
              {unsentRows.map((row) => (
                <tr key={row.id}>
                  <td className="font-mono text-caption">{row.eventType}</td>
                  <td data-label="Request">
                    {row.requestId && row.requestNo ? (
                      <Link href={`/users/requests/${row.requestId}`} className="link">
                        {row.requestNo}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Queued" className="whitespace-nowrap">{formatIndiaTime(row.createdAt)}</td>
                  <td data-label="Tries">
                    {row.gaveUp ? <Badge tone="danger">{row.attempts} · gave up</Badge> : row.attempts}
                    {/* D-243 (audit DB-014): a send that started but wasn't recorded may have gone out; check before resending. */}
                    {row.unconfirmed && (
                      <span className="ml-2" title="The send started but its result wasn't recorded. Check with the person (or the provider) before resending.">
                        <Badge tone="warning">may have been sent</Badge>
                      </span>
                    )}
                  </td>
                  <td>
                    <ResendOutbox outboxId={row.id} />
                  </td>
                </tr>
              ))}
            </PagedRows>
          </table>
        )}
      </section>

          </>
        }
        logLabel="Run log"
        log={
      <section aria-labelledby="runs-title" id="runs" className="card table-cards overflow-x-auto">
        <h2 className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 font-semibold">
          <span id="runs-title">Recent runs{job ? `: ${nameOf.get(job)}` : ""}</span>
          {job && (
            <Link href="/superadmin/monitoring/jobs#runs" className="link text-label font-normal">
              Show all
            </Link>
          )}
        </h2>
        {runs.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No runs recorded yet" body="Runs show here after the job runner's first call." />
          </div>
        ) : (
          <>
            <div className="px-5 pt-3">
              <ListToolbar id="automation-runs" path={PATH} label="Recent runs" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, group, RUN_GROUPS, RUN_GROUP_LABEL)} />
            </div>
            <FoldScope enabled={Boolean(group)}>
              <table className="data-table max-md:p-3">
                <thead>
                  <tr>
                    {runHead("Started", "run_started")}
                    {runHead("Automation", "run_name")}
                    {runHead("How", "run_how")}
                    {runHead("Result", "run_result")}
                    {runHead("Reference", "run_ref")}
                  </tr>
                </thead>
                {group ? (
                  groupRows(runRows, (run) => runBucket(group, { automationName: runName(run), status: run.status, trigger: run.trigger })).map((section) => (
                    <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={5}>
                      {section.items.map(runRow)}
                    </FoldTbody>
                  ))
                ) : (
                  <PagedRows colSpan={5}>{runRows.map(runRow)}</PagedRows>
                )}
              </table>
            </FoldScope>
          </>
        )}
      </section>
        }
      />
    </>
  );
}
