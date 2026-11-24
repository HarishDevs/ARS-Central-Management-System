"use client";

import { formatDate, formatDateTime } from "@/lib/format/date";
import { History, Link2, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { pageVersionAction, restorePageAction, savePageAction } from "@/app/users/work/collab-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { RichEditor, type MentionPerson } from "@/features/ui/RichEditor";
import { RichText } from "@/features/work/RichText";
import { useWorkCall } from "@/features/work/client";
import { PAGE_MAX, PAGE_TITLE_MAX, taskLinkText } from "@/server/work/collab-rules";

// v1.71.0 (D-384, PM phase E part 2, spec PROJECTS_VIEWS §11): the project's
// page (its brief): one formatted document (headings, lists, links,
// @mentions) that everyone on the project reads; owners and editors change
// it. "Link a task" puts a link to one of the project's tasks in the text;
// linked tasks show below with their status (only those the reader may see).
// Every save is a version; the newest 50 are kept and any can be restored.
export interface PageData {
  title: string;
  body: string;
  rowVersion: number;
  updatedByName: string | null;
  updatedAt: string | null;
  canEdit: boolean;
  versions: { versionNo: number; title: string; size: number; restoredFrom: number | null; savedByName: string; savedAt: string }[];
  linked: { id: number; taskNo: string; title: string; status: string; dueAt: string | null; assigneeName: string }[];
  hiddenLinks: number;
}
const when = (iso: string) => formatDateTime(iso);
const STATUS: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", BLOCKED: "Blocked", COMPLETED: "Done", CANCELLED: "Cancelled" };

export function PageTab({ projectId, page, people, tasks, taskHref }: { projectId: number; page: PageData; people: MentionPerson[]; tasks: { id: number; taskNo: string; title: string }[]; taskHref: string }) {
  const { call, pending } = useWorkCall();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [editorKey, setEditorKey] = useState(0);
  const [base, setBase] = useState(page.rowVersion);
  const [showVersions, setShowVersions] = useState(false);
  const [preview, setPreview] = useState<{ versionNo: number; title: string; body: string } | null>(null);
  const [linkTask, setLinkTask] = useState("");
  const start = () => {
    setTitle(page.title);
    setBody(page.body);
    setBase(page.rowVersion);
    setEditorKey((key) => key + 1);
    setEditing(true);
  };
  const save = async () => {
    const result = await call(() => savePageAction(projectId, { title, body, rowVersion: base }));
    if (result?.ok) {
      if (result.value) setBase(result.value.rowVersion);
      setEditing(false);
    }
  };
  const insertTask = () => {
    const task = tasks.find((item) => String(item.id) === linkTask);
    if (!task) return;
    const line = taskLinkText(window.location.origin, task);
    setBody((current) => `${current.replace(/\s+$/, "")}${current.trim() ? "\n" : ""}- ${line}`);
    setEditorKey((key) => key + 1);
    setLinkTask("");
  };
  const openVersion = async (versionNo: number) => {
    const result = await call(() => pageVersionAction(projectId, versionNo), { success: false });
    if (result?.ok && result.value) setPreview({ versionNo, ...result.value });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="page-tab">
      <section className="card space-y-3 px-5 py-4" aria-label="Project page">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) void save();
            }}
          >
            <label className="block text-label font-medium" htmlFor="page-title">
              Title
            </label>
            <input id="page-title" className="field-input text-section font-semibold" value={title} maxLength={PAGE_TITLE_MAX} placeholder="Untitled page" onChange={(event) => setTitle(event.target.value)} />
            <RichEditor key={editorKey} name="body" id="page-body" label="Page" placeholder="Write the project's brief: goals, scope, key people and links. Use # for a heading and @ to mention someone." initialText={body} onText={setBody} people={people} minHeight={320} maxLength={PAGE_MAX} />
            <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-2">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-caption text-ink-muted">
                Link a task
                <select className="field-input field-compact w-auto" value={linkTask} onChange={(event) => setLinkTask(event.target.value)} data-testid="page-link-task">
                  <option value="">Choose one of the project&apos;s tasks</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.taskNo} {task.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-secondary btn-compact" disabled={!linkTask} onClick={insertTask}>
                <Link2 aria-hidden="true" className="h-4 w-4" /> Add link
              </button>
            </div>
            <p className="text-caption text-ink-muted">{body.length.toLocaleString("en-IN")} of {PAGE_MAX.toLocaleString("en-IN")} characters. Saving keeps the old text as a version.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary btn-compact" disabled={pending} aria-busy={pending || undefined} data-testid="page-save">
                Save page
              </button>
              <button type="button" className="btn-secondary btn-compact" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-2">
              <h2 className="flex-1 text-[22px] font-semibold leading-tight" data-testid="page-title">
                {page.title || "Untitled page"}
              </h2>
              {page.canEdit && (
                <button type="button" className="btn-secondary btn-compact" onClick={start} data-testid="page-edit">
                  <Pencil aria-hidden="true" className="h-4 w-4" /> Edit
                </button>
              )}
            </div>
            {page.updatedAt && (
              <p className="text-caption text-ink-muted">
                Last saved by {page.updatedByName} · {when(page.updatedAt)} · version {page.rowVersion}
              </p>
            )}
            {page.body.trim() ? (
              <RichText text={page.body} className="text-body [&_p.font-semibold]:mt-3 [&_p.font-semibold]:text-[18px]" />
            ) : (
              <p className="text-ink-muted" data-testid="page-empty">
                {page.canEdit ? "Nothing here yet. Choose Edit to write the project's brief: its goals, scope, key people and links." : "Nothing here yet. The project's owners and editors write this page."}
              </p>
            )}
          </>
        )}
      </section>
      <aside className="space-y-4">
        <section className="card px-5 py-4" aria-labelledby="page-tasks">
          <h2 id="page-tasks" className="mb-2 font-semibold">
            Linked tasks
          </h2>
          {page.linked.length === 0 && page.hiddenLinks === 0 && <p className="text-caption text-ink-muted">No tasks linked yet.</p>}
          <ul className="space-y-2 text-label" data-testid="page-linked">
            {page.linked.map((task) => (
              <li key={task.id}>
                <Link href={`${taskHref}${task.id}`} scroll={false} className="link">
                  {task.taskNo} {task.title}
                </Link>
                <span className="block text-caption text-ink-muted">
                  {STATUS[task.status] ?? task.status} · {task.assigneeName}
                  {task.dueAt ? ` · due ${formatDate(task.dueAt, { year: "auto" })}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {page.hiddenLinks > 0 && <p className="mt-2 text-caption text-ink-muted">{page.hiddenLinks === 1 ? "One linked task is" : `${page.hiddenLinks} linked tasks are`} not shown because you can&apos;t see {page.hiddenLinks === 1 ? "it" : "them"}.</p>}
        </section>
        <section className="card px-5 py-4" aria-labelledby="page-history">
          <h2 id="page-history" className="mb-2 font-semibold">
            <button type="button" aria-expanded={showVersions} onClick={() => setShowVersions((value) => !value)} className="inline-flex items-center gap-2" data-testid="page-versions-toggle">
              <History aria-hidden="true" className="h-4 w-4" /> Version history ({page.versions.length})
            </button>
          </h2>
          {showVersions && (
            <ol className="space-y-2 text-label" data-testid="page-versions">
              {page.versions.length === 0 && <li className="text-caption text-ink-muted">No versions yet.</li>}
              {page.versions.map((version) => (
                <li key={version.versionNo} className="rounded-md border border-line px-2 py-1.5">
                  <p className="font-medium">
                    Version {version.versionNo}
                    {version.versionNo === page.rowVersion ? " (current)" : ""}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {version.savedByName} · {when(version.savedAt)}
                    {version.restoredFrom ? ` · restored version ${version.restoredFrom}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-3 text-caption">
                    <button type="button" className="link" onClick={() => void openVersion(version.versionNo)} aria-label={`Show version ${version.versionNo}`}>
                      Show
                    </button>
                    {page.canEdit && version.versionNo !== page.rowVersion && (
                      <ConfirmButton
                        title={`Restore version ${version.versionNo}?`}
                        body="The page goes back to that text. What it says now is kept as a version, so you can come back to it."
                        className="link inline-flex items-center gap-1"
                        confirmLabel="Restore"
                        onConfirm={() => call(() => restorePageAction(projectId, version.versionNo, page.rowVersion))}
                      >
                        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> Restore
                      </ConfirmButton>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {showVersions && <p className="mt-2 text-caption text-ink-muted">The newest 50 versions are kept.</p>}
        </section>
        {preview && (
          <section className="card px-5 py-4" aria-labelledby="page-preview" data-testid="page-version-preview">
            <div className="mb-2 flex items-center gap-2">
              <h2 id="page-preview" className="flex-1 font-semibold">
                Version {preview.versionNo}
              </h2>
              <button type="button" className="btn-secondary btn-compact" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <p className="font-medium">{preview.title || "Untitled page"}</p>
            <RichText text={preview.body || "(empty)"} className="text-label" />
          </section>
        )}
      </aside>
    </div>
  );
}
