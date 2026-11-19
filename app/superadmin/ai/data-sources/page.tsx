import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge } from "@/features/ui/Display";
import { PLANNED_SOURCES } from "@/features/ai/sources";
import { lastSuccess, latestRuns } from "@/lib/db/repositories/ai.repository";
import { sourceDatasetCounts } from "@/lib/db/repositories/ai-data.repository";
import { SALESFORCE_KEY } from "@/server/ai/connectors/salesforce";
import { getConnection } from "@/lib/db/repositories/salesforce.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { requireArea } from "@/server/authorization/guards";
import { ListViews } from "@/features/lists/ListViews";
import { sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): both
// tables sort by any column (one sort on the page at a time); views save it.
const SOURCE_COLUMNS = ["source", "what", "status", "last", "needs"] as const;
const RUN_COLUMNS = ["object", "records", "run", "result"] as const;
const PATH = "/superadmin/ai/data-sources";
const TARGET = "list_super_ai_sources";

export const metadata: Metadata = { title: "Data Sources" };
export const dynamic = "force-dynamic";

// D-169: where the AI's data comes from, its status and how fresh it is.
// Credentials are never shown here. D-180: Super Admin only (moved from /users/ai).
export default async function AiDataSourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // D-244 (audit SEC-02): every page checks its own area. The layout's
  // check alone isn't enough: a client-navigation request (RSC) renders the
  // page without waiting for the layout.
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const [connection, sfRuns, sfLast, sfCounts] = await Promise.all([
    getConnection(),
    latestRuns(SALESFORCE_KEY),
    lastSuccess(SALESFORCE_KEY),
    sourceDatasetCounts(SALESFORCE_KEY),
  ]);
  const sfFailed = sfRuns.some((run) => run.status === "FAILED");
  const status: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; text: string; last: string }> = {
    ars: { tone: "success", text: "Connected (live)", last: "Read live at each question" },
    // D-172: live queries through the OAuth connection; the hourly copy (optional) shows its own runs below.
    salesforce:
      connection.status === "CONNECTED"
        ? { tone: sfFailed ? "warning" : "success", text: sfFailed ? "Connected (last copy failed; older copy kept)" : "Connected (live, read-only)", last: sfLast ? `Copy: ${formatIndiaTime(new Date(sfLast))}` : connection.lastTestAt ? `Tested: ${formatIndiaTime(connection.lastTestAt)}` : "Live at each question" }
        : connection.status === "NEEDS_REAUTH"
          ? { tone: "danger", text: "Needs reconnecting", last: sfLast ? formatIndiaTime(new Date(sfLast)) : "—" }
          : { tone: "neutral", text: "Not connected", last: "Never" },
    oracle: { tone: "neutral", text: "Not connected", last: "Never" },
    powerbi: { tone: "neutral", text: "Not connected", last: "Never" },
  };
  const needs = (source: (typeof PLANNED_SOURCES)[number]) => (source.key === "ars" ? "Nothing: limited to what each person may see." : source.needs);
  const sourceSort = parseColumnSort(query, SOURCE_COLUMNS);
  const sourceValue: Record<(typeof SOURCE_COLUMNS)[number], (source: (typeof PLANNED_SOURCES)[number]) => unknown> = {
    source: (source) => source.name,
    what: (source) => source.what,
    status: (source) => status[source.key]?.text,
    last: (source) => status[source.key]?.last,
    needs,
  };
  const sources = sourceSort.sortBy ? sortRows(PLANNED_SOURCES, sourceValue[sourceSort.sortBy], sourceSort.dir) : PLANNED_SOURCES;
  const recordsOf = (dataset: string) => sfCounts.find((item) => item.dataset === dataset)?.records ?? 0;
  const runSort = parseColumnSort(query, RUN_COLUMNS);
  const runValue: Record<(typeof RUN_COLUMNS)[number], (run: (typeof sfRuns)[number]) => unknown> = {
    object: (run) => run.dataset,
    records: (run) => recordsOf(run.dataset),
    run: (run) => run.startedAt,
    result: (run) => run.status,
  };
  const runs = runSort.sortBy ? sortRows(sfRuns, runValue[runSort.sortBy], runSort.dir) : sfRuns;
  const sourceHead = sortHeads(PATH, query, sourceSort);
  const runHead = sortHeads(PATH, query, runSort);
  return (
    <>
      <PageHeader title="Data Sources" description="Where the AI's data comes from, whether it is connected, and how fresh it is. Read-only access only." />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      <div className="space-y-6">
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="ai-sources">
            <caption className="sr-only">Data sources</caption>
            <thead>
              <tr>
                {sourceHead("Source", "source")}
                {sourceHead("What it provides", "what")}
                {sourceHead("Status", "status")}
                {sourceHead("Last successful sync", "last")}
                {sourceHead("Needed before connecting", "needs")}
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.key}>
                  <td className="font-medium">{source.name}</td>
                  <td className="text-label">{source.what}</td>
                  <td>
                    <Badge tone={status[source.key]!.tone}>{status[source.key]!.text}</Badge>
                  </td>
                  <td className="text-label text-ink-muted">{status[source.key]!.last}</td>
                  <td className="text-label text-ink-muted">{needs(source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sfRuns.length > 0 && (
          <section className="card overflow-x-auto" aria-labelledby="sf-runs">
            <h2 id="sf-runs" className="px-5 pt-4 font-semibold">
              Salesforce objects
            </h2>
            <table className="data-table" data-testid="ai-sf-runs">
              <thead>
                <tr>
                  {runHead("Object", "object")}
                  {runHead("Records copied", "records")}
                  {runHead("Last run", "run")}
                  {runHead("Result", "result")}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.dataset}>
                    <td className="font-medium">{run.dataset}</td>
                    <td>{recordsOf(run.dataset)}</td>
                    <td className="text-label text-ink-muted">{formatIndiaTime(run.startedAt)}</td>
                    <td className="text-label">{run.status === "SUCCEEDED" ? `Succeeded (${run.rowsFetched} changed)` : run.status === "RUNNING" ? "Running" : `Failed: ${run.error ?? "unknown"} (the last good copy is kept)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
