"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Paperclip, Send, X } from "lucide-react";
import { submitFormAction } from "@/app/users/work/form-actions";
import { MAX_FILE_BYTES } from "@/server/attachments/files";
import { visibleFields } from "@/server/forms/dynamic";
import type { FormField } from "@/server/forms/fields";
import { DateRangePicker } from "@/features/ui/DateRangePicker";

// v1.66.0 (D-374, spec FORMS_MODULE §3.9–§3.10): the fill view of a project
// form, for signed-in people. A centred card; required marks; one control per
// type (dropdown "Choose one", checkbox list, date, number, files by picker
// or drag and drop); branches follow the answers live; "This field is
// required" under each missing answer on Submit, cleared as it is answered;
// the server checks everything again. A submission key stops a double
// submit; the confirmation offers "View request" when the person can see the task.
type Value = string | string[];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.csv,.txt";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export function FillForm({ token, name, description, coverUrl, fields, submitter, confirmation, submitAnother }: { token: string; name: string; description: string | null; coverUrl: string | null; fields: FormField[]; submitter: { name: string; email: string }; confirmation: string; submitAnother: boolean }) {
  const [values, setValues] = useState<Record<string, Value>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ taskId: number; taskNo: string; canSee: boolean } | null>(null);
  const key = useRef(newKey());
  const summary = useRef<HTMLDivElement>(null);

  // Typed values for the shared show-if evaluator (branches).
  const shown = useMemo(() => {
    const data: Record<string, string | number | null | string[]> = {};
    for (const field of fields) {
      const value = values[field.key];
      if (field.type === "ATTACHMENT") data[field.key] = files[field.key]?.length ? files[field.key]!.length : null;
      else if (Array.isArray(value)) data[field.key] = value.length ? value : null;
      else data[field.key] = value ? value : null;
    }
    return visibleFields(fields, data as Record<string, string | number | null>);
  }, [fields, values, files]);

  const set = (field: string, value: Value) => {
    setValues((all) => ({ ...all, [field]: value }));
    setErrors((all) => {
      if (!all[field]) return all;
      const next = { ...all };
      delete next[field];
      return next;
    });
  };
  const missing = (field: FormField) => {
    if (!field.required || field.type === "SECTION") return false;
    if (field.type === "ATTACHMENT") return !(files[field.key]?.length);
    const value = values[field.key];
    return Array.isArray(value) ? value.length === 0 : !value || !value.trim();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const found: Record<string, string> = {};
    for (const field of fields) if (shown.has(field.key) && missing(field)) found[field.key] = "This field is required";
    setErrors(found);
    if (Object.keys(found).length) {
      setStatus(`${Object.keys(found).length} answer${Object.keys(found).length === 1 ? " is" : "s are"} missing.`);
      summary.current?.focus();
      return;
    }
    const data = new FormData();
    data.set("submissionKey", key.current);
    for (const field of fields) {
      if (!shown.has(field.key) || field.type === "SECTION") continue;
      if (field.type === "ATTACHMENT") {
        for (const file of files[field.key] ?? []) data.append(`file:${field.key}`, file);
        continue;
      }
      const value = values[field.key];
      if (value === undefined) continue;
      data.set(`answer:${field.key}`, Array.isArray(value) ? JSON.stringify(value) : value);
    }
    setBusy(true);
    setStatus("Sending…");
    try {
      const result = await submitFormAction(token, data);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message);
        setStatus("Not sent.");
        summary.current?.focus();
        return;
      }
      setDone({ taskId: result.value!.taskId, taskNo: result.value!.taskNo, canSee: result.value!.canSee });
      setStatus("Form submitted.");
    } catch {
      setMessage("Couldn't send the form. Check your connection and try again; your answers are still here.");
      setStatus("Not sent.");
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setValues({});
    setFiles({});
    setErrors({});
    setDone(null);
    key.current = newKey();
    setStatus("");
  };

  const errorCount = Object.keys(errors).length;
  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="fill-form">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <article className="card overflow-hidden">
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="h-28 w-full object-cover sm:h-32" />
        )}
        {done ? (
          <div className="space-y-3 px-5 py-8 text-center sm:px-10" data-testid="form-confirmation">
            <CheckCircle2 aria-hidden="true" className="mx-auto h-12 w-12 text-success-600" />
            <h1 className="text-page-title font-semibold tracking-tight">{confirmation.trim() || "Thanks for submitting a request"}</h1>
            <p className="text-label text-ink-muted">A confirmation has been sent to {submitter.email} (in your notifications and by email).</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {done.canSee && (
                <Link href={`/users/tasks/${done.taskId}`} className="btn-primary" data-testid="view-request">
                  View request ({done.taskNo})
                </Link>
              )}
              {submitAnother && (
                <button type="button" className="btn-secondary" onClick={again}>
                  Submit another response
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5 px-5 py-6 sm:px-10" aria-labelledby="fill-title">
            <header className="space-y-1">
              <h1 id="fill-title" className="text-page-title font-semibold tracking-tight">
                {name}
              </h1>
              {description && <p className="whitespace-pre-line text-label text-ink-muted">{description}</p>}
              <p className="text-caption text-ink-muted">
                <span className="text-danger-600" aria-hidden="true">
                  *
                </span>{" "}
                Required
              </p>
            </header>
            <div ref={summary} tabIndex={-1} className="outline-none">
              {(errorCount > 0 || message) && (
                <div role="alert" className="rounded-md border border-danger-600 bg-danger-50 px-3 py-2 text-label text-danger-600" data-testid="fill-errors">
                  {message ?? `Please answer ${errorCount === 1 ? "the question" : `the ${errorCount} questions`} marked below.`}
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Fixed label="Name" value={submitter.name} />
              <Fixed label="Email address" value={submitter.email} />
            </div>
            {fields.map((field) =>
              !shown.has(field.key) ? null : field.type === "SECTION" ? (
                <h2 key={field.key} className="border-b border-line pb-1 pt-2 font-semibold">
                  {field.label}
                </h2>
              ) : (
                <Question key={field.key} field={field} value={values[field.key]} files={files[field.key] ?? []} error={errors[field.key]} onChange={(value) => set(field.key, value)} onFiles={(list) => {
                  setFiles((all) => ({ ...all, [field.key]: list }));
                  setErrors((all) => {
                    const next = { ...all };
                    delete next[field.key];
                    return next;
                  });
                }} />
              ),
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy} data-testid="fill-submit">
                <Send aria-hidden="true" className="h-4 w-4" /> {busy ? "Sending…" : "Submit"}
              </button>
              <span className="text-caption text-ink-muted">
                <Link href="/terms" className="link">
                  Terms
                </Link>{" "}
                ·{" "}
                <Link href="/privacy" className="link">
                  Privacy
                </Link>
              </span>
            </div>
          </form>
        )}
      </article>
    </div>
  );
}

function Fixed({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-label" aria-label={`${label}: ${value} (from your account)`}>
        {value}
      </p>
    </div>
  );
}

function Question({ field, value, files, error, onChange, onFiles }: { field: FormField; value: Value | undefined; files: File[]; error: string | undefined; onChange: (value: Value) => void; onFiles: (files: File[]) => void }) {
  const id = `q-${field.key}`;
  const help = field.help ? `${id}-help` : undefined;
  const err = error ? `${id}-error` : undefined;
  const describedBy = [help, err].filter(Boolean).join(" ") || undefined;
  const label = (
    <>
      {field.label}
      {field.required && (
        <span className="text-danger-600">
          {" "}
          <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
        </span>
      )}
    </>
  );
  const common = { id, "aria-invalid": Boolean(error) || undefined, "aria-describedby": describedBy, "aria-required": field.required || undefined };
  const ring = error ? "border-danger-600" : "";
  let control: React.ReactNode;
  switch (field.type) {
    case "LONG_TEXT":
      control = <textarea {...common} rows={4} maxLength={4000} value={(value as string) ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Enter your answer" className={`field-input ${ring}`} />;
      break;
    case "CHOICE":
      control = (
        <select {...common} value={(value as string) ?? ""} onChange={(event) => onChange(event.target.value)} className={`field-input w-auto min-w-[12rem] max-w-full ${ring}`}>
          <option value="">Choose one</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    case "MULTI_CHOICE": {
      const picked = Array.isArray(value) ? value : [];
      control = (
        <ul aria-label={field.label} className="space-y-1" id={id} aria-describedby={describedBy}>
          {(field.options ?? []).map((option) => (
            <li key={option}>
              <label className="flex min-h-9 items-center gap-2 text-label">
                <input type="checkbox" checked={picked.includes(option)} onChange={(event) => onChange(event.target.checked ? (field.options ?? []).filter((item) => item === option || picked.includes(item)) : picked.filter((item) => item !== option))} className="h-5 w-5" />
                {option}
              </label>
            </li>
          ))}
        </ul>
      );
      break;
    }
    case "DATE":
      // v1.75.0 (D-399): the shared date picker, one day (a label outside names its button).
      control = (
        <DateRangePicker
          mode="single"
          idBase={`${id}-picker`}
          triggerId={id}
          triggerDescribedBy={describedBy}
          triggerInvalid={Boolean(error) || undefined}
          label={field.label}
          dueLabel="Date"
          value={{ start: "", due: (value as string) ?? "" }}
          onChange={(next) => onChange(next.due)}
          placeholder="Choose a date"
          triggerClass={`field-input flex w-full items-center gap-2 text-left sm:w-1/2 ${ring}`}
        />
      );
      break;
    case "NUMBER":
      control = <input {...common} type="text" inputMode="decimal" value={(value as string) ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Enter a number" className={`field-input w-full sm:w-1/2 ${ring}`} />;
      break;
    case "ATTACHMENT":
      control = <FileDrop id={id} describedBy={describedBy} name={field.label} max={field.maxFiles ?? 1} files={files} onFiles={onFiles} invalid={Boolean(error)} />;
      break;
    default:
      control = <input {...common} type="text" maxLength={200} value={(value as string) ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Enter your answer" className={`field-input ${ring}`} />;
  }
  const grouped = field.type === "MULTI_CHOICE" || field.type === "ATTACHMENT";
  return (
    <div data-testid="fill-question" data-key={field.key}>
      {grouped ? (
        <p className="field-label" id={`${id}-label`}>
          {label}
        </p>
      ) : (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}
      {field.help && (
        <p id={help} className="mb-1 text-caption text-ink-muted">
          {field.help}
        </p>
      )}
      {control}
      {error && (
        <p id={err} role="alert" className="mt-1 text-caption text-danger-600">
          {error}
          <span className="sr-only"> : {field.label}</span>
        </p>
      )}
    </div>
  );
}

// Files: a "Select files" button (keyboard) or drag and drop; the app's
// limits (10 MB each, the usual file types) are checked again on the server.
function FileDrop({ id, describedBy, name, max, files, onFiles, invalid }: { id: string; describedBy?: string; name: string; max: number; files: File[]; onFiles: (files: File[]) => void; invalid: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const take = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((file) => file.size > MAX_FILE_BYTES);
    const fine = incoming.filter((file) => file.size <= MAX_FILE_BYTES);
    // One file unless the question allows several: a new one replaces it (AC-FORM-32).
    const next = max === 1 ? fine.slice(-1) : [...files, ...fine].slice(0, max);
    setNote(tooBig.length ? `${tooBig.map((file) => file.name).join(", ")}: larger than 10 MB, not added.` : max > 1 && files.length + fine.length > max ? `At most ${max} files here.` : null);
    onFiles(next);
    if (input.current) input.current.value = "";
  };
  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center text-label ${over ? "border-primary-600 bg-primary-50" : invalid ? "border-danger-600" : "border-line"}`}
      >
        <input ref={input} id={id} tabIndex={-1} type="file" multiple={max > 1} accept={ACCEPT} className="sr-only" aria-describedby={describedBy} aria-label={`Files for ${name}`} onChange={(event) => take(event.target.files)} />
        <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => input.current?.click()}>
          <Paperclip aria-hidden="true" className="h-4 w-4" /> {max > 1 ? "Select files…" : "Select a file…"}
        </button>
        <span className="text-caption text-ink-muted">or drag and drop {max > 1 ? `up to ${max} files` : "a file"} here (10 MB each)</span>
      </div>
      {note && <p className="mt-1 text-caption text-warning-600">{note}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label={`Files chosen for ${name}`}>
          {files.map((file, index) => (
            <li key={`${file.name}${index}`} className="flex items-center gap-2 text-label">
              <Paperclip aria-hidden="true" className="h-4 w-4 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-danger-600" onClick={() => onFiles(files.filter((_, i) => i !== index))}>
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
