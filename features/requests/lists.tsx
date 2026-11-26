import { formatDate, indiaDay } from "@/lib/format/date";
import Link from "next/link";
import { Fragment } from "react";
import { ReorderHeader, type HeaderColumn, type HeaderSort } from "@/features/requests/ReorderHeader";
import { SortTh } from "@/features/ui/SortTh";
import { ChangeDetailsButton } from "@/features/requests/ChangeDetails";
import { RequestStatusPill } from "@/features/requests/StatusPill";
import { EmptyState } from "@/features/shell/PageHeader";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import type {
  MyRequestItem,
  QueueItem,
} from "@/lib/db/repositories/approvals.repository";
import { SafeText } from "@/features/ui/SafeText";
import { FoldListGroup, FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { PriorityPill } from "@/features/ui/ChoicePill";
import type { ShownPriority } from "@/server/approvals/priority";
import { QueueRowSelect, QueueSelectAll } from "@/features/requests/QueueBulkApprove";

// v1.47.0: `priority` (the request's Priority field, by request id) adds a
// Priority column; pages that don't pass it show the table as before.
// v1.52.3 (owner): with `order` the columns follow the person's saved order
// and their titles can be dragged to move them (Waiting for me).
type QueueColumn = "priority" | "from" | "step" | "since" | "due";
const QUEUE_HEADER: Record<QueueColumn, HeaderColumn> = {
  priority: { key: "priority", label: "Priority" },
  from: { key: "from", label: "From" },
  step: { key: "step", label: "Your step" },
  since: { key: "since", label: "Waiting since" },
  due: { key: "due", label: "Due date" },
};
// v1.57.4 (D-343): `groups` (label + the items in it, in order) shows the rows
// in folding groups; without it, one plain list as before.
// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): with
// `sort` every column title (and Request) is a sort link (hrefs from the page);
// grouped rows get Expand all / Collapse all (groups start folded).
// v1.59.0 (D-357, owner: "approver can change the approval details" "from the
// table itself"): with `editable`, each approval row (not a work task, not on
// hold) has a Change details button at the end.
// v1.90.0 (D-429, owner: "select and bulk approval option"): with `selectable`,
// each approval row (not a work task, not on hold) has a tick box first (and
// each phone card one on its left) for Approve on the bulk bar.
export const queueSelectable = (item: Pick<QueueItem, "work" | "onHold">) => !item.work && !item.onHold;
export function QueueTable({ items, priority, order: savedOrder, formDue = {}, groups, sort, editable = false, selectable = false, titleOnly = false }: { items: QueueItem[]; priority?: Record<number, ShownPriority>; order?: string[]; formDue?: Record<number, string>; groups?: { key: string; label: string; items: QueueItem[] }[]; sort?: HeaderSort; editable?: boolean; selectable?: boolean; titleOnly?: boolean }) {
  // v1.91.1 (D-435, owner: "the 1st line to be available and the 2nd line is not needed"): on
  // Waiting for me the Request cell is the title only; the record number stays on the request
  // page and search by number still works. Home keeps the second line (titleOnly is off there).
  // The request as this page shows it: bulk Approve refuses one that changed since (stale).
  const selectKey = (item: QueueItem) => `${item.requestId}:${item.taskKey}${item.stateVersion !== undefined ? `:${item.stateVersion}` : ""}`;
  const selectLabel = (item: QueueItem) => `Select ${item.requestNo} ${item.title}`;
  // v1.53.0: the request's own due date (its form's Due date field), India day.
  const todayDay = indiaDay(new Date());
  const dayText = (day: string) => formatDate(day);
  const all: QueueColumn[] = priority ? ["priority", "from", "step", "since", "due"] : ["from", "step", "since", "due"];
  const order: QueueColumn[] = savedOrder ? (savedOrder.filter((key): key is QueueColumn => (all as string[]).includes(key))) : all;
  const cellFor = (item: QueueItem, column: QueueColumn): React.ReactNode => {
    switch (column) {
      case "priority":
        return (
          <td data-testid="queue-priority">
            <PriorityPill priority={priority?.[item.requestId]} />
          </td>
        );
      case "from":
        return <td>{item.requesterName}</td>;
      case "step":
        return (
          <td>
            {item.work && <span className="mr-1.5 rounded-full bg-primary-50 px-2 py-px text-caption font-semibold text-primary-700">To do</span>}
            {item.onHold && <span className="mr-1.5 rounded-full bg-warning-50 px-2 py-px text-caption font-semibold text-warning-600">On hold</span>}
            {item.nodeLabel}
            {item.forName && <p className="text-caption text-ink-muted">for {item.forName} (you&apos;re covering)</p>}
          </td>
        );
      case "since":
        return <td className="whitespace-nowrap">{formatIndiaTime(item.createdAt)}</td>;
      case "due":
        if (formDue[item.requestId]) {
          const day = formDue[item.requestId]!;
          const late = day < todayDay;
          return (
            <td className="whitespace-nowrap">
              <span className={late ? "font-semibold text-danger-600" : ""}>
                {late ? "Overdue · " : ""}
                {dayText(day)}
              </span>
              {item.dueAt && <span className={`block text-caption ${item.overdue ? "font-semibold text-danger-600" : "text-ink-muted"}`}>Step due {formatIndiaTime(item.dueAt)}</span>}
            </td>
          );
        }
        return (
          <td className="whitespace-nowrap">
            {item.dueAt ? (
              <span className={item.overdue ? "font-semibold text-danger-600" : ""}>
                {item.overdue ? "Overdue · " : ""}
                {formatIndiaTime(item.dueAt)}
              </span>
            ) : (
              <span className="text-ink-muted">No due date</span>
            )}
          </td>
        );
    }
  };
  if (items.length === 0)
    return (
      <EmptyState
        title="Nothing waiting for you"
        body="Requests that need your approval, and work given to you, appear here."
      />
    );
  return (
    <FoldScope enabled={Boolean(groups)}>
      {/* Phones (spec #5): one card per item, the whole card is the link. */}
      <ul className="card divide-y divide-line sm:hidden">
        {(groups ?? [{ key: "all", label: "", items }]).map((group) => {
          const cards = group.items.map((item) => (
          <li key={item.taskKey + item.requestId} className={selectable ? "flex items-start" : undefined}>
            {selectable &&
              (queueSelectable(item) ? (
                <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-start justify-center pt-3">
                  <QueueRowSelect value={selectKey(item)} label={selectLabel(item)} card />
                </label>
              ) : (
                <span aria-hidden="true" className="min-w-11 shrink-0" />
              ))}
            <Link
              href={`/users/requests/${item.requestId}`}
              data-queue-link
              className={`block py-3 focus-visible:bg-surface-muted active:bg-surface-muted ${selectable ? "min-w-0 flex-1 pr-4" : "px-4"}`}
            >
              <p className="font-medium text-primary-700">
                <SafeText text={item.title} />
              </p>
              {priority?.[item.requestId] && (
                <p className="mt-0.5">
                  <PriorityPill priority={priority[item.requestId]} />
                </p>
              )}
              {/* v1.91.1 (D-435): a phone card has no From column, so it keeps "from …"; the number and type go with the desktop line 2. */}
              <p className="text-caption text-ink-muted" data-testid="queue-card-meta">
                {titleOnly ? (
                  <>from {item.requesterName}</>
                ) : (
                  <>
                    {item.requestNo} · from {item.requesterName}
                    {item.typeName ? ` · ${item.typeName}` : ""}
                  </>
                )}
              </p>
              <p className="mt-1 text-label">
                {item.work && (
                  <span className="mr-1.5 rounded-full bg-primary-50 px-2 py-px text-caption font-semibold text-primary-700">
                    To do
                  </span>
                )}
                {item.onHold && (
                  <span className="mr-1.5 rounded-full bg-warning-50 px-2 py-px text-caption font-semibold text-warning-600">
                    On hold
                  </span>
                )}
                {item.nodeLabel}
                {item.forName && (
                  <span className="text-ink-muted"> · for {item.forName}</span>
                )}
              </p>
              {item.dueAt && (
                <p
                  className={`text-caption ${item.overdue ? "font-semibold text-danger-600" : "text-ink-muted"}`}
                >
                  {item.overdue ? "Overdue · " : "Due "}
                  {formatIndiaTime(item.dueAt)}
                </p>
              )}
            </Link>
          </li>
          ));
          return group.label ? (
            <FoldListGroup key={group.key} label={group.label} count={group.items.length}>
              {cards}
            </FoldListGroup>
          ) : (
            <Fragment key={group.key}>{cards}</Fragment>
          );
        })}
      </ul>
      <div className="card hidden overflow-x-auto sm:block">
        <table className="data-table">
          <thead>
            {savedOrder ? (
              <ReorderHeader list="queue" lead="Request" columns={order.map((column) => QUEUE_HEADER[column])} sort={sort} trailing={editable ? "Change details" : undefined} leading={selectable ? "Select" : undefined} leadingControl={selectable && titleOnly ? <QueueSelectAll testId="queue-select-all-header" /> : undefined} />
            ) : (
              <tr>
                {selectable && (
                  <th scope="col" className="w-10">
                    <span className="sr-only">Select</span>
                    {/* v1.91.1 (D-435): select-all at the top of the tick column (the bar below the table has the same box, kept in step). */}
                    {titleOnly && <QueueSelectAll testId="queue-select-all-header" />}
                  </th>
                )}
                {sort?.hrefs.title ? <SortTh label="Request" column="title" sortBy={sort.sortBy} dir={sort.dir} href={sort.hrefs.title} /> : <th>Request</th>}
                {order.map((column) =>
                  sort?.hrefs[column] ? (
                    <SortTh key={column} label={QUEUE_HEADER[column].label} column={column} sortBy={sort.sortBy} dir={sort.dir} href={sort.hrefs[column]!} />
                  ) : (
                    <th key={column}>{QUEUE_HEADER[column].label}</th>
                  ),
                )}
                {editable && (
                  <th scope="col">
                    <span className="sr-only">Change details</span>
                  </th>
                )}
              </tr>
            )}
          </thead>
          {(groups ?? [{ key: "all", label: "", items }]).map((group) => {
            const rows = group.items.map((item) => (
              <tr key={item.taskKey + item.requestId}>
                {selectable && <td className="w-10">{queueSelectable(item) ? <QueueRowSelect value={selectKey(item)} label={selectLabel(item)} /> : <span aria-hidden="true" className="inline-block h-4 w-4" />}</td>}
                <td>
                  <Link
                    href={`/users/requests/${item.requestId}`}
                    className="link"
                    data-queue-link
                  >
                    <SafeText text={item.title} />
                  </Link>
                  {!titleOnly && (
                    <p className="text-caption text-ink-muted">
                      {item.requestNo}
                      {item.typeName ? ` · ${item.typeName}` : ""}
                    </p>
                  )}
                </td>
                {order.map((column) => (
                  <Fragment key={column}>{cellFor(item, column)}</Fragment>
                ))}
                {editable && <td className="text-right">{!item.work && !item.onHold && <ChangeDetailsButton requestId={item.requestId} taskKey={item.taskKey} title={item.title} />}</td>}
              </tr>
            ));
            return group.label ? (
              <FoldTbody key={group.key} label={group.label} count={group.items.length} colSpan={order.length + 1 + (editable ? 1 : 0) + (selectable ? 1 : 0)}>
                {rows}
              </FoldTbody>
            ) : (
              <tbody key={group.key}>{rows}</tbody>
            );
          })}
        </table>
      </div>
    </FoldScope>
  );
}

// v1.58.1 (owner): with `sort` every column title (Priority included) is a sort link.
export function MyRequestsTable({ items, priority, sort }: { items: MyRequestItem[]; priority?: Record<number, ShownPriority>; sort?: HeaderSort }) {
  const th = (column: string, label: string) =>
    sort?.hrefs[column] ? <SortTh label={label} column={column} sortBy={sort.sortBy} dir={sort.dir} href={sort.hrefs[column]!} /> : <th>{label}</th>;
  if (items.length === 0) {
    return (
      <EmptyState
        title="No requests yet"
        body="Raise a request and follow every level of approval here."
      />
    );
  }
  return (
    <>
      <ul className="card divide-y divide-line sm:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/users/requests/${item.id}`}
              className="block px-4 py-3 active:bg-surface-muted"
            >
              <span className="flex items-start justify-between gap-2">
                {/* A long title wraps (even one long word); the status stays whole. */}
                <span className="min-w-0 font-medium text-primary-700 [overflow-wrap:anywhere]">
                  <SafeText text={item.title} />
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <RequestStatusPill status={item.status} validUntil={item.validUntil} />
                  {priority?.[item.id] && <PriorityPill priority={priority[item.id]} />}
                </span>
              </span>
              <span className="block text-caption text-ink-muted">
                {item.requestNo} · {item.workflowName} ·{" "}
                {formatIndiaTime(item.submittedAt)}
              </span>
              {(item.status === "IN_PROGRESS" || item.status === "ON_HOLD") &&
                item.pendingWith && (
                  <span className="block text-caption text-ink-muted">
                    Waiting for {item.pendingWith}
                  </span>
                )}
            </Link>
          </li>
        ))}
      </ul>
      <div className="card hidden overflow-x-auto sm:block">
        <table className="data-table">
          <thead>
            <tr>
              {th("title", "Request")}
              {th("type", "Type")}
              {th("status", "Status")}
              {priority && th("priority", "Priority")}
              {th("waiting", "Waiting for")}
              {th("raised", "Raised")}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/users/requests/${item.id}`} className="link">
                    <SafeText text={item.title} />
                  </Link>
                  <p className="text-caption text-ink-muted">
                    {item.requestNo}
                  </p>
                </td>
                <td>{item.workflowName}</td>
                <td>
                  <RequestStatusPill status={item.status} validUntil={item.validUntil} />
                </td>
                {priority && (
                  <td data-testid="my-request-priority">
                    <PriorityPill priority={priority[item.id]} />
                  </td>
                )}
                <td className="text-ink-muted">
                  {item.status === "IN_PROGRESS" || item.status === "ON_HOLD"
                    ? (item.pendingWith ?? "—")
                    : "—"}
                </td>
                <td className="whitespace-nowrap">
                  {formatIndiaTime(item.submittedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
