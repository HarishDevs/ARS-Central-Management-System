"use client";

import { EmptyState } from "@/features/ui/Display";
import { Download, ExternalLink, Eye, File as FileIcon, FileSpreadsheet, FileText, Image as ImageIcon, LayoutGrid, List as ListIcon, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Dialog } from "@/features/ui/Dialog";
import { formatSize } from "@/server/attachments/files";
import { EMPTY_FILE_FILTER, FILE_KIND_LABEL, FILE_KINDS, FILE_SORTS, FILE_SOURCE_LABEL, fileKind, filterFiles, sortFiles, type FileFilter, type FileItem, type FileKind, type FileSort } from "@/server/work/collab-rules";

// v1.71.0 (D-384, PM phase E part 2, spec PROJECTS_VIEWS §9): every file on
// the project's tasks (and their form submissions) and on its messages, as a
// gallery or a list. Filter by type, task, who added it and date; search;
// sort. Images preview here, PDFs open in the browser's viewer, every file
// downloads; "Go to task" opens the task beside the view. The server sent
// only files on tasks this person may see.
const SORT_LABEL: Record<FileSort, string> = { newest: "Newest first", oldest: "Oldest first", name: "Name", size: "Largest first" };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const KIND_ICON: Record<FileKind, typeof FileIcon> = { image: ImageIcon, pdf: FileText, document: FileText, sheet: FileSpreadsheet, other: FileIcon };

