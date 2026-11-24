import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ActionReviewForm, CloseOpenPointForm } from "@/features/meetings/MeetingForms";
import { FollowUpBadge, MeetingSections } from "@/features/meetings/MeetingParts";
import { listFollowUps, listOpenPointRegister } from "@/lib/db/repositories/meetings.repository";
import { scopeFor } from "@/server/meetings/service";
import { actionState, FOLLOW_UP_LABEL, type FollowUpState } from "@/server/meetings/rules";
import { indiaDateTimeText } from "@/server/modules/settings";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortTh } from "@/features/ui/SortTh";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { LatestNote } from "@/features/ui/LatestNote";
import { latestLimit } from "@/features/shell/nav-routes";
import { nextDir, parseColumnSort, sortRows } from "@/server/lists/sorting";
import { departmentBucket, dueBucket, groupRows, indiaDayOf, pickGroup } from "@/server/lists/group-rows";

// v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
const FOLLOW_GROUPS = ["dept", "responsible", "meeting", "status", "due"] as const;
type FollowGroup = (typeof FOLLOW_GROUPS)[number];
const FOLLOW_GROUP_LABEL: Record<FollowGroup, string> = { dept: "Department (responsible)", responsible: "Responsible", meeting: "Meeting", status: "Status", due: "Due date" };
const STATE_ORDER: Record<string, number> = { OVERDUE: 0, OPEN: 1, DONE_UNCONFIRMED: 2, NO_TASK: 3, CONFIRMED: 4, CANCELLED: 5 };
import { isAdminActor } from "@/server/modules/tasks";
import { ListPage } from "@/features/ui/ListPage";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): the rows are all loaded, so they sort on the page. The
// Follow-up column holds buttons only (nothing to sort).
const FOLLOW_SORTS = ["action", "meeting", "responsible", "due", "status"] as const;
type FollowSort = (typeof FOLLOW_SORTS)[number];
const FOLLOW_SORT_LABEL: Record<FollowSort, string> = { action: "Action", meeting: "Meeting", responsible: "Responsible", due: "Due", status: "Status" };

