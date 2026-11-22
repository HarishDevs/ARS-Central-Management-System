import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { NoResults, Pagination } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { TaskPriorityPill } from "@/features/ui/ChoicePill";
import { MeetingSections, MeetingStatusBadge, PointsBadge, whenText } from "@/features/meetings/MeetingParts";
import { listMeetings, listMeetingTypes, type MeetingListFilter } from "@/lib/db/repositories/meetings.repository";
import { scopeFor } from "@/server/meetings/service";
import { MEETING_STATUSES, MODE_LABEL, PRIORITY_LABEL as MEETING_PRIORITY_LABEL, STATUS_LABEL } from "@/server/meetings/rules";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortTh } from "@/features/ui/SortTh";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { nextDir, parseColumnSort } from "@/server/lists/sorting";
import { MEETING_SORT_COLUMNS, MEETING_SORT_LABEL } from "@/server/meetings/list-sort";
import { departmentBucket, groupRows, pickGroup } from "@/server/lists/group-rows";
import type { MeetingListRow } from "@/lib/db/repositories/meetings.repository";

export const metadata: Metadata = { title: "Meetings" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "mine", label: "I run" },
  { key: "approve", label: "To approve" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const PAGE_SIZE = 25;
// v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
const MEETING_GROUPS = ["dept", "type", "status", "owner", "coordinator", "priority", "mode"] as const;
type MeetingGroup = (typeof MEETING_GROUPS)[number];
const MEETING_GROUP_LABEL: Record<MeetingGroup, string> = { dept: "Department", type: "Type", status: "Status", owner: "Meeting Owner", coordinator: "Coordinator", priority: "Priority", mode: "Mode" };
const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4 };
function meetingBucket(row: MeetingListRow, group: MeetingGroup): [string, number] {
  switch (group) {
    case "dept":
      return departmentBucket(row.departmentName);
    case "type":
      return [row.typeName, 0];
    case "status":
      return [STATUS_LABEL[row.status], MEETING_STATUSES.indexOf(row.status)];
    case "owner":
      return [row.ownerName, 0];
    case "coordinator":
      return [row.coordinatorName, 0];
    case "priority":
      return [MEETING_PRIORITY_LABEL[row.priority] ?? row.priority, PRIORITY_ORDER[row.priority] ?? 9];
    default:
      return [MODE_LABEL[row.mode], 0];
  }
}

