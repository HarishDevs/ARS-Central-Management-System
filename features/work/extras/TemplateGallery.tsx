"use client";

import { formatDate } from "@/lib/format/date";
import { Building2, Eye, LayoutTemplate, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { deleteTemplateAction, renameTemplateAction, shareTemplateAction } from "@/app/users/work/extras-actions";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { Badge, EmptyState } from "@/features/ui/Display";
import { useWorkCall } from "@/features/work/client";
import { summaryLine, type TemplateSummary } from "@/server/work/template-rules";

// v1.70.0 (D-383, "pm_extras"): the template gallery. Tabs: Mine, Organisation
// (templates IT made available to everyone), Shared with me (through the
// project they came from). Every card: Preview, Use; the owner (or IT)
// renames and deletes; IT marks organisation templates.
export interface GalleryCard {
  id: number;
  name: string;
  description: string | null;
  ownerName: string;
  shared: boolean;
  createdAt: string;
  summary: TemplateSummary;
  sections: string[];
  mine: boolean;
  canManage: boolean;
}


export function TemplateGallery({ show, items, isAdmin }: { show: "mine" | "organisation" | "shared"; items: GalleryCard[]; isAdmin: boolean }) {
  const lists = {
    mine: items.filter((item) => item.mine),
    organisation: items.filter((item) => item.shared),
    shared: items.filter((item) => !item.mine && !item.shared),
  };
  const shown = lists[show];
  const tab = (key: typeof show, label: string) => (
    <Link
      key={key}
      href={key === "mine" ? "/users/work/templates" : `/users/work/templates?show=${key}`}
      aria-current={show === key ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-label ${show === key ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}
    >
      {label} ({lists[key].length})
    </Link>
  );
  return (
    <div className="space-y-4" data-testid="template-gallery">
      <nav aria-label="Which templates" className="flex flex-wrap gap-2">
        {tab("mine", "My templates")}
        {tab("organisation", "Organisation")}
        {tab("shared", "Shared with me")}
      </nav>
      {shown.length === 0 ? (
        <EmptyState
          title={show === "organisation" ? "No organisation templates yet" : show === "shared" ? "Nothing shared with you" : "You haven't saved a template yet"}
          body={show === "mine" ? "Open a project, choose ⋯ → Save as template. Its sections, tasks, fields and the rest become a template." : show === "organisation" ? "The IT team marks templates everyone can use." : "Templates saved from projects you are in show here."}
          icon={<LayoutTemplate className="h-6 w-6" />}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => (
            <TemplateCard key={item.id} item={item} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({ item, isAdmin }: { item: GalleryCard; isAdmin: boolean }) {
  const { call, pending } = useWorkCall();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name);
  return (
    <li className="card flex min-w-0 flex-col gap-3 px-4 py-3" data-testid="template-card">
      <div className="flex items-start gap-2">
        <LayoutTemplate aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await call(() => renameTemplateAction(item.id, name));
                if (result?.ok) setRenaming(false);
              }}
            >
              <label htmlFor={`rename-${item.id}`} className="sr-only">
                New name
              </label>
              <input id={`rename-${item.id}`} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={150} required className="field-input field-compact min-w-0 flex-1" />
              <button type="submit" className="btn-primary btn-compact w-auto" disabled={pending}>
                Save
              </button>
              <button type="button" className="btn-ghost btn-compact" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h2 className="font-semibold [overflow-wrap:anywhere]">{item.name}</h2>
          )}
          <p className="text-caption text-ink-muted">
            {item.ownerName} · {formatDate(item.createdAt)}
          </p>
        </div>
        {item.shared && (
          <Badge tone="info">
            <Building2 aria-hidden="true" className="mr-1 inline h-3 w-3" />
            Organisation
          </Badge>
        )}
      </div>
      {item.description && <p className="line-clamp-2 text-label text-ink-muted">{item.description}</p>}
      <p className="text-label">{summaryLine(item.summary)}</p>
      <p className="text-caption text-ink-muted [overflow-wrap:anywhere]">Sections: {item.sections.slice(0, 6).join(", ")}{item.sections.length > 6 ? "…" : ""}</p>
      <div className="mt-auto flex flex-wrap gap-2">
        <Link href={`/users/work/projects/new?template=${item.id}`} className="btn-primary btn-compact inline-flex w-auto items-center gap-1" data-testid="use-template">
          Use template
        </Link>
        <Link href={`/users/work/projects/${item.id}`} className="btn-secondary btn-compact inline-flex items-center gap-1">
          <Eye aria-hidden="true" className="h-4 w-4" /> Preview
        </Link>
        {item.canManage && !renaming && (
          <button type="button" className="btn-ghost btn-compact" onClick={() => setRenaming(true)} aria-label={`Rename ${item.name}`}>
            <Pencil aria-hidden="true" className="h-4 w-4" /> Rename
          </button>
        )}
        {isAdmin && (
          <button type="button" className="btn-ghost btn-compact" disabled={pending} onClick={() => call(() => shareTemplateAction(item.id, !item.shared))}>
            {item.shared ? "Stop sharing with everyone" : "Share with everyone"}
          </button>
        )}
        {item.canManage && (
          <ConfirmButton className="btn-ghost btn-compact text-danger-600" title={`Delete ${item.name}?`} body="Projects made from it stay. It can be restored from Deleted for 30 days." confirmLabel="Delete" onConfirm={() => call(() => deleteTemplateAction(item.id))}>
            Delete
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}
