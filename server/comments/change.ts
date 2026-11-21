import "server-only";
import { findRequest, isParticipant } from "@/lib/db/repositories/approvals.repository";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { applyCommentChange, listCommentVersions, lockCommentBody, type CommentTarget, type CommentVersion } from "@/lib/db/repositories/comment-versions.repository";
import { withTransaction } from "@/lib/db/transaction";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { loadTicketFor } from "@/server/tickets/service";
import { changeComment as changeTaskComment, taskCommentVersions } from "@/server/work/service";

// v1.60.0 (D-365, owner: "i want edit option in all the comments"; answers:
// keep every version, the author and IT admins, no time limit, edit and
// delete). One entry point for request comments, ticket remarks and task
// comments. Every earlier text is kept in comment_versions.
export type CommentActor = { id: number; roles: readonly string[]; modules?: readonly string[]; name?: string; sessionId?: string | null; ipAddress?: string | null };
export type CommentChange = { body: string } | { delete: true };
export type CommentResult<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string };

const NOT_FOUND = "Not found.";
export const isCommentAdmin = (roles: readonly string[]) => roles.includes("IT_ADMIN") || roles.includes("SUPER_ADMIN");
// The author and IT admins may edit or delete (owner, 21 Nov 2026).
export const mayChangeComment = (authorId: number, actor: { id: number; roles: readonly string[] }) => authorId === actor.id || isCommentAdmin(actor.roles);
const LIMIT: Record<CommentTarget, number> = { REQUEST: 2000, TICKET: 4000, TASK: 4000 };

// May this person see the comment's request / ticket (and an internal remark)?
async function seesParent(target: "REQUEST" | "TICKET", parentId: number, internal: boolean, actor: CommentActor): Promise<boolean> {
  if (target === "REQUEST") {
    const request = await findRequest(parentId);
    return Boolean(request && (request.requesterId === actor.id || isCommentAdmin(actor.roles) || (await isParticipant(parentId, actor.id))));
  }
  const loaded = await loadTicketFor(parentId, actor);
  return Boolean(loaded && (!internal || loaded.internal));
}

export async function changeComment(target: CommentTarget, commentId: number, change: CommentChange, actor: CommentActor): Promise<CommentResult> {
  if (target === "TASK") {
    const result = await changeTaskComment(commentId, "body" in change ? { body: change.body } : { delete: true }, { ...actor, name: actor.name ?? "", sessionId: actor.sessionId ?? null } as Parameters<typeof changeTaskComment>[2]);
    return result.ok ? { ok: true, value: undefined, message: "body" in change ? "Comment saved." : "Comment deleted." } : { ok: false, message: result.message };
  }
  const text = "body" in change ? change.body.trim() : "";
  if ("body" in change && (text.length < 1 || text.length > LIMIT[target])) return { ok: false, message: `Write 1 to ${LIMIT[target].toLocaleString("en-IN")} characters.` };
  const peek = await lockCommentBody(target, commentId, getDbPool());
  if (!peek || peek.deleted || !(await seesParent(target, peek.parentId, peek.internal, actor))) return { ok: false, message: NOT_FOUND };
  if (!mayChangeComment(peek.authorId, actor)) return { ok: false, message: "Only its author and IT can change a comment." };
  const outcome = await withTransaction(async (connection: Queryable) => {
    const current = await lockCommentBody(target, commentId, connection);
    if (!current || current.deleted) return "gone" as const;
    if ("body" in change && current.body === text) return "same" as const;
    await applyCommentChange(target, commentId, current.body, "body" in change ? { body: text } : { delete: true }, actor.id, connection);
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `${target}_COMMENT_${"body" in change ? "EDITED" : "DELETED"}`,
        entityType: target,
        entityId: current.parentId,
        sessionId: actor.sessionId ?? null,
        ipAddress: actor.ipAddress ?? null,
        metadata: { commentId, byAuthor: current.authorId === actor.id },
      },
      connection,
    );
    return "done" as const;
  });
  if (outcome === "gone") return { ok: false, message: NOT_FOUND };
  return { ok: true, value: undefined, message: outcome === "same" ? "No change." : "body" in change ? "Comment saved." : "Comment deleted." };
}

// The earlier texts, for anyone who can see the comment.
export async function commentVersions(target: CommentTarget, commentId: number, actor: CommentActor): Promise<CommentResult<CommentVersion[]>> {
  if (target === "TASK") {
    const allowed = await taskCommentVersions(commentId, { ...actor, name: actor.name ?? "", sessionId: actor.sessionId ?? null } as Parameters<typeof taskCommentVersions>[1]);
    return allowed ? { ok: true, value: await listCommentVersions("TASK", commentId) } : { ok: false, message: NOT_FOUND };
  }
  const peek = await lockCommentBody(target, commentId, getDbPool());
  if (!peek || !(await seesParent(target, peek.parentId, peek.internal, actor))) return { ok: false, message: NOT_FOUND };
  return { ok: true, value: await listCommentVersions(target, commentId) };
}
