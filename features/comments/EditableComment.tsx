"use client";

import { useState } from "react";
import { changeCommentAction, commentVersionsAction } from "@/app/users/comment-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { RichEditor } from "@/features/ui/RichEditor";
import { RichText } from "@/features/work/RichText";
import { useWorkCall } from "@/features/work/client";

// v1.60.0 (D-365, owner: "i want edit option in all the comments"; answers:
// keep every version, the author and IT admins, no time limit, edit and
// delete). Shared by request comments, ticket remarks and task comments.
export type CommentTargetName = "REQUEST" | "TICKET" | "TASK";
type Version = { id: number; body: string; kind: "EDIT" | "DELETE"; by: string; at: string };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// "(edited) · Show edits": the earlier texts, oldest first, for anyone who sees the comment.
export function ShowEdits({ target, commentId, deleted = false }: { target: CommentTargetName; commentId: number; deleted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [problem, setProblem] = useState("");
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (versions) return;
    const result = await commentVersionsAction(target, commentId);
    if (result.ok) setVersions(result.versions);
    else setProblem(result.message);
  };
  return (
    <>
      <button type="button" className="text-caption text-ink-muted underline-offset-2 hover:text-ink hover:underline" aria-expanded={open} onClick={() => void toggle()} data-testid="show-edits">
        {open ? "Hide earlier versions" : deleted ? "Show what it said" : "Show edits"}
      </button>
      {open && (
        <ol className="mt-1 w-full space-y-1 rounded-md border border-line bg-surface-muted px-3 py-2" aria-label="Earlier versions" data-testid="comment-versions">
          {problem && <li className="text-caption text-danger-600">{problem}</li>}
          {!problem && !versions && <li className="text-caption text-ink-muted">Loading…</li>}
          {versions?.length === 0 && <li className="text-caption text-ink-muted">No earlier versions.</li>}
          {versions?.map((version) => (
            <li key={version.id} className="text-label">
              <p className="text-caption text-ink-muted">
                {version.kind === "DELETE" ? "Deleted" : "Changed"} by {version.by} · {when(version.at)}. Before that it said:
              </p>
              <RichText text={version.body} className="text-ink-muted" />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// A request comment or ticket remark: its text, and Edit / Delete for its author and IT.
export function EditableComment({
  target,
  commentId,
  body,
  edited,
  deleted,
  canChange,
  maxLength,
  noun = "comment",
}: {
  target: CommentTargetName;
  commentId: number;
  body: string;
  edited: boolean;
  deleted: boolean;
  canChange: boolean;
  maxLength: number;
  noun?: "comment" | "remark";
}) {
  const { call, pending } = useWorkCall();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  if (deleted)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="comment-deleted">
        <p className="text-label italic text-ink-muted">This {noun} was deleted.</p>
        <ShowEdits target={target} commentId={commentId} deleted />
      </div>
    );
  return (
    <div data-testid="editable-comment">
      {editing ? (
        <form
          className="mt-1 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void call(() => changeCommentAction(target, commentId, { body: text })).then((result) => result?.ok && setEditing(false));
          }}
        >
          <RichEditor name="body" id={`edit-${target.toLowerCase()}-${commentId}`} label={`Edit ${noun}`} initialText={body} onText={setText} minHeight={72} maxLength={maxLength} autoFocus />
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !text.trim()} aria-busy={pending || undefined} className="btn-primary btn-compact">
              Save
            </button>
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => {
                setText(body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <RichText text={body} className="mt-0.5" />
      )}
      {(edited || (canChange && !editing)) && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-caption">
          {edited && <span className="text-ink-muted">(edited)</span>}
          {edited && <ShowEdits target={target} commentId={commentId} />}
          {canChange && !editing && (
            <>
              <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setEditing(true)} data-testid="comment-edit">
                Edit
              </button>
              <ConfirmButton
                title={`Delete this ${noun}?`}
                body={`It shows as deleted for everyone; what it said stays in its history.`}
                className="text-ink-muted hover:text-danger-600"
                onConfirm={() => call(() => changeCommentAction(target, commentId, { delete: true }))}
              >
                Delete
              </ConfirmButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}
