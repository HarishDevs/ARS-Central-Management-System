"use client";

import { Download, FileUp } from "lucide-react";
import { useId, useState } from "react";
import { importPreviewAction, importRunAction } from "@/app/users/work/extras-actions";
import { useWorkCall } from "@/features/work/client";
import { TARGET_LABEL, TASK_TARGETS, type Target } from "@/server/work/import-rules";
import type { ImportOutcome, ImportPreview } from "@/server/work/project-io";

// v1.70.0 (D-383, "pm_extras"): export the project (CSV, Excel, JSON) and
// import tasks from a CSV or Excel file in three steps: choose the file,
// say what each column is, check (a dry run with a report of every row's
// problems), then import.
const ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt";

export function ImportExportPanel({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const base = `/api/work/projects/${projectId}/export?format=`;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-label font-semibold">Export</h3>
        <p className="mb-2 text-caption text-ink-muted">The List&apos;s columns with every custom field, for the tasks you can see. JSON holds the whole structure (sections, fields, tasks, dependencies, tabs, dashboard, forms, automations), like a template.</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`${base}csv`} download data-testid="export-csv">
            <Download aria-hidden="true" className="h-4 w-4" /> CSV
          </a>
          <a className="btn-secondary" href={`${base}xlsx`} download data-testid="export-xlsx">
            <Download aria-hidden="true" className="h-4 w-4" /> Excel
          </a>
          {canEdit && (
            <a className="btn-secondary" href={`${base}json`} download data-testid="export-json">
              <Download aria-hidden="true" className="h-4 w-4" /> JSON
            </a>
          )}
        </div>
      </div>
      {canEdit && <ImportWizard projectId={projectId} />}
    </div>
  );
}

