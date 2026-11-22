import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as collab from "@/lib/db/repositories/pm-collab.repository";
import { afterResponse } from "@/lib/http/after-response";
import { personLabel } from "@/lib/people/label";
import { deliverOutbox } from "@/server/approvals/service";
import { filesFrom, prepareFiles } from "@/server/attachments/service";
import { MAX_FILES_PER_UPLOAD } from "@/server/attachments/files";
import { discardStaged, insertRecordFiles, stageFiles, type StagedFile } from "@/server/modules/files";
import { projectMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import { overLimit } from "@/server/security/limits";
import { effectiveProjectRole, projectAbilities, type ProjectRole } from "@/server/work/access";
import { parseModuleSet } from "@/server/modules/modules";
import { cleanBody, cleanPageBody, cleanPageTitle, cleanSubject, messageMentions, messageRecipients, newMentions, taskLinkIds, versionsToDrop, type FileItem } from "@/server/work/collab-rules";
import { groupReactions, isReaction, type ReactionCount } from "@/server/work/pm-rules";
import { workViewer } from "@/server/work/task-access";
import { extrasOn } from "@/server/work/templates";

// v1.71.0 (D-384, PM phase E part 2): a project's Files, Messages and Page
// tabs. Behind "pm_extras". Who (deny by default; outsiders get "Not found."):
// - Files: everyone who sees the project, only files on tasks they may see
//   (visibleTaskClause) and on the project's messages.
// - Messages: everyone who sees the project reads; commenters and above write,
//   reply (one level) and react; the author and IT edit or delete (D-365:
//   every earlier text kept, shown to all readers).
// - Page: everyone who sees the project reads it and its versions; owners and
//   editors write it and restore a version (the newest 50 are kept).
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, fieldErrors });
const NOT_FOUND = "Not found.";
const isAdmin = (roles: readonly string[]) => roles.includes("IT_ADMIN") || roles.includes("SUPER_ADMIN");

async function send(ids: number[]) {
  if (ids.length) await afterResponse("project messages", () => deliverOutbox(ids));
}

// The project with the person's role (null: switch off, not visible, a template, deleted).
export async function projectAccess(projectId: number, actor: TaskActor) {
  if (!(await extrasOn(actor))) return null;
  const viewer = await workViewer(actor);
  if (viewer.projects === false) return null;
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return null;
  return { ...found, viewer, can: projectAbilities(found.role) };
}

// Which of these people may see the project (active, with Projects; role by the project's rules).
async function audience(projectId: number, ids: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const project = await repo.findProject(projectId);
  if (!project || project.deletedAt) return out;
  const members = await repo.listProjectMembers(projectId);
  const facts = repo.projectFacts(project, members);
  const [rows] = await getDbPool().query<(RowDataPacket & { id: number; codes: string | null; module_access: string | null })[]>(
    "SELECT u.id, u.module_access, (SELECT GROUP_CONCAT(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS codes FROM users u WHERE u.id IN (?) AND u.active = TRUE",
    [unique],
  );
  for (const row of rows) {
    const roles = (row.codes ?? "").split(",").filter(Boolean);
    const viewer = await workViewer({ id: Number(row.id), roles, modules: parseModuleSet(row.module_access) });
    if (viewer.projects !== false && effectiveProjectRole(facts, viewer)) out.add(Number(row.id));
  }
  return out;
}

export async function mentionPeople(): Promise<{ id: number; label: string; detail?: string; name: string }[]> {
  return (await listActiveUserOptions()).map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined, name: person.name }));
}

// ---- files --------------------------------------------------------------------------------
export async function loadProjectFiles(projectId: number, actor: TaskActor): Promise<Result<FileItem[]>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  return { ok: true, value: await collab.projectFiles(projectId, { ...found.viewer }) };
}

// May this person open a file on a project message? (the download route)
export async function messageFileVisible(messageId: number, actor: TaskActor): Promise<boolean> {
  const message = await collab.findMessage(messageId);
  if (!message || message.deleted) return false;
  if (message.parentId) {
    const thread = await collab.findMessage(message.parentId);
    if (!thread || thread.deleted) return false;
  }
  return Boolean(await projectAccess(message.projectId, actor));
}

