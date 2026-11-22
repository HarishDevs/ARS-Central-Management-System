import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge, EmptyState, NoResults } from "@/features/ui/Display";
import { ProjectDot } from "@/features/work/client";
import { PortfolioCommandButton, PortfolioStar } from "@/features/work/portfolios/PortfolioParts";
import { listDeletedPortfolios, listVisiblePortfolios } from "@/lib/db/repositories/portfolios.repository";
import { PRIVACY_LABEL, STATUS_KIND_LABEL, STATUS_KIND_TONE } from "@/server/work/access";
import { portfolioPage } from "@/server/work/page-context";
import { purgeActive } from "@/server/work/purge-status";
import { purgeText } from "@/server/work/pm-rules";

export const metadata: Metadata = { title: "Portfolios" };
export const dynamic = "force-dynamic";

// v1.69.0 (D-382, spec PORTFOLIOS §3.1): the portfolios the person is in,
// every one they can see, archived and deleted ones; Create portfolio.
export default async function PortfoliosPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const { viewer } = await portfolioPage();
  const params = await searchParams;
  const show = params.show === "all" || params.show === "archived" || params.show === "deleted" ? params.show : "mine";
  const q = (params.q ?? "").trim().slice(0, 100);
  const [items, deleted] = await Promise.all([
    show === "deleted" ? Promise.resolve([]) : listVisiblePortfolios(viewer, { onlyMine: show === "mine", archived: show === "archived", q }),
    show === "deleted" ? listDeletedPortfolios(viewer) : Promise.resolve([]),
  ]);
  const purging = show === "deleted" ? await purgeActive() : false;
  const tab = (key: string, label: string) => (
    <Link key={key} href={key === "mine" ? "/users/work/portfolios" : `/users/work/portfolios?show=${key}`} aria-current={show === key ? "page" : undefined} className={`rounded-full px-3 py-1 text-label ${show === key ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Portfolios" icon={Briefcase} description="Portfolios group projects (and other portfolios) so you can follow their status, task progress and dates in one place. You only ever see the projects you already have access to.">
        <Link href="/users/work/portfolios/new" className="btn-primary btn-compact inline-flex items-center gap-1" data-testid="create-portfolio">
          + Create portfolio
        </Link>
      </PageHeader>
      <section aria-label="Portfolio list" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {tab("mine", "My portfolios")}
          {tab("all", "All I can see")}
          {tab("archived", "Archived")}
          {tab("deleted", "Deleted")}
          {show !== "deleted" && (
            <form className="ml-auto" action="/users/work/portfolios">
              {show !== "mine" && <input type="hidden" name="show" value={show} />}
              <label htmlFor="portfolio-q" className="sr-only">
                Find a portfolio
              </label>
              <input id="portfolio-q" name="q" defaultValue={q} placeholder="Find a portfolio…" className="field-input h-8 w-56 max-w-full text-label" />
            </form>
          )}
        </div>
        {show === "deleted" ? (
          deleted.length === 0 ? (
            <EmptyState title="No deleted portfolios" body={`Portfolios you delete stay here for 30 days${purging ? ", then they are removed for good" : ""}. Their projects are never touched.`} />
          ) : (
            <ul className="card divide-y divide-line" data-testid="deleted-portfolios">
              {deleted.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex-1">{item.name}</span>
                  <span className="text-caption text-ink-muted" data-testid="purge-note">
                    {purgeText(item.deletedAt, new Date(), purging)}
                  </span>
                  <PortfolioCommandButton portfolioId={item.id} command="RESTORE" label="Restore" />
                </li>
              ))}
            </ul>
          )
        ) : items.length === 0 ? (
          q ? (
            <NoResults what="portfolios" query={q} clearSearchHref={show === "mine" ? "/users/work/portfolios" : `/users/work/portfolios?show=${show}`} />
          ) : (
            <EmptyState
              title={show === "mine" ? "You're not in any portfolio yet" : "No portfolios here"}
              body="Use Create portfolio to group the projects you follow. You'll be its owner and can add people."
              action={
                <Link href="/users/work/portfolios/new" className="btn-primary btn-compact">
                  Create portfolio
                </Link>
              }
            />
          )
        ) : (
          <ul className="card divide-y divide-line" data-testid="portfolio-list">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <PortfolioStar portfolioId={item.id} starred={item.starred} name={item.name} />
                <ProjectDot color={item.color} className="h-3 w-3" />
                <div className="min-w-0 flex-1">
                  <Link href={`/users/work/portfolios/${item.id}`} className="font-medium text-ink hover:underline">
                    {item.name}
                  </Link>
                  <p className="text-caption text-ink-muted">
                    {PRIVACY_LABEL[item.privacy]} · Owner {item.ownerName} · {item.items} {item.items === 1 ? "item" : "items"}
                  </p>
                </div>
                {item.currentStatus && <Badge tone={STATUS_KIND_TONE[item.currentStatus]}>{STATUS_KIND_LABEL[item.currentStatus]}</Badge>}
                {!item.isMember && !viewer.isAdmin && <PortfolioCommandButton portfolioId={item.id} command="JOIN" label="Join" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
