"use client";

import { Link2, Lock, Plus, Share2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { followAction, memberAction, privacyAction } from "@/app/users/work/actions";
import { initials } from "@/features/ui/Display";
import { useToast } from "@/features/ui/Toast";
import { useWorkCall } from "@/features/work/client";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { PRIVACY, PRIVACY_LABEL, PROJECT_ROLE_LABEL, PROJECT_ROLES, type ProjectRole } from "@/server/work/access";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { Dialog } from "@/features/ui/Dialog";

// D-220 (owner's screenshot: Asana's Share dialog): share a project or a
// task from its own screen. Project: invite people or a department with a
// role, who can see it (access settings), who has access with their roles,
// copy the link. Task: add collaborators (followers), who can see it, copy
// the link. Every change is checked again on the server.

function copy(path: string, toast: ReturnType<typeof useToast>, what: string) {
  const link = `${window.location.origin}${path}`;
  void copyText(link).then((done) => toast(done ? { tone: "success", title: `${what} link copied.` } : { tone: "error", title: `${COPY_BLOCKED} ${link}` }));
}

const Dot = ({ name }: { name: string }) => (
  <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-700">
    {initials(name)}
  </span>
);

export function ProjectShareButton(props: {
  projectId: number;
  name: string;
  privacy: string;
  departmentId: number | null;
  departments: { id: number; name: string }[];
  members: { type: "USER" | "DEPARTMENT"; id: number; name: string; role: ProjectRole }[];
  people: { id: number; label: string }[];
  canShare: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary btn-compact inline-flex items-center gap-1" data-testid="share-project">
        <Share2 aria-hidden="true" className="h-4 w-4" /> Share
      </button>
      {open && <ProjectShareDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProjectShareDialog({ projectId, name, privacy, departmentId, departments, members, people, canShare, canManage, onClose }: Parameters<typeof ProjectShareButton>[0] & { onClose: () => void }) {
  const toast = useToast();
  const { call, pending } = useWorkCall();
  const [who, setWho] = useState("");
  const [role, setRole] = useState<ProjectRole>("EDITOR");
  const [access, setAccess] = useState(privacy);
  const [department, setDepartment] = useState<number | "">(departmentId ?? "");
  const roles = PROJECT_ROLES.filter((item) => canManage || item !== "OWNER");
  const send = (member: string, value: string) => {
    const data = new FormData();
    data.set("projectId", String(projectId));
    data.set("member", member);
    data.set("role", value);
    return call(() => memberAction(null, data));
  };
  return (
    // v1.89.0 (D-423, UIQA-CON-18): the shared Dialog (title 18, ×, motion, focus back, footer on the right).
    <Dialog
      open
      onClose={onClose}
      title={`Share ${name}`}
      description={
        <Link href={`/users/work/projects/${projectId}/settings#permissions`} className="hover:text-ink">
          Project permissions
        </Link>
      }
      size="lg"
      flush
      testId="share-dialog"
      footer={
        <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => copy(`/users/work/projects/${projectId}`, toast, "Project")}>
          <Link2 aria-hidden="true" className="h-4 w-4" /> Copy project link
        </button>
      }
    >
      {canShare && (
        <section className="space-y-2 border-b border-line px-6 py-4" aria-labelledby="invite-title">
          <h3 id="invite-title" className="font-semibold">
            Invite
          </h3>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center rounded-md border border-line-strong focus-within:border-primary-600">
              <select aria-label="Add people or a department" value={who} onChange={(event) => setWho(event.target.value)} className="h-10 min-w-0 flex-1 bg-transparent px-3 text-body focus:outline-none">
                <option value="">Add people or a department…</option>
                <optgroup label="People">
                  {people
                    .filter((person) => !members.some((member) => member.type === "USER" && member.id === person.id))
                    .map((person) => (
                      <option key={person.id} value={`USER:${person.id}`}>
                        {person.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Departments">
                  {departments
                    .filter((item) => !members.some((member) => member.type === "DEPARTMENT" && member.id === item.id))
                    .map((item) => (
                      <option key={item.id} value={`DEPARTMENT:${item.id}`}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              </select>
              <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as ProjectRole)} className="h-10 bg-transparent px-2 text-label font-medium focus:outline-none">
                {roles.map((item) => (
                  <option key={item} value={item}>
                    {PROJECT_ROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" disabled={!who || pending} onClick={() => void send(who, role).then((result) => result?.ok && setWho(""))} className="btn-primary">
              Invite
            </button>
          </div>
          <p className="text-caption text-ink-muted">People you add are told in the app and by email.</p>
        </section>
      )}
      <section className="space-y-3 px-6 py-4" aria-labelledby="access-title">
        <h3 id="access-title" className="font-semibold">
          Access settings
        </h3>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Who can see this project"
            value={access}
            disabled={!canManage}
            onChange={(event) => {
              const next = event.target.value;
              setAccess(next);
              if (next !== "DEPARTMENT") void call(() => privacyAction(projectId, next, null));
              else if (department !== "") void call(() => privacyAction(projectId, next, Number(department)));
            }}
            className="field-input flex-1"
          >
            {PRIVACY.map((item) => (
              <option key={item} value={item}>
                {item === "PRIVATE" ? "🔒 " : ""}
                {PRIVACY_LABEL[item]}
              </option>
            ))}
          </select>
          {access === "DEPARTMENT" && (
            <select
              aria-label="Department"
              value={department}
              disabled={!canManage}
              onChange={(event) => {
                const next = event.target.value ? Number(event.target.value) : "";
                setDepartment(next);
                if (next !== "") void call(() => privacyAction(projectId, "DEPARTMENT", next));
              }}
              className="field-input w-56"
            >
              <option value="">Choose a department…</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {!canManage && <p className="text-caption text-ink-muted">Only the project&apos;s owners change who can see it.</p>}
        <div className="flex items-center justify-between pt-2">
          <h3 className="font-semibold">Who has access</h3>
          <Link href="/users/notifications/settings" className="link text-label">
            Manage notifications
          </Link>
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Who has access">
          {members.map((member) => (
            <li key={`${member.type}:${member.id}`} className="flex items-center gap-3 py-1.5">
              {member.type === "USER" ? <Dot name={member.name} /> : <Users aria-hidden="true" className="h-8 w-8 rounded-full bg-surface-muted p-1.5 text-ink-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{member.name}</span>
                {member.type === "DEPARTMENT" && <span className="text-caption text-ink-muted">Everyone in this department</span>}
              </span>
              {canShare && (canManage || member.role !== "OWNER") ? (
                <select aria-label={`Role of ${member.name}`} value={member.role} onChange={(event) => void send(`${member.type}:${member.id}`, event.target.value)} className="rounded bg-transparent text-label font-medium">
                  {roles
                    .filter((item) => member.type === "USER" || item !== "OWNER")
                    .map((item) => (
                      <option key={item} value={item}>
                        {item === "OWNER" ? "Project admin" : PROJECT_ROLE_LABEL[item]}
                      </option>
                    ))}
                  <option value="REMOVE">Remove</option>
                </select>
              ) : (
                <span className="text-label text-ink-muted">{member.role === "OWNER" ? "Project admin" : PROJECT_ROLE_LABEL[member.role]}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}

export function TaskShareButton(props: { taskId: number; title: string; followers: { id: number; name: string }[]; people: { id: number; label: string }[]; visibility: string; canAdd: boolean; compact?: boolean; collaborators?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* v1.62.0 (D-368): the task pane's "Add or remove collaborators" button opens the same dialog. */}
      {props.collaborators ? (
        // v1.75.0 (D-399, owner's pane screenshot): the collaborators' avatars and a "+".
        <button type="button" onClick={() => setOpen(true)} aria-label={`Collaborators: ${props.followers.length}. Add or remove collaborators`} title={props.followers.map((person) => person.name).join(", ") || "Collaborators"} className="inline-flex h-8 items-center gap-1 rounded-full px-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="pane-collaborators">
          <span aria-hidden="true" className="flex -space-x-1.5">
            {props.followers.slice(0, 3).map((person) => (
              <span key={person.id} className="grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-primary-50 text-[length:calc(10px*var(--text-scale,1))] font-semibold text-primary-700">
                {person.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0]?.toUpperCase() ?? "")
                  .join("")}
              </span>
            ))}
            {props.followers.length === 0 && <Users className="h-4 w-4" />}
          </span>
          {props.followers.length > 3 && <span aria-hidden="true" className="text-caption tabular-nums">+{props.followers.length - 3}</span>}
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-line-strong">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={props.compact ? "inline-flex items-center gap-1 rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink" : "btn-secondary btn-compact inline-flex items-center gap-1"} data-testid="share-task">
          <Share2 aria-hidden="true" className="h-4 w-4" /> Share
        </button>
      )}
      {open && <TaskShareDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function TaskShareDialog({ taskId, title, followers, people, visibility, canAdd, onClose }: Parameters<typeof TaskShareButton>[0] & { onClose: () => void }) {
  const toast = useToast();
  const { call, pending } = useWorkCall();
  const [who, setWho] = useState("");
  return (
    // v1.89.0 (D-423, UIQA-CON-18): the shared Dialog.
    <Dialog
      open
      onClose={onClose}
      title={`Share ${title}`}
      size="md"
      flush
      testId="share-dialog"
      footer={
        <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => copy(`/users/tasks/${taskId}`, toast, "Task")}>
          <Link2 aria-hidden="true" className="h-4 w-4" /> Copy task link
        </button>
      }
    >
      {canAdd && (
        <section className="space-y-2 border-b border-line px-6 py-4">
          <h3 className="font-semibold">Add collaborators</h3>
          <div className="flex gap-2">
            <PersonSelect
              ariaLabel="Add a collaborator"
              options={people.filter((person) => !followers.some((item) => item.id === person.id))}
              value={who ? Number(who) : null}
              onChange={(id) => setWho(id === null ? "" : String(id))}
              emptyLabel="Add people…"
              compact
              floating
              className="flex-1"
            />
            <button type="button" disabled={!who || pending} onClick={() => void call(() => followAction(taskId, Number(who), true)).then((result) => result?.ok && setWho(""))} className="btn-primary">
              Add
            </button>
          </div>
          <p className="text-caption text-ink-muted">Collaborators can see the task and hear about comments and changes.</p>
        </section>
      )}
      <section className="space-y-2 px-6 py-4">
        <h3 className="font-semibold">Who can see it</h3>
        <p className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-label text-ink-muted">
          <Lock aria-hidden="true" className="h-4 w-4 shrink-0" /> {visibility}
        </p>
        <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label="Collaborators">
          {followers.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-1">
              <Dot name={person.name} />
              <span className="flex-1 truncate">{person.name}</span>
              {canAdd && (
                <button type="button" className="text-label text-ink-muted hover:text-danger-600" onClick={() => void call(() => followAction(taskId, person.id, false))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}
