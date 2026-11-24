import { formatDateTime } from "@/lib/format/date";
import { TaskPriorityPill } from "@/features/ui/ChoicePill";
import { RichText } from "@/features/work/RichText";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { Hint } from "@/features/ui/Hint";
import { Badge, Breadcrumbs } from "@/features/ui/Display";
import { returnToFor } from "@/server/authorization/return-to";
import { ReturnToLink } from "@/features/ui/ReturnToLink";
import { AttachFilesForm, EditTaskForm, ReassignForm, TaskActionButton } from "@/features/modules/TaskForms";
import { ActionRemarks } from "@/features/modules/ActionRemarks";
import { FieldValues, FileLinks, type HistoryEntry } from "@/features/modules/RecordParts";
import { STATUS_TONE } from "@/features/modules/TaskListScreen";
import { listTaskEvents, listPeopleFacts, personFacts } from "@/lib/db/repositories/tasks.repository";
import { loadFieldLookups, loadLookupNames } from "@/lib/db/repositories/lookups.repository";
import { listRecordFiles } from "@/server/modules/files";
import { isAdminActor, loadTaskFor, relatedRequestVisible } from "@/server/modules/tasks";
import { meetingOfTask } from "@/lib/db/repositories/meetings.repository";
import { loadJourney } from "@/server/journey/load";
import { ARSApprovalJourney } from "@/features/journey/ARSApprovalJourney";
import { COMPLETION_LABEL, indiaDateTimeText, utcToIndiaLocal } from "@/server/modules/settings";
import { isOverdue, mayAssignTo, TASK_STATUS_LABEL } from "@/server/modules/task-rules";
import { TaskWorkPanel, TaskWorkSide } from "@/features/work/TaskWorkPanel";
import { CommentThread } from "@/features/work/CommentThread";
import { taskWorkView } from "@/server/work/task-view";
import { TaskCompleteButton } from "@/features/work/client";
import { TaskShareButton } from "@/features/work/ShareDialogs";
import { visibilityText } from "@/features/work/visibility";
import { ArrowLeft, ArrowRightToLine, CalendarDays, ExternalLink, Eye, MoreHorizontal } from "lucide-react";
import { PaneTitle, PaneVisibilityBanner, TaskFieldRows } from "@/features/work/PaneLayout";
import { PaneComposer } from "@/features/work/CommentThread";
import { PaneModeButton, PaneMoreMenu, TaskLikeButton } from "@/features/work/PaneParts";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { SheetButton } from "@/features/mobile/BottomSheet";
import { CopyLinkButton } from "@/features/work/client";
import { Avatar } from "@/features/ui/Avatar";

import { TaskActivity } from "@/features/work/TaskActivity";
import { MySectionPicker } from "@/features/work/MyTasks";
import { mySectionChoice, RULE_EVENT } from "@/server/work/my-rules";
import { RunAutomationButtons } from "@/features/work/automations/RunAutomationButtons";
import { manualRulesFor } from "@/server/work/automations";
import { loadTaskTime } from "@/server/work/time-tracking";
import { TimeSection } from "@/features/work/extras/TimeSection";
import { loadTicketFor } from "@/server/tickets/service";
import { listTicketComments, listTicketEvents } from "@/lib/db/repositories/tickets.repository";
import { TICKET_EVENT_TEXT } from "@/features/tickets/event-text";
import { personLabel } from "@/lib/people/label";
import { recurrenceLabel } from "@/server/work/more-rules";
import type { AuthenticatedUser } from "@/types/auth";

export const TASK_EVENT_TEXT: Record<string, string> = {
  CREATED: "Created",
  START: "Started",
  BLOCK: "Marked blocked",
  UNBLOCK: "Back in progress",
  COMPLETE: "Completed",
  REOPEN: "Reopened",
  CANCEL: "Cancelled",
  REASSIGN: "Reassigned",
  EDIT: "Details changed",
  COMMENT: "Comment",
  // D-215: Task & Project Management.
  COMMENTED: "Commented",
  SUBTASK_ADDED: "Added a subtask",
  PARENT_CHANGED: "Moved in the task tree",
  MOVED_SECTION: "Moved to another section",
  ADDED_TO_PROJECT: "Added to a project",
  REMOVED_FROM_PROJECT: "Removed from a project",
  FOLLOWER_ADDED: "Added a follower",
  FOLLOWER_REMOVED: "Removed a follower",
  DEPENDENCY_ADDED: "Now waits for another task",
  DEPENDENCY_REMOVED: "No longer waits for a task",
  TAG_ADDED: "Added a tag",
  TAG_REMOVED: "Removed a tag",
  DELETED: "Deleted",
  RESTORED: "Restored",
  // D-218
  REPEAT_SET: "Repeat changed",
  RECURRED: "Repeated",
  FIELD_SET: "Field changed",
  // v1.66.0 (D-374): made from a project form by the system user, on behalf of the submitter.
  FORM_SUBMITTED: "Submitted through a form",
};

