import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { extrasOn } from "@/server/work/templates";
import { projectTemplatesHref } from "@/features/shell/nav-routes";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge, EmptyState, NoResults } from "@/features/ui/Display";
import { ProjectDot } from "@/features/work/client";
import { ProjectCommandButton, StarButton } from "@/features/work/ProjectForms";
import { countTemplateTasks } from "@/server/work/more-rules";
import { listDeletedProjects, listTemplates, listVisibleProjects } from "@/lib/db/repositories/work.repository";
import { PRIVACY_LABEL, STATUS_KIND_LABEL, STATUS_KIND_TONE } from "@/server/work/access";
import { workPage } from "@/server/work/page-context";
import { purgeActive } from "@/server/work/purge-status";
import { purgeText } from "@/server/work/pm-rules";
import { readLegacyTemplate } from "@/server/work/template-rules";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

// D-215: every project the person can see (private ones only to members),
// starred first; a new project; archived and deleted ones on request.
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; new?: string }> }) {
  const { user, viewer } = await workPage();
  const params = await searchParams;
  // v1.72.1 (D-395, QA F-11): one "Project templates" destination: with the gallery on, the old tab opens it.
  const galleryOn = await extrasOn(user);
  if (params.show === "templates" && galleryOn) redirect(projectTemplatesHref(true));
  const show = params.show === "archived" || params.show === "mine" || params.show === "deleted" || params.show === "templates" ? params.show : "all";
  const q = (params.q ?? "").trim().slice(0, 100);
  const [projects, deleted, templates] = await Promise.all([
    show === "deleted" || show === "templates" ? Promise.resolve([]) : listVisibleProjects(viewer, { archived: show === "archived", q, onlyMine: show === "mine" }),
    show === "deleted" ? listDeletedProjects(viewer) : Promise.resolve([]),
    listTemplates(viewer),
  ]);
  const purging = show === "deleted" ? await purgeActive() : false;
  const tab = (key: string, label: string) => (
    <Link key={key} href={key === "all" ? "/users/work/projects" : key === "templates" ? projectTemplatesHref(galleryOn) : `/users/work/projects?show=${key}`} aria-current={show === key ? "page" : undefined} className={`rounded-full px-3 py-1 text-label ${show === key ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader title="Projects" icon={FolderKanban} description="Projects group tasks in sections, with list, board, calendar and timeline views, members and status updates." >
        <Link href="/users/work/projects/new" className="btn-primary btn-compact inline-flex items-center gap-1" data-testid="create-project">
          + Create project
        </Link>
      </PageHeader>
      <div>
        <section aria-label="Project list" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {tab("all", "All I can see")}
            {tab("mine", "I'm a member")}
            {tab("archived", "Archived")}
            {tab("templates", `Templates (${templates.length})`)}
            {tab("deleted", "Deleted")}
            <form className="ml-auto" action="/users/work/projects">
              {show !== "all" && <input type="hidden" name="show" value={show} />}
              <label htmlFor="project-q" className="sr-only">
                Find a project
              </label>
              <input id="project-q" name="q" defaultValue={q} placeholder="Find a project…" className="field-input h-8 w-56 text-label" />
            </form>
          </div>
          {show === "templates" ? (
            templates.length === 0 ? (
              <EmptyState title="No templates yet" body="Open a project → Members & settings → Save as template. Its sections, fields and tasks (with their dates) become reusable." />
            ) : (
              <ul className="card divide-y divide-line" data-testid="template-list">
                {templates.map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Link href={`/users/work/projects/${template.id}`} className="flex-1 font-medium hover:underline">
                      {template.name}
                    </Link>
                    <span className="text-caption text-ink-muted">
                      {countTemplateTasks(readLegacyTemplate(template.body)?.tasks ?? [])} tasks · {template.ownerName}
                    </span>
                    <Link href={`/users/work/projects/new?template=${template.id}`} className="btn-secondary btn-compact">
                      Use template
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : show === "deleted" ? (
            deleted.length === 0 ? (
              <EmptyState title="No deleted projects" body={`Projects you delete stay here for 30 days${purging ? ", then they are removed for good" : ""}.`} />
            ) : (
              <ul className="card divide-y divide-line">
                {deleted.map((project) => (
                  <li key={project.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex-1">{project.name}</span>
                    {/* v1.62.0 (D-368): when it goes for good. */}
                    <span className="text-caption text-ink-muted" data-testid="purge-note">
                      {purgeText(project.deletedAt, new Date(), purging)}
                    </span>
                    <ProjectCommandButton projectId={project.id} command="RESTORE" label="Restore" />
                  </li>
                ))}
              </ul>
            )
          ) : projects.length === 0 ? (
            q ? (
              <NoResults what="projects" query={q} clearSearchHref={show === "all" ? "/users/work/projects" : `/users/work/projects?show=${show}`} />
            ) : (
              <EmptyState
                title="No projects yet"
                body="Use Create project: you'll be its owner and can add people or a whole department."
                // v1.72.1 (D-395, QA F-15): the main action inside the empty state too.
                action={
                  <Link href="/users/work/projects/new" className="btn-secondary btn-compact">
                    Start your first project
                  </Link>
                }
              />
            )
          ) : (
            <ul className="card divide-y divide-line" data-testid="project-list-items">
              {projects.map((project) => {
                const total = project.openTasks + project.doneTasks;
                return (
                  <li key={project.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <StarButton projectId={project.id} starred={project.starred} name={project.name} />
                    <ProjectDot color={project.color} className="h-3 w-3" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/users/work/projects/${project.id}`} className="font-medium text-ink hover:underline">
                        {project.name}
                      </Link>
                      <p className="text-caption text-ink-muted">
                        {PRIVACY_LABEL[project.privacy]}
                        {project.departmentName ? ` · ${project.departmentName}` : ""} · Owner {project.ownerName}
                        {total > 0 ? ` · ${project.doneTasks}/${total} done` : ""}
                      </p>
                    </div>
                    {project.currentStatus && <Badge tone={STATUS_KIND_TONE[project.currentStatus]}>{STATUS_KIND_LABEL[project.currentStatus]}</Badge>}
                    {!project.isMember && <ProjectCommandButton projectId={project.id} command="JOIN" label="Join" />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