// v1.51.0 (D-300): the meetings the person is on (and, for HODs, their
// departments' meetings; ED, MD and IT see all).
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): an empty address opens the person's default saved view (private).
  await applyDefaultListView(user.id, "list_meetings", "/users/meetings", query);
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const tab: Tab = (TABS.find((item) => item.key === one("tab"))?.key ?? "upcoming") as Tab;
  const q = one("q").trim().slice(0, 100);
  const typeId = /^\d{1,10}$/.test(one("type")) ? Number(one("type")) : null;
  const status = (MEETING_STATUSES as readonly string[]).includes(one("status")) ? one("status") : null;
  const page = /^\d{1,4}$/.test(one("page")) ? Math.max(1, Number(one("page"))) : 1;
  const group = pickGroup(one("group"), MEETING_GROUPS);
  // v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in all columns").
  const sort = parseColumnSort(query, MEETING_SORT_COLUMNS);
  const scope = await scopeFor(user);
  const base: Omit<MeetingListFilter, "tab"> = { userId: user.id, q, typeId, departmentId: null, status, from: null, to: null, page, pageSize: PAGE_SIZE, sortBy: sort.sortBy, dir: sort.dir };
  const [list, types, approveCount] = await Promise.all([
    listMeetings(scope, { ...base, tab }),
    listMeetingTypes(true),
    listMeetings(scope, { ...base, tab: "approve", q: "", typeId: null, status: null, page: 1, pageSize: 1 }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const href = (changes: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const merged = { tab, q, type: typeId, status, group, sortBy: sort.sortBy, dir: sort.sortBy ? sort.dir : null, page, ...changes };
    for (const [key, value] of Object.entries(merged))
      if (value !== null && value !== "" && !(key === "page" && value === 1) && !(key === "tab" && value === "upcoming")) params.set(key, String(value));
    const text = params.toString();
    return `/users/meetings${text ? `?${text}` : ""}`;
  };
  const filtered = Boolean(q || typeId || status);
  return (
    <>
      <PageHeader icon={CalendarClock} title="Meetings" description="Schedule meetings, approve points and MOM, and follow up the action items.">
        <Link href="/users/meetings/new" className="btn-primary btn-compact">
          Schedule a meeting
        </Link>
      </PageHeader>
      <MeetingSections current="/users/meetings" />
      <nav aria-label="Meeting lists" className="mb-3 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={href({ tab: item.key, page: 1 })}
            aria-current={tab === item.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-label ${tab === item.key ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line text-ink-muted hover:text-ink"}`}
          >
            {item.label}
            {item.key === "approve" && approveCount.total > 0 ? ` (${approveCount.total})` : ""}
          </Link>
        ))}
      </nav>
      {/* v1.51.1 (owner): toolbar filters only (Filter, Search icon). */}
      <ListToolbar
        id="meeting-filters"
        path="/users/meetings"
        label="Filter meetings"
        keep={{ tab: tab !== "upcoming" ? tab : undefined, group: group ?? undefined, sortBy: sort.sortBy ?? undefined, dir: sort.sortBy ? sort.dir : undefined }}
        search={{ name: "q", value: q, placeholder: "Title or meeting number" }}
        filterCount={[typeId, status].filter(Boolean).length}
        clearHref={filtered ? href({ q: "", type: null, status: null, page: 1 }) : null}
        group={{
          label: group ? MEETING_GROUP_LABEL[group] : null,
          clearHref: href({ group: null, page: 1 }),
          choices: MEETING_GROUPS.map((value) => ({ label: MEETING_GROUP_LABEL[value], href: href({ group: value, page: 1 }), active: group === value })),
        }}
        filters={
          <>
            <div>
              <label htmlFor="mf-type" className="field-label">
                Type
              </label>
              <select id="mf-type" name="type" defaultValue={typeId ?? ""} className="field-input h-10">
                <option value="">Any type</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mf-status" className="field-label">
                Status
              </label>
              <select id="mf-status" name="status" defaultValue={status ?? ""} className="field-input h-10">
                <option value="">Any status</option>
                {MEETING_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
          </>
        }
      />
      {/* v1.58.0 (D-354, owner): save tab, filters, search, group and sort as a named view (only mine). */}
      <ListViews userId={user.id} target="list_meetings" path="/users/meetings" query={{ ...Object.fromEntries(new URLSearchParams(href({ page: 1 }).split("?")[1] ?? "").entries()), tab }} />
      {list.rows.length === 0 ? (
        filtered ? (
          <NoResults query={q || null} resetHref={href({ q: "", type: null, status: null, page: 1 })} what="meetings" />
        ) : (
          <EmptyState
            title={tab === "approve" ? "Nothing to approve" : "No meetings here yet"}
            body={tab === "approve" ? "Meeting points and MOM sent to you as Meeting Owner show here." : "Meetings you are on show here. Schedule one to start."}
            // v1.72.1 (D-395, QA F-15): the main action inside the empty state too.
            action={
              tab === "approve" ? undefined : (
                <Link href="/users/meetings/new" className="btn-secondary btn-compact">
                  Schedule a new meeting
                </Link>
              )
            }
          />
        )
      ) : (
        // v1.56.0 (D-333, owner: "i want the meeting to be like table format like the tickets").
        // v1.58.0 (D-354, owner): groups start folded; Expand all / Collapse all.
        <FoldScope enabled={Boolean(group)}>
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="meeting-list">
            <caption className="sr-only">Meetings</caption>
            <thead>
              <tr>
                {/* v1.58.0 (D-354): every column sorts both ways (in SQL; the list is paged). */}
                {MEETING_SORT_COLUMNS.map((column) => (
                  <SortTh key={column} label={MEETING_SORT_LABEL[column]} column={column} sortBy={sort.sortBy} dir={sort.dir} href={href({ sortBy: column, dir: nextDir(sort, column), page: 1 })} />
                ))}
              </tr>
            </thead>
            {(group ? groupRows(list.rows, (row) => meetingBucket(row, group)) : [{ key: "all", label: "", items: list.rows }]).map((section) => {
              const rows = section.items.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap font-mono text-label">
                    <Link href={`/users/meetings/${row.id}`} className="link">
                      {row.meetingNo}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/users/meetings/${row.id}`} className="link font-medium">
                      {row.title}
                    </Link>
                    <p className="text-caption text-ink-muted">
                      {row.typeName}
                      {row.openActions > 0 ? ` · ${row.openActions} open action(s)` : ""}
                    </p>
                  </td>
                  <td className="whitespace-nowrap text-label">{whenText(row.scheduledStart, row.scheduledEnd)}</td>
                  <td className="text-label">
                    {MODE_LABEL[row.mode]}
                    {row.venue && <span className="block text-caption text-ink-muted">{row.venue}</span>}
                    {row.link && (
                      <a href={row.link} target="_blank" rel="noopener noreferrer" className="link block text-caption" title={row.link} data-testid="meeting-join-link">
                        Join
                      </a>
                    )}
                  </td>
                  <td className="text-label">{row.ownerName}</td>
                  <td className="text-label">{row.coordinatorName}</td>
                  <td className="text-label">{row.departmentName ?? "—"}</td>
                  <td>
                    <TaskPriorityPill priority={row.priority} showNormal />
                  </td>
                  <td className="text-label tabular-nums">{row.participants}</td>
                  <td>
                    <span className="flex flex-col items-start gap-1">
                      <MeetingStatusBadge status={row.status} />
                      {(row.status === "SCHEDULED" || row.status === "IN_PROGRESS") && <PointsBadge status={row.pointsStatus} />}
                    </span>
                  </td>
                </tr>
              ));
              return section.label ? (
                <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={10}>
                  {rows}
                </FoldTbody>
              ) : (
                <tbody key={section.key}>{rows}</tbody>
              );
            })}
          </table>
        </div>
        </FoldScope>
      )}
      {pages > 1 && (
        <div className="mt-4">
          <Pagination page={page} pages={pages} hrefFor={(next) => href({ page: next })} />
        </div>
      )}
    </>
  );
}
