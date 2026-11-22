"use client";

import { ChevronDown, ChevronRight, Download, MessageSquarePlus, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/features/ui/Toast";
import { InlineLoading } from "@/features/ui/Spinner";
import { changeMessageAction, messageVersionsAction, postMessageAction, reactMessageAction } from "@/app/users/work/collab-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { RichEditor, type MentionPerson } from "@/features/ui/RichEditor";
import { RichText } from "@/features/work/RichText";
import { useWorkCall } from "@/features/work/client";
import { ReactionBar } from "@/features/work/CommentThread";
import { ACCEPT_ATTRIBUTE, formatSize } from "@/server/attachments/files";
import type { ReactionCount } from "@/server/work/pm-rules";

// v1.71.0 (D-384, PM phase E part 2, spec PROJECTS_VIEWS §10): the project's
// conversations. A thread has a subject and a formatted body (@mentions,
// files); replies are one level; reactions as on comments. The writer and IT
// edit or delete, every earlier text is kept ("Show edits"). Members hear of
// a new thread, the thread's people of a reply, and mentioned people always
// (when they can see the project).
export interface MessageItem {
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
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function MessagesTab({ projectId, projectName, threads, replies, canWrite, people, openThread }: { projectId: number; projectName: string; threads: MessageItem[]; replies: MessageItem[]; canWrite: boolean; people: MentionPerson[]; openThread: number | null }) {
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set(openThread ? [openThread] : threads[0] ? [threads[0].id] : []));
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="space-y-4" aria-labelledby="messages-heading" data-testid="messages-tab">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="messages-heading" className="font-semibold">
          Messages
        </h2>
        {canWrite && !composing && (
          <button type="button" className="btn-primary btn-compact ml-auto" onClick={() => setComposing(true)} data-testid="new-message">
            <MessageSquarePlus aria-hidden="true" className="h-4 w-4" /> Send a message to the project
          </button>
        )}
      </div>
      {composing && (
        <Composer
          projectId={projectId}
          projectName={projectName}
          people={people}
          onDone={(threadId) => {
            setComposing(false);
            // The new conversation opens.
            if (threadId) setOpen((current) => new Set([...current, threadId]));
          }}
        />
      )}
      {threads.length === 0 && !composing && (
        <div className="card px-5 py-8 text-center">
          <p className="font-semibold">Start a conversation</p>
          <p className="mt-1 text-label text-ink-muted">Send a message to kick off the project, talk about its work or share ideas with everyone on it.</p>
          {!canWrite && <p className="mt-2 text-caption text-ink-muted">You can read this project&apos;s messages but not write them.</p>}
        </div>
      )}
      <ol className="space-y-3" data-testid="message-threads">
        {threads.map((thread) => {
          const isOpen = open.has(thread.id);
          const list = replies.filter((reply) => reply.parentId === thread.id);
          return (
            <li key={thread.id} className="card" data-testid="message-thread" id={`thread-${thread.id}`}>
              <h3 className="m-0">
                <button type="button" aria-expanded={isOpen} aria-controls={`thread-body-${thread.id}`} onClick={() => toggle(thread.id)} className="flex w-full items-start gap-2 px-4 py-3 text-left">
                  {isOpen ? <ChevronDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{thread.deleted ? <span className="italic text-ink-muted">Deleted message</span> : thread.subject}</span>
                    <span className="block text-caption font-normal text-ink-muted">
                      {thread.authorName} · {when(thread.createdAt)} · {thread.replies} {thread.replies === 1 ? "reply" : "replies"}
                      {thread.replies > 0 ? ` · last ${when(thread.lastActivity)}` : ""}
                    </span>
                  </span>
                </button>
              </h3>
              {isOpen && (
                <div id={`thread-body-${thread.id}`} className="space-y-3 border-t border-line px-4 py-3">
                  <Message message={thread} canReact={canWrite} people={people} />
                  {list.length > 0 && (
                    <ol className="ml-4 space-y-3 border-l border-line pl-3" aria-label="Replies">
                      {list.map((reply) => (
                        <li key={reply.id}>
                          <Message message={reply} canReact={canWrite} people={people} />
                        </li>
                      ))}
                    </ol>
                  )}
                  {canWrite && !thread.deleted && <ReplyBox projectId={projectId} threadId={thread.id} people={people} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Files({ files }: { files: MessageItem["files"] }) {
  if (!files.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-2" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.id}>
          <a href={`/api/files/${file.id}`} download className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-caption hover:bg-surface-muted" aria-label={`Download ${file.name}`}>
            <Download aria-hidden="true" className="h-3.5 w-3.5" /> {file.name} <span className="text-ink-faint">({formatSize(file.size)})</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Message({ message, canReact, people }: { message: MessageItem; canReact: boolean; people: MentionPerson[] }) {
  const { call, pending } = useWorkCall();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(message.subject ?? "");
  const [text, setText] = useState(message.body);
  if (message.deleted)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="message-deleted">
        <p className="text-label italic text-ink-muted">This message was deleted.</p>
        <MessageEdits messageId={message.id} deleted />
      </div>
    );
  return (
    <article className="space-y-1" data-testid="message" aria-label={`Message from ${message.authorName}`}>
      <p className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
        <span className="font-semibold text-ink">{message.authorName}</span>
        <span>{when(message.createdAt)}</span>
        {message.edited && <span>(edited)</span>}
        {message.edited && <MessageEdits messageId={message.id} />}
      </p>
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void call(() => changeMessageAction(message.id, { subject: message.parentId ? undefined : subject, body: text })).then((result) => result?.ok && setEditing(false));
          }}
        >
          {message.parentId === null && (
            <label className="block text-caption text-ink-muted">
              Subject
              <input className="field-input mt-1" value={subject} maxLength={150} required onChange={(event) => setSubject(event.target.value)} />
            </label>
          )}
          <RichEditor name="body" label="Edit message" initialText={message.body} onText={setText} people={people} minHeight={72} maxLength={10000} autoFocus />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className="btn-primary btn-compact">
              Save
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <RichText text={message.body} className="text-body" />
      )}
      <Files files={message.files} />
      <div className="flex flex-wrap items-center gap-3 text-caption">
        {canReact ? <ReactionBar reactions={message.reactions} act={(key) => reactMessageAction(message.id, key)} /> : null}
        {message.canChange && !editing && (
          <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setEditing(true)} data-testid="message-edit">
            Edit
          </button>
        )}
        {message.canChange && (
          <ConfirmButton title="Delete this message?" body="It shows as deleted for everyone on the project; what it said stays in its history." className="text-ink-muted hover:text-danger-600" onConfirm={() => call(() => changeMessageAction(message.id, { delete: true }), { success: "Message deleted." })}>
            Delete
          </ConfirmButton>
        )}
      </div>
    </article>
  );
}

// The earlier texts of a message, oldest first (D-365, as on comments).
function MessageEdits({ messageId, deleted = false }: { messageId: number; deleted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<{ id: number; subject: string | null; body: string; kind: "EDIT" | "DELETE"; by: string; at: string }[] | null>(null);
  const [problem, setProblem] = useState("");
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (versions) return;
    const result = await messageVersionsAction(messageId);
    if (result.ok) setVersions(result.versions);
    else setProblem(result.message);
  };
  return (
    <>
      <button type="button" className="text-caption text-ink-muted underline-offset-2 hover:text-ink hover:underline" aria-expanded={open} onClick={() => void toggle()} data-testid="message-show-edits">
        {open ? "Hide earlier versions" : deleted ? "Show what it said" : "Show edits"}
      </button>
      {open && (
        <ol className="mt-1 w-full space-y-1 rounded-md border border-line bg-surface-muted px-3 py-2" aria-label="Earlier versions" data-testid="message-versions">
          {problem && <li className="text-caption text-danger-600">{problem}</li>}
          {!problem && !versions && <li><InlineLoading /></li>}
          {versions?.length === 0 && <li className="text-caption text-ink-muted">No earlier versions.</li>}
          {versions?.map((version) => (
            <li key={version.id} className="text-label">
              <p className="text-caption text-ink-muted">
                {version.kind === "DELETE" ? "Deleted" : "Changed"} by {version.by} · {when(version.at)}. Before that it said:
              </p>
              {version.subject && <p className="font-medium text-ink-muted">{version.subject}</p>}
              <RichText text={version.body} className="text-ink-muted" />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function AttachInput({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1 text-caption text-ink-muted hover:text-ink">
      <Paperclip aria-hidden="true" className="h-4 w-4" /> Attach files (up to 10, 10 MB each)
      <input id={id} type="file" name="attachments" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" data-testid="message-files" />
    </label>
  );
}

function Composer({ projectId, projectName, people, onDone }: { projectId: number; projectName: string; people: MentionPerson[]; onDone: (threadId?: number) => void }) {
  const { result, pending, onSubmit, formRef } = useActionForm(postMessageAction, { resetOnSuccess: true });
  const toast = useToast();
  // Sent: the composer closes (the new conversation is at the top) and says so.
  useEffect(() => {
    if (!result?.ok) return;
    toast({ tone: "success", title: result.message || "Message sent." });
    const threadId = result.data?.threadId;
    onDone(typeof threadId === "number" ? threadId : undefined);
  }, [result, onDone, toast]);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="card space-y-3 px-4 py-3" aria-label="New message" data-testid="message-composer">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-caption text-ink-muted">To: everyone on {projectName}</p>
      <label className="block text-label font-medium" htmlFor="message-subject">
        Subject
      </label>
      <input id="message-subject" name="subject" className="field-input" maxLength={150} required aria-describedby="message-subject-error" />
      <FieldError result={result} name="subject" />
      <RichEditor name="body" id="message-body" label="Message" placeholder="Write a message or @mention a teammate" people={people} maxLength={10000} />
      <FieldError result={result} name="body" />
      <AttachInput id="message-attach" />
      <FieldError result={result} name="attachments" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} className="btn-compact">
          Send
        </SubmitButton>
        <button type="button" className="btn-secondary btn-compact" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}

function ReplyBox({ projectId, threadId, people }: { projectId: number; threadId: number; people: MentionPerson[] }) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit, formRef } = useActionForm(postMessageAction, { resetOnSuccess: true });
  if (!open)
    return (
      <button type="button" className="link text-caption" onClick={() => setOpen(true)} data-testid="message-reply">
        Reply
      </button>
    );
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2" aria-label="Reply">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="parentId" value={threadId} />
      <RichEditor name="body" id={`message-reply-${threadId}`} label="Reply" people={people} minHeight={60} maxLength={10000} autoFocus />
      <FieldError result={result} name="body" />
      <AttachInput id={`message-reply-attach-${threadId}`} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} className="btn-compact">
          Reply
        </SubmitButton>
        <button type="button" className="btn-secondary btn-compact" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
