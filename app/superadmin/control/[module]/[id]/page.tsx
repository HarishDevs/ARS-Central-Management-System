import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { BackLink } from "@/features/ui/BackLink";
import { Badge } from "@/features/ui/Display";
import { SafeText } from "@/features/ui/SafeText";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { DateField } from "@/features/ui/DateField";
import { ControlActionForm } from "@/features/superadmin/ControlForms";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { findRequest, findWorkflowVersion, userNames } from "@/lib/db/repositories/approvals.repository";
import { daysUntilPurge } from "@/lib/db/repositories/superadmin-bin.repository";
import { personLabel } from "@/lib/people/label";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { ALL_TASK_PRIORITIES, TICKET_PRIORITIES } from "@/server/modules/settings";
import { loadControlItem, MODULE_LABEL, type ControlModule } from "@/server/superadmin/control/service";

export const metadata: Metadata = { title: "Control panel item" };
export const dynamic = "force-dynamic";

const SLUG: Record<string, ControlModule> = {
  request: "REQUEST",
  task: "TASK",
  ticket: "TICKET",
};
// Fields the panel edits as plain values (the rest stay as they are).
const EDITABLE = new Set(["TEXT", "LONG_TEXT", "NUMBER", "CURRENCY", "DATE", "URL", "CHOICE", "RADIO"]);

