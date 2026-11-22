import "server-only";
import type { TaskRecord } from "@/lib/db/repositories/tasks.repository";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { personLabel } from "@/lib/people/label";
import { assignGroup, ancestors, likesOf, listComments, listDependencies, listFollowers, listSections, listSubtasks, listTaskItems, listTaskProjects, listVisibleProjects } from "@/lib/db/repositories/work.repository";
import { OPEN_STATUSES } from "@/server/modules/task-rules";
import { indiaDateTimeText } from "@/server/modules/settings";
import { loadSetting } from "@/server/work/holiday-store";
import { parseRecurrenceSettings, RECURRENCE_SETTINGS_KEY } from "@/server/work/more-rules";
import { recurrenceOf } from "@/server/work/service-more";
import { rightsOn, workViewer } from "@/server/work/task-access";
import type { PanelData } from "@/features/work/TaskWorkPanel";
import type { CommentView } from "@/features/work/CommentThread";
import { featureOn } from "@/server/settings/features";
import { reactionRows } from "@/lib/db/repositories/pm.repository";
import { groupReactions } from "@/server/work/pm-rules";
import { cellsFor, projectFieldsFor } from "@/server/work/fields-service";

// D-215 / D-219: everything the task page and the task panel show beside the
// task's own details (projects, subtasks, waiting for, tags, followers,
// likes, repeat, fields, comments), with what the person may do.
export async function taskWorkView(task: TaskRecord, user: { id: number; roles: readonly string[] }) {
  const viewer = await workViewer(user);
  const [rights, chain, links, subtasks, deps, followers, likes, comments, choices, workItem, people, recurrence, recurrenceSettings] = await Promise.all([
    rightsOn(task, viewer),
    ancestors(task.id),
    listTaskProjects(task.id),
    listSubtasks(task.id),
    listDependencies(task.id),
    listFollowers(task.id),
    likesOf("TASK", task.id),
    listComments(task.id, user.id),
    listVisibleProjects(viewer),
    listTaskItems(["t.id = ?"], [task.id], "t.id", 1),
    listPeopleFacts(),
    recurrenceOf(task.id),
    loadSetting(RECURRENCE_SETTINGS_KEY).then(parseRecurrenceSettings),
  ]);
  // v1.64.0 (D-371): each project's fields with this task's values as typed cells.
  const actor = { id: user.id, name: "", roles: user.roles };
  const [linkSections, linkFields] = await Promise.all([Promise.all(links.map((link) => listSections(link.projectId))), Promise.all(links.map((link) => projectFieldsFor(link.projectId, actor)))]);
  const allDefs = [...new Map(linkFields.flatMap((item) => item?.defs ?? []).map((field) => [field.id, field])).values()];
  const ownCells = (await cellsFor([task.id], allDefs, viewer))[task.id] ?? {};
  const planning = await featureOn("pm_planning", user).catch(() => false);
  const panel: PanelData = {
    taskId: task.id,
    taskNo: task.taskNo,
    title: task.title,
    open: OPEN_STATUSES.includes(task.status),
    isMilestone: task.isMilestone,
    startsOn: task.startsOn ?? "",
    meId: user.id,
    canEdit: rights.edit,
    // D-222: planning (dates, tags, waiting for, fields, repeat) and details (milestone…) per the ad hoc rule.
    canProgress: rights.planning,
    canDetails: rights.details,
    adhoc: rights.adhoc,
    canComment: rights.comment,
    deleted: Boolean(task.deletedAt),
    parent: chain.at(-1) ?? null,
    links: links.map((link, index) => ({ projectId: link.projectId, projectName: link.projectName, color: link.color, sectionId: link.sectionId, sections: linkSections[index]!.map((section) => ({ id: section.id, name: section.name })) })),
    projectChoices: choices.map((project) => ({ id: project.id, name: project.name })),
    subtasks: subtasks.map((item) => ({ id: item.id, title: item.title, status: item.status, assigneeName: item.assigneeName, dueAt: item.dueAt?.toISOString() ?? null, subtasks: item.subtasks })),
    // v1.65.0 (D-373): each link's type and lag, and the other task's due date.
    blockedBy: deps.blockedBy.map((item) => ({ ...item, dueAt: item.dueAt?.toISOString() ?? null })),
    blocking: deps.blocking.map((item) => ({ ...item, dueAt: item.dueAt?.toISOString() ?? null })),
    tags: workItem.items[0]?.tags.map((tag) => ({ id: tag.id, name: tag.name })) ?? [],
    followers,
    // v1.52.1: pickers show "Name - code" with the department; mentions keep the name.
    people: people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined, name: person.name })),
    likes,
    nowIso: new Date().toISOString(),
    recurrence,
    recurrenceOn: recurrenceSettings.enabled,
    fields: links.map((link, index) => ({ projectId: link.projectId, fields: linkFields[index]?.views ?? [], values: ownCells })),
    planning,
  };
  // v1.62.0 (D-368): emoji reactions beside Like ("pm_foundations").
  const pmOn = await featureOn("pm_foundations", user).catch(() => false);
  const reactions = pmOn ? groupReactions(await reactionRows(comments.map((comment) => comment.id), user.id)) : null;
  const commentViews: CommentView[] = comments.map((comment) => ({
    id: comment.id,
    parentCommentId: comment.parentCommentId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
    isPinned: comment.isPinned,
    edited: comment.editedAt !== null,
    deleted: comment.deletedAt !== null,
    when: indiaDateTimeText(comment.createdAt),
    likes: comment.likes,
    likedByMe: comment.likedByMe,
    reactions: reactions ? (reactions.get(comment.id) ?? []) : undefined,
  }));
  // D-222: the other people an ad hoc task was given to (their own copies).
  const group = await assignGroup(task.id);
  return { panel, comments: commentViews, rights, chain, links, viewer, people, group, pmOn };
}
