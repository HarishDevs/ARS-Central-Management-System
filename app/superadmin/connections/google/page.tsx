import type { Metadata } from "next";
import { PagedRows } from "@/features/ui/PagedRows";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge, Card, EmptyState } from "@/features/ui/Display";
import { Hint } from "@/features/ui/Hint";
import { CalendarConfigForm, CommandButton } from "@/features/integrations/CalendarForms";
import { calendarCommandAction } from "@/app/superadmin/connections/google/actions";
import { calendarStats, listConflicts, listConnections, listJobs, loadSettingsRow } from "@/lib/db/repositories/gcal.repository";
import { listAuditForEntity } from "@/lib/db/repositories/audit.repository";
import { integrationStatus, redirectUri, SCOPES, STATUS_LABEL, WEBHOOK_PATH } from "@/server/calendar/config";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { getEnv } from "@/config/environment";
import { DetailsList } from "@/features/ui/DetailsList";
import { ConnectionStatus } from "@/features/superadmin/ConnectionStatus";
import { ListViews } from "@/features/lists/ListViews";
import { sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): the
// Connected people and Recent sync log tables sort by any column (one sort on
// the page at a time); views save it. No Group by: a set-up and health console
// (the failed syncs, conflicts and history are short lists, not tables).
const CONNECTION_COLUMNS = ["con_person", "con_account", "con_status", "con_last", "con_waiting"] as const;
const SYNC_COLUMNS = ["sync_queued", "sync_person", "sync_kind", "sync_status", "sync_result"] as const;
const PATH = "/superadmin/connections/google";
const TARGET = "list_super_gcal";

export const metadata: Metadata = { title: "Google sign-in & calendar" };
export const dynamic = "force-dynamic";

// v1.11.0 (D-152): Super Admin → Integrations → Google Calendar. Set-up,
// test, switch on/off, health, sync logs, failed syncs, connected people,
// conflicts and the audit history. Secrets are never shown.
const when = (date: Date | null) => (date ? formatIndiaTime(date) : "Never");
const TONE = { NOT_CONFIGURED: "warning", DISABLED: "neutral", ENABLED: "success", MAINTENANCE: "warning" } as const;
const CONNECTION_TONE = { ACTIVE: "success", NEEDS_REAUTH: "warning", DISCONNECTED: "neutral", REVOKED: "danger" } as const;