// ---- messages -----------------------------------------------------------------------------
export interface MessageView {
  id: number;
  parentId: number | null;
  authorId: number;
  authorName: string;
  subject: string | null;
  body: string;
  createdAt: string;
  lastActivity: string;
  edited: boolean;
  deleted: boolean;
  replies: number;
  reactions: ReactionCount[];
  files: { id: number; name: string; contentType: string; size: number }[];
  canChange: boolean;
}
export interface MessagesView {
  threads: MessageView[];
  replies: MessageView[];
  canWrite: boolean;
  meId: number;
}
export async function loadMessages(projectId: number, actor: TaskActor): Promise<Result<MessagesView>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const threads = await collab.listThreads(projectId);
  const replies = await collab.listReplies(threads.map((thread) => thread.id));
  const all = [...threads, ...replies];
  const live = all.filter((message) => !message.deleted).map((message) => message.id);
  const [reactions, files] = await Promise.all([collab.messageReactions(live, actor.id), collab.messageFiles(live)]);
  const grouped = groupReactions(reactions);
  const admin = isAdmin(actor.roles);
  const view = (message: collab.MessageRow): MessageView => ({
    id: message.id,
    parentId: message.parentId,
    authorId: message.authorId,
    authorName: message.authorName,
    subject: message.deleted ? null : message.subject,
    body: message.deleted ? "" : message.body,
    createdAt: message.createdAt.toISOString(),
    lastActivity: message.lastActivity.toISOString(),
    edited: message.edited,
    deleted: message.deleted,
    replies: message.replies,
    reactions: message.deleted ? [] : (grouped.get(message.id) ?? []),
    files: message.deleted ? [] : files.filter((file) => file.messageId === message.id).map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
    canChange: !message.deleted && (message.authorId === actor.id || admin),
  });
  return { ok: true, value: { threads: threads.map(view), replies: replies.map(view), canWrite: found.can.comment, meId: actor.id } };
}

