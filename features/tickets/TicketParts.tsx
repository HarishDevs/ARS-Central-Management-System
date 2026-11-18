import Link from "next/link";
import { Badge, type Tone } from "@/features/ui/Display";
import { statusText, isOverdue, type TicketStatus } from "@/server/tickets/rules";
import { TICKET_PRIORITY_LABEL, type TicketPriority } from "@/server/modules/settings";
import type { TicketListItem } from "@/lib/db/repositories/tickets.repository";

// v1.55.0 (owner's ticketing brief §12): small shared pieces of the ticket pages.
const STATUS_TONE: Record<TicketStatus, Tone> = { NEW: "info", ASSIGNED: "primary", IN_PROGRESS: "primary", AWAITING_CONFIRMATION: "warning", REOPENED: "danger", CLOSED: "success" };
const PRIORITY_TONE: Record<TicketPriority, Tone> = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" };

export function TicketStatusBadge({ status, closeKind }: { status: TicketStatus; closeKind: string | null }) {
  return <Badge tone={closeKind === "AUTO" ? "neutral" : STATUS_TONE[status]}>{statusText(status, closeKind)}</Badge>;
}
export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{TICKET_PRIORITY_LABEL[priority]}</Badge>;
}

const day = (value: Date | null) => (value ? value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

// The ticket table (owner's columns): number, subject, requestor, department,
// priority, assigned employee, created, target date, status.
export function TicketTable({ items, caption, testId = "ticket-table" }: { items: readonly TicketListItem[]; caption: string; testId?: string }) {
  const now = new Date();
  return (
    <div className="card overflow-x-auto">
      <table className="data-table" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Subject</th>
            <th scope="col">Requestor</th>
            <th scope="col">Department</th>
            <th scope="col">Priority</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Created</th>
            <th scope="col">Target date</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
