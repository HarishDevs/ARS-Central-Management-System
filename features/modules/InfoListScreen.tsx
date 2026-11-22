import { requireFeature } from "@/server/settings/feature-guard";
import { TaskPriorityPill } from "@/features/ui/ChoicePill";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { Badge, type Tone } from "@/features/ui/Display";
import { countInfo, listInfo } from "@/lib/db/repositories/info.repository";
import { listModuleTypes, listTypeVersions } from "@/lib/db/repositories/module-types.repository";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { INFO_TAB_LABEL, infoListSql, infoQuery, parseInfoFilters, tabsFor, type InfoBase } from "@/server/modules/info-lists";
import { infoState, INFO_STATE_LABEL, type InfoState } from "@/server/modules/info-rules";
import { indiaDateTimeText, INFO_PRIORITIES, INFO_PRIORITY_LABEL, type InfoPriority } from "@/server/modules/settings";
import { PAGE_SIZES } from "@/server/modules/task-lists";
import { indiaToday } from "@/server/modules/information";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortTh } from "@/features/ui/SortTh";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { nextDir } from "@/server/lists/sorting";
import { departmentBucket, groupRows } from "@/server/lists/group-rows";
import { INFO_LIST_GROUPS, type InfoListGroup, type InfoSortColumn } from "@/server/modules/info-lists";
import type { InfoListItem } from "@/lib/db/repositories/info.repository";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { personLabel } from "@/lib/people/label";
import { NoResults } from "@/features/ui/Display";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { MobileInfoList, type MobileInfoRow } from "@/features/mobile/MobileInfoList";

// D-226: the sorts offered in the toolbar.
const INFO_SORTS = ["newest", "oldest", "expiry"] as const;
const INFO_SORT_LABEL: Record<(typeof INFO_SORTS)[number], string> = { newest: "Newest", oldest: "Oldest", expiry: "Expiring first" };

// v1.9.0 (D-143): Information inbox and Sent by me.
const TITLE: Record<InfoBase, string> = { INBOX: "Information inbox", SENT: "Information sent by me" };
const PATH: Record<InfoBase, string> = { INBOX: "/users/information", SENT: "/users/information/sent" };
export const INFO_STATE_TONE: Record<InfoState, Tone> = { DRAFT: "warning", PUBLISHED: "success", WITHDRAWN: "neutral", ARCHIVED: "neutral", EXPIRED: "neutral" };
// v1.58.0 (D-354, owner): saved views (private) per list, kept under these targets.
const VIEW_TARGET: Record<InfoBase, string> = { INBOX: "list_info_inbox", SENT: "list_info_sent" };
// v1.58.0 (D-354): the column titles (every column sorts both ways).
const SORT_LABEL: Record<InfoSortColumn, string> = { subject: "Subject", type: "Type", from: "From", recipients: "Recipients", importance: "Importance", you: "You", read: "Read / acknowledged", published: "Published", status: "Status" };
const COLUMNS: Record<InfoBase, InfoSortColumn[]> = { INBOX: ["subject", "type", "from", "importance", "you", "published"], SENT: ["subject", "type", "recipients", "importance", "read", "status"] };
export const INFO_PRIORITY_TONE: Record<InfoPriority, Tone> = { NORMAL: "neutral", ELEVATED: "info", IMPORTANT: "warning", HIGH: "warning", URGENT: "danger" };

