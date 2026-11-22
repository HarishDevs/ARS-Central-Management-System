"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CopyPlus, EyeOff, Eye, GitBranch, ImagePlus, Link2, Mail, MoreHorizontal, Share2, Trash2, User, X } from "lucide-react";
import { deleteFormAction, duplicateFormAction, formCoverAction, publishFormAction, saveFormAction, unpublishFormAction } from "@/app/users/work/form-actions";
import { Menu } from "@/features/ui/Menu";
import { ConfirmDialog } from "@/features/ui/Dialog";
import { FormFieldsEditor } from "@/features/admin/FormFieldsEditor";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { QrCode } from "@/features/work/forms/QrCode";
import type { FormField } from "@/server/forms/fields";
import {
  AUDIENCE_LABEL,
  AUDIENCES,
  branchCandidates,
  branchOf,
  branchTargets,
  BRANCH_TYPES,
  checkIntakeForm,
  CONFIRMATION_MAX,
  connectChoices,
  DESCRIPTION_MAX,
  FORM_NAME_MAX,
  MAX_BRANCH_DEPTH,
  setBranch,
  targetFromValue,
  targetValue,
  type FormProblem,
  type IntakeSettings,
  type MappingTarget,
  type ProjectFieldInfo,
} from "@/server/work/intake-rules";

// v1.66.0 (D-374, spec FORMS_MODULE §3.4–§3.7): the project intake form
// builder, in the project's Customize area. One builder: the shared Form
// Designer (features/admin/FormFieldsEditor.tsx) in its "Project intake form"
// kind, plus the form's own parts: title, description, cover image, the
// signed-in person's Name and Email (read-only), "Connect to field" and
// branches per option on each question, the Settings tab and the Share tab.
// The checks here guide; the server checks again on save and publish.
export interface BuilderProps {
  formId: number;
  projectId: number;
  projectName: string;
  status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  versionNo: number | null;
  draftChanged: boolean;
  rowVersion: number;
  initial: { name: string; description: string; fields: FormField[]; mappings: Record<string, MappingTarget>; settings: IntakeSettings };
  coverUrl: string | null;
  sections: { id: number; name: string }[];
  projectFields: ProjectFieldInfo[];
  people: { id: number; label: string }[];
  departments: { id: number; name: string }[];
  link: string;
  me: { name: string; email: string };
}
type Tab = "questions" | "settings" | "share";
const TAB_LABEL: Record<Tab, string> = { questions: "Questions", settings: "Settings", share: "Share" };

