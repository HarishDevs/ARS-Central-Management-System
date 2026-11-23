import { EmptyState } from "@/features/ui/Display";
import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { recentAiEvents, recentFailures, usageByPerson, usageByProvider } from "@/lib/db/repositories/ai.repository";
import { getSettingValue } from "@/server/settings/values";
import { PROVIDER_LABEL } from "@/server/ai/providers";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { requireArea } from "@/server/authorization/guards";
import { ListViews } from "@/features/lists/ListViews";
import { sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): the
// Usage by person table sorts by any column; views save it. (The other panels are lists, not tables.)
const PEOPLE_COLUMNS = ["person", "questions", "failed", "tokens", "last"] as const;
const PATH = "/superadmin/monitoring/ai-reports";
const TARGET = "list_super_ai_reports";

export const metadata: Metadata = { title: "AI reports" };
export const dynamic = "force-dynamic";

// D-180 (owner): AI usage for the Super Admin (moved from AI settings):
// by person and provider over 30 days, failed answers with their technical
// reason, and security and setting events. Super Admin only (layout).
export default async function AiReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // D-244 (audit SEC-02): every page checks its own area. The layout's
  // check alone isn't enough: a client-navigation request (RSC) renders the
  // page without waiting for the layout.
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const [usage, allPeople, failures, events, priceIn, priceOut] = await Promise.all([usageByProvider(30), usageByPerson(30, 100), recentFailures(30), recentAiEvents(40), getSettingValue("ai.price_in_per_million"), getSettingValue("ai.price_out_per_million")]);
  // An estimate only, from the prices entered in AI settings; the provider's bill is the real figure.
  const cost = (inTokens: number, outTokens: number) =>
    priceIn && priceOut ? `≈ ₹${((inTokens / 1e6) * Number(priceIn) + (outTokens / 1e6) * Number(priceOut)).toFixed(2)} (estimate)` : null;
  const sort = parseColumnSort(query, PEOPLE_COLUMNS);
  const value: Record<(typeof PEOPLE_COLUMNS)[number], (row: (typeof allPeople)[number]) => unknown> = {
    person: (row) => row.name,
    questions: (row) => row.questions,
    failed: (row) => row.failures,
    tokens: (row) => row.inputTokens + row.outputTokens,
    last: (row) => row.lastAt,
  };
  const people = sort.sortBy ? sortRows(allPeople, value[sort.sortBy], sort.dir) : allPeople;
  const head = sortHeads(PATH, query, sort);
  return (
    <>
      <PageHeader title="AI reports" description="AI usage over the last 30 days, failed answers and security events." />
      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="card" aria-labelledby="ai-people">
            <h2 id="ai-people" className="border-b border-line px-5 py-4 font-semibold">
              Usage by person, last 30 days
            </h2>
            {people.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No questions yet" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table" data-testid="ai-usage-people">
                  <thead>
                    <tr>
                      {head("Person", "person")}
                      {head("Questions", "questions")}
                      {head("Failed", "failed")}
                      {head("Tokens in / out", "tokens")}
                      {head("Last", "last")}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((row) => (
                      <tr key={row.userId}>
                        <td>{row.name}</td>
                        <td>{row.questions}</td>
                        <td>{row.failures}</td>
                        <td className="text-label">
                          {row.inputTokens.toLocaleString("en-IN")} / {row.outputTokens.toLocaleString("en-IN")} {cost(row.inputTokens, row.outputTokens) ?? ""}
                        </td>
                        <td className="text-label text-ink-muted">{row.lastAt ? formatIndiaTime(row.lastAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="ai-failures">
            <h2 id="ai-failures" className="border-b border-line px-5 py-4 font-semibold">
              Recent failed answers
            </h2>
            {failures.length === 0 ? (
              <p className="px-5 py-4 text-label text-ink-muted">None.</p>
            ) : (
              <ul className="divide-y divide-line text-label" data-testid="ai-failures">
                {failures.map((row, index) => (
                  <li key={index} className="px-5 py-2">
                    <p>{row.error}</p>
                    <p className="text-caption text-ink-muted">
                      {row.name} · {formatIndiaTime(row.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="space-y-6">
          <section className="card" aria-labelledby="ai-usage">
            <h2 id="ai-usage" className="border-b border-line px-5 py-4 font-semibold">
              Usage, last 30 days
            </h2>
            {usage.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No questions yet" />
              </div>
            ) : (
              <ul className="divide-y divide-line text-label" data-testid="ai-usage">
                {usage.map((row) => (
                  <li key={row.provider} className="px-5 py-3">
                    <p className="font-medium">{PROVIDER_LABEL[row.provider as keyof typeof PROVIDER_LABEL] ?? row.provider}</p>
                    <p className="text-ink-muted">
                      {row.answers} answers · {row.failures} failed · {row.people} people · {row.inputTokens.toLocaleString("en-IN")} in / {row.outputTokens.toLocaleString("en-IN")} out tokens {cost(row.inputTokens, row.outputTokens) ?? ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card" aria-labelledby="ai-events">
            <h2 id="ai-events" className="border-b border-line px-5 py-4 font-semibold">
              Security and setting events
            </h2>
            {events.length === 0 ? (
              <p className="px-5 py-4 text-label text-ink-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-line text-label" data-testid="ai-events">
                {events.map((row, index) => (
                  <li key={index} className="px-5 py-2">
                    <p>
                      {row.action.replace(/_/g, " ").toLowerCase()} {row.result === "FAILURE" ? "(failed)" : ""}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {row.actor ?? "System"} · {formatIndiaTime(row.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