// v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
const INFO_GROUP_LABEL: Record<InfoListGroup, string> = { dept: "Department (sender's)", sender: "Sent by", type: "Type", priority: "Importance", state: "Status" };
const INFO_PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4 };
function infoBucket(item: InfoListItem, today: string, group: InfoListGroup | null | undefined): [string, number] {
  switch (group) {
    case "dept":
      return departmentBucket(item.senderDepartment);
    case "sender":
      return [item.createdByName, 0];
    case "type":
      return [item.typeName, 0];
    case "priority":
      return [INFO_PRIORITY_LABEL[item.priority] ?? item.priority, INFO_PRIORITY_ORDER[item.priority] ?? 9];
    default:
      return [INFO_STATE_LABEL[infoState(item, today)], 0];
  }
}
export async function InfoListScreen({ base, query }: { base: InfoBase; query: Record<string, string | string[] | undefined> }) {
  const { user } = await requireArea("users");
  // v1.72.1 (D-395): a switched-off feature says so (not a 404).
  await requireFeature("information", user);
  // v1.58.0 (D-354): an empty address opens the person's default saved view.
  await applyDefaultListView(user.id, VIEW_TARGET[base], PATH[base], query);
  const filters = parseInfoFilters(query, base);
  const today = indiaToday();
  const [types, people] = await Promise.all([listModuleTypes("INFO"), listActiveUserOptions()]);
  const versions = (await Promise.all(types.map((type) => listTypeVersions(type.id)))).flat();
  const searchable = [...new Set(versions.flatMap((version) => version.form.filter((field) => field.searchable).map((field) => field.key)))];
  const sql = infoListSql(filters, base, user.id, today, searchable);
  const [list, counts] = await Promise.all([
    listInfo(sql.where, sql.params, sql.orderBy, filters.size, (filters.page - 1) * filters.size, user.id),
    Promise.all(
      tabsFor(base).map(async (tab) => {
        const counted = infoListSql(filters, base, user.id, today, searchable, tab);
        return [tab, await countInfo(counted.where, counted.params, user.id)] as const;
      }),
    ),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / filters.size));
  const path = PATH[base];
  // v1.46.0 (V143-16): phones get the Asana-pattern list (features/mobile/MobileInfoList).
  if (await isMobileLayout()) {
    const rows: MobileInfoRow[] = list.rows.map((item) => {
      const state = infoState(item, today);
      const chip: MobileInfoRow["chip"] =
        base === "INBOX"
          ? state !== "PUBLISHED"
            ? { text: INFO_STATE_LABEL[state], tone: "neutral" }
            : item.ackRequired
              ? item.acknowledgedAt
                ? { text: "Acknowledged", tone: "success" }
                : { text: "To acknowledge", tone: "warning" }
              : { text: item.readAt ? "Read" : "Unread", tone: "neutral" }
          : { text: INFO_STATE_LABEL[state], tone: state === "DRAFT" ? "warning" : state === "PUBLISHED" ? "success" : "neutral" };
      return {
        id: item.id,
        title: item.title,
        infoNo: item.infoNo,
        detail: [item.typeName, base === "INBOX" ? item.createdByName : item.status === "DRAFT" ? "Draft" : item.recipients].filter(Boolean).join(" · "),
        priority: item.priority,
        unread: base === "INBOX" && !item.readAt,
        chip,
      };
    });
    const keep: Record<string, string> = { tab: filters.tab };
    if (filters.sort !== "newest") keep.sort = filters.sort;
    // v1.58.0 (D-354): a column sort chosen on a larger screen is kept by the search.
    if (filters.sortBy) {
      keep.sortBy = filters.sortBy;
      keep.dir = filters.dir ?? "asc";
    }
    return (
      <MobileInfoList
        title={base === "INBOX" ? "Information" : "Sent by me"}
        sent={base === "SENT"}
        rows={rows}
        views={counts.map(([tab, count]) => ({ href: `${path}${infoQuery(filters, base, { tab, page: 1 })}`, label: INFO_TAB_LABEL[tab], current: filters.tab === tab, count }))}
        sorts={INFO_SORTS.map((sort) => ({ href: `${path}${infoQuery({ ...filters, sort }, base, { page: 1, sortBy: null })}`, label: INFO_SORT_LABEL[sort], current: !filters.sortBy && filters.sort === sort }))}
        search={{ action: path, value: filters.q, keep }}
        canNew
        pages={
          pages > 1
            ? {
                prev: filters.page > 1 ? `${path}${infoQuery(filters, base, { page: filters.page - 1 })}` : null,
                next: filters.page < pages ? `${path}${infoQuery(filters, base, { page: filters.page + 1 })}` : null,
                text: `Page ${filters.page} of ${pages}`,
              }
            : null
        }
      />
    );
  }
  return (
    <>
      <PageHeader
        icon={Megaphone}
        title={TITLE[base]}
        description={
          base === "INBOX"
            ? "Information sent to you. Opening one marks it read; acknowledging is a separate button."
            : "Information you wrote: drafts, published, withdrawn and archived, with who read and acknowledged it."
        }
      >
        <Link href="/users/information/new" className="btn-primary btn-compact">
          New information
        </Link>
      </PageHeader>
      <nav aria-label="Quick filters" className="mb-3 flex flex-wrap gap-x-1 border-b border-line">
        {counts.map(([tab, count]) => (
          <Link
            key={tab}
            href={`${path}${infoQuery(filters, base, { tab })}`}
            aria-current={filters.tab === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-label ${filters.tab === tab ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {INFO_TAB_LABEL[tab]} ({count})
          </Link>
        ))}
      </nav>
      <ListToolbar
        id="info-filters"
        path={path}
        label="Filter information"
        keep={{
          tab: filters.tab,
          sort: filters.sort !== "newest" ? filters.sort : undefined,
          size: filters.size !== 25 ? String(filters.size) : undefined,
          group: filters.group ?? undefined,
          // v1.58.0 (D-354): searching and filtering keep the column sort.
          sortBy: filters.sortBy ?? undefined,
          dir: filters.sortBy ? (filters.dir ?? "asc") : undefined,
        }}
        search={{ name: "q", value: filters.q, placeholder: "Number, subject or message" }}
        filterCount={[filters.typeId, filters.priority, filters.senderId, filters.from || filters.to].filter(Boolean).length}
        clearHref={filters.q || filters.typeId || filters.priority || filters.senderId || filters.from || filters.to ? `${path}?tab=${filters.tab}` : null}
        filters={
          <>
            <label className="text-label">
              Type
              <select name="type" defaultValue={filters.typeId ?? ""} className="field-input h-10">
                <option value="">Any</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-label">
              Importance
              <select name="priority" defaultValue={filters.priority ?? ""} className="field-input h-10">
                <option value="">Any</option>
                {INFO_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {INFO_PRIORITY_LABEL[priority]}
                  </option>
                ))}
              </select>
            </label>
            {base === "INBOX" && (
              <div className="text-label">
                <label htmlFor="info-sender">From</label>
                <PersonSelect
                  id="info-sender"
                  name="sender"
                  options={people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
                  defaultValue={filters.senderId ?? null}
                  emptyLabel="Anyone"
                  compact
                />
              </div>
            )}
            <label className="text-label">
              {base === "INBOX" ? "Published from" : "Created from"}
              <input type="date" name="from" defaultValue={filters.from ?? ""} className="field-input h-10" />
            </label>
            <label className="text-label">
              To
              <input type="date" name="to" defaultValue={filters.to ?? ""} className="field-input h-10" />
            </label>
          </>
        }
        sort={{
          // v1.58.0 (D-354): a column sort shows here; a preset clears it.
          label: filters.sortBy ? `${SORT_LABEL[filters.sortBy]} ${filters.dir === "desc" ? "↓" : "↑"}` : INFO_SORT_LABEL[filters.sort],
          changed: filters.sort !== "newest" || Boolean(filters.sortBy),
          choices: INFO_SORTS.map((sort) => ({ label: INFO_SORT_LABEL[sort], href: `${path}${infoQuery(filters, base, { sort, sortBy: null })}`, active: !filters.sortBy && filters.sort === sort })),
        }}
        group={{
          label: filters.group ? INFO_GROUP_LABEL[filters.group] : null,
          clearHref: `${path}${infoQuery(filters, base, { group: null })}`,
          choices: INFO_LIST_GROUPS.map((group) => ({ label: INFO_GROUP_LABEL[group], href: `${path}${infoQuery(filters, base, { group })}`, active: filters.group === group })),
        }}
        sizes={PAGE_SIZES.map((size) => ({ label: `${size} per page`, href: `${path}${infoQuery(filters, base, { size })}`, active: filters.size === size }))}
      />
      {/* v1.58.0 (D-354, owner): save tab, filters, search, group and sort as a named view (only mine). */}
      <ListViews userId={user.id} target={VIEW_TARGET[base]} path={path} query={Object.fromEntries(new URLSearchParams(infoQuery(filters, base)).entries())} />
      {list.rows.length === 0 ? (
        filters.q || filters.typeId || filters.priority || filters.senderId || filters.from || filters.to ? (
          <NoResults what="information" query={filters.q} clearSearchHref={`${path}${infoQuery(filters, base, { q: "" })}`} resetHref={`${path}?tab=${filters.tab}`} />
        ) : (
          <EmptyState title="Nothing here" body="Nothing in this tab yet. Try another tab." />
        )
      ) : (
        // v1.58.0 (D-354, owner): groups start folded; Expand all / Collapse all.
        <FoldScope enabled={Boolean(filters.group)}>
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="info-table">
            <caption className="sr-only">{TITLE[base]}</caption>
            <thead>
              <tr>
                {/* v1.58.0 (D-354, owner): every column sorts, A→Z then Z→A. */}
                {COLUMNS[base].map((column) => (
                  <SortTh
                    key={column}
                    label={SORT_LABEL[column]}
                    column={column}
                    sortBy={filters.sortBy ?? null}
                    dir={filters.dir ?? "asc"}
                    href={`${path}${infoQuery(filters, base, { sortBy: column, dir: nextDir({ sortBy: filters.sortBy ?? null, dir: filters.dir ?? "asc" }, column) })}`}
                  />
                ))}
              </tr>
            </thead>
            {(filters.group ? groupRows(list.rows, (item: InfoListItem): [string, number] => infoBucket(item, today, filters.group)) : [{ key: "all", label: "", items: list.rows }]).map((group) => {
              const rows = group.items.map((item) => {
                const state = infoState(item, today);
                const unread = base === "INBOX" && !item.readAt;
                return (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/users/information/${item.id}`} className={`link ${unread ? "font-semibold" : ""}`}>
                        {unread && <span role="img" aria-label="Unread" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary-600 align-middle" />}
                        {item.title}
                      </Link>
                      <p className="font-mono text-caption text-ink-muted">{item.infoNo}</p>
                    </td>
                    <td className="text-label">{item.typeName}</td>
                    <td className="text-label">{base === "INBOX" ? item.createdByName : item.status === "DRAFT" ? "—" : item.recipients}</td>
                    <td>
                      <TaskPriorityPill priority={item.priority} showNormal />
                    </td>
                    <td className="text-label">
                      {base === "INBOX"
                        ? item.ackRequired
                          ? item.acknowledgedAt
                            ? "Acknowledged"
                            : "To acknowledge"
                          : item.readAt
                            ? "Read"
                            : "Unread"
                        : item.status === "DRAFT"
                          ? "—"
                          : `${item.read} / ${item.ackRequired ? item.acknowledged : "—"}`}
                    </td>
                    <td className="text-label">
                      {base === "INBOX" ? item.publishedAt ? indiaDateTimeText(item.publishedAt) : "—" : <Badge tone={INFO_STATE_TONE[state]}>{INFO_STATE_LABEL[state]}</Badge>}
                      {base === "INBOX" && state !== "PUBLISHED" && <span className="block text-caption text-ink-muted">{INFO_STATE_LABEL[state]}</span>}
                    </td>
                  </tr>
                );
              });
              // v1.57.5 (D-344): groups fold from their heading.
              return group.label ? (
                <FoldTbody key={group.key} label={group.label} count={group.items.length} colSpan={6}>
                  {rows}
                </FoldTbody>
              ) : (
                <tbody key={group.key}>{rows}</tbody>
              );
            })}
          </table>
        </div>
        </FoldScope>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-label">
          {filters.page > 1 ? (
            <Link href={`${path}${infoQuery(filters, base, { page: filters.page - 1 })}`} className="link">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {filters.page} of {pages} · {list.total} items
          </span>
          {filters.page < pages ? (
            <Link href={`${path}${infoQuery(filters, base, { page: filters.page + 1 })}`} className="link">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
