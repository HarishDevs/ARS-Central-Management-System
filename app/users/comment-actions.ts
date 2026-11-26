"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { getActionContext } from "@/lib/http/request-context";
import { changeComment, commentVersions, type CommentActor } from "@/server/comments/change";
import type { CommentTarget } from "@/lib/db/repositories/comment-versions.repository";
import { logError } from "@/lib/logging/logger";
import { hasModule } from "@/server/modules/modules";
import { collaboratesOnRequestComment } from "@/lib/db/repositories/collaborating.repository";
import type { ActionResult } from "@/lib/http/action-result";

// v1.60.0 (D-365, owner: "i want edit option in all the comments"): edit or
// delete a comment on a request, ticket or task, and read its earlier versions.
const TARGETS: readonly CommentTarget[] = ["REQUEST", "TICKET", "TASK"];
const PATHS: Record<CommentTarget, string> = { REQUEST: "/users/requests/[id]", TICKET: "/users/tickets/[id]", TASK: "/users/tasks/[id]" };

async function actor(target: CommentTarget, commentId?: number): Promise<CommentActor | null> {
  try {
    const session = await requireApiArea("users");
    if (target === "TASK" && !(await featureOn("tasks", session.user))) return null;
    // v1.91.0 (D-434): a request comment without the Approvals module only on a
    // request the person is still an active collaborator on (their Commenter access).
    if (target === "REQUEST" && session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "APPROVAL") && !(commentId !== undefined && (await collaboratesOnRequestComment(commentId, session.user.id)))) return null;
    const { ipAddress } = await getActionContext();
    return { id: session.user.id, name: session.user.name, roles: session.user.roles, sessionId: session.sessionId, ipAddress, modules: session.user.modules };
  } catch {
    return null;
  }
}
const valid = (target: unknown, id: unknown): target is CommentTarget => TARGETS.includes(target as CommentTarget) && typeof id === "number" && Number.isInteger(id) && id > 0;

export async function changeCommentAction(target: CommentTarget, commentId: number, change: { body?: string; delete?: boolean }): Promise<ActionResult> {
  if (!valid(target, commentId)) return { ok: false, message: "Not found." };
  const me = await actor(target, commentId);
  if (!me) return { ok: false, message: "Not found." };
  try {
    const result = await changeComment(target, commentId, change.delete ? { delete: true } : { body: String(change.body ?? "") }, me);
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: { body: result.message } };
    revalidatePath(PATHS[target], "page");
    return { ok: true, message: result.message ?? "Saved." };
  } catch (error) {
    logError("changeCommentAction failed", error, { target, commentId });
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

export async function commentVersionsAction(target: CommentTarget, commentId: number): Promise<{ ok: true; versions: { id: number; body: string; kind: "EDIT" | "DELETE"; by: string; at: string }[] } | { ok: false; message: string }> {
  if (!valid(target, commentId)) return { ok: false, message: "Not found." };
  const me = await actor(target, commentId);
  if (!me) return { ok: false, message: "Not found." };
  try {
    const result = await commentVersions(target, commentId, me);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, versions: result.value.map((version) => ({ id: version.id, body: version.body, kind: version.kind, by: version.changedByName, at: version.changedAt.toISOString() })) };
  } catch (error) {
    logError("commentVersionsAction failed", error, { target, commentId });
    return { ok: false, message: "Couldn't load the earlier versions." };
  }
}
