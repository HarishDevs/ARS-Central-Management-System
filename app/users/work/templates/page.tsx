import type { Metadata } from "next";
import { LayoutTemplate } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { TemplateGallery } from "@/features/work/extras/TemplateGallery";
import { workPage } from "@/server/work/page-context";
import { gallery } from "@/server/work/templates";
import { isAdminRoles } from "@/server/work/task-access";

export const metadata: Metadata = { title: "Project templates" };
export const dynamic = "force-dynamic";

// v1.70.0 (D-383, "pm_extras"): the template gallery: organisation templates
// (marked by IT), the person's own, and those shared through a project;
// preview, use, rename, delete.
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { user, viewer } = await workPage();
  if (viewer.projects === false) notFound();
  const items = await gallery({ id: user.id, name: user.name, roles: user.roles, modules: user.modules, sessionId: "", ipAddress: null });
  if (!items) notFound();
  const params = await searchParams;
  const show = params.show === "organisation" || params.show === "shared" ? params.show : "mine";
  return (
    <>
      <PageHeader title="Project templates" icon={LayoutTemplate} description="Start a project from a template: its sections, tasks with their dates, custom fields, dependencies, tabs, dashboard, forms and automations come along. Save any project as a template from its menu.">
        <Link href="/users/work/projects/new" className="btn-primary btn-compact inline-flex items-center gap-1">
          + New project
        </Link>
      </PageHeader>
      <TemplateGallery
        show={show}
        isAdmin={isAdminRoles(user.roles)}
        items={items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))}
      />
    </>
  );
}