function ImportWizard({ projectId }: { projectId: number }) {
  const auto = useId();
  const { call, pending } = useWorkCall();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [skipErrors, setSkipErrors] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const form = (withMapping: boolean) => {
    const data = new FormData();
    if (file) data.set("file", file);
    if (withMapping) data.set("mapping", JSON.stringify(mapping));
    if (skipErrors) data.set("skipErrors", "on");
    return data;
  };
  const read = async () => {
    setOutcome(null);
    const result = await call(() => importPreviewAction(projectId, form(false)), { success: false });
    if (result?.ok && result.value) {
      setPreview(result.value);
      setMapping(result.value.mapping);
    }
  };
  const check = async () => {
    const result = await call(() => importPreviewAction(projectId, form(true)), { success: false });
    if (result?.ok && result.value) setPreview(result.value);
  };
  const run = async () => {
    const result = await call(() => importRunAction(projectId, form(true)));
    if (result?.ok && result.value) {
      setOutcome(result.value);
      setPreview(null);
      setFile(null);
    }
  };
  const plan = preview?.plan ?? null;
  const targetName = (target: Target) => (target === "skip" ? "Don't import" : target.startsWith("field:") ? (preview?.fields.find((field) => `field:${field.id}` === target)?.name ?? "Field") : TARGET_LABEL[target as (typeof TASK_TARGETS)[number]]);
  return (
    <div className="space-y-3 border-t border-line pt-4" data-testid="import-wizard">
      <h3 className="text-label font-semibold">Import tasks</h3>
      <p className="text-caption text-ink-muted">
        From an Excel (.xlsx) or CSV file with a header row, up to 500 rows and 2 MB. Every task needs a name and a due date; the assignee can be a name, email or User ID (empty = you). Sections that don&apos;t exist yet are added.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={`${auto}-file`} className="field-label">
            1. Choose the file
          </label>
          <input
            id={`${auto}-file`}
            type="file"
            accept={ACCEPT}
            className="field-input h-auto py-1.5"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setOutcome(null);
            }}
          />
        </div>
        <button type="button" className="btn-secondary" disabled={!file || pending} onClick={read}>
          <FileUp aria-hidden="true" className="h-4 w-4" /> Read the file
        </button>
      </div>
      {preview && (
        <div className="space-y-3">
          <h4 className="text-label font-semibold">2. What is each column? ({preview.fileName})</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <thead>
                <tr className="text-left text-caption text-ink-muted">
                  <th className="py-1 pr-3 font-medium">Column</th>
                  <th className="py-1 pr-3 font-medium">First value</th>
                  <th className="py-1 font-medium">Import as</th>
                </tr>
              </thead>
              <tbody>
                {preview.header.map((name, index) => (
                  <tr key={`${name}-${index}`} className="border-t border-line">
                    <th scope="row" className="py-1 pr-3 text-left font-medium [overflow-wrap:anywhere]">
                      {name || `Column ${index + 1}`}
                    </th>
                    <td className="max-w-48 truncate py-1 pr-3 text-ink-muted">{preview.sample[0]?.[index] ?? ""}</td>
                    <td className="py-1">
                      <select
                        aria-label={`Import the column ${name || index + 1} as`}
                        className="field-input field-compact"
                        value={mapping[index] ?? "skip"}
                        onChange={(event) => setMapping((current) => current.map((item, at) => (at === index ? (event.target.value as Target) : item)))}
                        data-testid={`map-${index}`}
                      >
                        <option value="skip">Don&apos;t import</option>
                        {TASK_TARGETS.map((target) => (
                          <option key={target} value={target}>
                            {TARGET_LABEL[target]}
                          </option>
                        ))}
                        {preview.fields.map((field) => (
                          <option key={field.id} value={`field:${field.id}`}>
                            Field: {field.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-secondary" disabled={pending} onClick={check}>
            3. Check the rows
          </button>
        </div>
      )}
      <div aria-live="polite">
        {plan && (
          <div className="space-y-2" data-testid="import-report">
            {plan.problems.length > 0 ? (
              <ul className="list-disc pl-5 text-label text-danger-600">
                {plan.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : (
              <p className="text-label">
                {plan.ready} row{plan.ready === 1 ? "" : "s"} ready{plan.withErrors ? `, ${plan.withErrors} with problems` : ""}
                {plan.newSections.length ? `. New sections: ${plan.newSections.join(", ")}` : ""}.
              </p>
            )}
            {plan.withErrors > 0 && (
              <table className="w-full text-label" aria-label="Rows with problems">
                <thead>
                  <tr className="text-left text-caption text-ink-muted">
                    <th className="py-1 pr-3 font-medium">Row</th>
                    <th className="py-1 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows
                    .filter((row) => row.errors.length)
                    .slice(0, 100)
                    .map((row) => (
                      <tr key={row.line} className="border-t border-line align-top">
                        <td className="py-1 pr-3">{row.line}</td>
                        <td className="py-1">{row.errors.join(" ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {plan.ready > 0 && (
              <details>
                <summary className="cursor-pointer text-label">Preview the rows to import</summary>
                <table className="mt-1 w-full text-label">
                  <thead>
                    <tr className="text-left text-caption text-ink-muted">
                      <th className="py-1 pr-3 font-medium">Row</th>
                      <th className="py-1 pr-3 font-medium">Task</th>
                      <th className="py-1 pr-3 font-medium">Section</th>
                      <th className="py-1 pr-3 font-medium">Assignee</th>
                      <th className="py-1 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows
                      .filter((row) => !row.errors.length)
                      .slice(0, 20)
                      .map((row) => (
                        <tr key={row.line} className="border-t border-line">
                          <td className="py-1 pr-3">{row.line}</td>
                          <td className="py-1 pr-3 [overflow-wrap:anywhere]">{row.title}</td>
                          <td className="py-1 pr-3">{row.section ?? "First section"}</td>
                          <td className="py-1 pr-3">{row.assigneeName ?? "You"}</td>
                          <td className="py-1">{row.dueDay}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </details>
            )}
            {!plan.problems.length && plan.ready > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                {plan.withErrors > 0 && (
                  <label className="flex items-center gap-2 text-label">
                    <input type="checkbox" checked={skipErrors} onChange={(event) => setSkipErrors(event.target.checked)} /> Skip rows with problems
                  </label>
                )}
                <button type="button" className="btn-primary w-auto" disabled={pending || (plan.withErrors > 0 && !skipErrors)} onClick={run}>
                  Import {plan.ready} task{plan.ready === 1 ? "" : "s"}
                </button>
              </div>
            )}
          </div>
        )}
        {outcome && (
          <div className="space-y-1 text-label" data-testid="import-outcome">
            <p>
              {outcome.created} task{outcome.created === 1 ? "" : "s"} imported{outcome.skipped ? `; ${outcome.skipped} row${outcome.skipped === 1 ? "" : "s"} with problems left out` : ""}.
            </p>
            {outcome.failed.length > 0 && (
              <ul className="list-disc pl-5">
                {outcome.failed.slice(0, 50).map((item, index) => (
                  <li key={index}>
                    Row {item.line}: {item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {mapping.length > 0 && preview && !plan && <p className="text-caption text-ink-muted">Now: {mapping.filter((item) => item !== "skip").map(targetName).join(", ") || "nothing chosen"}.</p>}
    </div>
  );
}
