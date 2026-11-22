"use client";

import { Copy, FileText, Link2, Pencil, Plus, Trash2, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFormAction, deleteFormAction, duplicateFormAction, unpublishFormAction } from "@/app/users/work/form-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { useWorkCall } from "@/features/work/client";

// v1.66.0 (D-374, spec FORMS_MODULE §3.3): Customize → Forms. The project's
// intake forms in creation order, each with its state; builders edit,
// duplicate, unpublish and delete; everyone copies the link of a published form.
export interface FormRowView {
  id: number;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  versionNo: number | null;
  draftChanged: boolean;
  link: string;
  submissions: number;
}
const STATUS_TEXT = { DRAFT: "Draft", PUBLISHED: "Published", UNPUBLISHED: "Not accepting submissions" } as const;
const STATUS_TONE = { DRAFT: "bg-surface-muted text-ink-muted", PUBLISHED: "bg-success-50 text-success-600", UNPUBLISHED: "bg-warning-50 text-warning-600" } as const;

export function FormsPanel({ projectId, rows, build }: { projectId: number; rows: FormRowView[]; build: boolean }) {
  const { call, pending } = useWorkCall();
  const router = useRouter();
  const toast = useToast();
  const base = `/users/work/projects/${projectId}/forms`;
  const copy = (link: string) => {
    const full = `${window.location.origin}${link}`;
    void copyText(full).then((done) => toast(done ? { tone: "success", title: "Form link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${full}` }));
  };
  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30";
  return (
    <div className="space-y-3" data-testid="forms-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">Turn submissions into tasks: people fill in a form, and each submission becomes a task in a section of this project.</p>
        {build && (
          <button
            type="button"
            className="btn-primary btn-compact inline-flex items-center gap-1"
            disabled={pending}
            data-testid="add-form"
            onClick={async () => {
              const result = await call(() => createFormAction(projectId), { success: false });
              const id = result?.ok ? (result as { value?: { id: number } }).value?.id : undefined;
              if (id) router.push(`${base}/${id}`);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add form
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-4 py-4 text-label">
          <p className="font-medium">Get started with forms</p>
          <p className="text-ink-muted">{build ? "Add a form; publish it; share its link or QR code." : "No forms are published for this project yet."}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line" aria-label="Forms">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-label" data-testid="form-row">
              <FileText aria-hidden="true" className="h-4 w-4 text-ink-muted" />
              <span className="min-w-0 flex-1">
                {build ? (
                  <Link href={`${base}/${row.id}`} className="link font-medium">
                    {row.name}
                  </Link>
                ) : (
                  <Link href={row.link} className="link font-medium">
                    {row.name}
                  </Link>
                )}{" "}
                <span className={`ml-1 rounded-full px-2 py-0.5 text-caption font-semibold ${STATUS_TONE[row.status]}`}>{STATUS_TEXT[row.status]}</span>
                <span className="block text-caption text-ink-muted">
                  {row.versionNo ? `Version ${row.versionNo}` : "Never published"}
                  {build && row.versionNo && row.draftChanged ? " · unpublished changes" : ""} · {row.submissions} submission{row.submissions === 1 ? "" : "s"}
                </span>
              </span>
              {row.status === "PUBLISHED" && (
                <button type="button" className={icon} aria-label={`Copy the link of ${row.name}`} title="Copy link" onClick={() => copy(row.link)}>
                  <Link2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {build && (
                <>
                  <Link href={`${base}/${row.id}`} className={icon} aria-label={`Edit ${row.name}`} title="Edit">
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    className={icon}
                    disabled={pending}
                    aria-label={`Duplicate ${row.name}`}
                    title="Duplicate"
                    onClick={async () => {
                      const result = await call(() => duplicateFormAction(row.id));
                      const id = result?.ok ? (result as { value?: { id: number } }).value?.id : undefined;
                      if (id) router.push(`${base}/${id}`);
                    }}
                  >
                    <Copy aria-hidden="true" className="h-4 w-4" />
                  </button>
                  {row.status === "PUBLISHED" && (
                    <ConfirmButton
                      className={icon}
                      ariaLabel={`Unpublish ${row.name}`}
                      title={`Unpublish “${row.name}”?`}
                      body="Its link will say the form isn't accepting submissions. Tasks already made stay. You can publish it again."
                      confirmLabel="Unpublish"
                      onConfirm={() => call(() => unpublishFormAction(row.id))}
                    >
                      <EyeOff aria-hidden="true" className="h-4 w-4" />
                    </ConfirmButton>
                  )}
                  <ConfirmButton
                    className={`${icon} hover:text-danger-600`}
                    ariaLabel={`Delete ${row.name}`}
                    title={`Delete “${row.name}”?`}
                    body="The form and its link stop working. Tasks made from it stay in the project."
                    onConfirm={() => call(() => deleteFormAction(row.id))}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </ConfirmButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