// Post a thread (subject + body) or a reply (parentId), with files (the upload rules of tasks).
export async function postMessage(projectId: number, formData: FormData, actor: TaskActor): Promise<Result<{ id: number; threadId: number }>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.comment) return fail("Only the project's commenters, editors and owners can write messages.");
  if (found.project.archivedAt) return fail("This project is archived; its messages can be read but not added to.");
  const parentRaw = formData.get("parentId");
  const parentId = typeof parentRaw === "string" && /^\d{1,10}$/.test(parentRaw) ? Number(parentRaw) : null;
  let thread: collab.MessageRow | null = null;
  if (parentId) {
    thread = await collab.findMessage(parentId);
    if (!thread || thread.projectId !== projectId || thread.deleted) return fail(NOT_FOUND);
    if (thread.parentId) return fail("Reply to the conversation, not to a reply."); // one level
  }
  const subject = parentId ? null : cleanSubject(formData.get("subject"));
  if (!parentId && !subject) return fail("Give the message a subject (up to 150 characters).", { subject: "Give the message a subject (up to 150 characters)." });
  const body = cleanBody(formData.get("body"));
  if (!body) return fail("Write a message (up to 10,000 characters).", { body: "Write a message (up to 10,000 characters)." });
  if (await overLimit(`pm-message:${actor.id}`, 20)) return fail("At most 20 messages a minute. Wait a minute and try again.");
  const uploads = filesFrom(formData);
  if (uploads.length > MAX_FILES_PER_UPLOAD) return fail(`Attach at most ${MAX_FILES_PER_UPLOAD} files at a time.`);
  const prepared = await prepareFiles(uploads);
  if (!prepared.ok) return fail(prepared.message, { attachments: prepared.message });
  const staged: StagedFile[] = await stageFiles(prepared.files);
  // Who is told: on a new thread the project's members, on a reply the
  // thread's people; plus mentions of people who may see the project.
  const members = found.members.filter((member) => member.type === "USER").map((member) => member.id);
  const threadPeople = thread ? await collab.threadPeople(thread.id) : null;
  const mentioned = messageMentions(body);
  const allowed = await audience(projectId, [...members, ...(threadPeople ?? []), ...mentioned]);
  const who = messageRecipients({ authorId: actor.id, members, threadPeople, mentioned, mayView: (id) => allowed.has(id) });
  try {
    const outcome = await withTransaction(async (connection) => {
      const id = await collab.insertMessage({ projectId, parentId, authorId: actor.id, subject, body }, connection);
      if (staged.length) await insertRecordFiles("PROJECT_MESSAGE", id, staged, actor.id, "GENERAL", connection);
      await recordAudit({ actorUserId: actor.id, action: parentId ? "PROJECT_MESSAGE_REPLIED" : "PROJECT_MESSAGE_POSTED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId ?? null, ipAddress: actor.ipAddress ?? null, metadata: { messageId: id, threadId: parentId ?? id, files: staged.length, mentions: who.mentions.length } }, connection);
      const info = { id: projectId, name: found.project.name };
      const title = subject ?? thread?.subject ?? "a conversation";
      const outbox = await insertOutbox(
        null,
        [
          ...who.notify.map((person) => (parentId ? projectMessages.reply(info, person, actor.name, title, parentId) : projectMessages.posted(info, person, actor.name, title, id))),
          ...who.mentions.map((person) => projectMessages.mentioned(info, person, actor.name, title, parentId ?? id)),
        ],
        connection,
      );
      return { id, outbox };
    });
    await send(outcome.outbox);
    const skipped = who.cannotSee.length ? ` ${who.cannotSee.length === 1 ? "One person you mentioned can't" : `${who.cannotSee.length} people you mentioned can't`} see this project, so ${who.cannotSee.length === 1 ? "they weren't" : "they weren't"} told.` : "";
    return { ok: true, value: { id: outcome.id, threadId: parentId ?? outcome.id }, message: `${parentId ? "Reply sent." : "Message sent."}${skipped}` };
  } catch (error) {
    await discardStaged(staged);
    throw error;
  }
}

// Edit (subject for a thread, body) or delete: the author and IT; the old text is kept.
export async function changeMessage(messageId: number, change: { subject?: unknown; body?: unknown } | { delete: true }, actor: TaskActor): Promise<Result> {
  const peek = await collab.findMessage(messageId);
  if (!peek || peek.deleted) return fail(NOT_FOUND);
  const found = await projectAccess(peek.projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (peek.authorId !== actor.id && !isAdmin(actor.roles)) return fail("Only its writer and IT can change a message.");
  let next: { subject: string | null; body: string } | null = null;
  if (!("delete" in change)) {
    const subject = peek.parentId ? null : cleanSubject(change.subject ?? peek.subject);
    if (!peek.parentId && !subject) return fail("Give the message a subject (up to 150 characters).", { subject: "Give the message a subject (up to 150 characters)." });
    const body = cleanBody(change.body);
    if (!body) return fail("Write a message (up to 10,000 characters).", { body: "Write a message (up to 10,000 characters)." });
    next = { subject, body };
  }
  const outcome = await withTransaction(async (connection) => {
    const current = await collab.findMessage(messageId, connection, true);
    if (!current || current.deleted) return "gone" as const;
    if (next && current.body === next.body && current.subject === next.subject) return "same" as const;
    await collab.changeMessage(messageId, { subject: current.subject, body: current.body }, next ?? { delete: true }, actor.id, connection);
    await recordAudit({ actorUserId: actor.id, action: next ? "PROJECT_MESSAGE_EDITED" : "PROJECT_MESSAGE_DELETED", entityType: "PROJECT", entityId: current.projectId, sessionId: actor.sessionId ?? null, ipAddress: actor.ipAddress ?? null, metadata: { messageId, byAuthor: current.authorId === actor.id } }, connection);
    return "done" as const;
  });
  if (outcome === "gone") return fail(NOT_FOUND);
  return { ok: true, value: undefined, message: outcome === "same" ? "No change." : next ? "Message saved." : "Message deleted." };
}

export async function messageVersions(messageId: number, actor: TaskActor): Promise<Result<collab.MessageVersion[]>> {
  const message = await collab.findMessage(messageId);
  if (!message || !(await projectAccess(message.projectId, actor))) return fail(NOT_FOUND);
  return { ok: true, value: await collab.listMessageVersions(messageId) };
}

export async function reactToMessage(messageId: number, key: string, actor: TaskActor): Promise<Result<{ on: boolean }>> {
  if (!isReaction(key)) return fail("Choose a reaction.");
  const message = await collab.findMessage(messageId);
  if (!message || message.deleted) return fail(NOT_FOUND);
  const found = await projectAccess(message.projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.comment) return fail("Only the project's commenters, editors and owners can react.");
  const on = await collab.toggleMessageReaction(messageId, actor.id, key);
  return { ok: true, value: { on }, message: on ? "Reaction added." : "Reaction removed." };
}

// ---- page ---------------------------------------------------------------------------------
export interface PageView {
  title: string;
  body: string;
  rowVersion: number; // 0: never written
  updatedByName: string | null;
  updatedAt: string | null;
  canEdit: boolean;
  versions: { versionNo: number; title: string; size: number; restoredFrom: number | null; savedByName: string; savedAt: string }[];
  linked: { id: number; taskNo: string; title: string; status: string; dueAt: string | null; assigneeName: string }[];
  hiddenLinks: number; // links to tasks the viewer can't see
}
export async function loadPage(projectId: number, actor: TaskActor): Promise<Result<PageView>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const [page, versions] = await Promise.all([collab.findPage(projectId), collab.listPageVersions(projectId)]);
  const ids = taskLinkIds(page?.body ?? "");
  const linked = await collab.linkedTasks(ids, found.viewer);
  return {
    ok: true,
    value: {
      title: page?.title ?? "",
      body: page?.body ?? "",
      rowVersion: page?.rowVersion ?? 0,
      updatedByName: page?.updatedByName ?? null,
      updatedAt: page?.updatedAt.toISOString() ?? null,
      canEdit: found.can.edit,
      versions: versions.map((version) => ({ ...version, savedAt: version.savedAt.toISOString() })),
      linked: linked.map((task) => ({ ...task, dueAt: task.dueAt?.toISOString() ?? null })),
      hiddenLinks: ids.length - linked.length,
    },
  };
}

// Save (owners and editors). `rowVersion` is the version the writer started
// from: a newer one in between is refused (no silent overwrite).
export async function savePage(projectId: number, input: { title: unknown; body: unknown; rowVersion: unknown; restore?: unknown }, actor: TaskActor): Promise<Result<{ rowVersion: number }>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.edit) return fail("Only the project's owners and editors can change its page.");
  const base = typeof input.rowVersion === "number" && Number.isInteger(input.rowVersion) && input.rowVersion >= 0 ? input.rowVersion : null;
  if (base === null) return fail("Reload the page and try again.");
  let title: string | null;
  let body: string | null;
  let restoredFrom: number | null = null;
  if (input.restore !== undefined) {
    restoredFrom = typeof input.restore === "number" && Number.isInteger(input.restore) && input.restore > 0 ? input.restore : null;
    const version = restoredFrom ? await collab.findPageVersion(projectId, restoredFrom) : null;
    if (!version) return fail(NOT_FOUND);
    title = version.title;
    body = version.body;
  } else {
    title = cleanPageTitle(input.title);
    if (title === null) return fail("A title has at most 150 characters.", { title: "A title has at most 150 characters." });
    body = cleanPageBody(input.body);
    if (body === null) return fail("The page has at most 100,000 characters.", { body: "The page has at most 100,000 characters." });
  }
  const mentionedBefore: string[] = [];
  const outcome = await withTransaction(async (connection) => {
    await connection.query("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
    const current = await collab.findPage(projectId, connection, true);
    const currentVersion = current?.rowVersion ?? 0;
    if (currentVersion !== base) return { kind: "stale" as const, by: current?.updatedByName ?? "Someone" };
    if (current && current.title === title && current.body === body) return { kind: "same" as const, rowVersion: currentVersion };
    mentionedBefore.push(current?.body ?? "");
    const next = await collab.writePage(projectId, { title: title!, body: body!, restoredFrom }, current, actor.id, connection);
    await collab.dropPageVersions(projectId, versionsToDrop(await collab.pageVersionNumbers(projectId, connection)), connection);
    await recordAudit({ actorUserId: actor.id, action: restoredFrom ? "PROJECT_PAGE_RESTORED" : "PROJECT_PAGE_SAVED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId ?? null, ipAddress: actor.ipAddress ?? null, metadata: { version: next, restoredFrom } }, connection);
    return { kind: "done" as const, rowVersion: next };
  });
  if (outcome.kind === "stale") return fail(`${outcome.by} saved the page while you were editing. Copy your text, reload, and add it again.`);
  if (outcome.kind === "same") return { ok: true, value: { rowVersion: outcome.rowVersion }, message: "No change." };
  // People newly @mentioned (and able to see the project) are told.
  const fresh = newMentions(mentionedBefore[0] ?? "", body!).filter((id) => id !== actor.id);
  if (fresh.length) {
    const allowed = await audience(projectId, fresh);
    const ids = await insertOutbox(
      null,
      fresh.filter((id) => allowed.has(id)).map((person) => projectMessages.pageMention({ id: projectId, name: found.project.name }, person, actor.name)),
      getDbPool(),
    );
    await send(ids);
  }
  return { ok: true, value: { rowVersion: outcome.rowVersion }, message: restoredFrom ? `Version ${restoredFrom} restored.` : "Page saved." };
}

export async function pageVersion(projectId: number, versionNo: number, actor: TaskActor): Promise<Result<{ title: string; body: string }>> {
  const found = await projectAccess(projectId, actor);
  if (!found) return fail(NOT_FOUND);
  const version = await collab.findPageVersion(projectId, versionNo);
  return version ? { ok: true, value: version } : fail(NOT_FOUND);
}

export type { ProjectRole };
