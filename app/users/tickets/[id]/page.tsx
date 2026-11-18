import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ticket } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { FieldValues, FileLinks } from "@/features/modules/RecordParts";
import { RichText } from "@/features/work/RichText";
import { AssignTicketForm, ConfirmTicketForms, TicketRemarkForm } from "@/features/tickets/TicketForms";
import { TicketPriorityBadge, TicketStatusBadge } from "@/features/tickets/TicketParts";
import { ticketsPage } from "@/server/tickets/page-context";
import { loadTicketFor } from "@/server/tickets/service";
import { findTicketFeedback, listTicketComments, listTicketEvents } from "@/lib/db/repositories/tickets.repository";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { loadLookupNames } from "@/lib/db/repositories/lookups.repository";
import { listRecordFiles } from "@/server/modules/files";
import { indiaDateTimeText } from "@/server/modules/settings";
import { isOverdue, TICKET_STATUS_LABEL, type TicketStatus } from "@/server/tickets/rules";
import { personLabel } from "@/lib/people/label";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §5-7, §12): one ticket. Coordinators assign
// (making the linked task) and add remarks; the assignee works in the task;
// the requester confirms or reopens once the work is done.
const EVENT_TEXT: Record<string, string> = {
  RAISED: "Raised",
  ASSIGNED: "Assigned",
  REASSIGNED: "Reassigned",
  REASSIGNED_AFTER_REOPEN: "Assigned again after reopening",
  WORK_STARTED: "Work started",
  WORK_COMPLETED: "Work completed",
  CONFIRM_REMINDER: "Reminder sent to confirm",
  CONFIRMED: "Confirmed and closed",
  REOPENED: "Reopened",
  AUTO_CLOSED: "Closed automatically",
  REMARK: "Remark",
  FILES_ADDED: "Files added",
};
const day = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ raised?: string }> }) {
  const { user } = await ticketsPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const loaded = await loadTicketFor(Number(id), user);
  if (!loaded) notFound();
  const { ticket, form, actions, internal, viewer } = loaded;
  const [events, comments, files, taskFiles, people, lookupNames, feedback] = await Promise.all([
    listTicketEvents(ticket.id, internal),
    listTicketComments(ticket.id, internal),
    listRecordFiles("TICKET", ticket.id),
    ticket.taskId ? listRecordFiles("TASK", ticket.taskId) : Promise.resolve([]),
    listPeopleFacts(),
    loadLookupNames(),
    ticket.status === "CLOSED" ? findTicketFeedback(ticket.id) : Promise.resolve(null),
  ]);
  const query = await searchParams;
  const names = new Map(people.map((person) => [person.id, person.name]));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const requester = ticket.requesterId === user.id;
  const late = isOverdue(ticket);
  const facts: [string, React.ReactNode][] = [
    ["Requestor", ticket.requesterName],
    ["Employee ID", ticket.requesterLoginId],
    ["Department", ticket.departmentName ?? "—"],
    ["Email", ticket.requesterEmail],
    ["Ticket type", `${ticket.categoryName} · ${ticket.typeName}`],
    ["Raised", indiaDateTimeText(ticket.submittedAt)],
    ["Required date", day(ticket.requiredOn)],
    ["Assigned to", ticket.assigneeName ?? "Not assigned yet"],
    ["Target date", ticket.dueAt ? <span className={late ? "font-semibold text-danger-600" : ""}>{indiaDateTimeText(ticket.dueAt).split(",")[0]}{late ? " (overdue)" : ""}</span> : "—"],
  ];
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/tickets", label: "My tickets" }, { label: ticket.ticketNo }]} />
      <PageHeader title={ticket.title} icon={Ticket} meta={`${ticket.ticketNo} · ${ticket.categoryName}`}>
        <TicketPriorityBadge priority={ticket.priority} />
        <TicketStatusBadge status={ticket.status} closeKind={ticket.closeKind} />
      </PageHeader>
      {query.raised && (
        <p role="status" className="mb-4 rounded-md bg-success-50 px-3 py-2 text-label text-success-600">
          Ticket {ticket.ticketNo} raised. Its coordinators have been told.
        </p>
      )}

      {/* The requester's moment: confirm or reopen. */}
      {actions.has("CONFIRM") && (
        <section className="card mb-6 border-warning-600 px-5 py-4" aria-labelledby="confirm-heading">
          <h2 id="confirm-heading" className="mb-1 font-semibold">
            The work is done: please confirm
          </h2>
          <p className="mb-3 text-label text-ink-muted">
            {ticket.assigneeName} completed it{ticket.resolvedAt ? ` on ${indiaDateTimeText(ticket.resolvedAt)}` : ""}. With no answer, it closes by itself after {day(ticket.confirmDueOn)}.
          </p>
          {ticket.resolutionText && (
            <div className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-label">
              <p className="font-medium">Completion remarks</p>
              <RichText text={ticket.resolutionText} />
            </div>
          )}
          <ConfirmTicketForms ticketId={ticket.id} />
        </section>
      )}
      {ticket.status === "AWAITING_CONFIRMATION" && !requester && (
        <p className="mb-4 rounded-md bg-warning-50 px-3 py-2 text-label text-warning-600" role="status">
          Waiting for {ticket.requesterName} to confirm. It closes by itself after {day(ticket.confirmDueOn)} if there is no answer.
        </p>
      )}
      {ticket.status === "CLOSED" && (
        <p className="mb-4 rounded-md bg-success-50 px-3 py-2 text-label text-success-600" role="status" data-testid="ticket-closed">
          Closed {ticket.closedAt ? indiaDateTimeText(ticket.closedAt) : ""}: {ticket.closeReason ?? (ticket.closeKind === "AUTO" ? "automatically" : "confirmed")}.
          {feedback?.rating ? ` Rated ${feedback.rating}/5.` : ""}
          {feedback?.comment ? ` "${feedback.comment}"` : ""}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="card px-5 py-4" aria-labelledby="details-heading">
            <h2 id="details-heading" className="mb-3 font-semibold">
              Details
            </h2>
            <dl className="mb-4 grid gap-3 sm:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-caption text-ink-muted">{label}</dt>
                  <dd className="break-words text-label font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {ticket.description && (
              <div className="mb-4">
                <p className="mb-1 text-caption text-ink-muted">Description</p>
                <RichText text={ticket.description} />
              </div>
            )}
            <FieldValues form={form} data={ticket.formData} names={names} lookupNames={lookupNames} />
            <div className="mt-4 space-y-3">
              <FileLinks files={files} label="Attachments" />
              <FileLinks files={taskFiles} label="Supporting documents from the work" />
            </div>
          </section>

          <section className="card px-5 py-4" aria-labelledby="remarks-heading">
            <h2 id="remarks-heading" className="mb-3 font-semibold">
              Remarks
            </h2>
            {comments.length === 0 ? (
              <p className="mb-3 text-label text-ink-muted">No remarks yet.</p>
            ) : (
              <ul className="mb-4 space-y-3" data-testid="ticket-comments">
                {comments.map((comment) => (
                  <li key={comment.id} className={`rounded-md px-3 py-2 ${comment.internal ? "bg-warning-50" : "bg-surface-muted"}`}>
                    <p className="text-caption text-ink-muted">
                      {comment.authorName} · {indiaDateTimeText(comment.createdAt)}
                      {comment.internal ? " · Internal" : ""}
                    </p>
                    <RichText text={comment.body} />
                  </li>
                ))}
              </ul>
            )}
            {actions.has("COMMENT") && <TicketRemarkForm ticketId={ticket.id} canInternal={internal && !requester} />}
          </section>
        </div>

        <aside className="space-y-6">
          {actions.has("ASSIGN") && (
            <section className="card px-5 py-4" aria-labelledby="assign-heading">
              <h2 id="assign-heading" className="mb-3 font-semibold">
                {ticket.assigneeId ? (ticket.status === "REOPENED" ? "Assign again" : "Reassign") : "Assign"}
              </h2>
              <AssignTicketForm
                ticketId={ticket.id}
                rowVersion={ticket.rowVersion}
                people={people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
                current={ticket.assigneeId}
                defaultTarget={ticket.dueAt && ticket.status !== "REOPENED" ? new Date(ticket.dueAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : (ticket.requiredOn && ticket.requiredOn >= today ? ticket.requiredOn : today)}
                today={today}
                reassign={ticket.assigneeId !== null}
              />
            </section>
          )}
          {ticket.taskId && (viewer.isAdmin || viewer.isCoordinator || ticket.assigneeId === user.id) && (
            <section className="card px-5 py-4" aria-labelledby="task-heading">
              <h2 id="task-heading" className="mb-1 font-semibold">
                Linked task
              </h2>
              <p className="text-label">
                <Link href={`/users/tasks/${ticket.taskId}`} className="link font-mono">
                  {ticket.taskNo}
                </Link>{" "}
                {ticket.assigneeId === user.id ? "· start, update and complete the work there." : `· with ${ticket.assigneeName}.`}
              </p>
            </section>
          )}
          <section className="card px-5 py-4" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="mb-3 font-semibold">
              Timeline
            </h2>
            <ol className="space-y-2 text-label" data-testid="ticket-timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <p className="font-medium">
                    {EVENT_TEXT[event.action] ?? event.action}
                    {/* The new status, unless the words already say it (e.g. "Assigned"). */}
                    {event.toStatus && event.action !== "RAISED" && event.toStatus !== event.fromStatus && !(EVENT_TEXT[event.action] ?? "").toLowerCase().startsWith((TICKET_STATUS_LABEL[event.toStatus as TicketStatus] ?? "").toLowerCase()) ? ` → ${TICKET_STATUS_LABEL[event.toStatus as TicketStatus] ?? event.toStatus}` : ""}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {event.actorName ?? "ARS CMS"} · {indiaDateTimeText(event.createdAt)}
                  </p>
                  {typeof event.detail?.assigneeName === "string" && <p className="text-caption">To {event.detail.assigneeName}, target {day(typeof event.detail.targetDate === "string" ? event.detail.targetDate : null)}</p>}
                  {typeof event.detail?.reason === "string" && <p className="text-caption">{event.detail.reason}</p>}
                  {typeof event.detail?.remarks === "string" && event.detail.remarks && <p className="text-caption">{event.detail.remarks}</p>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
