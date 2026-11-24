import type { Metadata } from "next";
import { Briefcase, LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { ListPage } from "@/features/ui/ListPage";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { Badge, EmptyState, NoResults } from "@/features/ui/Display";
import { ProjectDot } from "@/features/work/client";
import { PortfolioCardMenu, PortfolioCommandButton, PortfolioStar } from "@/features/work/portfolios/PortfolioParts";
import { listDeletedPortfolios, listVisiblePortfolios } from "@/lib/db/repositories/portfolios.repository";
import { PRIVACY_LABEL, STATUS_KIND_LABEL, STATUS_KIND_TONE } from "@/server/work/access";
import { portfolioPage } from "@/server/work/page-context";
import { purgeActive } from "@/server/work/purge-status";
import { purgeText } from "@/server/work/pm-rules";

export const metadata: Metadata = { title: "Portfolios" };
export const dynamic = "force-dynamic";

// v1.69.0 (D-382, spec PORTFOLIOS §3.1): the portfolios the person is in,
// every one they can see, archived and deleted ones; Create portfolio.
// v1.73.0 (D-396, spec PORTFOLIOS §3.1 / S-19): the portfolios show as cards
// (a "New portfolio" tile first; each card: identity tile, name, star, ⋯
// options, the number of items and the status), or as a list with "View as list"
// (kept in the address, ?layout=list).
export default async function PortfoliosPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; layout?: string }> }) {
  const { viewer } = await portfolioPage();
  const params = await searchParams;
  const show = params.show === "all" || params.show === "archived" || params.show === "deleted" ? params.show : "mine";
  const q = (params.q ?? "").trim().slice(0, 100);
  const asList = params.layout === "list";
  const layoutHref = (list: boolean) => {
    const query = new URLSearchParams();
    if (show !== "mine") query.set("show", show);
    if (q) query.set("q", q);
    if (list) query.set("layout", "list");
    const text = query.toString();
    return `/users/work/portfolios${text ? `?${text}` : ""}`;
  };
  const [items, deleted] = await Promise.all([
    show === "deleted" ? Promise.resolve([]) : listVisiblePortfolios(viewer, { onlyMine: show === "mine", archived: show === "archived", q }),
    show === "deleted" ? listDeletedPortfolios(viewer) : Promise.resolve([]),
  ]);
  const purging = show === "deleted" ? await purgeActive() : false;
  const tab = (key: string, label: string) => (
    <Link key={key} href={key === "mine" ? `/users/work/portfolios${asList ? "?layout=list" : ""}` : `/users/work/portfolios?show=${key}${asList ? "&layout=list" : ""}`} aria-current={show === key ? "page" : undefined} className={`rounded-full px-3 py-1 text-label ${show === key ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
  return (
    // v1.89.0 (D-423, UIQA-CON-01 / CON-07): the shared list page: PageHeader with "New portfolio",
    // the view tabs and View as list / cards leading the shared toolbar, and its Search (an icon until
    // used) instead of a page-made search box. Same addresses (?show, ?q, ?layout).
    <ListPage
      title="Portfolios"
      description="Portfolios group projects (and other portfolios) so you can follow their status, task progress and dates in one place. You only ever see the projects you already have access to."
      action={
        <Link href="/users/work/portfolios/new" className="btn-primary btn-compact inline-flex items-center gap-1" data-testid="create-portfolio">
          <Plus aria-hidden="true" className="h-4 w-4" /> New portfolio
        </Link>
      }
      toolbar={
        <ListToolbar
          id="portfolio-list-toolbar"
          path="/users/work/portfolios"
          label="Find a portfolio"
          keep={{ show: show !== "mine" ? show : undefined, layout: asList ? "list" : undefined }}
          search={show !== "deleted" ? { name: "q", value: q, placeholder: "Find a portfolio…" } : undefined}
          filterCount={0}
          clearHref={null}
          lead={
            <>
              <nav aria-label="Portfolio views" className="flex flex-wrap items-center gap-2">
                {tab("mine", "My portfolios")}
                {tab("all", "All I can see")}
                {tab("archived", "Archived")}
                {tab("deleted", "Deleted")}
              </nav>
              {show !== "deleted" && (
                <Link href={layoutHref(!asList)} className="btn-secondary btn-compact inline-flex items-center gap-1" data-testid="portfolio-layout">
                  {asList ? <LayoutGrid aria-hidden="true" className="h-4 w-4" /> : <List aria-hidden="true" className="h-4 w-4" />} {asList ? "View as cards" : "View as list"}
                </Link>
              )}
            </>
          }
        />
      }
    >
      <section aria-label="Portfolio list" className="space-y-3">
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
              body="Use New portfolio to group the projects you follow. You'll be its owner and can add people."
              action={
                <Link href="/users/work/portfolios/new" className="btn-primary btn-compact">
                  New portfolio
                </Link>
              }
            />
          )
        ) : !asList ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="portfolio-list" data-layout="cards" aria-label="Portfolios">
            <li>
              <Link href="/users/work/portfolios/new" className="card-link flex h-full min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong px-4 py-5 text-label text-ink-muted hover:text-ink" data-testid="new-portfolio-tile">
                <Plus aria-hidden="true" className="h-6 w-6" /> New portfolio
              </Link>
            </li>
            {items.map((item) => (
              <li key={item.id} className="card flex min-h-[8.5rem] flex-col gap-2 px-4 py-3" data-testid="portfolio-card">
                <div className="flex items-center gap-1">
                  <span aria-hidden="true" className="relative flex h-8 w-8 shrink-0 items-center justify-center text-on-solid">
                    <ProjectDot color={item.color} className="absolute inset-0 h-8 w-8 rounded-md" />
                    <Briefcase className="relative h-4 w-4" />
                  </span>
                  <span className="ml-auto" />
                  <PortfolioStar portfolioId={item.id} starred={item.starred} name={item.name} />
                  <PortfolioCardMenu portfolioId={item.id} name={item.name} starred={item.starred} canJoin={!item.isMember && !viewer.isAdmin} />
                </div>
                <Link href={`/users/work/portfolios/${item.id}`} className="line-clamp-2 font-medium text-ink hover:underline">
                  {item.name}
                </Link>
                <p className="mt-auto flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                  {item.items} {item.items === 1 ? "item" : "items"} · {PRIVACY_LABEL[item.privacy]}
                  {item.currentStatus && <Badge tone={STATUS_KIND_TONE[item.currentStatus]}>{STATUS_KIND_LABEL[item.currentStatus]}</Badge>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="card divide-y divide-line" data-testid="portfolio-list" data-layout="list">
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
                <PortfolioCardMenu portfolioId={item.id} name={item.name} starred={item.starred} canJoin={!item.isMember && !viewer.isAdmin} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </ListPage>
  );
}
