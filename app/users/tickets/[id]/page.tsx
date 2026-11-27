import { formatDate } from "@/lib/format/date";
import { ItemChecklist } from "@/features/modules/ItemChecklist";
import { EditableComment } from "@/features/comments/EditableComment";
import { checklistsFor, mayTickTicket } from "@/server/records/item-checks";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ticket } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge, Breadcrumbs } from "@/features/ui/Display";
import { returnToFor } from "@/server/authorization/return-to";
import { ReturnToLink } from "@/features/ui/ReturnToLink";
import { FieldValues, FileLinks } from "@/features/modules/RecordParts";
import { RichText } from "@/features/work/RichText";
import { AssignTicketForm, ConfirmTicketForms, TicketRemarkForm, TicketWorkForm } from "@/features/tickets/TicketForms";
import { TicketPriorityBadge, TicketStatusBadge } from "@/features/tickets/TicketParts";
import { ticketsPage } from "@/server/tickets/page-context";
import { loadTicketFor } from "@/server/tickets/service";
import { coordinatorsOf, findTicketFeedback, listTicketCollaborators, listTicketComments, listTicketEvents } from "@/lib/db/repositories/tickets.repository";
import { CollaboratorsCard } from "@/features/requests/CollaboratorsCard";
import { CommenterBadge } from "@/features/collaborating/CommenterBadge";
import { collaboratorOnly, mayAddTicketFiles, mayLeaveTicket, mayManageTicketCollaborators } from "@/server/tickets/rules";
import { collabTabHref } from "@/server/collaborating/tabs";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { loadLookupNames } from "@/lib/db/repositories/lookups.repository";
import { listRecordFiles } from "@/server/modules/files";
import { indiaDateTimeText } from "@/server/modules/settings";
import { isOverdue, TICKET_STATUS_LABEL, type TicketStatus } from "@/server/tickets/rules";
import { personLabel } from "@/lib/people/label";
import { TICKET_EVENT_TEXT } from "@/features/tickets/event-text";
import { TASK_EVENT_TEXT } from "@/features/work/TaskDetail";
import { listComments as listTaskComments } from "@/lib/db/repositories/work.repository";
import { listTaskEvents } from "@/lib/db/repositories/tasks.repository";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §5-7, §12): one ticket. Coordinators assign
// (making the linked task) and add remarks; the assignee works in the task;
// the requester confirms or reopens once the work is done.
const day = (value: string | null) => formatDate(value, { empty: "—" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ raised?: string; from?: string }> }) {
  const { user } = await ticketsPage({ partyOpen: true });
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const loaded = await loadTicketFor(Number(id), user);
  if (!loaded) notFound();
  const { ticket, form, actions, internal, viewer } = loaded;
  const [events, comments, files, taskFiles, people, lookupNames, feedback, collaborators] = await Promise.all([
    listTicketEvents(ticket.id, internal),
    listTicketComments(ticket.id, internal),
    listRecordFiles("TICKET", ticket.id, { internal }),
    ticket.taskId ? listRecordFiles("TASK", ticket.taskId) : Promise.resolve([]),
    listPeopleFacts(),
    loadLookupNames(),
    ticket.status === "CLOSED" ? findTicketFeedback(ticket.id) : Promise.resolve(null),
    listTicketCollaborators(ticket.id),
  ]);
  // v1.92.0 (D-438, D-439): collaborators, like a request's. The raiser,
  // coordinators, assignee and IT manage them; a collaborator with no other part
  // in the ticket gets the Collaborating tab as the way back, and without the
  // Ticketing module is a Commenter (read, download, comment; nothing else).
  const onlyCollaborator = collaboratorOnly(ticket, viewer);
  const commenter = Boolean(viewer.commenter && onlyCollaborator);
  const canManageCollaborators = mayManageTicketCollaborators(ticket, viewer);
  const ticketPeople = new Set([ticket.requesterId, ...(ticket.assigneeId ? [ticket.assigneeId] : []), ...(canManageCollaborators ? (await coordinatorsOf(ticket.typeId)).map((person) => person.id) : [])]);
  const collaboratorOptions = canManageCollaborators ? people.filter((person) => !ticketPeople.has(person.id)).map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined })) : [];
  const query = await searchParams;
  // v1.89.0 (NAV-04, D-419): the validated way back to another area's list (?from=).
  const returnTo = returnToFor(user, query.from);
  const names = new Map(people.map((person) => [person.id, person.name]));
  // v1.57.2 (D-339, owner: "all the comments and attachments and activities should be
  // reflected in both ticket and task"): the task's comments and activity show here too.
  const [taskComments, taskEvents] = ticket.taskId ? await Promise.all([listTaskComments(ticket.taskId, user.id), listTaskEvents(ticket.taskId).then((rows) => rows.filter((row) => row.eventType !== "MY_SECTION_RULE"))]) : [[], []];
  const remarks = [
    ...comments.map((comment) => ({ key: `r${comment.id}`, id: comment.id, authorId: comment.authorId, authorName: comment.authorName, createdAt: comment.createdAt, body: comment.body, internal: comment.internal, fromTask: false, edited: comment.edited, deleted: comment.deleted })),
    ...taskComments.filter((comment) => !comment.deletedAt).map((comment) => ({ key: `t${comment.id}`, id: comment.id, authorId: comment.authorId, authorName: comment.authorName, createdAt: comment.createdAt, body: comment.body, internal: false, fromTask: true, edited: comment.editedAt !== null, deleted: false })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const timeline = [
    ...events.map((event) => ({ kind: "ticket" as const, at: event.createdAt, event })),
    ...taskEvents.map((event) => ({ kind: "task" as const, at: event.createdAt, event })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  // v1.57.0 (D-335): Item list fields, ticked as provided by the coordinators and the assignee.
  const checklists = await checklistsFor("TICKET", ticket.id, form, ticket.formData);
  const canTickItems = checklists.length > 0 && (await mayTickTicket(ticket.id, user));
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
      {/* v1.89.0 (NAV-04, D-419): opened from Admin → Records, the way back is that list. */}
      {/* v1.89.0 (D-423, UIQA-CON-11 / CON-12): the way back on the breadcrumb's line; the badges beside the title. */}
      {/* v1.92.0 (D-441): a collaborator-only viewer's way back is the Collaborating screen's Tickets tab. */}
      <Breadcrumbs
        items={[returnTo ? { href: returnTo.href, label: returnTo.label } : onlyCollaborator ? { href: collabTabHref("tickets"), label: "Collaborating" } : { href: "/users/tickets", label: "My tickets" }, { label: ticket.ticketNo }]}
        back={returnTo ? <ReturnToLink to={returnTo} /> : undefined}
      />
      <PageHeader
        title={ticket.title}
        icon={Ticket}
        meta={`${ticket.ticketNo} · ${ticket.categoryName}`}
        badge={
          <>
            <TicketPriorityBadge priority={ticket.priority} />
            <TicketStatusBadge status={ticket.status} closeKind={ticket.closeKind} />
            {ticket.archivedAt && <Badge tone="neutral">Archived (read-only)</Badge>}
            {ticket.onBehalfByName && <Badge tone="info">Created by Super Admin on behalf of {ticket.requesterName}</Badge>}
            {commenter && <CommenterBadge module="Ticketing" />}
          </>
        }
      />
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
            <FieldValues form={form.filter((field) => field.type !== "ITEM_LIST")} data={ticket.formData} names={names} lookupNames={lookupNames} />
            {checklists.length > 0 && (
              <div className="mt-4">
                <ItemChecklist entityType="TICKET" entityId={ticket.id} lists={checklists} canTick={canTickItems} />
              </div>
            )}
            <div className="mt-4 space-y-3">
              <FileLinks files={files} label="Attachments" />
              <FileLinks files={taskFiles} label="Supporting documents from the work" />
            </div>
          </section>

          <section className="card px-5 py-4" aria-labelledby="remarks-heading">
            <h2 id="remarks-heading" className="mb-3 font-semibold">
              Remarks
            </h2>
            {remarks.length === 0 ? (
              <p className="mb-3 text-label text-ink-muted">No remarks yet.</p>
            ) : (
              <ul className="mb-4 space-y-3" data-testid="ticket-comments">
                {remarks.map((comment) => (
                  <li key={comment.key} className={`rounded-md px-3 py-2 ${comment.internal ? "bg-warning-50" : "bg-surface-muted"}`}>
                    <p className="text-caption text-ink-muted">
                      {comment.authorName} · {indiaDateTimeText(comment.createdAt)}
                      {comment.internal ? " · Internal" : ""}
                      {comment.fromTask ? ` · on task ${ticket.taskNo ?? ""}` : ""}
                    </p>
                    {/* v1.60.0 (D-365): the author and IT edit or delete a remark; earlier versions kept. */}
                    <EditableComment
                      target={comment.fromTask ? "TASK" : "TICKET"}
                      commentId={comment.id}
                      body={comment.body}
                      edited={comment.edited}
                      deleted={comment.deleted}
                      canChange={!comment.fromTask && (comment.authorId === user.id || viewer.isAdmin)}
                      maxLength={4000}
                      noun="remark"
                    />
                  </li>
                ))}
              </ul>
            )}
            {actions.has("COMMENT") && <TicketRemarkForm ticketId={ticket.id} canInternal={internal && !requester} canAttach={mayAddTicketFiles(ticket, viewer)} />}
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
          {/* v1.59.3 (D-362, owner): the assignee updates the work on the ticket itself; no task. */}
          {(actions.has("START") || actions.has("RESOLVE")) && (
            <section className="card px-5 py-4" aria-labelledby="work-heading">
              <h2 id="work-heading" className="mb-3 font-semibold">
                Your work on this ticket
              </h2>
              <TicketWorkForm ticketId={ticket.id} rowVersion={ticket.rowVersion} canStart={actions.has("START")} canResolve={actions.has("RESOLVE")} />
            </section>
          )}
          {ticket.taskId && (viewer.isAdmin || viewer.isCoordinator || ticket.assigneeId === user.id) && (
            <p className="text-caption text-ink-muted">
              Earlier work was tracked in task{" "}
              <Link href={`/users/tasks/${ticket.taskId}`} className="link font-mono">
                {ticket.taskNo}
              </Link>{" "}
              (history; the ticket is now updated here).
            </p>
          )}
          {/* v1.92.0 (D-438): people following the ticket. */}
          <CollaboratorsCard
            kind="ticket"
            requestId={ticket.id}
            viewerId={mayLeaveTicket(ticket, viewer) ? user.id : 0}
            canManage={canManageCollaborators}
            options={collaboratorOptions}
            rows={collaborators.map((row) => ({ userId: row.userId, name: row.name, loginId: row.loginId, addedByName: row.addedByName, addedAt: indiaDateTimeText(row.addedAt) }))}
          />
          <section className="card px-5 py-4" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="mb-3 font-semibold">
              Timeline
            </h2>
            {/* v1.74.1 (D-397): an empty timeline says so. */}
            {timeline.length === 0 && <p className="text-label text-ink-muted">Nothing has happened yet.</p>}
            <ol className="space-y-2 text-label" data-testid="ticket-timeline">
              {timeline.map((item) =>
                item.kind === "task" ? (
                  <li key={`t${item.event.id}`} data-testid="ticket-timeline-task">
                    <p className="font-medium">
                      Task {ticket.taskNo}: {TASK_EVENT_TEXT[item.event.eventType] ?? item.event.eventType}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {item.event.actorName} · {indiaDateTimeText(item.event.createdAt)}
                    </p>
                    {item.event.body && <p className="text-caption">{item.event.body.replace(/@\[([^\]\n]{1,80})\]\(user:\d{1,10}\)/g, "@$1")}</p>}
                  </li>
                ) : (
                  <TicketEventRow key={`k${item.event.id}`} event={item.event} />
                ),
              )}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}

// One line of the ticket's own timeline.
function TicketEventRow({ event }: { event: Awaited<ReturnType<typeof listTicketEvents>>[number] }) {
  return (
    <li>
      <p className="font-medium">
        {TICKET_EVENT_TEXT[event.action] ?? event.action}
        {/* The new status, unless the words already say it (e.g. "Assigned"). */}
        {event.toStatus && event.action !== "RAISED" && event.toStatus !== event.fromStatus && !(TICKET_EVENT_TEXT[event.action] ?? "").toLowerCase().startsWith((TICKET_STATUS_LABEL[event.toStatus as TicketStatus] ?? "").toLowerCase()) ? ` → ${TICKET_STATUS_LABEL[event.toStatus as TicketStatus] ?? event.toStatus}` : ""}
      </p>
      <p className="text-caption text-ink-muted">
        {event.actorName ?? "ARS CMS"} · {indiaDateTimeText(event.createdAt)}
      </p>
      {typeof event.detail?.assigneeName === "string" && <p className="text-caption">To {event.detail.assigneeName}, target {day(typeof event.detail.targetDate === "string" ? event.detail.targetDate : null)}</p>}
      {typeof event.detail?.reason === "string" && <p className="text-caption">{event.detail.reason}</p>}
      {Array.isArray(event.detail?.names) && <p className="text-caption">{(event.detail.names as unknown[]).filter((name) => typeof name === "string").join(", ")}</p>}
      {event.action === "COLLABORATOR_REMOVED" && typeof event.detail?.name === "string" && <p className="text-caption">{event.detail.self ? `${event.detail.name} stopped following` : event.detail.name}</p>}
      {typeof event.detail?.remarks === "string" && event.detail.remarks && <p className="text-caption">{event.detail.remarks}</p>}
    </li>
  );
}
