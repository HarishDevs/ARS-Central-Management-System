import type { Metadata } from "next";
import { NewProjectWizard } from "@/features/work/NewProjectWizard";
import { listTemplates } from "@/lib/db/repositories/work.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { countTemplateTasks } from "@/server/work/more-rules";
import { peopleOptions, workPage } from "@/server/work/page-context";
import { readLegacyTemplate } from "@/server/work/template-rules";
import { gallery } from "@/server/work/templates";

export const metadata: Metadata = { title: "New project" };
export const dynamic = "force-dynamic";

// D-220: create a project step by step, blank or from a template.
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { user, viewer } = await workPage();
  const params = await searchParams;
  // v1.70.0 (D-383): with "pm_extras" on, the gallery's templates (organisation ones too) with their people placeholders.
  const fromGallery = await gallery({ id: user.id, name: user.name, roles: user.roles, modules: user.modules, sessionId: "", ipAddress: null });
  const [templates, departments] = await Promise.all([fromGallery ? Promise.resolve([]) : listTemplates(viewer), listDepartments()]);
  const shaped: { id: number; name: string; tasks: number; sections: string[]; placeholders?: { key: string; label: string }[] }[] = fromGallery
    ? fromGallery.map((item) => ({ id: item.id, name: item.name, tasks: item.summary.tasks, sections: item.sections, placeholders: item.placeholders }))
    : templates.map((template) => {
        const body = readLegacyTemplate(template.body);
        return { id: template.id, name: template.name, tasks: countTemplateTasks(body?.tasks ?? []), sections: body?.sections ?? [] };
      });
  const people = shaped.some((item) => item.placeholders?.length) ? await peopleOptions() : [];
  const startTemplate = /^\d{1,10}$/.test(params.template ?? "") && shaped.some((item) => String(item.id) === params.template) ? Number(params.template) : null;
  return (
    <NewProjectWizard
      templates={shaped}
      departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }))}
      myDepartmentId={viewer.departmentId}
      startTemplate={startTemplate}
      people={people}
    />
  );
}
