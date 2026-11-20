import Link from "next/link";
import { TicketWorkForm } from "@/features/tickets/TicketForms";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortTh } from "@/features/ui/SortTh";
import { nextDir, sortHref, type ColumnSort } from "@/server/lists/sorting";
import { departmentBucket, groupRows } from "@/server/lists/group-rows";
import { TICKET_STATUS_LABEL } from "@/server/tickets/rules";
import { Badge, type Tone } from "@/features/ui/Display";
import { statusText, isOverdue, type TicketStatus } from "@/server/tickets/rules";
import { TICKET_PRIORITY_LABEL, type TicketPriority } from "@/server/modules/settings";
import type { TicketBoardItem, TicketListItem, TicketSortColumn } from "@/lib/db/repositories/tickets.repository";

// v1.55.0 (owner's ticketing brief §12): small shared pieces of the ticket pages.
const STATUS_TONE: Record<TicketStatus, Tone> = { NEW: "info", ASSIGNED: "primary", IN_PROGRESS: "primary", AWAITING_CONFIRMATION: "warning", REOPENED: "danger", CLOSED: "success" };
const PRIORITY_TONE: Record<TicketPriority, Tone> = { URGENT: "danger", HIGH: "warning", IMPORTANT: "warning", ELEVATED: "info", NORMAL: "neutral" };

export function TicketStatusBadge({ status, closeKind }: { status: TicketStatus; closeKind: string | null }) {
  return <Badge tone={closeKind === "AUTO" ? "neutral" : STATUS_TONE[status]}>{statusText(status, closeKind)}</Badge>;
}
export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{TICKET_PRIORITY_LABEL[priority]}</Badge>;
}

