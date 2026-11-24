"use client";

import { Archive, CalendarRange, CalendarSync, ChevronDown, Copy, Download, FileJson, FileSpreadsheet, FileUp, FolderPlus, LayoutTemplate, Link2, Palette, Printer, Settings, ShieldCheck, Timer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SaveTemplateForm } from "@/features/work/MoreParts";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { initials } from "@/features/ui/Display";
import { useToast } from "@/features/ui/Toast";
import { COLOR_HEX, useWorkCall } from "@/features/work/client";
import { projectDatesAction, renameProjectAction } from "@/app/users/work/actions";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { StarButton } from "@/features/work/ProjectForms";
import { ProjectShareButton } from "@/features/work/ShareDialogs";
import { CustomizeButton, type CustomizeCounts } from "@/features/work/CustomizePanel";
import type { ProjectRole } from "@/server/work/access";
import { STATUS_KIND_LABEL, STATUS_KINDS, type ProjectStatusKind } from "@/server/work/access";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { Dialog } from "@/features/ui/Dialog";

// D-219 (screen catalog S-06): the project header: icon, name, the actions
// menu, star, the "Set status" pill, then member avatars, Share and Customize.
// v1.72.0 (D-387, spec PM §3.6, §3.10, §3.20, §3.22): the tile and the avatars
// are links (colour, members), the actions menu follows the spec's order with
// Import and Export submenus, the status menu shows each status's colour and
// Customize opens the Customize panel.
const STATUS_DOT: Record<ProjectStatusKind, string> = {
  ON_TRACK: "bg-success-600",
  AT_RISK: "bg-warning-600",
  OFF_TRACK: "bg-danger-600",
  ON_HOLD: "bg-info-600",
  COMPLETE: "bg-primary-solid",
  DROPPED: "bg-ink-faint",
};

// v1.73.0 (D-396, spec PM §3.6 "inline title rename for admins"): owners
// rename the project in its header. The name is a button inside the heading
// ("Rename project"); it becomes a text box: Enter or leaving the box saves,
// Escape puts the old name back. Others see a plain heading.
function ProjectTitle({ projectId, name }: { projectId: number; name: string }) {
  const { call, pending } = useWorkCall();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setValue(name), [name]);
  const finish = (save: boolean) => {
    setEditing(false);
    const next = value.replace(/\s+/g, " ").trim();
    if (save && next && next !== name) void call(() => renameProjectAction(projectId, next)).then((result) => !result?.ok && setValue(name));
    else setValue(name);
    requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <h1 className="min-w-0 text-page-title tracking-tight">
      {editing ? (
        <input
          autoFocus
          aria-label="Project name"
          value={value}
          maxLength={150}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
            }
          }}
          className="field-input field-compact w-[min(28rem,70vw)] text-section font-semibold"
          data-testid="project-title-input"
        />
      ) : (
        <button ref={button} type="button" onClick={() => setEditing(true)} title="Rename project" className="block max-w-full truncate rounded-md px-1 text-left hover:bg-surface-muted" data-testid="project-title">
          {value}
        </button>
      )}
    </h1>
  );
}