export const metadata: Metadata = { title: "Meeting follow-ups" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine to do" },
  { key: "confirm", label: "To confirm" },
  { key: "overdue", label: "Overdue" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];

// v1.51.0 (D-300): the follow-up register. Every action item from approved
// MOMs (the latest meeting it was carried to), and every open point.
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): an empty address opens the person's default saved view (private).
  await applyDefaultListView(user.id, "list_follow_ups", "/users/meetings/follow-ups", query);
  const view: View = (VIEWS.find((item) => item.key === query.view)?.key ?? "open") as View;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const group = pickGroup(query.group, FOLLOW_GROUPS);
  const sort = parseColumnSort(query, FOLLOW_SORTS);
  // v1.58.0 (D-354): one address builder, so view, search, group and sort travel together.
  const fuHref = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | null> = { view, q: q || null, group, sortBy: sort.sortBy, dir: sort.sortBy ? sort.dir : null, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    return `/users/meetings/follow-ups?${params.toString()}`;
  };
  const groupHref = (value: FollowGroup | null) => fuHref({ group: value });
  const scope = await scopeFor(user);
  // v1.72.1 (D-395, QA F-07): the latest 500 actions (and 300 open points) say so, with "Show more".
  const limit = latestLimit(query.limit, 500, 2500);
  const pointLimit = latestLimit(query.points, 300, 1500);
  const [rows, openPoints] = await Promise.all([listFollowUps(scope, { ownerOnly: view === "mine" ? user.id : null, q, limit }), listOpenPointRegister(scope, pointLimit)]);
  const now = new Date();
  const withState = rows.map((row) => ({ row, state: actionState({ taskStatus: row.taskStatus, dueAt: row.taskDueAt, confirmedAt: row.confirmedAt }, now) as FollowUpState }));
  const runs = (row: { meetingOwnerId: number; meetingCoordinatorId: number }) => row.meetingOwnerId === user.id || row.meetingCoordinatorId === user.id || isAdminActor(user);
  const shown = withState.filter(({ row, state }) => {
    if (view === "all") return true;
    if (view === "confirm") return state === "DONE_UNCONFIRMED" && runs(row);
    if (view === "overdue") return state === "OVERDUE";
    return state !== "CONFIRMED" && state !== "CANCELLED";
  });
  // v1.58.0 (D-354): the chosen column order (groups keep it inside each group).
  const sorted = sort.sortBy
    ? sortRows(
        shown,
        ({ row, state }) =>
          sort.sortBy === "action"
            ? `${row.taskNo ?? ""} ${row.title}`.trim()
            : sort.sortBy === "meeting"
              ? row.meetingNo
              : sort.sortBy === "responsible"
                ? row.ownerName
                : sort.sortBy === "due"
                  ? (row.taskDueAt ? row.taskDueAt.toISOString() : row.dueOn)
                  : (STATE_ORDER[state] ?? 9),
        sort.dir,
      )
    : shown;
  const counts = Object.fromEntries((["OPEN", "OVERDUE", "DONE_UNCONFIRMED", "CONFIRMED"] as FollowUpState[]).map((state) => [state, withState.filter((item) => item.state === state).length]));
  return (
    <ListPage
      header={
          <PageHeader icon={ListChecks} title="Meeting follow-ups" description="Every action item and open point from approved MOMs, until it is confirmed done or closed." />
      }
    >
      <MeetingSections current="/users/meetings/follow-ups" />
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["OPEN", "OVERDUE", "DONE_UNCONFIRMED", "CONFIRMED"] as FollowUpState[]).map((state) => (
          <div key={state} className="card px-4 py-3">
            <dt className="text-caption text-ink-muted">{FOLLOW_UP_LABEL[state]}</dt>
            <dd className="text-stat font-semibold">{counts[state]}</dd>
          </div>
        ))}
      </dl>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <nav aria-label="Follow-up views" className="flex flex-wrap gap-2">
          {VIEWS.map((item) => (
            <Link
              key={item.key}
              href={fuHref({ view: item.key })}
              aria-current={view === item.key ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-label ${view === item.key ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line text-ink-muted hover:text-ink"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {/* v1.51.1 (owner): the toolbar search icon instead of a search box. */}
        <ListToolbar
          id="follow-up-filters"
          path="/users/meetings/follow-ups"
          label="Find follow-ups"
          keep={{ view, group: group ?? undefined, sortBy: sort.sortBy ?? undefined, dir: sort.sortBy ? sort.dir : undefined }}
          search={{ name: "q", value: q, placeholder: "Action or meeting" }}
          filterCount={0}
          clearHref={q ? fuHref({ q: null }) : null}
          group={{
            label: group ? FOLLOW_GROUP_LABEL[group] : null,
            clearHref: groupHref(null),
            choices: FOLLOW_GROUPS.map((value) => ({ label: FOLLOW_GROUP_LABEL[value], href: groupHref(value), active: group === value })),
          }}
        />
      </div>
      {/* v1.58.0 (D-354, owner): save view, search, group and sort as a named view (only mine). */}
      <ListViews userId={user.id} target="list_follow_ups" path="/users/meetings/follow-ups" query={Object.fromEntries(new URLSearchParams(fuHref({}).split("?")[1] ?? "").entries())} />
      {shown.length === 0 ? (
        <EmptyState title="Nothing to follow up here" body="Action items appear once the Meeting Owner approves the MOM." />
      ) : (
        // v1.58.0 (D-354, owner): groups start folded; Expand all / Collapse all.
        <FoldScope enabled={Boolean(group)}>
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="follow-up-table">
            <thead>
              <tr>
                {FOLLOW_SORTS.map((column) => (
                  <SortTh key={column} label={FOLLOW_SORT_LABEL[column]} column={column} sortBy={sort.sortBy} dir={sort.dir} href={fuHref({ sortBy: column, dir: nextDir(sort, column) })} />
                ))}
                <th scope="col">Follow-up</th>
              </tr>
            </thead>
            {(group
              ? groupRows(sorted, ({ row, state }): [string, number] => {
                  const today = indiaDayOf(new Date());
                  if (group === "dept") return departmentBucket(row.ownerDepartment);
                  if (group === "responsible") return [row.ownerName, 0];
                  if (group === "meeting") return [`${row.meetingNo} ${row.meetingTitle}`, 0];
                  if (group === "status") return [FOLLOW_UP_LABEL[state], STATE_ORDER[state] ?? 9];
                  return dueBucket(row.taskDueAt ? indiaDayOf(row.taskDueAt) : row.dueOn, today, state !== "CONFIRMED" && state !== "CANCELLED");
                })
              : [{ key: "all", label: "", items: sorted }]
            ).map((section) => {
              const rows = section.items.map(({ row, state }) => (
                <tr key={row.id}>
                  <td>
                    {row.taskId && (
                      <Link href={`/users/tasks/${row.taskId}`} className="text-primary-700 underline">
                        {row.taskNo}
                      </Link>
                    )}{" "}
                    {row.title}
                    {row.reviewNote && <p className="text-caption text-ink-muted">Note: {row.reviewNote}</p>}
                  </td>
                  <td className="text-label">
                    <Link href={`/users/meetings/${row.meetingId}`} className="text-primary-700 underline">
                      {row.meetingNo}
                    </Link>
                    <p className="text-caption text-ink-muted">{row.meetingTitle}</p>
                  </td>
                  <td className="text-label">{row.ownerName}</td>
                  <td className="text-label">{row.taskDueAt ? indiaDateTimeText(row.taskDueAt) : (row.dueOn ?? "—")}</td>
                  <td>
                    <FollowUpBadge state={state} />
                  </td>
                  <td>
                    {runs(row) && row.taskId && state !== "CONFIRMED" && state !== "CANCELLED" ? (
                      <ActionReviewForm actionId={row.id} canConfirm={state === "DONE_UNCONFIRMED"} canSendBack={state === "DONE_UNCONFIRMED"} />
                    ) : null}
                  </td>
                </tr>
              ));
              return section.label ? (
                <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={6}>
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
      <LatestNote shown={rows.length} limit={limit} step={500} max={2500} path="/users/meetings/follow-ups" query={query} what="action items" />
      <section className="mt-6" aria-labelledby="open-points">
        <h2 id="open-points" className="mb-2 font-semibold">
          Open points ({openPoints.length})
        </h2>
        {openPoints.length === 0 ? (
          <p className="text-label text-ink-muted">No open points.</p>
        ) : (
          <ul className="space-y-2">
            {openPoints.map((point) => (
              <li key={point.id} className="card flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-label">
                <div>
                  <p>{point.text}</p>
                  <p className="text-caption text-ink-muted">
                    <Link href={`/users/meetings/${point.meetingId}`} className="text-primary-700 underline">
                      {point.meetingNo}
                    </Link>{" "}
                    · {point.ownerName ?? "No owner"} · {point.reviewOn ? `review on ${point.reviewOn}` : "no review date"}
                  </p>
                </div>
                {(point.meetingOwnerId === user.id || point.meetingCoordinatorId === user.id || isAdminActor(user)) && <CloseOpenPointForm pointId={point.id} />}
              </li>
            ))}
          </ul>
        )}
        <LatestNote shown={openPoints.length} limit={pointLimit} step={300} max={1500} path="/users/meetings/follow-ups" query={query} what="open points" param="points" />
      </section>
    </ListPage>
  );
}
