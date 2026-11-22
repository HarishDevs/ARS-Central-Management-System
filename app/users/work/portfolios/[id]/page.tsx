import type { Metadata } from "next";
import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs } from "@/features/ui/Display";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { PortfolioHeader } from "@/features/work/portfolios/PortfolioHeader";
import { PortfolioList } from "@/features/work/portfolios/PortfolioList";
import { PortfolioProgress } from "@/features/work/portfolios/PortfolioProgress";
import { PortfolioTimeline } from "@/features/work/portfolios/PortfolioTimeline";
import { PortfolioDashboard } from "@/features/work/portfolios/PortfolioDashboard";
import { PortfolioCommandButton } from "@/features/work/portfolios/PortfolioParts";
import { indiaDayOf } from "@/features/work/format";
import { PRIVACY_LABEL, PROJECT_ROLE_LABEL, STATUS_KINDS } from "@/server/work/access";
import { peopleOptions, portfolioPage } from "@/server/work/page-context";
import { loadDashboard, loadPortfolio, loadStatusUpdates, workChoices } from "@/server/work/portfolios";
import { progressOf, statusCounts } from "@/server/work/portfolio-rules";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { featureOn } from "@/server/settings/features";
import { durationOf, planningBasis } from "@/server/work/durations";
import { durationText } from "@/server/work/working-days";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "list", label: "List" },
  { key: "timeline", label: "Timeline" },
  { key: "progress", label: "Progress" },
  { key: "dashboard", label: "Dashboard" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// v1.69.0 (D-382, spec PORTFOLIOS §3.4-3.19): one portfolio. Only people
// with a role in it (members, its department or everyone, by its privacy)
// can open it; anyone else gets "not found". Rows for work the person can't
// see are masked (deny by default).
export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; status?: string; created?: string }> }) {
  const { user } = await portfolioPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const actor = { id: user.id, name: user.name, roles: user.roles, modules: user.modules };
  const view = await loadPortfolio(Number(id), actor);
  if (!view) notFound();
  const query = await searchParams;
  const tab: TabKey = TABS.some((item) => item.key === query.tab) ? (query.tab as TabKey) : (view.portfolio.defaultTab.toLowerCase() as TabKey);
  const { portfolio, can } = view;
  const base = `/users/work/portfolios/${portfolio.id}`;
  const [people, departments, choices, updates, widgets] = await Promise.all([
    can.share || can.edit ? peopleOptions() : Promise.resolve([]),
    can.manage ? listDepartments().then((items) => items.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name }))) : Promise.resolve([]),
    can.edit && tab === "list" ? workChoices(actor) : Promise.resolve({ projects: [], portfolios: [] }),
    tab === "progress" ? loadStatusUpdates(portfolio.id, actor) : Promise.resolve([]),
    tab === "dashboard" ? loadDashboard(view, actor) : Promise.resolve([]),
  ]);
  const progress = progressOf(view.totals);
  const visibleRows = view.rows.filter((row) => !row.masked);
  // v1.74.0 (D-398, "pm_planning"): each visible row's From/To working days and estimated hours (the Duration column).
  const basis = tab === "list" && (await featureOn("pm_planning", user).catch(() => false)) ? await planningBasis() : null;
  const durations = basis
    ? Object.fromEntries(
        visibleRows.flatMap((row) => {
          const span = durationOf(row.startOn, row.dueOn, basis);
          return [[row.itemId, span ? durationText(span) : null] as const];
        }),
      )
    : null;
  const initialStatus = (STATUS_KINDS as readonly string[]).includes(query.status ?? "") ? query.status : undefined;
  return (
    <>
      {/* v1.72.1 (D-395, QA F-06): a way back to the list. */}
      <Breadcrumbs items={[{ href: "/users/work/portfolios", label: "Portfolios" }, { label: portfolio.name }]} />
      <PortfolioHeader
        portfolio={{
          id: portfolio.id,
          name: portfolio.name,
          color: portfolio.color,
          status: portfolio.currentStatus,
          privacy: portfolio.privacy,
          departmentId: portfolio.departmentId,
          description: portfolio.description ?? "",
          startOn: portfolio.startOn,
          dueOn: portfolio.dueOn,
          ownerId: portfolio.ownerId,
          defaultTab: portfolio.defaultTab,
          defaultAccessRole: portfolio.defaultAccessRole,
          archived: Boolean(portfolio.archivedAt),
          rowVersion: portfolio.rowVersion,
        }}
        meta={`${PRIVACY_LABEL[portfolio.privacy]}${portfolio.departmentName ? ` · ${portfolio.departmentName}` : ""} · You: ${PROJECT_ROLE_LABEL[view.role]} · ${view.totals.projects} ${view.totals.projects === 1 ? "project" : "projects"} · ${progress.text}`}
        starred={view.starred}
        members={view.members}
        fields={view.fields}
        can={can}
        isMember={view.isMember}
        meId={user.id}
        people={people}
        departments={departments}
      />
      {(portfolio.archivedAt || (!view.isMember && !can.manage)) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {portfolio.archivedAt && <Badge tone="neutral">Archived</Badge>}
          {portfolio.archivedAt && <span className="text-label text-ink-muted">This portfolio is archived: it is hidden from the list but still works.</span>}
          {!view.isMember && !can.manage && (
            <span className="flex flex-wrap items-center gap-2 text-label text-ink-muted" data-testid="join-banner">
              Join to follow this portfolio with its people. <PortfolioCommandButton portfolioId={portfolio.id} command="JOIN" label="Join portfolio" />
            </span>
          )}
        </div>
      )}
      {query.created === "1" && (
        <p role="status" className="mb-3 rounded-md bg-success-50 px-3 py-2 text-label text-success-600">
          Portfolio created. Add work with Add work, and bring people in with Share.
        </p>
      )}
      {view.hidden > 0 && (
        <p className="mb-3 flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-label" data-testid="private-work-notice">
          <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
          This portfolio holds {view.hidden} {view.hidden === 1 ? "item" : "items"} you can&apos;t see.{tab === "dashboard" ? " Their figures are left out." : " Ask the person who added it, or the project's owner, for access."}
        </p>
      )}
      <LiveRefresh />
      <nav aria-label="Portfolio views" className="mb-3 flex flex-wrap gap-1 border-b border-line" data-testid="portfolio-tabs">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={`${base}?tab=${item.key}`}
            aria-current={tab === item.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-label ${tab === item.key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "list" && <PortfolioList portfolioId={portfolio.id} rows={view.rows} fields={view.fields} canEdit={can.edit} meId={user.id} people={people.map((person) => ({ id: person.id, label: person.label }))} choices={choices} durations={durations} />}
      {tab === "timeline" && <PortfolioTimeline rows={view.rows} today={indiaDayOf(new Date())} />}
      {tab === "progress" && (
        <PortfolioProgress
          portfolioId={portfolio.id}
          counts={statusCounts(visibleRows.map((row) => (row.masked ? null : row.status)))}
          hidden={view.hidden}
          updates={updates.map((update) => ({ ...update, createdAt: update.createdAt.toISOString() }))}
          canPost={can.edit}
          canManage={can.manage}
          meId={user.id}
          initialStatus={initialStatus}
          about={{ ownerName: portfolio.ownerName, dueOn: portfolio.dueOn, startOn: portfolio.startOn, description: portfolio.description ?? "", rowVersion: portfolio.rowVersion }}
          fresh={Boolean(updates[0] && Date.now() - updates[0].createdAt.getTime() < 14 * 86_400_000)}
        />
      )}
      {tab === "dashboard" && <PortfolioDashboard widgets={widgets} />}
    </>
  );
}
