import { Diamond } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge } from "@/features/ui/Display";
import { FromTemplateForm } from "@/features/work/MoreParts";
import { FIELD_TYPE_LABEL } from "@/server/work/custom-fields";
import { offsetLabel, summaryLine, type TemplateTaskV2, type TemplateV2 } from "@/server/work/template-rules";
import type { GalleryItem } from "@/server/work/templates";
import { TAB_VIEW_LABEL, isTabView } from "@/server/work/view-tabs";

// v1.70.0 (D-383, "pm_extras"): a template's preview: what it holds (by
// section, with each task's day and placeholder), its fields, dependencies,
// tabs, dashboard, forms and automations, and the form that uses it.
export function TemplatePreview({ item, template, departments, people }: { item: GalleryItem; template: TemplateV2; departments: { id: number; name: string }[]; people: { id: number; label: string; detail?: string }[] }) {
  const holder = new Map(template.placeholders.map((entry) => [entry.key, entry.label]));
  const lines = (tasks: TemplateTaskV2[], level = 0): React.ReactNode[] =>
    tasks.flatMap((task) => [
      <li key={task.key} style={{ paddingLeft: level * 20 }} className="flex flex-wrap items-baseline gap-x-2 text-label">
        {task.isMilestone ? <Diamond aria-label="Milestone" className="h-3 w-3 text-primary-700" /> : <span aria-hidden="true">•</span>}
        <span className="[overflow-wrap:anywhere]">{task.title}</span>
        <span className="text-caption text-ink-muted">
          {offsetLabel(task.dueOffset)} · {task.assignee ? (holder.get(task.assignee) ?? "Placeholder") : "Whoever makes the project"}
        </span>
      </li>,
      ...lines(task.subtasks, level + 1),
    ]);
  const list = (title: string, names: string[], testId?: string) =>
    names.length ? (
      <div data-testid={testId}>
        <h3 className="text-label font-semibold">{title}</h3>
        <p className="text-label text-ink-muted [overflow-wrap:anywhere]">{names.join(", ")}</p>
      </div>
    ) : null;
  return (
    <>
      <PageHeader title={item.name} meta={`Template · ${summaryLine(item.summary)} · Owner ${item.ownerName}`}>
        <Badge tone="info">Template</Badge>
        {item.shared && <Badge tone="neutral">Organisation</Badge>}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4 px-5 py-4" aria-label="What it holds" data-testid="template-preview">
          {template.sections.map((section, index) => {
            const tasks = template.tasks.filter((task) => Math.min(task.section, template.sections.length - 1) === index);
            return (
              <div key={`${section.ref}-${index}`}>
                <h2 className="mb-1 font-semibold">{section.name}</h2>
                {tasks.length ? <ul className="space-y-1" data-testid="template-tasks">{lines(tasks)}</ul> : <p className="text-caption text-ink-muted">No tasks.</p>}
              </div>
            );
          })}
        </section>
        <div className="space-y-6">
          <section className="card space-y-3 px-5 py-4" aria-label="Also in it">
            <h2 className="font-semibold">Also in it</h2>
            {list("Custom fields", template.fields.map((field) => `${field.name} (${FIELD_TYPE_LABEL[field.type]}${field.library ? ", library" : ""})`), "template-fields")}
            {template.dependencies.length > 0 && <p className="text-label">{template.dependencies.length} dependenc{template.dependencies.length === 1 ? "y" : "ies"} between its tasks</p>}
            {list("Tabs", template.tabs.map((tab) => `${tab.name}${isTabView(tab.type) && tab.name !== TAB_VIEW_LABEL[tab.type] ? ` (${TAB_VIEW_LABEL[tab.type]})` : ""}`))}
            {list("Dashboard", template.widgets.map((widget) => widget.title))}
            {list("Forms (made as unpublished drafts)", template.forms.map((form) => form.name))}
            {list("Automations (made as drafts, owned by you)", template.automations.map((rule) => rule.name))}
            {list("People placeholders", template.placeholders.map((entry) => entry.label))}
            <p className="text-caption text-ink-muted">Dates are days from the project&apos;s start (Day 1 = the start day); a date on a holiday moves to the next working day.</p>
          </section>
          <section className="card px-5 py-4" aria-label="Use this template">
            <h2 className="mb-3 font-semibold">Use this template</h2>
            <FromTemplateForm templates={[{ id: item.id, name: item.name }]} departments={departments} extras placeholders={template.placeholders.map((entry) => ({ key: entry.key, label: entry.label }))} people={people} />
          </section>
        </div>
      </div>
    </>
  );
}
