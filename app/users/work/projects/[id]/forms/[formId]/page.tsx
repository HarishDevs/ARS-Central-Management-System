import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { IntakeBuilder } from "@/features/work/forms/IntakeBuilder";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { peopleOptions, workPage } from "@/server/work/page-context";
import { builderData } from "@/server/work/intake-forms";

export const metadata: Metadata = { title: "Project form" };
export const dynamic = "force-dynamic";

// v1.66.0 (D-374, PM phase C): the project intake form builder (Customize →
// Forms). Only the project's form builders reach it (owners and editors, or
// owners only with "Only admins customise"), with the "pm_forms" switch on;
// anyone else gets "not found".
export default async function ProjectFormPage({ params }: { params: Promise<{ id: string; formId: string }> }) {
  const { user } = await workPage();
  const { id, formId } = await params;
  if (!/^\d{1,10}$/.test(id) || !/^\d{1,10}$/.test(formId)) notFound();
  const data = await builderData(Number(formId), { id: user.id, name: user.name, roles: user.roles, modules: user.modules });
  if (!data || data.form.projectId !== Number(id)) notFound();
  const [people, departments] = await Promise.all([peopleOptions(), listDepartments()]);
  const { form } = data;
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/work/projects", label: "Projects" }, { href: `/users/work/projects/${form.projectId}`, label: form.projectName }, { href: `/users/work/projects/${form.projectId}/settings#forms`, label: "Forms" }, { label: form.name }]} />
      <PageHeader title={form.status === "DRAFT" && !form.versionNo ? "Add form" : "Edit form"} />
      <IntakeBuilder
        formId={form.id}
        projectId={form.projectId}
        projectName={form.projectName}
        status={form.status}
        versionNo={form.versionNo}
        draftChanged={form.draftChanged}
        rowVersion={form.rowVersion}
        initial={{ name: form.name, description: form.description ?? "", fields: form.draft.fields, mappings: form.draft.mappings, settings: form.settings }}
        coverUrl={form.coverPath ? `/api/forms/${form.token}/cover` : null}
        sections={data.sections}
        projectFields={data.projectFields}
        people={people.map((person) => ({ id: person.id, label: person.label }))}
        departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }))}
        link={data.link}
        me={{ name: user.name, email: user.email }}
      />
    </>
  );
}