export function FilesTab({ files, taskHref, messagesHref }: { files: FileItem[]; taskHref: string; messagesHref: string }) {
  const [layout, setLayout] = useState<"tiles" | "list">("tiles");
  const [filter, setFilter] = useState<FileFilter>(EMPTY_FILE_FILTER);
  const [sort, setSort] = useState<FileSort>("newest");
  const [viewing, setViewing] = useState<FileItem | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const shown = useMemo(() => sortFiles(filterFiles(files, filter), sort), [files, filter, sort]);
  const tasks = useMemo(() => [...new Map(files.filter((file) => file.taskId).map((file) => [file.taskId!, `${file.taskNo} ${file.taskTitle}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [files]);
  const people = useMemo(() => [...new Map(files.map((file) => [file.uploaderId, file.uploaderName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [files]);
  const filtered = filter !== EMPTY_FILE_FILTER && JSON.stringify(filter) !== JSON.stringify(EMPTY_FILE_FILTER);
  const set = (patch: Partial<FileFilter>) => setFilter((current) => ({ ...current, ...patch }));
  const where = (file: FileItem) =>
    file.taskId ? (
      <Link href={`${taskHref}${file.taskId}`} scroll={false} className="link" title="Go to task">
        {file.taskNo} {file.taskTitle}
      </Link>
    ) : (
      <Link href={`${messagesHref}${file.messageId}`} className="link">
        Message: {file.messageSubject ?? "a conversation"}
      </Link>
    );
  const actions = (file: FileItem) => {
    const kind = fileKind(file.contentType, file.name);
    return (
      <span className="flex flex-wrap items-center gap-3 text-caption">
        {kind === "image" && (
          <button
            type="button"
            className="link inline-flex items-center gap-1"
            onClick={() => {
              setFailed(false);
              setViewing(file);
            }}
            aria-label={`Preview ${file.name}`}
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5" /> Preview
          </button>
        )}
        {kind === "pdf" && (
          <a href={`/api/files/${file.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1" aria-label={`Open ${file.name} in a new tab`}>
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /> Open
          </a>
        )}
        <a href={`/api/files/${file.id}`} download className="link inline-flex items-center gap-1" aria-label={`Download ${file.name}`}>
          <Download aria-hidden="true" className="h-3.5 w-3.5" /> Download
        </a>
        {file.taskId ? (
          <Link href={`${taskHref}${file.taskId}`} scroll={false} className="link inline-flex items-center gap-1" aria-label={`Go to the task of ${file.name}`}>
            Go to task
          </Link>
        ) : (
          <Link href={`${messagesHref}${file.messageId}`} className="link inline-flex items-center gap-1" aria-label={`Go to the message of ${file.name}`}>
            <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" /> Go to message
          </Link>
        )}
      </span>
    );
  };
  return (
    <section className="space-y-3" aria-label="Files" data-testid="files-tab">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3" role="search" aria-label="Filter files">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-caption text-ink-muted">
          Search
          <span className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input type="search" value={filter.search} onChange={(event) => set({ search: event.target.value.slice(0, 100) })} className="field-input field-compact pl-8" placeholder="Name, task or person" />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          Type
          <select className="field-input field-compact w-auto" value={filter.kind} onChange={(event) => set({ kind: event.target.value as FileKind | "" })}>
            <option value="">All types</option>
            {FILE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {FILE_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex max-w-[16rem] flex-col gap-1 text-caption text-ink-muted">
          Task
          <select className="field-input field-compact w-auto" value={filter.taskId ?? ""} onChange={(event) => set({ taskId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All tasks</option>
            {tasks.map(([taskId, label]) => (
              <option key={taskId} value={taskId}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          Added by
          <select className="field-input field-compact w-auto" value={filter.uploaderId ?? ""} onChange={(event) => set({ uploaderId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Anyone</option>
            {people.map(([personId, name]) => (
              <option key={personId} value={personId}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          From
          <input type="date" className="field-input field-compact w-auto" value={filter.from} max={filter.to || undefined} onChange={(event) => set({ from: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          To
          <input type="date" className="field-input field-compact w-auto" value={filter.to} min={filter.from || undefined} onChange={(event) => set({ to: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          Sort
          <select className="field-input field-compact w-auto" value={sort} onChange={(event) => setSort(event.target.value as FileSort)}>
            {FILE_SORTS.map((item) => (
              <option key={item} value={item}>
                {SORT_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Show files as" className="flex rounded-md border border-line">
          {(["tiles", "list"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={layout === item}
              onClick={() => setLayout(item)}
              className={`inline-flex h-9 items-center gap-1 px-3 text-label ${layout === item ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:text-ink"}`}
              data-testid={`files-${item}`}
            >
              {item === "tiles" ? <LayoutGrid aria-hidden="true" className="h-4 w-4" /> : <ListIcon aria-hidden="true" className="h-4 w-4" />}
              {item === "tiles" ? "Gallery" : "List"}
            </button>
          ))}
        </div>
        {filtered && (
          <button type="button" className="btn-secondary btn-compact" onClick={() => setFilter(EMPTY_FILE_FILTER)}>
            Clear filters
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-caption text-ink-muted" id={`${id}-count`}>
        {shown.length === files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : `${shown.length} of ${files.length} files`}
      </p>
      {files.length === 0 && <EmptyState title="No files yet" body="Files added to the project's tasks, its form submissions and its messages show here." />}
      {files.length > 0 && shown.length === 0 && (
        <EmptyState
          title="No files match these filters"
          body="Change or clear the filters above to see more files."
        />
      )}
      {shown.length > 0 && layout === "tiles" && (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(12rem,1fr))]" aria-describedby={`${id}-count`}>
          {shown.map((file) => {
            const kind = fileKind(file.contentType, file.name);
            const Icon = KIND_ICON[kind];
            return (
              <li key={file.id} className="card flex flex-col overflow-hidden" data-testid="file-tile">
                <div className="grid h-32 place-items-center bg-surface-muted">
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by our own access-checked route
                    <img src={`/api/files/${file.id}?inline=1`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <Icon aria-hidden="true" className="h-10 w-10 text-ink-faint" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="break-all text-label font-medium">{file.name}</p>
                  <p className="text-caption text-ink-muted">
                    {FILE_SOURCE_LABEL[file.source]} · {where(file)}
                  </p>
                  <p className="text-caption text-ink-faint">
                    {file.uploaderName} · {when(file.createdAt)} · {formatSize(file.size)}
                  </p>
                  <div className="mt-auto pt-1">{actions(file)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 0 && layout === "list" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-label" data-testid="files-table">
            <caption className="sr-only">The project&apos;s files</caption>
            <thead className="border-b border-line text-caption text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  File name
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Added by
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Attached to
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Added on
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((file) => (
                <tr key={file.id} className="border-b border-line last:border-0" data-testid="file-row">
                  <td className="break-all px-3 py-2 font-medium">{file.name}</td>
                  <td className="px-3 py-2">{file.uploaderName}</td>
                  <td className="px-3 py-2">
                    {FILE_KIND_LABEL[fileKind(file.contentType, file.name)].replace(/s$/, "")} · {formatSize(file.size)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-ink-muted">{FILE_SOURCE_LABEL[file.source]}: </span>
                    {where(file)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{when(file.createdAt)}</td>
                  <td className="px-3 py-2">{actions(file)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? ""} size="lg">
        {viewing &&
          (failed ? (
            <p className="text-label text-danger-600">This file couldn&apos;t be shown. It may have been removed, or you may no longer have access. Try Download instead.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a private file streamed by our own access-checked route
            <img src={`/api/files/${viewing.id}?inline=1`} alt={viewing.name} className="mx-auto max-h-[70vh] w-auto rounded-md" onError={() => setFailed(true)} />
          ))}
      </Dialog>
    </section>
  );
}