const day = (value: Date | null) => (value ? value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

// The ticket table (owner's columns): number, subject, requestor, department,
// priority, assigned employee, created, target date, status.
// v1.57.2 (D-340, owner: "an option to navigate to the tasks from tickets assigned to
// me so that the assignee can complete directly"): withTask adds a Task column.
// v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
export const TICKET_GROUPS = ["dept", "category", "form", "priority", "status", "assignee", "requester"] as const;
export type TicketGroup = (typeof TICKET_GROUPS)[number];
export const TICKET_GROUP_LABEL: Record<TicketGroup, string> = { dept: "Department", category: "Category", form: "Ticket form", priority: "Priority", status: "Status", assignee: "Assigned to", requester: "Requestor" };
const TICKET_PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4 };
const TICKET_STATUS_ORDER: Record<string, number> = { NEW: 0, REOPENED: 1, ASSIGNED: 2, IN_PROGRESS: 3, AWAITING_CONFIRMATION: 4, CLOSED: 5 };
function ticketBucket(item: TicketListItem, group: TicketGroup): [string, number] {
  switch (group) {
    case "dept":
      return departmentBucket(item.departmentName);
    case "category":
      return [item.categoryName, 0];
    case "form":
      return [`${item.categoryName} · ${item.typeName}`, 0];
    case "priority":
      return [TICKET_PRIORITY_LABEL[item.priority] ?? item.priority, TICKET_PRIORITY_ORDER[item.priority] ?? 9];
    case "status":
      return [item.closeKind === "AUTO" ? "Closed – auto closed" : TICKET_STATUS_LABEL[item.status], TICKET_STATUS_ORDER[item.status] ?? 9];
    case "assignee":
      return item.assigneeName ? [item.assigneeName, 0] : ["Not assigned", 9];
    default:
      return [item.requesterName, 0];
  }
}

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): every column title sorts (the server pages the rows, so the sort
// is SQL in listTickets; `sort` carries the address it lives on). A chosen Group
// by starts folded, with Expand all / Collapse all (FoldScope).
const TICKET_COLUMN_LABEL: Record<TicketSortColumn, string> = {
  ticket: "Ticket",
  subject: "Subject",
  requestor: "Requestor",
  department: "Department",
  priority: "Priority",
  assignee: "Assigned to",
  created: "Created",
  target: "Target date",
  status: "Status",
  task: "Update", // v1.59.3 (D-362): the assignee updates the ticket here (was the linked task)
};
export type TableSort<K extends string> = { state: ColumnSort<K>; path: string; query: Record<string, unknown> };

export function TicketTable({ items, caption, testId = "ticket-table", withTask = false, group = null, sort = null }: { items: readonly TicketListItem[]; caption: string; testId?: string; withTask?: boolean; group?: TicketGroup | null; sort?: TableSort<TicketSortColumn> | null }) {
  const now = new Date();
  const columns = (Object.keys(TICKET_COLUMN_LABEL) as TicketSortColumn[]).filter((column) => withTask || column !== "task");
  return (
    <FoldScope enabled={Boolean(group)}>
      <div className="card overflow-x-auto">
        <table className="data-table" data-testid={testId}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) =>
                sort ? (
                  <SortTh key={column} label={TICKET_COLUMN_LABEL[column]} column={column} sortBy={sort.state.sortBy} dir={sort.state.dir} href={sortHref(sort.path, sort.query, column, nextDir(sort.state, column))} />
                ) : (
                  <th key={column} scope="col">
                    {TICKET_COLUMN_LABEL[column]}
                  </th>
                ),
              )}
            </tr>
          </thead>
          {(group ? groupRows(items, (item) => ticketBucket(item, group)) : [{ key: "all", label: "", items: [...items] }]).map((section) => {
            const rows = section.items.map((item) => {
              const late = isOverdue({ status: item.status, dueAt: item.dueAt }, now);
              return (
                <tr key={item.id}>
                  <td className="whitespace-nowrap font-mono text-label">
                    <Link href={`/users/tickets/${item.id}`} className="link">
                      {item.ticketNo}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/users/tickets/${item.id}`} className="link font-medium">
                      {item.title}
                    </Link>
                    <p className="text-caption text-ink-muted">
                      {item.categoryName} · {item.typeName}
                    </p>
                  </td>
                  <td className="text-label">{item.requesterName}</td>
                  <td className="text-label">{item.departmentName ?? "—"}</td>
                  <td>
                    <TicketPriorityBadge priority={item.priority} />
                  </td>
                  <td className="text-label">{item.assigneeName ?? "—"}</td>
                  <td className="whitespace-nowrap text-label">{day(item.submittedAt)}</td>
                  <td className={`whitespace-nowrap text-label ${late ? "font-semibold text-danger-600" : ""}`}>
                    {day(item.dueAt)}
                    {late && <span className="block text-caption">Overdue</span>}
                  </td>
                  <td>
                    <TicketStatusBadge status={item.status} closeKind={item.closeKind} />
                  </td>
                  {withTask && (
                    // v1.59.3 (D-362, owner): Assigned to me updates the ticket from its row (no task).
                    <td className="min-w-[12rem]">
                      {item.status === "ASSIGNED" || item.status === "REOPENED" || item.status === "IN_PROGRESS" ? (
                        <TicketWorkForm ticketId={item.id} canStart={item.status !== "IN_PROGRESS"} canResolve compact />
                      ) : (
                        <span className="text-caption text-ink-muted">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            });
            return section.label ? (
              <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={withTask ? 10 : 9}>
                {rows}
              </FoldTbody>
            ) : (
              <tbody key={section.key}>{rows}</tbody>
            );
          })}
        </table>
      </div>
    </FoldScope>
  );
}

// v1.58.0 (D-354, owner: sorting on every column): the Coordinator board is not
// paged, so it sorts the rows on the page, inside each status group. Priority
// sorts Urgent first; "In this status" by how long it has been there (ascending =
// shortest first, i.e. the latest arrival); dates by date; empty values last. Pure.
export const BOARD_SORT_COLUMNS = ["ticket", "subject", "requestor", "department", "priority", "assignee", "since", "target", "needed"] as const;
export type BoardSortColumn = (typeof BOARD_SORT_COLUMNS)[number];
export function boardSortValue(item: TicketBoardItem, column: BoardSortColumn): unknown {
  switch (column) {
    case "ticket":
      return item.ticketNo;
    case "subject":
      return item.title;
    case "requestor":
      return item.requesterName;
    case "department":
      return item.departmentName;
    case "priority":
      return TICKET_PRIORITY_ORDER[item.priority] ?? 9;
    case "assignee":
      return item.assigneeName;
    case "since":
      return -item.statusSince.getTime();
    case "target":
      return item.dueAt;
    default:
      return item.requiredOn;
  }
}