export default async function GoogleCalendarAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const settings = await loadSettingsRow();
  const status = integrationStatus({ enabled: settings.enabled, maintenance: settings.maintenance, clientId: settings.clientId, hasSecret: Boolean(settings.secretEnc), lastTestOk: settings.lastTestOk });
  const [stats, allConnections, failed, allRecent, conflicts, history] = await Promise.all([
    calendarStats(),
    listConnections(),
    listJobs({ statuses: ["FAILED", "DEAD"], limit: 50 }),
    listJobs({ limit: 20 }),
    listConflicts({ status: "OPEN", limit: 50 }),
    listAuditForEntity(["INTEGRATION"], "google_calendar", 25),
  ]);
  const connectionSort = parseColumnSort(query, CONNECTION_COLUMNS);
  const connectionValue: Record<(typeof CONNECTION_COLUMNS)[number], (connection: (typeof allConnections)[number]) => unknown> = {
    con_person: (connection) => connection.userName,
    con_account: (connection) => connection.googleEmail,
    con_status: (connection) => connection.status,
    con_last: (connection) => connection.lastSyncAt,
    con_waiting: (connection) => connection.pendingJobs + connection.openConflicts,
  };
  const connections = connectionSort.sortBy ? sortRows(allConnections, connectionValue[connectionSort.sortBy], connectionSort.dir) : allConnections;
  const syncSort = parseColumnSort(query, SYNC_COLUMNS);
  const syncValue: Record<(typeof SYNC_COLUMNS)[number], (job: (typeof allRecent)[number]) => unknown> = {
    sync_queued: (job) => job.createdAt,
    sync_person: (job) => job.userName,
    sync_kind: (job) => `${job.kind} ${job.reason}`,
    sync_status: (job) => job.status,
    sync_result: (job) => (job.result ? JSON.stringify(job.result) : job.errorDetail),
  };
  const recent = syncSort.sortBy ? sortRows(allRecent, syncValue[syncSort.sortBy], syncSort.dir) : allRecent;
  const connectionHead = sortHeads(PATH, query, connectionSort);
  const syncHead = sortHeads(PATH, query, syncSort);
  const base = getEnv().APP_BASE_URL;
  const redirect = redirectUri(base);
  const webhook = base ? new URL(WEBHOOK_PATH, base).toString() : null;

  return (
    <>
      <PageHeader title="Google sign-in & calendar" description="Google sign-in (the Power BI site's Firebase project; its server credentials are GoDaddy variables, never stored here) and the two-way sync between ARS and each person's own Google Calendar. You set the calendar up here; each person connects their own account from their profile.">
        <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </PageHeader>

      {/* v1.84.0 (D-411): Connections → Google sign-in & calendar: both statuses first. */}
      <ConnectionStatus keys={["google_signin", "google_calendar"]} />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      <Card title="Calendar status and actions" className="mb-6">
        <DetailsList
          className="mb-4 lg:grid-cols-4"
          items={[
            { label: "Integration", value: <span className="font-semibold">{STATUS_LABEL[status]}</span> },
            { label: "Last health check", value: settings.lastTestAt ? `${when(settings.lastTestAt)} · ${settings.lastTestOk ? "passed" : "failed"}` : "Not tested yet" },
            { label: "Last configuration change", value: `${when(settings.updatedAt)}${settings.updatedByName ? ` · ${settings.updatedByName}` : ""} (version ${settings.version})` },
            { label: "Client secret", value: settings.secretEnc ? "Saved (encrypted, hidden)" : "Not set" },
          ]}
        />
        <div className="flex flex-wrap items-start gap-3">
          <CommandButton action={calendarCommandAction} fields={{ command: "test" }} label="Test configuration" />
          {settings.enabled ? (
            <CommandButton action={calendarCommandAction} fields={{ command: "disable" }} label="Disable integration" confirm="Syncing stops for everyone. Connections and events already in Google are kept." confirmLabel="Disable" danger />
          ) : (
            <CommandButton action={calendarCommandAction} fields={{ command: "enable" }} label="Enable integration" variant="primary" />
          )}
          {settings.maintenance ? (
            <CommandButton action={calendarCommandAction} fields={{ command: "maintenance-off" }} label="End maintenance mode" />
          ) : (
            <CommandButton action={calendarCommandAction} fields={{ command: "maintenance-on" }} label="Maintenance mode" confirm="Syncing pauses for everyone until you end maintenance mode." confirmLabel="Pause syncing" />
          )}
        </div>
        {settings.lastTest?.checks && (
          <ul className="mt-4 space-y-1 text-label" aria-label="Last check results" data-testid="gcal-checks">
            {settings.lastTest.checks.map((check) => (
              <li key={check.key} className={check.ok ? "text-success-600" : "text-danger-600"}>
                {check.ok ? "✓" : "✗"} {check.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            Google Cloud set-up
            <Hint
              text="1. Google Cloud Console → APIs & Services → Library → enable Google Calendar API. 2. OAuth consent screen (Google Auth Platform → Audience): set User type: External. ARS people use more than one domain; with “Internal” everyone outside the project's own Workspace gets “Error 403: org_internal”. Add the scopes below. In “Testing” only listed test users can connect (access lapses after 7 days): Publish app to open it to everyone. 3. Credentials → Create OAuth client ID → Web application, with the redirect URI below, exactly."
              align="start"
            />
          </span>
        }
        className="mb-6"
      >
        <p className="text-label">Authorised redirect URI</p>
        <p className="mt-1 break-all rounded bg-surface-muted px-3 py-2 font-mono text-caption" data-testid="gcal-redirect">
          {redirect ?? "Set APP_BASE_URL on the server first."}
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-label">
          Scopes
          <Hint text="Requested from each person: the least needed." align="start" />
        </p>
        <ul className="mt-1 list-disc pl-5 font-mono text-caption">
          {SCOPES.map((scope) => (
            <li key={scope} className="break-all">
              {scope}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-label">
          Change notifications: <span className="break-all font-mono text-caption">{webhook ?? "(APP_BASE_URL not set)"}</span>{" "}
          <Hint text="They need the public https address; the scheduled reconciliation covers anything missed." align="end" />
        </p>
      </Card>

      <Card title="Configuration" className="mb-6">
        <CalendarConfigForm clientId={settings.clientId} hasSecret={Boolean(settings.secretEnc)} config={settings.config} />
      </Card>

      <Card title="Health (last 24 hours)" className="mb-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-label sm:grid-cols-3 lg:grid-cols-5" data-testid="gcal-health">
          {[
            ["Connected", stats.connections.ACTIVE],
            ["Need reauthorising", stats.connections.NEEDS_REAUTH],
            ["Disconnected / revoked", stats.connections.DISCONNECTED + stats.connections.REVOKED],
            ["Syncs done", stats.jobs24h.done],
            ["Syncs failed", stats.jobs24h.failed + stats.jobs24h.dead],
            ["Waiting to retry", stats.pendingRetries],
            ["API errors", stats.apiErrors24h],
            ["Connect failures", stats.oauthFailures24h],
            ["Channels expiring < 1 day", stats.channelsExpiringSoon],
            ["Conflicts to review", stats.openConflicts],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-stat font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-caption text-ink-muted">
          Last successful sync: {when(stats.lastSuccessAt)} · Average time from queued to done: {stats.avgLatencySeconds === null ? "n/a" : `${stats.avgLatencySeconds} s`}
          {stats.lastErrorCategories.length > 0 && ` · Errors this week: ${stats.lastErrorCategories.map((item) => `${item.category} ${item.count}`).join(", ")}`}
        </p>
      </Card>

      <Card title={`Connected people (${connections.length})`} className="mb-6" bodyClassName="p-0">
        {connections.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nobody has connected yet" body="Once the integration is enabled, people connect from Profile → Calendar." />
          </div>
        ) : (
          <div className="table-cards overflow-x-auto">
            <table className="w-full min-w-[760px] text-label max-md:p-3" aria-label="Connected people" data-cards>
              <thead className="text-left text-caption text-ink-muted">
                <tr>
                  {connectionHead("Person", "con_person", { className: "px-4 py-2" })}
                  {connectionHead("Google account · calendar", "con_account", { className: "px-4 py-2" })}
                  {connectionHead("Status", "con_status", { className: "px-4 py-2" })}
                  {connectionHead("Last sync", "con_last", { className: "px-4 py-2" })}
                  {connectionHead("Waiting · conflicts", "con_waiting", { className: "px-4 py-2" })}
                  <th scope="col" className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <PagedRows colSpan={6}>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td className="px-4 py-2">
                      {connection.userName} <span className="text-ink-muted">({connection.loginId})</span>
                    </td>
                    <td data-label="Google account · calendar" className="px-4 py-2 break-all">
                      {connection.googleEmail ?? "Unknown"} · {connection.calendarName ?? "No calendar"}
                    </td>
                    <td data-label="Status" className="px-4 py-2">
                      <Badge tone={CONNECTION_TONE[connection.status]}>{connection.status.replace("_", " ").toLowerCase()}</Badge>
                      {connection.lastError && <span className="mt-1 block text-caption text-danger-600">{connection.lastError}</span>}
                    </td>
                    <td data-label="Last sync" className="px-4 py-2">{when(connection.lastSyncAt)}</td>
                    <td data-label="Waiting · conflicts" className="px-4 py-2 tabular-nums">
                      {connection.pendingJobs} · {connection.openConflicts}
                    </td>
                    <td data-label="Actions" className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {connection.status === "ACTIVE" && <CommandButton action={calendarCommandAction} fields={{ command: "resync", connectionId: connection.id }} label="Full resync" />}
                        {(connection.status === "ACTIVE" || connection.status === "NEEDS_REAUTH") && (
                          <CommandButton
                            action={calendarCommandAction}
                            fields={{ command: "revoke", connectionId: connection.id }}
                            label="Revoke"
                            confirm={`End ${connection.userName}'s Google Calendar connection? Their tokens are deleted and syncing stops. ARS records aren't changed.`}
                            confirmLabel="Revoke connection"
                            danger
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </PagedRows>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Failed syncs (${failed.length})`} className="mb-6" actions={failed.length > 0 ? <CommandButton action={calendarCommandAction} fields={{ command: "retry-all" }} label="Retry all" /> : undefined}>
        {failed.length === 0 ? (
          <p className="text-label text-ink-muted">No failed syncs.</p>
        ) : (
          <ul className="divide-y divide-line text-label" data-testid="gcal-failed">
            {failed.map((job) => (
              <li key={job.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <strong>{job.userName}</strong> · {job.kind.replace("_", " ").toLowerCase()} · {job.status === "DEAD" ? "retries used up" : "failed"} after {job.attempts} attempt(s) · {when(job.finishedAt)}
                  <span className="block text-caption text-danger-600">
                    {job.errorCategory}: {job.errorDetail}
                  </span>
                </span>
                <CommandButton action={calendarCommandAction} fields={{ command: "retry", jobId: job.id }} label="Retry" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            Conflicts awaiting review
            <Hint text="People usually resolve their own from Profile → Calendar." align="start" />
          </span>
        }
        className="mb-6"
      >
        {conflicts.length === 0 ? (
          <p className="text-label text-ink-muted">None.</p>
        ) : (
          <ul className="divide-y divide-line text-label">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="py-2">
                <strong>{conflict.userName}</strong>: personal entry #{conflict.entityId} · {conflict.conflictType === "BOTH_CHANGED" ? "changed in both places" : "deleted in Google, changed in ARS"} · {when(conflict.createdAt)}
                <div className="mt-2 flex flex-wrap gap-2">
                  <CommandButton action={calendarCommandAction} fields={{ command: "resolve", conflictId: conflict.id, resolution: "KEEP_ARS" }} label="Keep ARS version" />
                  <CommandButton action={calendarCommandAction} fields={{ command: "resolve", conflictId: conflict.id, resolution: "KEEP_GOOGLE" }} label="Keep Google version" />
                  <CommandButton action={calendarCommandAction} fields={{ command: "resolve", conflictId: conflict.id, resolution: "DISMISSED" }} label="Dismiss" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent sync log" className="mb-6" bodyClassName="p-0">
        <div className="table-cards overflow-x-auto">
          <table className="w-full min-w-[640px] text-label max-md:p-3" aria-label="Recent syncs" data-cards>
            <thead className="text-left text-caption text-ink-muted">
              <tr>
                {syncHead("Queued", "sync_queued", { className: "px-4 py-2" })}
                {syncHead("Person", "sync_person", { className: "px-4 py-2" })}
                {syncHead("Kind · reason", "sync_kind", { className: "px-4 py-2" })}
                {syncHead("Status", "sync_status", { className: "px-4 py-2" })}
                {syncHead("Result", "sync_result", { className: "px-4 py-2" })}
              </tr>
            </thead>
            <PagedRows colSpan={5}>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-muted">
                    No syncs yet.
                  </td>
                </tr>
              )}
              {recent.map((job) => (
                <tr key={job.id}>
                  <td data-label="Queued" className="px-4 py-2 whitespace-nowrap">{when(job.createdAt)}</td>
                  <td data-card-title="" className="px-4 py-2">{job.userName}</td>
                  <td data-label="Kind · reason" className="px-4 py-2">
                    {job.kind.replace("_", " ").toLowerCase()} · {job.reason.toLowerCase().replace(/_/g, " ")}
                  </td>
                  <td data-label="Status" className="px-4 py-2">{job.status.toLowerCase()}</td>
                  <td data-label="Result" className="px-4 py-2 text-caption text-ink-muted">
                    {job.result
                      ? Object.entries(job.result)
                          .filter(([, value]) => value)
                          .map(([key, value]) => `${key} ${value}`)
                          .join(", ") || "no changes"
                      : (job.errorDetail ?? "")}
                  </td>
                </tr>
              ))}
            </PagedRows>
          </table>
        </div>
      </Card>

      <Card title="Configuration history (audit)">
        {history.length === 0 ? (
          <p className="text-label text-ink-muted">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-line text-label" data-testid="gcal-history">
            {history.map((entry) => (
              <li key={entry.id} className="py-2">
                {when(entry.occurredAt)} · {entry.actorName ?? "System"} · {entry.action.replace(/^GCAL_/, "").replace(/_/g, " ").toLowerCase()}
                {entry.result === "FAILURE" ? " (failed)" : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