// v1.94.0 (D-451..D-457): one item in the Super Admin control panel: what it
// is, then Modify (logged override), Archive / Un-archive and Move to the bin,
// each with a required reason. Every check runs again on the server.
export default async function ControlItemPage({ params }: { params: Promise<{ module: string; id: string }> }) {
  const { user } = await requireArea("superadmin");
  const { module: slug, id: rawId } = await params;
  const kind = SLUG[slug];
  const id = /^\d{1,12}$/.test(rawId) ? Number(rawId) : null;
  if (!kind || !id) notFound();
  const item = await loadControlItem(kind, id, user);
  if (!item) notFound();
  const people = (await listActiveUserOptions()).map((person) => ({
    id: person.id,
    label: personLabel(person),
    detail: person.departmentName ?? undefined,
  }));
  const hidden = { module: kind, id: item.id };
  const locked = Boolean(item.binned || item.deleted);
  const ownRequest = kind === "REQUEST" && item.ownerId === user.id;

  // Requests: the open approvals and steps, and the form, for the override forms.
  const request = kind === "REQUEST" && !locked ? await findRequest(item.id) : null;
  const version = request ? await findWorkflowVersion(request.workflowVersionId) : null;
  const labelOf = (nodeId: string) => version?.definition.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
  const pending = request ? request.state.tasks.filter((task) => task.status === "PENDING") : [];
  const names = await userNames(pending.map((task) => task.approverId));
  const activeSteps = request
    ? Object.entries(request.state.nodes)
        .filter(([nodeId, node]) => (node.status === "ACTIVE" || node.status === "BLOCKED") && version?.definition.nodes.find((candidate) => candidate.id === nodeId)?.kind === "APPROVAL")
        .map(([nodeId]) => nodeId)
    : [];
  const editable = version ? version.form.filter((field) => EDITABLE.has(field.type)) : [];
  const raw = (key: string) => {
    const value = request?.formData[key];
    return value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  };

  return (
    <>
      <BackLink fallback="/superadmin/control" label="Control panel" />
      <PageHeader
        title={`${MODULE_LABEL[kind]} ${item.number}`}
        description="Every change needs a reason, is recorded in the item's own history as changed by Super Admin and in the audit log, and the people involved are told."
      />
      <div className="space-y-6" data-testid="control-item">
        <section className="card space-y-2 px-5 py-4" aria-label="The item">
          <p className="text-heading font-semibold">
            <SafeText text={item.title} />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{item.statusLabel}</Badge>
            {item.archivedAt && <Badge tone="neutral">Archived</Badge>}
            {item.binned && <Badge tone="danger">In Deleted items</Badge>}
            {item.deleted && !item.binned && <Badge tone="warning">Deleted by its creator</Badge>}
            {item.onBehalfByName && <Badge tone="info">Created by Super Admin on behalf of {item.ownerName}</Badge>}
          </div>
          <p className="text-label text-ink-muted">
            {kind === "REQUEST" ? "Raised by" : kind === "TASK" ? "Created by" : "Raised by"} {item.ownerName}
            {item.assigneeName ? ` · assigned to ${item.assigneeName}` : ""} · {formatIndiaTime(item.createdAt)}
          </p>
          {item.linkedTo && <p className="text-label text-ink-muted">This task is {item.linkedTo}: its status and assignee change there.</p>}
          {!locked && (
            <p>
              <Link href={item.href} className="link text-label" data-testid="open-item">
                Open its page (history, comments, files)
              </Link>
            </p>
          )}
          {item.binned && (
            <p className="text-label">
              In the bin since {formatIndiaTime(item.binned.binnedAt)} ({item.binned.reason}).{" "}
              {daysUntilPurge(item.binned) > 0 ? `Delete permanently is possible in ${daysUntilPurge(item.binned)} days.` : "It can be deleted permanently now."}{" "}
              <Link href={`/superadmin/control/bin?q=${encodeURIComponent(item.number)}`} className="link">
                Open Deleted items
              </Link>
            </p>
          )}
        </section>

        {!locked && (
          <section className="card space-y-4 px-5 py-4" aria-labelledby="modify-heading">
            <h2 id="modify-heading" className="font-semibold">
              Modify
            </h2>
            {item.archivedAt ? (
              <p className="text-label text-ink-muted">It is archived, so it is read-only. Un-archive it first to change it.</p>
            ) : ownRequest ? (
              <p className="text-label text-ink-muted">You raised this request, so you can&apos;t override it (nobody approves or overrides their own request). Ask another Super Admin.</p>
            ) : kind === "REQUEST" ? (
              <div className="grid gap-4 md:grid-cols-2">
                {pending.length > 0 && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "CHANGE_APPROVER",
                      version: item.rowVersion,
                    }}
                    label="Change an approver"
                    title="Change who an open approval waits for"
                    submitLabel="Change approver"
                    testId="change-approver"
                  >
                    <label className="field-label" htmlFor="approval-task">
                      Approval
                    </label>
                    <select id="approval-task" name="taskKey" className="field-input" required>
                      {pending.map((task) => (
                        <option key={task.id} value={task.id}>
                          {labelOf(task.nodeId)}: {names.get(task.approverId) ?? `#${task.approverId}`}
                        </option>
                      ))}
                    </select>
                    <PersonSelect name="userId" options={people.filter((person) => person.id !== item.ownerId)} ariaLabel="New approver" placeholder="New approver…" required />
                  </ControlActionForm>
                )}
                {activeSteps.length > 0 && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "ADD_APPROVER",
                      version: item.rowVersion,
                    }}
                    label="Add an approver"
                    title="Add an approver to a step that is waiting"
                    submitLabel="Add approver"
                    testId="add-approver"
                  >
                    <label className="field-label" htmlFor="add-step">
                      Step
                    </label>
                    <select id="add-step" name="nodeId" className="field-input" required>
                      {activeSteps.map((nodeId) => (
                        <option key={nodeId} value={nodeId}>
                          {labelOf(nodeId)}
                        </option>
                      ))}
                    </select>
                    <PersonSelect name="userId" options={people.filter((person) => person.id !== item.ownerId)} ariaLabel="Approver to add" placeholder="Approver to add…" required />
                  </ControlActionForm>
                )}
                {activeSteps.length > 0 && item.status === "IN_PROGRESS" && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "SKIP_STEP",
                      version: item.rowVersion,
                    }}
                    label="Skip a step"
                    title="Skip a step that is waiting (its open approvals close as not needed)"
                    submitLabel="Skip step"
                    testId="skip-step"
                  >
                    <label className="field-label" htmlFor="skip-step">
                      Step
                    </label>
                    <select id="skip-step" name="nodeId" className="field-input" required>
                      {activeSteps.map((nodeId) => (
                        <option key={nodeId} value={nodeId}>
                          {labelOf(nodeId)}
                        </option>
                      ))}
                    </select>
                  </ControlActionForm>
                )}
                {!item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "FORCE_STATUS",
                      version: item.rowVersion,
                    }}
                    label="Force the status"
                    title="Force the status (approvals already given stay on record)"
                    submitLabel="Set status"
                    danger
                    testId="force-status"
                  >
                    <label className="field-label" htmlFor="force-status">
                      New status
                    </label>
                    <select id="force-status" name="status" className="field-input" required>
                      <option value="APPROVED">Approved</option>
                      <option value="REJECTED">Rejected</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </ControlActionForm>
                )}
                {item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "REOPEN",
                      version: item.rowVersion,
                    }}
                    label="Reopen"
                    title="Reopen from the first step (a new round; earlier decisions stay on record)"
                    submitLabel="Reopen"
                    testId="reopen"
                  />
                )}
                <ControlActionForm
                  kind="override"
                  hidden={{
                    ...hidden,
                    action: "EDIT_FIELDS",
                    version: item.rowVersion,
                  }}
                  label="Edit the details"
                  title="Edit the title and details"
                  note="The route is not run again; to change who approves, use the approver changes."
                  submitLabel="Save changes"
                  testId="edit-fields"
                >
                  <label className="field-label" htmlFor="edit-title">
                    Title
                  </label>
                  <input id="edit-title" name="title" defaultValue={item.title} maxLength={200} className="field-input" required />
                  {editable.map((field) => (
                    <div key={field.key}>
                      <label className="field-label" htmlFor={`field-${field.key}`}>
                        {field.label}
                      </label>
                      {field.type === "LONG_TEXT" ? (
                        <textarea id={`field-${field.key}`} name={`field:${field.key}`} defaultValue={raw(field.key)} rows={3} className="field-input h-auto py-2" />
                      ) : field.type === "CHOICE" || field.type === "RADIO" ? (
                        <select id={`field-${field.key}`} name={`field:${field.key}`} defaultValue={raw(field.key)} className="field-input">
                          <option value="">—</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "DATE" ? (
                        <DateField id={`field-${field.key}`} name={`field:${field.key}`} label={field.label} defaultValue={raw(field.key)} />
                      ) : (
                        <input id={`field-${field.key}`} name={`field:${field.key}`} defaultValue={raw(field.key)} className="field-input" />
                      )}
                    </div>
                  ))}
                </ControlActionForm>
              </div>
            ) : kind === "TASK" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ControlActionForm
                  kind="override"
                  hidden={{
                    ...hidden,
                    action: "EDIT",
                    version: item.rowVersion,
                  }}
                  label="Edit the task"
                  title="Edit the task"
                  submitLabel="Save changes"
                  testId="edit-task"
                >
                  <label className="field-label" htmlFor="task-title">
                    Title
                  </label>
                  <input id="task-title" name="title" defaultValue={item.title} maxLength={200} className="field-input" required />
                  <label className="field-label" htmlFor="task-description">
                    Description
                  </label>
                  <textarea id="task-description" name="description" defaultValue={item.description ?? ""} rows={3} maxLength={4000} className="field-input h-auto py-2" />
                  <label className="field-label" htmlFor="task-priority">
                    Priority
                  </label>
                  <select id="task-priority" name="priority" defaultValue={item.priority ?? "NORMAL"} className="field-input">
                    {ALL_TASK_PRIORITIES.map((value) => (
                      <option key={value} value={value}>
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <label className="field-label" htmlFor="task-due">
                    Due date
                  </label>
                  <DateField id="task-due" name="dueDay" label="Due date" defaultValue={item.dueDay ?? ""} />
                  {!item.linkedTo && <PersonSelect name="userId" options={people} defaultValue={item.assigneeId} ariaLabel="Assignee" placeholder="Assignee…" />}
                </ControlActionForm>
                {!item.linkedTo && !item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "FORCE_STATUS",
                      version: item.rowVersion,
                    }}
                    label="Force the status"
                    title="Set the task's status"
                    submitLabel="Set status"
                    testId="task-status"
                  >
                    <label className="field-label" htmlFor="task-status">
                      New status
                    </label>
                    <select id="task-status" name="status" className="field-input" required>
                      <option value="OPEN">Open</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="BLOCKED">Blocked</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </ControlActionForm>
                )}
                {!item.linkedTo && item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "REOPEN",
                      version: item.rowVersion,
                    }}
                    label="Reopen"
                    title="Reopen the task"
                    submitLabel="Reopen"
                    testId="task-reopen"
                  />
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <ControlActionForm
                  kind="override"
                  hidden={{
                    ...hidden,
                    action: "EDIT",
                    version: item.rowVersion,
                  }}
                  label="Edit the ticket"
                  title="Edit the ticket"
                  submitLabel="Save changes"
                  testId="edit-ticket"
                >
                  <label className="field-label" htmlFor="ticket-title">
                    Subject
                  </label>
                  <input id="ticket-title" name="title" defaultValue={item.title} maxLength={200} className="field-input" required />
                  <label className="field-label" htmlFor="ticket-description">
                    Description
                  </label>
                  <textarea id="ticket-description" name="description" defaultValue={item.description ?? ""} rows={3} className="field-input h-auto py-2" />
                  <label className="field-label" htmlFor="ticket-priority">
                    Priority
                  </label>
                  <select id="ticket-priority" name="priority" defaultValue={item.priority ?? "NORMAL"} className="field-input">
                    {TICKET_PRIORITIES.map((value) => (
                      <option key={value} value={value}>
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <label className="field-label" htmlFor="ticket-required">
                    Required by
                  </label>
                  <DateField id="ticket-required" name="requiredOn" label="Required by" defaultValue={item.dueDay ?? ""} />
                </ControlActionForm>
                {!item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "REASSIGN",
                      version: item.rowVersion,
                    }}
                    label="Assign or reassign"
                    title="Assign the ticket"
                    submitLabel="Assign"
                    testId="ticket-assign"
                  >
                    <PersonSelect name="userId" options={people} defaultValue={item.assigneeId} ariaLabel="Assignee" placeholder="Assignee…" required />
                    <label className="field-label" htmlFor="ticket-target">
                      Target date
                    </label>
                    <DateField id="ticket-target" name="targetDay" label="Target date" required />
                  </ControlActionForm>
                )}
                {!item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "FORCE_STATUS",
                      version: item.rowVersion,
                    }}
                    label="Force the status"
                    title="Set the ticket's status"
                    submitLabel="Set status"
                    testId="ticket-status"
                  >
                    <label className="field-label" htmlFor="ticket-status">
                      New status
                    </label>
                    <select id="ticket-status" name="status" className="field-input" required>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </ControlActionForm>
                )}
                {item.final && (
                  <ControlActionForm
                    kind="override"
                    hidden={{
                      ...hidden,
                      action: "REOPEN",
                      version: item.rowVersion,
                    }}
                    label="Reopen"
                    title="Reopen the ticket"
                    submitLabel="Reopen"
                    testId="ticket-reopen"
                  />
                )}
              </div>
            )}
          </section>
        )}

        {!locked && (
          <section className="card space-y-4 px-5 py-4" aria-labelledby="archive-heading">
            <h2 id="archive-heading" className="font-semibold">
              Archive or delete
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {item.archivedAt ? (
                <ControlActionForm
                  kind="archive"
                  hidden={{ ...hidden, mode: "unarchive" }}
                  label="Un-archive"
                  title="Un-archive (it can be changed again)"
                  submitLabel="Un-archive"
                  testId="unarchive"
                />
              ) : item.final ? (
                <ControlActionForm
                  kind="archive"
                  hidden={{ ...hidden, mode: "archive" }}
                  label="Archive"
                  title="Archive: read-only for everyone, still visible under Archived"
                  submitLabel="Archive"
                  testId="archive"
                />
              ) : (
                <p className="text-label text-ink-muted">Archive is for finished items: force its status first if it should end now.</p>
              )}
              {!item.archivedAt && (
                <ControlActionForm
                  kind="bin"
                  hidden={hidden}
                  label="Move to Deleted items"
                  title={`Move ${item.number} to Deleted items?`}
                  note={
                    kind === "REQUEST"
                      ? "It disappears from every screen, list, count and search for everyone. An open request is cancelled and the people waiting on it are told. You can restore it from Deleted items; after 30 days you can delete it permanently."
                      : "It disappears from every screen, list, count and search for everyone, with its subtasks. You can restore it from Deleted items; after 30 days you can delete it permanently."
                  }
                  submitLabel="Move to Deleted items"
                  danger
                  testId="bin"
                />
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