export function ProjectHeader({
  projectId,
  name,
  color,
  meta,
  starred,
  dates,
  status,
  members,
  canEdit,
  canManage,
  share,
  archived = false,
  extras = false,
  portfolios = false,
  customize,
}: {
  projectId: number;
  name: string;
  color: string;
  meta: string;
  starred: boolean;
  // v1.74.0 (D-398, "pm_planning"): "From 1 Dec To 12 Dec" and "10 working days · 80 h"; href: owners set them.
  dates?: { text: string; duration: string | null; href: string | null; from?: string; to?: string };
  status: ProjectStatusKind | null;
  members: { id: number; name: string }[];
  canEdit: boolean;
  canManage: boolean;
  archived?: boolean;
  extras?: boolean; // "pm_extras": Import and Export or sync
  portfolios?: boolean; // "pm_portfolios": Add to portfolio
  customize?: { counts: CustomizeCounts; fieldDialog: boolean };
  share: { privacy: string; departmentId: number | null; departments: { id: number; name: string }[]; members: { type: "USER" | "DEPARTMENT"; id: number; name: string; role: ProjectRole }[]; people: { id: number; label: string }[]; canShare: boolean };
}) {
  const toast = useToast();
  const { call } = useWorkCall();
  const [saving, setSaving] = useState(false);
  const base = `/users/work/projects/${projectId}`;
  const copyLink = () => {
    const link = `${window.location.origin}${base}`;
    void copyText(link).then((done) => toast(done ? { tone: "success", title: "Project link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${link}` }));
  };
  const exportBase = `/api/work/projects/${projectId}/export?format=`;
  const actions: MenuItem[] = [
    { label: "Edit project settings", icon: <Settings className="h-4 w-4" />, href: `${base}/settings#details` },
    { label: "Manage project permissions", icon: <ShieldCheck className="h-4 w-4" />, href: `${base}/settings#permissions` },
    ...(canManage ? [{ label: "Set colour", icon: <Palette className="h-4 w-4" style={{ color: COLOR_HEX[color] ?? COLOR_HEX.gray }} />, href: `${base}/settings#details` }] : []),
    { label: "Copy project link", icon: <Link2 className="h-4 w-4" />, onSelect: copyLink },
    ...(canEdit
      ? [
          { label: "Duplicate", icon: <Copy className="h-4 w-4" />, href: `${base}/settings#reuse` },
          { label: "Save as template", icon: <LayoutTemplate className="h-4 w-4" />, onSelect: () => setSaving(true) },
        ]
      : []),
    ...(portfolios ? [{ label: "Add to portfolio", icon: <FolderPlus className="h-4 w-4" />, hint: "Open a portfolio, then add projects", href: "/users/work/portfolios" }] : []),
    ...(extras && canEdit ? [{ kind: "submenu" as const, label: "Import", icon: <FileUp className="h-4 w-4" />, testId: "project-import", items: [{ label: "CSV or Excel file", icon: <FileSpreadsheet className="h-4 w-4" />, href: `${base}/settings#import-export` }] }] : []),
    {
      kind: "submenu" as const,
      label: extras ? "Export or sync" : "Export",
      icon: <Download className="h-4 w-4" />,
      testId: "project-export",
      items: [
        ...(extras
          ? [
              { kind: "heading" as const, label: "Export" },
              { label: "Project tasks (CSV)", icon: <FileSpreadsheet className="h-4 w-4" />, href: `${exportBase}csv`, download: true },
              { label: "Project tasks (Excel)", icon: <FileSpreadsheet className="h-4 w-4" />, href: `${exportBase}xlsx`, download: true },
              { label: "Time entries (CSV)", icon: <Timer className="h-4 w-4" />, href: `/api/work/projects/${projectId}/time`, download: true },
              ...(canEdit ? [{ label: "JSON", icon: <FileJson className="h-4 w-4" />, href: `${exportBase}json`, download: true }] : []),
              { kind: "heading" as const, label: "Sync" },
              { label: "Calendar feed", icon: <CalendarSync className="h-4 w-4" />, href: `${base}/settings#calendar-feed` },
            ]
          : []),
        { label: "Print", icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() },
      ],
    },
    ...(canManage
      ? [
          { kind: "separator" as const, label: "" },
          { label: archived ? "Unarchive" : "Archive", icon: <Archive className="h-4 w-4" />, href: `${base}/settings#lifecycle` },
          { label: "Delete project", icon: <Trash2 className="h-4 w-4" />, href: `${base}/settings#lifecycle`, tone: "danger" as const },
        ]
      : []),
  ];
  const statuses: MenuItem[] = STATUS_KINDS.map((kind) => ({ label: STATUS_KIND_LABEL[kind], hint: status === kind ? "Current status" : undefined, icon: <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[kind]}`} />, href: `${base}?view=overview&status=${kind}#post-status` }));
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3" data-testid="project-header">
      {canManage ? (
        <Link href={`${base}/settings#details`} aria-label={`Change colour of ${name}`} title="Change colour" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-caption font-bold text-on-solid hover:ring-2 hover:ring-line-strong" style={{ backgroundColor: COLOR_HEX[color] ?? COLOR_HEX.gray }}>
          <span aria-hidden="true">{initials(name)}</span>
        </Link>
      ) : (
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-caption font-bold text-on-solid" style={{ backgroundColor: COLOR_HEX[color] ?? COLOR_HEX.gray }}>
          {initials(name)}
        </span>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          {canManage ? <ProjectTitle projectId={projectId} name={name} /> : <h1 className="truncate text-page-title tracking-tight">{name}</h1>}
          <Menu label={`Actions for ${name}`} trigger={<ChevronDown aria-hidden="true" className="h-4 w-4" />} items={actions} align="left" menuClass="w-64" testId="project-actions" />
          <StarButton projectId={projectId} starred={starred} name={name} />
          {canEdit ? (
            <Menu
              label={status ? `Set a status. Current status: ${STATUS_KIND_LABEL[status]}` : "Set a status. Current status: No recent updates"}
              trigger={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-caption">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status ? STATUS_DOT[status] : "border border-ink-faint"}`} />
                  {status ? STATUS_KIND_LABEL[status] : "Set status"}
                </span>
              }
              items={statuses}
              align="left"
              testId="status-menu"
            />
          ) : (
            status && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-caption">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                {STATUS_KIND_LABEL[status]}
              </span>
            )
          )}
        </div>
        <div className="text-caption text-ink-muted">
          {meta}
          {dates && (dates.text || dates.href) && (
            <>
              {" · "}
              {dates.href ? (
                // v1.75.0 (D-399): owners set From and To right here with the date range picker.
                <DateRangePicker
                  label="Project dates"
                  startLabel="From (start date)"
                  dueLabel="To (due date)"
                  value={{ start: dates.from ?? "", due: dates.to ?? "" }}
                  onCommit={(next) => void call(() => projectDatesAction(projectId, next.start, next.due), { success: "Project dates saved." })}
                  testId="project-dates-header"
                  triggerLabel={dates.text ? `Dates: ${dates.text}. Change the project's dates` : "Set the project's dates"}
                  triggerClass="inline-flex min-h-6 items-center gap-1 rounded align-baseline text-caption text-ink-muted hover:text-ink hover:underline"
                  triggerContent={
                    <span className="inline-flex items-center gap-1" data-testid="project-dates">
                      <CalendarRange aria-hidden="true" className="h-3.5 w-3.5" />
                      {dates.text ? `Dates: ${dates.text}` : "Set dates"}
                    </span>
                  }
                />
              ) : (
                <span className="inline-flex items-center gap-1" data-testid="project-dates">
                  <CalendarRange aria-hidden="true" className="h-3.5 w-3.5" />
                  Dates: {dates.text}
                </span>
              )}
              {dates.duration && <span data-testid="project-duration"> · {dates.duration}</span>}
            </>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link href={`${base}/settings#members`} className="flex -space-x-1.5 rounded-full hover:opacity-90" aria-label={`Manage project members (${members.length} member${members.length === 1 ? "" : "s"})`} title="Manage project members" data-testid="member-stack">
          {members.slice(0, 5).map((member) => (
            <span key={member.id} title={member.name} className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-primary-50 text-[length:calc(10px*var(--text-scale,1))] font-semibold text-primary-700">
              {initials(member.name)}
            </span>
          ))}
          {members.length > 5 && <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-muted px-1 text-caption">+{members.length - 5}</span>}
        </Link>
        <ProjectShareButton projectId={projectId} name={name} privacy={share.privacy} departmentId={share.departmentId} departments={share.departments} members={share.members} people={share.people} canShare={share.canShare} canManage={canManage} />
        {canEdit && customize && <CustomizeButton base={base} counts={customize.counts} fieldDialog={customize.fieldDialog} />}
      </div>
      {/* v1.89.0 (D-423, UIQA-CON-18): the shared Dialog (title, ×, motion, focus back). */}
      <Dialog
        open={saving}
        onClose={() => setSaving(false)}
        title={`Save ${name} as a template`}
        description="Its sections, tasks (with their dates relative to the start), fields and settings become a template the project's people can start new projects from."
        size="md"
        testId="save-template-dialog"
        footer={
          <button type="button" className="btn-secondary btn-compact" onClick={() => setSaving(false)}>
            Cancel
          </button>
        }
      >
        {saving && <SaveTemplateForm projectId={projectId} name={name} />}
      </Dialog>
    </header>
  );
}