// v1.9.0 (D-143): one task. Only its creator, assigner, assignee, the
// assignee's manager and IT can open it; anyone else gets "not found".
// v1.52.1 (owner: "when opening a task it should open in a popup window with
// all the actions"): the whole task, shared by its full page and the popup
// opened from a list (?task=<id>). In the popup the breadcrumbs make way for
// a bar with Open full page and Close.
export async function TaskDetail({ taskId, user, query, popup }: { taskId: number; user: AuthenticatedUser; query: { created?: string; project?: string; from?: string }; popup?: { closeHref: string; side?: boolean } }) {
  const loaded = await loadTaskFor(taskId, user);
  if (!loaded) {
    if (!popup) notFound();
    return <p className="px-5 py-6 text-ink-muted">Not found, or you can&apos;t see this task.</p>;
  }
  const { task, settings, form, versionNo, actions } = loaded;
  const [events, files, people, lookups, lookupNames, me, relatedVisible] = await Promise.all([
    listTaskEvents(task.id),
    listRecordFiles("TASK", task.id),
    listPeopleFacts(),
    loadFieldLookups(),
    loadLookupNames(),
    personFacts(user.id),
    task.relatedRequestId ? relatedRequestVisible(task.relatedRequestId, user) : Promise.resolve(false),
  ]);
  // v1.57.2 (D-339, owner: "all the comments and attachments and activities should
  // be reflected in both ticket and task"): a ticket's task shows the ticket's
  // remarks, files and timeline (internal remarks only for those who see them).
  const ticketSide = task.ticketId ? await loadTicketFor(task.ticketId, user).catch(() => null) : null;
  const [ticketRemarks, ticketEvents, ticketFiles] = ticketSide
    ? await Promise.all([listTicketComments(ticketSide.ticket.id, ticketSide.internal).then((rows) => rows.filter((row) => !row.deleted)), listTicketEvents(ticketSide.ticket.id, ticketSide.internal), listRecordFiles("TICKET", ticketSide.ticket.id, { internal: ticketSide.internal })])
    : [[], [], []];
  // v1.51.0 (D-300): the meeting an action-item task came from (like projects).
  const fromMeeting = await meetingOfTask(task.id).catch(() => null);
  // D-273: the parent request's journey, small, for anyone who may see that request (its own check).
  const parentJourney = task.relatedRequestId ? await loadJourney(task.relatedRequestId, { id: user.id, roles: user.roles }).catch(() => null) : null;
  const created = query.created === "1";
  // D-215: projects, subtasks, dependencies, tags, followers, likes, comments (shared with the task panel, D-219).
  const view = await taskWorkView(task, user);
  const { panel, rights, chain, links, viewer, group } = view;
  const fromProject = links.find((link) => String(link.projectId) === query.project) ?? null;
  // v1.89.0 (NAV-04, D-419): opened from Admin → Records (Open full page), the
  // validated ?from= is the way back (first crumb and "← Back to …"); never in a pane.
  const returnTo = popup ? null : returnToFor(user, query.from);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const now = new Date();
  const late = isOverdue(task, now);
  const options = people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }));
  const assignable = people.filter(
    (person) =>
      person.id !== task.assigneeId && mayAssignTo(settings, { creatorId: user.id, creatorDepartmentId: me?.departmentId ?? null, creatorTeamIds: loaded.viewer.teamIds ?? [], candidate: person }, isAdminActor(user)),
  );
  const editable = form.filter((field) => field.editable && field.type !== "ATTACHMENT" && field.type !== "CALC");
  const values = Object.fromEntries(
    editable.map((field) => [field.key, Array.isArray(task.formData[field.key]) ? JSON.stringify(task.formData[field.key]) : task.formData[field.key] === undefined ? "" : String(task.formData[field.key])]),
  );
  // v1.76.0 (D-401): Task Summary's section (assignee only) and rule notes (only the person they are about sees them).
  const sectionChoice = task.assigneeId === user.id && !task.deletedAt ? await mySectionChoice(user.id, task.id).catch(() => null) : null;
  const history: HistoryEntry[] = events.filter((event) => event.eventType !== RULE_EVENT || Number(event.payload?.userId) === user.id).map((event) => ({
    id: event.id,
    when: event.createdAt,
    who: event.actorName,
    what:
      event.eventType === "REASSIGN" && event.payload
        ? `Reassigned from ${names.get(Number(event.payload.from)) ?? "someone"} to ${names.get(Number(event.payload.to)) ?? "someone"}`
        : (TASK_EVENT_TEXT[event.eventType] ?? event.eventType),
    // D-215: mentions read as @Name.
    detail: event.body?.replace(/@\[([^\]\n]{1,80})\]\(user:\d{1,10}\)/g, "@$1") ?? null,
  }));

  // v1.68.0 (D-380): "Run by hand" automations of the task's projects (owners and editors).
  const manualRules = task.deletedAt ? [] : await manualRulesFor(task.id, { id: user.id, name: user.name, roles: user.roles, modules: user.modules }).catch(() => []);
  // v1.71.0 (D-384): the Time section (with "pm_extras" on; null otherwise).
  const timeData = await loadTaskTime(task.id, { id: user.id, name: user.name, roles: user.roles, modules: user.modules }).catch(() => null);
  const actionsCard = (
    <>
          <section className="card space-y-3 px-5 py-4">
            <h2 className="font-semibold">Actions</h2>
            <RunAutomationButtons taskId={task.id} rules={manualRules} />
            {[...actions].filter((action) => action !== "COMMENT").length === 0 && <p className="text-label text-ink-muted">Nothing for you to do on this task now.</p>}
            {[...actions].some((action) => action !== "COMMENT" && action !== "EDIT") ? (
            <ActionRemarks>
            <div className="flex flex-wrap gap-2">
              {actions.has("START") && <TaskActionButton taskId={task.id} rowVersion={task.rowVersion} action="START" needsText={false} />}
              {actions.has("UNBLOCK") && <TaskActionButton taskId={task.id} rowVersion={task.rowVersion} action="UNBLOCK" needsText={false} />}
              {actions.has("COMPLETE") && (
                <TaskActionButton
                  taskId={task.id}
                  rowVersion={task.rowVersion}
                  action="COMPLETE"
                  needsText={settings.completion === "NOTE" || settings.completion === "NOTE_AND_FILE"}
                  allowFiles={settings.completion === "FILE" || settings.completion === "NOTE_AND_FILE"}
                  textLabel={`Completion note${settings.completion === "NONE" || settings.completion === "FILE" ? " (optional)" : ""}`}
                />
              )}
              {actions.has("BLOCK") && <TaskActionButton taskId={task.id} rowVersion={task.rowVersion} action="BLOCK" needsText textLabel="What is blocking it?" />}
              {actions.has("REOPEN") && <TaskActionButton taskId={task.id} rowVersion={task.rowVersion} action="REOPEN" needsText textLabel="Why reopen it?" />}
              {actions.has("CANCEL") && <TaskActionButton taskId={task.id} rowVersion={task.rowVersion} action="CANCEL" needsText textLabel="Why cancel it?" danger />}
            </div>
            {actions.has("COMPLETE") && settings.completion !== "NONE" && <p className="text-caption text-ink-muted">To complete: {COMPLETION_LABEL[settings.completion].toLowerCase()}.</p>}
            {actions.has("REASSIGN") && <ReassignForm taskId={task.id} rowVersion={task.rowVersion} assignable={assignable.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))} />}
            </ActionRemarks>
            ) : null}
            {actions.has("EDIT") && (
              <EditTaskForm
                taskId={task.id}
                rowVersion={task.rowVersion}
                title={task.title}
                description={task.description ?? ""}
                priority={task.priority}
                due={utcToIndiaLocal(task.dueAt)}
                editable={editable}
                values={values}
                people={options}
                lookups={lookups}
              />
            )}
          </section>
    </>
  );
  const canTick = (actions.has("COMPLETE") && settings.completion === "NONE") || actions.has("REOPEN") || task.status === "COMPLETED";
  const mobile = await isMobileLayout();

  return (
    <>
      {mobile && (
        // v1.45.0 (owner's Asana task screen): back, Mark complete, copy link and … (the task's actions) stay at the top.
        <div className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-sticky -mx-page -mt-page mb-3 flex items-center gap-2 border-b border-line bg-surface px-2 py-2" data-testid="m-task-bar">
          <Link href={returnTo ? returnTo.href : fromProject ? `/users/work/projects/${fromProject.projectId}` : "/users/work/my-tasks"} aria-label={returnTo ? `Back to ${returnTo.label}` : "Back to tasks"} className="grid h-11 w-11 place-items-center rounded-full text-ink">
            <ArrowLeft aria-hidden="true" className="h-6 w-6" />
          </Link>
          {/* v1.89.0 (UIQA-A11Y-01): min-w-0 so Mark complete shrinks (its words cut with …) instead of widening the page at 320 px (400 % zoom). */}
          <span className="flex min-w-0 flex-1 justify-center">{canTick && <TaskCompleteButton taskId={task.id} done={task.status === "COMPLETED"} disabled={!(actions.has("COMPLETE") || actions.has("REOPEN"))} title={task.title} />}</span>
          <span className="grid h-11 w-11 place-items-center">
            <CopyLinkButton path={`/users/tasks/${task.id}`} />
          </span>
          <SheetButton label="Task actions" title="Task actions" content={<div className="space-y-4 pb-2 [&_.card]:border-0 [&_.card]:px-0 [&_.card]:shadow-none">{actionsCard}<TaskShareButton taskId={task.id} title={task.title} followers={panel.followers} people={panel.people} visibility={visibilityText(links)} canAdd={rights.comment} /></div>} testId="m-task-actions" className="grid h-11 w-11 place-items-center rounded-full text-ink-muted">
            <MoreHorizontal aria-hidden="true" className="h-6 w-6" />
          </SheetButton>
        </div>
      )}
      {mobile ? (
        <header className="mb-4 space-y-4">
          <p className="font-mono text-[12px] text-ink-muted">
            {task.taskNo} · {task.typeName}
          </p>
          <h1 className="text-page-title [overflow-wrap:anywhere]">{task.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
            <TaskPriorityPill priority={task.priority} showNormal />
            {late && <Badge tone="danger">Overdue</Badge>}
            {task.deletedAt && <Badge tone="danger">Deleted</Badge>}
          </div>
          {/* v1.72.2 (D-394): each fact is dt + dd directly (axe definition-list); the picture is a dd placed first. */}
          <dl className="grid grid-cols-2 gap-3 border-y border-line py-3" data-testid="m-task-facts">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
              <dt className="col-start-2 row-start-1 text-[length:calc(13px*var(--text-scale,1))] text-ink-muted">Assigned to</dt>
              <dd className="col-start-2 row-start-2 truncate text-[length:calc(15px*var(--text-scale,1))]">{task.assigneeName}</dd>
              <dd className="col-start-1 row-span-2 row-start-1">
                <Avatar name={task.assigneeName} src={null} size="md" />
              </dd>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
              <dt className="col-start-2 row-start-1 text-[length:calc(13px*var(--text-scale,1))] text-ink-muted">Due date</dt>
              <dd className={`col-start-2 row-start-2 truncate text-[length:calc(15px*var(--text-scale,1))] ${late ? "text-danger-600" : ""}`}>{task.dueAt ? formatDateTime(task.dueAt, { year: "auto" }) : "None"}</dd>
              <dd aria-hidden="true" className={`col-start-1 row-span-2 row-start-1 grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 ${late ? "border-danger-600 text-danger-600" : "border-line text-ink-muted"}`}>
                <CalendarDays className="h-5 w-5" />
              </dd>
            </div>
          </dl>
        </header>
      ) : (
      <>
      {!popup && <Breadcrumbs
        items={[
          returnTo ? { href: returnTo.href, label: returnTo.label } : fromProject ? { href: `/users/work/projects/${fromProject.projectId}`, label: fromProject.projectName } : { href: "/users/tasks", label: "Tasks" },
          ...chain.map((item) => ({ href: `/users/tasks/${item.id}`, label: item.title })),
          { label: task.taskNo },
        ]}
        // v1.89.0 (D-423, UIQA-CON-11): the way back on the breadcrumb's line, as on every detail page.
        back={returnTo ? <ReturnToLink to={returnTo} /> : undefined}
      />}
      {popup?.side ? (
        // v1.62.0 (D-368, spec PRJ views §13.1): the pane's action bar, then the task's name.
        // v1.75.0 (D-399, owner's pane screenshot): Mark complete on the left; on the
        // right the collaborators' avatars with +, Share, a divider, then like, copy
        // link, full page, more and close (→|). The banner, the bold editable name
        // and the field rows follow; the comment box is pinned at the bottom.
        <header className="mb-4 space-y-3">
          <div className="sticky top-0 z-[3] -mx-4 -mt-4 flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2 sm:-mx-5 sm:-mt-5" role="toolbar" aria-label="Task actions" data-testid="pane-bar">
            {canTick && <TaskCompleteButton taskId={task.id} done={task.status === "COMPLETED"} disabled={!(actions.has("COMPLETE") || actions.has("REOPEN"))} title={task.title} />}
            <span className="flex-1" />
            <TaskShareButton taskId={task.id} title={task.title} followers={panel.followers} people={panel.people} visibility={visibilityText(links)} canAdd={rights.comment} collaborators />
            <TaskShareButton taskId={task.id} title={task.title} followers={panel.followers} people={panel.people} visibility={visibilityText(links)} canAdd={rights.comment} />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <TaskLikeButton taskId={task.id} liked={panel.likes.some((person) => person.id === user.id)} count={panel.likes.length} names={panel.likes.map((person) => person.name)} />
            <CopyLinkButton path={`/users/tasks/${task.id}`} />
            {/* v1.83.0 (D-410, owner): ⤢ opens the task in the centred dialog; the full page has its own button. */}
            <PaneModeButton to="DIALOG" />
            <Link href={`/users/tasks/${task.id}`} data-full-page aria-label="Open full page" title="Open full page (the task's own page)" className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="pane-full">
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </Link>
            <PaneMoreMenu taskId={task.id} title={task.title} canDelete={rights.edit && !task.deletedAt} closeHref={popup.closeHref} automations={manualRules} copy={{ projectId: (fromProject ?? links[0])?.projectId ?? null, description: task.description ?? "", priority: task.priority }} />
            <Link href={popup.closeHref} scroll={false} aria-label="Close task" aria-keyshortcuts="Escape" title="Close" data-pane-close className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="close-pane">
              <ArrowRightToLine aria-hidden="true" className="h-5 w-5" />
            </Link>
          </div>
          {view.pmOn && <PaneVisibilityBanner text={visibilityText(links)} data={panel} />}
          <PaneTitle taskId={task.id} title={task.title} canEdit={panel.canDetails && !task.deletedAt} />
          <p className="font-mono text-caption text-ink-muted">
            {task.taskNo} · {task.typeName}
          </p>
          <TaskFieldRows data={panel} canAssign={(actions.has("REASSIGN") || rights.edit) && !task.deletedAt} />
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
            <TaskPriorityPill priority={task.priority} showNormal />
            {late && <Badge tone="danger">Overdue</Badge>}
            {task.isMilestone && <Badge tone="primary">Milestone</Badge>}
            <Badge tone={panel.adhoc ? "neutral" : "info"}>{panel.adhoc ? "Ad hoc" : panel.recurrence ? `Periodic: ${recurrenceLabel(panel.recurrence)}` : "Periodic"}</Badge>
            {task.deletedAt && <Badge tone="danger">Deleted</Badge>}
          </div>
        </header>
      ) : (
      <>
      {view.pmOn && <VisibilityBanner text={visibilityText(links)} />}
      <PageHeader
        title={task.title}
        meta={`${task.taskNo} · ${task.typeName} (version ${versionNo})`}
        // v1.89.0 (D-423, UIQA-CON-12): the badges beside the title, as on every detail page; actions on the right.
        badge={
          <>
            <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
            <TaskPriorityPill priority={task.priority} showNormal />
            {late && <Badge tone="danger">Overdue</Badge>}
            {task.isMilestone && <Badge tone="primary">Milestone</Badge>}
            {/* D-222: the two kinds of task. */}
            <Badge tone={panel.adhoc ? "neutral" : "info"}>{panel.adhoc ? "Ad hoc" : panel.recurrence ? `Periodic: ${recurrenceLabel(panel.recurrence)}` : "Periodic"}</Badge>
            {task.deletedAt && <Badge tone="danger">Deleted</Badge>}
          </>
        }
      >
        <TaskShareButton taskId={task.id} title={task.title} followers={panel.followers} people={panel.people} visibility={visibilityText(links)} canAdd={rights.comment} />
        {/* D-219: complete or reopen in one click, as in Asana (types that need a note or file say so). */}
        {((actions.has("COMPLETE") && settings.completion === "NONE") || actions.has("REOPEN") || task.status === "COMPLETED") && (
          <TaskCompleteButton taskId={task.id} done={task.status === "COMPLETED"} disabled={!(actions.has("COMPLETE") || actions.has("REOPEN"))} title={task.title} />
        )}
      </PageHeader>
      </>
      )}
      </>
      )}
      {parentJourney && (
        <section className="mb-4" aria-label={`Approval journey of ${parentJourney.requestNo}`} data-testid="task-parent-journey">
          <p className="mb-1.5 text-label text-ink-muted">
            From approval request{" "}
            <Link href={`/users/requests/${parentJourney.requestId}`} className="link font-mono">
              {parentJourney.requestNo}
            </Link>
          </p>
          <ARSApprovalJourney journey={parentJourney} serverNow={new Date().toISOString()} variant="compact" />
        </section>
      )}
      {created && (
        <p role="status" className="mb-4 rounded-md bg-success-50 px-3 py-2 text-label text-success-600">
          Task {task.taskNo} created{task.assigneeId !== user.id ? ` and ${task.assigneeName} was told` : ""}.
        </p>
      )}
      <div className={popup?.side ? "grid gap-6" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"}>
        <div className="space-y-6">
          <section className="card space-y-4 px-5 py-4" aria-labelledby="details">
            <h2 id="details" className="font-semibold">
              Details
            </h2>
            {/* v1.75.0 (D-399): the task's people and dates as field rows (the date range picker), as in the pane. */}
            {!popup?.side && !task.deletedAt && <TaskFieldRows data={panel} canAssign={actions.has("REASSIGN") || rights.edit} />}
            {task.description && <RichText text={task.description} />}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Assigned to" value={task.assigneeName} />
              {sectionChoice && <MySectionPicker taskId={task.id} sections={sectionChoice.sections} current={sectionChoice.current} />}
              <Fact label="Assigned by" value={task.assignedByName} />
              <Fact label="Created by" value={`${task.createdByName}, ${indiaDateTimeText(task.createdAt)}`} />
              <Fact label="Due" value={task.dueAt ? indiaDateTimeText(task.dueAt) : "No due date"} />
              {task.startsOn && <Fact label="Start on" value={task.startsOn} />}
              {task.completedAt && <Fact label="Completed" value={`${task.completedByName ?? ""}, ${indiaDateTimeText(task.completedAt)}`} />}
              {task.relatedRequestNo && (
                <div>
                  <dt className="text-caption font-semibold text-ink-faint">Related request</dt>
                  <dd>
                    {relatedVisible ? (
                      <Link href={`/users/requests/${task.relatedRequestId}`} className="link font-mono">
                        {task.relatedRequestNo}
                      </Link>
                    ) : (
                      <span className="font-mono">{task.relatedRequestNo}</span>
                    )}{" "}
                    <Hint text="Separate from this task: completing it doesn't approve the request." align="start" />
                  </dd>
                </div>
              )}
              {fromMeeting && (
                <div>
                  <dt className="text-caption font-semibold text-ink-faint">Meeting</dt>
                  <dd>
                    <Link href={`/users/meetings/${fromMeeting.id}`} className="link">
                      <span className="font-mono">{fromMeeting.meetingNo}</span> {fromMeeting.title}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            <FieldValues form={form} data={task.formData} names={names} lookupNames={lookupNames} />
            {task.completionNote && (
              <div>
                <h3 className="text-label font-semibold">Completion note</h3>
                <p className="whitespace-pre-wrap">{task.completionNote}</p>
              </div>
            )}
          </section>
          {/* v1.54.7 (owner): a task's files, and adding more, always at hand. */}
          <section className="card space-y-3 px-5 py-4" aria-labelledby="task-files" data-testid="task-files">
            <h2 id="task-files" className="font-semibold">
              Attachments
            </h2>
            {files.length ? <FileLinks files={files} label="" /> : <p className="text-label text-ink-muted">No files yet.</p>}
            {ticketSide && ticketFiles.length > 0 && <FileLinks files={ticketFiles} label={`From ticket ${ticketSide.ticket.ticketNo}`} />}
            {actions.has("COMMENT") && <AttachFilesForm taskId={task.id} />}
          </section>
          {group.length > 0 && (
            <p className="card px-5 py-3 text-label" data-testid="assign-group">
              <span className="text-ink-muted">Also given to (each has their own copy): </span>
              {group.map((item, index) => (
                <span key={item.id}>
                  {index > 0 && ", "}
                  <Link href={`/users/tasks/${item.id}`} className="link">
                    {item.assigneeName}
                  </Link>
                  {item.status === "COMPLETED" && " ✓"}
                </span>
              ))}
            </p>
          )}
          <TaskWorkPanel data={panel} />
          {timeData && <TimeSection data={timeData} />}
          {/* v1.52.1 (owner, Asana): Comments and All activity as two tabs. */}
          <TaskActivity
            comments={
              <>
                <CommentThread taskId={task.id} meId={user.id} canComment={rights.comment && !task.deletedAt} canPin={rights.edit} isAdmin={viewer.isAdmin} people={panel.people} comments={view.comments} docked={mobile && !popup} composer={!popup?.side} />
                {ticketSide && ticketRemarks.length > 0 && (
                  <section className="card mt-4 px-5 py-4" aria-labelledby="ticket-remarks" data-testid="task-ticket-remarks">
                    <h2 id="ticket-remarks" className="mb-3 font-semibold">
                      Remarks on ticket{" "}
                      <Link href={`/users/tickets/${ticketSide.ticket.id}`} className="link font-mono">
                        {ticketSide.ticket.ticketNo}
                      </Link>
                    </h2>
                    <ul className="space-y-3">
                      {ticketRemarks.map((remark) => (
                        <li key={remark.id} className={`rounded-md px-3 py-2 ${remark.internal ? "bg-warning-50" : "bg-surface-muted"}`}>
                          <p className="text-caption text-ink-muted">
                            {remark.authorName} · {indiaDateTimeText(remark.createdAt)}
                            {remark.internal ? " · Internal" : ""}
                          </p>
                          <RichText text={remark.body} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            }
            commentCount={view.comments.filter((comment) => !comment.deleted).length + ticketRemarks.length}
            activity={[
              ...history.map((entry, index) => ({
                id: entry.id,
                when: entry.when.toISOString(),
                who: entry.who,
                what: entry.what,
                detail: entry.detail ?? null,
                kind: activityKind(events[index]?.eventType ?? ""),
              })),
              // The ticket's own timeline, marked as such (ids kept apart from the task's).
              ...ticketEvents.map((event) => ({
                id: 1_000_000_000 + event.id,
                when: event.createdAt.toISOString(),
                who: event.actorName ?? "ARS CMS",
                what: `Ticket ${ticketSide?.ticket.ticketNo ?? ""}: ${TICKET_EVENT_TEXT[event.action] ?? event.action}`,
                detail: (typeof event.detail?.reason === "string" ? event.detail.reason : typeof event.detail?.remarks === "string" ? event.detail.remarks : null) || null,
                kind: activityKind(event.action === "REMARK" ? "COMMENT" : ""),
              })),
            ]}
          />
        </div>
        <aside className="space-y-4" aria-label="Task actions">
          {!mobile && actionsCard}
          <TaskWorkSide data={panel} />
        </aside>
      </div>
      {/* v1.75.0 (D-399): the pane's comment box, pinned at its bottom. */}
      {popup?.side && <PaneComposer taskId={task.id} people={panel.people} canComment={rights.comment && !task.deletedAt} />}
    </>
  );
}

// v1.52.2 (owner, Asana's activity): comments in full, completion with a tick,
// creation, and everything else as small updates that fold together.
function activityKind(eventType: string): "comment" | "done" | "created" | "update" {
  if (eventType === "COMMENT" || eventType === "COMMENTED") return "comment";
  if (eventType === "COMPLETE") return "done";
  if (eventType === "CREATED") return "created";
  return "update";
}


// v1.62.0 (D-368, spec CMP-28): who can see this task, above its details.
function VisibilityBanner({ text }: { text: string }) {
  return (
    <p className="mb-3 flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-label text-ink-muted" data-testid="visibility-banner">
      <Eye aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption font-semibold text-ink-faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