export function IntakeBuilder(props: BuilderProps) {
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("questions");
  const [name, setName] = useState(props.initial.name);
  const [description, setDescription] = useState(props.initial.description);
  const [fields, setFields] = useState<FormField[]>(props.initial.fields);
  const [mappings, setMappings] = useState<Record<string, MappingTarget>>(props.initial.mappings);
  const [settings, setSettings] = useState<IntakeSettings>(props.initial.settings);
  const [rowVersion, setRowVersion] = useState(props.rowVersion);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(props.status);
  const [versionNo, setVersionNo] = useState(props.versionNo);
  const [unpublished, setUnpublished] = useState(props.draftChanged);
  const [serverProblems, setServerProblems] = useState<FormProblem[] | null>(null);
  const [coverStamp, setCoverStamp] = useState(0);
  const [hasCover, setHasCover] = useState(Boolean(props.coverUrl));
  const coverInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState(false);
  const touch = () => {
    setDirty(true);
    setServerProblems(null);
  };
  const editFields = (update: (all: FormField[]) => FormField[]) => {
    setFields((all) => update(all));
    touch();
  };
  const editSettings = (change: Partial<IntakeSettings>) => {
    setSettings((all) => ({ ...all, ...change }));
    touch();
  };

  // The same check the server runs on publish (BR-FORM-005): Publish stays off while anything is wrong.
  const problems = useMemo(
    () => serverProblems ?? checkIntakeForm({ name, draft: { fields, mappings }, settings }, { sectionIds: props.sections.map((section) => section.id), projectFields: props.projectFields, assigneeActive: props.people.some((person) => person.id === settings.assigneeId) }),
    [serverProblems, name, fields, mappings, settings, props.sections, props.projectFields, props.people],
  );
  const byQuestion = (field: FormField) => problems.filter((problem) => problem.key === field.key).map((problem) => problem.message);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const keep = Object.fromEntries(Object.entries(mappings).filter(([key]) => fields.some((field) => field.key === key)));
      const result = await saveFormAction(props.formId, { name, description, draft: { fields, mappings: keep }, settings, rowVersion });
      if (!result.ok) {
        toast({ tone: "error", title: result.message });
        return false;
      }
      setRowVersion(result.value!.rowVersion);
      setDirty(false);
      setUnpublished(true);
      return true;
    } catch {
      toast({ tone: "error", title: "Couldn't save. Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const result = await publishFormAction(props.formId);
      if (!result.ok) {
        if (result.problems) setServerProblems(result.problems);
        toast({ tone: "error", title: result.message });
        return;
      }
      setStatus("PUBLISHED");
      setVersionNo(result.value!.versionNo);
      setUnpublished(false);
      setRowVersion((value) => value + 1);
      toast({ tone: "success", title: `${result.message} Share the link or the QR code.` });
      setTab("share");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const unpublish = async () => {
    setBusy(true);
    try {
      const result = await unpublishFormAction(props.formId);
      toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
      if (result.ok) {
        setStatus("UNPUBLISHED");
        setRowVersion((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  };
  const uploadCover = async (file: File | null) => {
    const data = new FormData();
    if (file) data.set("cover", file);
    setBusy(true);
    try {
      const result = await formCoverAction(props.formId, data);
      toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
      if (result.ok) {
        setCoverStamp(Date.now());
        setHasCover(Boolean(file));
        setRowVersion((value) => value + 1);
        setUnpublished(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
      if (coverInput.current) coverInput.current.value = "";
    }
  };
  const fullLink = typeof window === "undefined" ? props.link : `${window.location.origin}${props.link}`;
  const copyLink = () => void copyText(fullLink).then((done) => toast(done ? { tone: "success", title: "Form link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${fullLink}` }));

  // "Connect to field" and the branches of one question (shown in its properties).
  const extras = (field: FormField) => {
    if (field.type === "SECTION") return null;
    const branch = branchOf(field);
    const source = branch ? fields.find((other) => other.key === branch.source) : undefined;
    return (
      <div className="space-y-3 border-t border-line pt-3">
        {field.type !== "ATTACHMENT" && <ConnectField field={field} value={mappings[field.key]} projectFields={props.projectFields} onChange={(target) => {
          setMappings((all) => {
            const next = { ...all };
            if (target) next[field.key] = target;
            else delete next[field.key];
            return next;
          });
          touch();
        }} />}
        {branch && source && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-caption" data-testid="branch-note">
            <GitBranch aria-hidden="true" className="h-4 w-4" />
            Shown only when “{source.label}” is {branch.options.map((option) => `“${option}”`).join(" or ")}.
            <button type="button" className="link" onClick={() => editFields((all) => branch.options.reduce((acc, option) => setBranch(acc, branch.source, option, field.key, false), all))}>
              Always show
            </button>
          </p>
        )}
        {BRANCH_TYPES.includes(field.type) && (field.options ?? []).length > 0 && <Branches field={field} fields={fields} onToggle={(option, target, on) => editFields((all) => setBranch(all, field.key, option, target, on))} />}
      </div>
    );
  };

  const tabIds: Tab[] = ["questions", "settings", "share"];
  const onTabKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = tabIds[(tabIds.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabIds.length - 1)) % tabIds.length]!;
    setTab(next);
    document.getElementById(`form-tab-${next}`)?.focus();
  };
  const textQuestions = fields.filter((field) => field.type === "TEXT");
  const titleKey = Object.entries(mappings).find(([, target]) => target.kind === "TASK" && target.field === "title")?.[0] ?? "";
  const statusText = status === "PUBLISHED" ? `Published · version ${versionNo}${unpublished || dirty ? " · unpublished changes" : ""}` : status === "UNPUBLISHED" ? "Not accepting submissions" : "Draft · never published";

  const openTab = (next: Tab) => {
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`form-tab-${next}`)?.focus());
  };
  const duplicate = async () => {
    setBusy(true);
    try {
      const result = await duplicateFormAction(props.formId);
      toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
      if (result.ok && result.value) router.push(`/users/work/projects/${props.projectId}/forms/${result.value.id}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const result = await deleteFormAction(props.formId);
      toast({ tone: result.ok ? "success" : "error", title: result.message || "Done." });
      if (result.ok) router.push(`/users/work/projects/${props.projectId}/settings#forms`);
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="form-builder">
      {/* v1.73.0 (D-396, spec FORMS §3.4.1): the header bar: who may submit + Change, then View form, Share form, Copy link and More actions (Duplicate form, Unpublish, Delete form). */}
      <div className="card flex flex-wrap items-center gap-2 px-4 py-2" role="toolbar" aria-label="Form actions" data-testid="form-header-bar">
        <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-ink-muted" data-testid="form-access">
          <Building2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          Who may submit: <span className="font-medium text-ink">{AUDIENCE_LABEL[settings.audience]}</span>.
          <button type="button" className="link" onClick={() => openTab("settings")}>
            Change
          </button>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {status === "PUBLISHED" && (
            <Link href={props.link} className="btn-ghost btn-compact inline-flex items-center gap-1" target="_blank" rel="noopener" data-testid="form-view">
              <Eye aria-hidden="true" className="h-4 w-4" /> View form
            </Link>
          )}
          <button type="button" className="btn-ghost btn-compact inline-flex items-center gap-1" onClick={() => openTab("share")} data-testid="form-share">
            <Share2 aria-hidden="true" className="h-4 w-4" /> Share form
          </button>
          {status === "PUBLISHED" && (
            <button type="button" className="btn-ghost btn-compact inline-flex items-center gap-1" onClick={copyLink}>
              <Link2 aria-hidden="true" className="h-4 w-4" /> Copy link
            </button>
          )}
          <Menu
            label="More actions for this form"
            title="More actions"
            trigger={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
            buttonClass="btn-ghost btn-compact"
            menuClass="w-56"
            testId="form-more"
            items={[
              { label: "Duplicate form", icon: <CopyPlus className="h-4 w-4" />, disabled: busy, onSelect: () => void duplicate(), testId: "form-duplicate" },
              ...(status === "PUBLISHED" ? [{ label: "Unpublish", hint: "Stop taking submissions", icon: <EyeOff className="h-4 w-4" />, disabled: busy, onSelect: () => void unpublish(), testId: "form-unpublish" }] : []),
              { kind: "separator" as const, label: "" },
              { label: "Delete form", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, onSelect: () => setDeleting(true), testId: "form-delete" },
            ]}
          />
        </span>
      </div>
      <ConfirmDialog
        open={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
        title="Delete this form?"
        body={`"${name}" is deleted and its link stops working. Tasks made from it stay in the project.`}
        confirmLabel="Delete form"
        tone="danger"
        busy={busy}
      />
      <section className="card overflow-hidden" aria-label="Form header">
        <div className="relative flex min-h-[7.5rem] items-center justify-center bg-surface-muted">
          {hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/forms/${props.link.split("/").pop()}/cover?v=${coverStamp}`} alt="" className="h-[7.5rem] w-full object-cover" />
          ) : null}
          <span className="absolute bottom-2 right-2 flex gap-2">
            <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="form-cover" onChange={(event) => void uploadCover(event.target.files?.[0] ?? null)} aria-label="Cover image (PNG, JPG or WEBP)" />
            <label htmlFor="form-cover" className="btn-secondary btn-compact inline-flex cursor-pointer items-center gap-1">
              <ImagePlus aria-hidden="true" className="h-4 w-4" /> {hasCover ? "Change cover image" : "Add cover image"}
            </label>
            {hasCover && (
              <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void uploadCover(null)}>
                Remove
              </button>
            )}
          </span>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label htmlFor="form-title" className="field-label">
              Form title
            </label>
            <input id="form-title" value={name} maxLength={FORM_NAME_MAX} onChange={(event) => { setName(event.target.value); touch(); }} className="field-input text-title font-semibold" />
          </div>
          <div>
            <label htmlFor="form-description" className="field-label">
              Form description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea id="form-description" value={description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(event) => { setDescription(event.target.value); touch(); }} className="field-input" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2" aria-label="Asked of everyone">
            <ReadOnly icon={<User aria-hidden="true" className="h-4 w-4" />} label="Name" value={props.me.name} />
            <ReadOnly icon={<Mail aria-hidden="true" className="h-4 w-4" />} label="Email address" value={props.me.email} />
          </div>
          <p className="text-caption text-ink-muted">Name and email come from the signed-in person who fills in the form; they can&apos;t be changed there.</p>
        </div>
      </section>

      <div role="tablist" aria-label="Form builder" className="flex gap-1 border-b border-line" onKeyDown={onTabKey}>
        {tabIds.map((item) => (
          <button
            key={item}
            id={`form-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`form-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => setTab(item)}
            className={`-mb-px border-b-2 px-3 py-2 text-label ${tab === item ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>

      <div id="form-panel-questions" role="tabpanel" aria-labelledby="form-tab-questions" hidden={tab !== "questions"}>
        <FormFieldsEditor
          form={fields}
          setForm={editFields}
          lockedKeys={[]}
          kind="PROJECT_INTAKE"
          intro="What people answer. Each submission becomes a task; connect a question to a task field or a project field to fill it in, and add branches to show follow-up questions for an option."
          renderExtra={(field) => extras(field)}
          problemsFor={byQuestion}
        />
      </div>

      <div id="form-panel-settings" role="tabpanel" aria-labelledby="form-tab-settings" hidden={tab !== "settings"} className="card space-y-5 px-5 py-4">
        <fieldset className="space-y-3">
          <legend className="font-semibold">Task settings</legend>
          <Select id="set-section" label="Section for tasks" value={String(settings.sectionId ?? "")} onChange={(value) => editSettings({ sectionId: value ? Number(value) : null })} options={props.sections.map((section) => ({ value: String(section.id), label: section.name }))} hint="New tasks go to the top of this section." />
          <Select
            id="set-title"
            label="Task name"
            value={titleKey}
            onChange={(value) => {
              setMappings((all) => {
                const next = Object.fromEntries(Object.entries(all).filter(([, target]) => !(target.kind === "TASK" && target.field === "title")));
                if (value) next[value] = { kind: "TASK", field: "title" };
                return next;
              });
              touch();
            }}
            options={[{ value: "", label: `${name || "Form"} submission` }, ...textQuestions.map((field) => ({ value: field.key, label: `The answer to “${field.label}”` }))]}
          />
          <Select id="set-assignee" label="Default assignee (required)" value={String(settings.assigneeId ?? "")} onChange={(value) => editSettings({ assigneeId: value ? Number(value) : null })} options={[{ value: "", label: "Choose a person" }, ...props.people.map((person) => ({ value: String(person.id), label: person.label }))]} hint="Every task has one assignee: each submission is assigned to this person." />
          <div>
            <label htmlFor="set-due" className="field-label">
              Due date (required): working days after the submission
            </label>
            <input id="set-due" type="number" min={0} max={365} inputMode="numeric" value={settings.dueOffsetDays ?? ""} onChange={(event) => editSettings({ dueOffsetDays: event.target.value === "" ? null : Math.max(0, Math.min(365, Math.round(Number(event.target.value)))) })} className="field-input w-28" />
            <p className="mt-1 text-caption text-ink-muted">Weekly offs and holidays are skipped. A question connected to the due date overrides this when answered.</p>
          </div>
          <Check id="set-copy" label="Copy all answers to the task description" checked={settings.copyToDescription} onChange={(on) => editSettings({ copyToDescription: on })} />
          <Check id="set-followers" label="Add submitters to the task as collaborators" hint="They follow the task, see it and its comments, and hear about changes." checked={settings.addFollowers} onChange={(on) => editSettings({ addFollowers: on })} />
          <Check id="set-notify-assignee" label="Tell the assignee about each submission" checked={settings.notifyAssignee} onChange={(on) => editSettings({ notifyAssignee: on })} />
          <Check id="set-notify-owner" label="Tell the project's owner about each submission" checked={settings.notifyOwner} onChange={(on) => editSettings({ notifyOwner: on })} />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Form settings</legend>
          <div role="radiogroup" aria-labelledby="set-audience-label" className="space-y-1">
            <p id="set-audience-label" className="field-label">
              Who may submit
            </p>
            {AUDIENCES.map((audience) => (
              <label key={audience} className="flex min-h-9 items-center gap-2 text-label">
                <input type="radio" name="set-audience" value={audience} checked={settings.audience === audience} onChange={() => editSettings({ audience })} className="h-5 w-5" />
                {AUDIENCE_LABEL[audience]}
              </label>
            ))}
            <p className="text-caption text-ink-muted">Only people signed in to ARS-CMS can open the link. A link for people without an account is not offered.</p>
          </div>
          {settings.audience === "DEPARTMENTS" && (
            <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line px-3 py-2">
              <legend className="px-1 text-caption text-ink-muted">Departments</legend>
              {props.departments.map((department) => (
                <label key={department.id} className="flex min-h-8 items-center gap-2 text-label">
                  <input
                    type="checkbox"
                    checked={settings.departmentIds.includes(department.id)}
                    onChange={(event) => editSettings({ departmentIds: event.target.checked ? [...settings.departmentIds, department.id] : settings.departmentIds.filter((one) => one !== department.id) })}
                    className="h-5 w-5"
                  />
                  {department.name}
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <label htmlFor="set-confirmation" className="field-label">
              Confirmation message <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea id="set-confirmation" rows={2} maxLength={CONFIRMATION_MAX} placeholder="Your submission has been received" value={settings.confirmation} onChange={(event) => editSettings({ confirmation: event.target.value })} className="field-input" />
          </div>
          <Check id="set-another" label="Show a “Submit another response” button" checked={settings.submitAnother} onChange={(on) => editSettings({ submitAnother: on })} />
        </fieldset>
      </div>

      <div id="form-panel-share" role="tabpanel" aria-labelledby="form-tab-share" hidden={tab !== "share"} className="card space-y-3 px-5 py-4">
        {status === "PUBLISHED" ? (
          <>
            <p className="text-label">Share this link with the people who may submit. They sign in to open it.</p>
            <div className="flex flex-wrap gap-2">
              <input readOnly value={fullLink} aria-label="Form link" className="field-input min-w-0 flex-1 font-mono text-label" onFocus={(event) => event.currentTarget.select()} data-testid="form-link" />
              <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={copyLink}>
                <Link2 aria-hidden="true" className="h-4 w-4" /> Copy link
              </button>
            </div>
            <QrCode text={fullLink} label={`QR code of the link to ${name}`} />
            <p className="text-caption text-ink-muted">Print the QR code or show it on a screen; a phone camera opens the form.</p>
          </>
        ) : (
          <p className="text-label text-ink-muted">Publish the form to get its link and QR code.</p>
        )}
      </div>

      <div className="card sticky bottom-0 z-10 flex flex-wrap items-center gap-3 px-5 py-3" data-testid="form-footer">
        <span className="text-caption text-ink-muted" data-testid="form-status">
          {statusText}
          {dirty ? " · not saved" : ""}
        </span>
        {problems.length > 0 && (
          <details className="text-caption text-warning-600" data-testid="form-problems">
            <summary className="cursor-pointer">
              {problems.length} thing{problems.length === 1 ? "" : "s"} to fix before publishing
            </summary>
            <ul role="status" className="mt-1 list-disc pl-5">
              {problems.slice(0, 12).map((problem, index) => (
                <li key={`${problem.key ?? ""}${index}`}>{problem.message}</li>
              ))}
            </ul>
          </details>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-compact" disabled={busy || !dirty} onClick={() => void save().then((ok) => ok && toast({ tone: "success", title: "Draft saved." }))} data-testid="form-save">
            Save draft
          </button>
          <button type="button" className="btn-primary btn-compact" disabled={busy || problems.length > 0} onClick={() => void publish()} data-testid="form-publish" title={problems.length ? "Fix the things listed first" : undefined}>
            {status === "PUBLISHED" ? "Publish changes" : "Publish"}
          </button>
        </span>
      </div>
    </div>
  );
}

function ReadOnly({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <p className="flex items-center gap-1 text-caption font-semibold text-ink-muted">
        {icon}
        {label} <span className="font-normal">(filled in for them)</span>
      </p>
      <p className="truncate text-label">{value}</p>
    </div>
  );
}

function Select({ id, label, value, onChange, options, hint }: { id: string; label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="field-input">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

function Check({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div>
      <label htmlFor={id} className="flex min-h-9 items-center gap-2 text-label">
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />
        {label}
      </label>
      {hint && <p className="pl-7 text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

// "Connect to field": a task field (name, description, due date, priority) or
// a project custom field of a matching type. The assignee is never offered.
function ConnectField({ field, value, projectFields, onChange }: { field: FormField; value: MappingTarget | undefined; projectFields: ProjectFieldInfo[]; onChange: (target: MappingTarget | null) => void }) {
  const choices = connectChoices(field, projectFields);
  const fitting = choices.filter((choice) => !choice.problem);
  const current = value ? choices.find((choice) => choice.value === targetValue(value)) : undefined;
  return (
    <div>
      <label htmlFor={`connect-${field.key}`} className="field-label">
        Connect to field
      </label>
      <select id={`connect-${field.key}`} value={value ? targetValue(value) : ""} onChange={(event) => onChange(targetFromValue(event.target.value))} className="field-input" data-testid="connect-field">
        <option value="">Not connected (the answer goes into the description)</option>
        <optgroup label="Task">
          {fitting.filter((choice) => choice.target.kind === "TASK").map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </optgroup>
        {fitting.some((choice) => choice.target.kind === "FIELD") && (
          <optgroup label="Project fields">
            {fitting.filter((choice) => choice.target.kind === "FIELD").map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        )}
        {current?.problem && <option value={current.value}>{current.label} (doesn&apos;t fit)</option>}
      </select>
      {current?.problem && (
        <p role="alert" className="mt-1 text-caption text-danger-600">
          {current.problem}
        </p>
      )}
      {!fitting.length && <p className="mt-1 text-caption text-ink-muted">No field of this project takes this type of answer.</p>}
    </div>
  );
}

// "Add branch" per option: tick the later questions shown only when this option is chosen.
function Branches({ field, fields, onToggle }: { field: FormField; fields: FormField[]; onToggle: (option: string, target: string, on: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const candidates = branchCandidates(fields, field.key);
  return (
    <div data-testid="branches">
      <p className="field-label">Branches</p>
      <ul className="space-y-1">
        {(field.options ?? []).map((option) => {
          const targets = branchTargets(fields, field.key, option);
          const isOpen = open === option;
          return (
            <li key={option} className="rounded-md border border-line px-2 py-1">
              <div className="flex flex-wrap items-center gap-2 text-label">
                <span className="min-w-0 flex-1 truncate">{option}</span>
                {targets.length > 0 && <span className="text-caption text-ink-muted">shows {targets.length}</span>}
                <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : option)} aria-label={`Add branch for ${option}`}>
                  <GitBranch aria-hidden="true" className="h-4 w-4" /> {isOpen ? "Done" : "Add branch"}
                </button>
              </div>
              {isOpen && (
                <fieldset className="mt-1 space-y-1 pb-1">
                  <legend className="text-caption text-ink-muted">Show these questions only when “{option}” is chosen:</legend>
                  {candidates.length === 0 ? (
                    <p className="text-caption text-ink-muted">Add questions below this one first (branches go at most {MAX_BRANCH_DEPTH} levels deep).</p>
                  ) : (
                    candidates.map((candidate) => {
                      const other = branchOf(candidate);
                      return (
                        <label key={candidate.key} className="flex min-h-8 items-center gap-2 text-label">
                          <input type="checkbox" checked={targets.includes(candidate.key)} onChange={(event) => onToggle(option, candidate.key, event.target.checked)} className="h-5 w-5" />
                          {candidate.label || "New question"}
                          {other && other.source !== field.key && <span className="text-caption text-ink-muted">(follows another question now)</span>}
                        </label>
                      );
                    })
                  )}
                  <button type="button" className="inline-flex items-center gap-1 text-caption text-ink-muted hover:text-ink" onClick={() => setOpen(null)}>
                    <X aria-hidden="true" className="h-3 w-3" /> Close
                  </button>
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
