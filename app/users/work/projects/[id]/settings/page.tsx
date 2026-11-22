import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { MembersPanel, ProjectCommandButton, ProjectForm } from "@/features/work/ProjectForms";
import { FieldsManager, FromTemplateForm, SaveTemplateForm } from "@/features/work/MoreParts";
import { PermissionsPanel } from "@/features/work/PermissionsPanel";
import { listProjectEvents, listProjectFields, projectFor } from "@/lib/db/repositories/work.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { indiaDateTimeText } from "@/server/modules/settings";
import { projectAbilities } from "@/server/work/access";
import { peopleOptions, workPage } from "@/server/work/page-context";
import { featureOn } from "@/server/settings/features";
import { goneFieldsFor, projectFieldsFor } from "@/server/work/fields-service";
import { FieldsPanel } from "@/features/work/FieldsPanel";
import { FieldDialogHost } from "@/features/work/FieldDialog";
import { DependenciesPanel, SchedulingPanel } from "@/features/work/SchedulingPanel";
import { projectSchedule } from "@/server/work/schedule-service";
import { projectFormsFor } from "@/server/work/intake-forms";
import { FormsPanel } from "@/features/work/forms/FormsPanel";
import { projectRulesFor } from "@/server/work/automations";
import { AutomationsPanel } from "@/features/work/automations/AutomationsPanel";
import { extrasOn } from "@/server/work/templates";
import { currentFeed } from "@/server/work/calendar-feeds";
import { ImportExportPanel } from "@/features/work/extras/ImportExportPanel";
import { CalendarFeedPanel } from "@/features/work/extras/CalendarFeedPanel";
import { SettingsNav, type SettingsNavGroup } from "@/features/work/SettingsNav";

export const metadata: Metadata = { title: "Project settings" };
export const dynamic = "force-dynamic";

const EVENT_WORD: Record<string, string> = {
  CREATED: "Created the project",
  DETAILS: "Changed the details",
  PRIVACY: "Changed who can see it",
  MEMBER_ADDED: "Added a member",
  MEMBER_ROLE: "Changed a member's role",
  MEMBER_REMOVED: "Removed a member",
  JOINED: "Joined",
  LEFT: "Left",
  SECTION_ADDED: "Added a section",
  SECTION_DELETED: "Deleted a section",
  STATUS: "Posted a status update",
  ARCHIVE: "Archived it",
  UNARCHIVE: "Brought it back from the archive",
  DELETE: "Deleted it",
  RESTORE: "Restored it",
  FIELD_ADDED: "Added a field",
  PERMISSIONS: "Changed the project permissions",
  FIELD_REMOVED: "Removed a field",
  FIELD_CHANGED: "Changed a field",
  FIELD_DELETED: "Deleted a field",
  FIELD_RESTORED: "Restored a field",
  TEMPLATE_SAVED: "Made this template",
  FROM_TEMPLATE: "Made it from a template",
  COPIED: "Made it as a copy",
  COPY_NOTES: "Noted what didn't come along",
  SCHEDULING: "Changed the scheduling",
  FORM_ADDED: "Added a form",
  FORM_PUBLISHED: "Published a form",
  FORM_UNPUBLISHED: "Unpublished a form",
  FORM_DELETED: "Deleted a form",
  AUTOMATION_ADDED: "Added an automation",
  AUTOMATION_PUBLISHED: "Published an automation",
  AUTOMATION_DELETED: "Deleted an automation",
  AUTOMATION_OWNER: "Became the owner of an automation",
};

// D-215: members and roles, details and privacy, archive and delete, history.
export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, viewer } = await workPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const found = await projectFor(Number(id), viewer);
  if (!found) notFound();
  // v1.72.0 (D-387): its skeleton comes from NavigationProgress (V6-D06: no Suspense or loading.tsx on pages with actions).
  return <SettingsView found={found} user={user} viewer={viewer} />;
}

type WorkPage = Awaited<ReturnType<typeof workPage>>;
async function SettingsView({ found, user, viewer }: { found: NonNullable<Awaited<ReturnType<typeof projectFor>>>; user: WorkPage["user"]; viewer: WorkPage["viewer"] }) {
  const { project, members, role } = found;
  const can = projectAbilities(role);
  const [people, departments, events, fields] = await Promise.all([can.share ? peopleOptions() : Promise.resolve([]), listDepartments(), listProjectEvents(project.id), listProjectFields(project.id)]);
  const activeDepartments = departments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }));
  const isMember = members.some((member) => member.type === "USER" && member.id === user.id);
  // v1.64.0 (D-371): with "pm_planning" on, the Fields section is the full custom field manager.
  const planning = await featureOn("pm_planning", user);
  const actor = { id: user.id, name: user.name, roles: user.roles, modules: user.modules };
  const [planFields, gone] = planning ? await Promise.all([projectFieldsFor(project.id, actor), goneFieldsFor(project.id, actor)]) : [null, null];
  // v1.65.0 (D-373): the Dependencies and Scheduling settings ("pm_planning").
  const scheduling = planning ? await projectSchedule(project.id) : null;
  // v1.66.0 (D-374): Forms ("pm_forms"): builders see every form, others the published ones.
  const projectForms = await projectFormsFor(project.id, actor);
  // v1.68.0 (D-380): Automations ("pm_automations"): owners and editors.
  const automations = await projectRulesFor(project.id, actor);
  // v1.70.0 (D-383): "pm_extras": Duplicate with choices, import/export, the calendar feed.
  const extras = await extrasOn(user);
  const feed = extras ? await currentFeed("PROJECT", project.id, { ...actor, sessionId: "", ipAddress: null }) : null;
  // v1.72.0 (D-387): the section list, in the order the sections are drawn.
  const navGroups: SettingsNavGroup[] = [
    { name: "Project settings", items: [...(can.manage ? [{ id: "details", label: "Project details" }] : []), ...(scheduling ? [{ id: "dependencies", label: "Dependencies" }, { id: "scheduling", label: "Scheduling" }] : [])] },
    { name: "Sharing", items: [{ id: "members", label: "Members" }, { id: "permissions", label: "Permissions" }] },
    { name: "Customize", items: [...((planFields && gone) || (!planning && can.edit) ? [{ id: "fields", label: "Fields" }] : []), ...(projectForms ? [{ id: "forms", label: "Forms" }] : []), ...(automations ? [{ id: "automations", label: "Automations" }] : [])] },
    {
      name: "More",
      items: [...(can.edit ? [{ id: "reuse", label: "Duplicate and templates" }] : []), ...(extras ? [{ id: "import-export", label: "Import and export" }, { id: "calendar-feed", label: "Calendar feed" }] : []), { id: "lifecycle", label: "Archive or delete" }, { id: "history", label: "History" }],
    },
  ].filter((group) => group.items.length > 0);
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/work/projects", label: "Projects" }, { href: `/users/work/projects/${project.id}`, label: project.name }, { label: "Members & settings" }]} />
      <PageHeader title={`${project.name}: members & settings`} />
      {/* v1.72.0 (D-387, spec PM §3.11 and PC §1): one column of sections in the spec's order, with a section list (wide screens) or a "Jump to" dropdown (phones). */}
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside>
          <SettingsNav groups={navGroups} />
        </aside>
        <div className="min-w-0 max-w-4xl space-y-6 [&_h2[id]]:scroll-mt-24">
          {can.manage && (
            <section className="card px-5 py-4" aria-labelledby="details">
              <h2 id="details" className="mb-3 font-semibold">
                Project details
              </h2>
              <ProjectForm
                values={{
                  id: project.id,
                  name: project.name,
                  description: project.description ?? "",
                  color: project.color,
                  privacy: project.privacy,
                  departmentId: project.departmentId,
                  defaultAccessRole: project.defaultAccessRole,
                  defaultView: project.defaultView,
                  startOn: project.startOn ?? "",
                  dueOn: project.dueOn ?? "",
                  rowVersion: project.rowVersion,
                }}
                departments={activeDepartments}
                myDepartmentId={viewer.departmentId}
              />
            </section>
          )}
          {scheduling && (
            <section className="card px-5 py-4" aria-labelledby="dependencies" id="dependencies-section">
              <h2 id="dependencies" className="mb-1 font-semibold">
                Dependencies
              </h2>
              <DependenciesPanel projectId={project.id} mode={scheduling.mode} canManage={can.manage} />
            </section>
          )}
          {scheduling && (
            <section className="card px-5 py-4" aria-labelledby="scheduling" id="scheduling-section">
              <h2 id="scheduling" className="mb-1 font-semibold">
                Scheduling
              </h2>
              <SchedulingPanel projectId={project.id} skipOffDays={scheduling.skipOffDays} canManage={can.manage} />
            </section>
          )}
          <section className="card px-5 py-4" aria-labelledby="members">
            <h2 id="members" className="mb-3 font-semibold">
              Members
            </h2>
            <MembersPanel projectId={project.id} members={members} people={people} departments={activeDepartments} canShare={can.share} canManage={can.manage} />
          </section>
          <section className="card px-5 py-4" aria-labelledby="permissions">
            <h2 id="permissions" className="mb-3 font-semibold">
              Project permissions
            </h2>
            <PermissionsPanel projectId={project.id} projectName={project.name} initial={project.permissions} fields={fields.map((field) => ({ id: field.id, name: field.name }))} canManage={can.manage} planning={planning} />
          </section>
          {planFields && gone && (
            <section className="card px-5 py-4" aria-labelledby="fields" id="fields-section">
              <h2 id="fields" className="mb-1 font-semibold">
                Fields
              </h2>
              <FieldsPanel projectId={project.id} fields={planFields.views} customise={planFields.customise} removed={gone.removed} deleted={gone.deleted} />
              <FieldDialogHost projectId={project.id} projectName={project.name} fields={planFields.views} customiseRole={planFields.customiseRole} planning />
            </section>
          )}
          {!planning && can.edit && (
            <section className="card px-5 py-4" aria-labelledby="fields">
              <h2 id="fields" className="mb-1 font-semibold">
                Fields
              </h2>
              <p className="mb-3 text-caption text-ink-muted">Your own columns for the tasks of this project (text, number, choice or date), shown in the List and on each task.</p>
              <FieldsManager projectId={project.id} fields={fields.map((field) => ({ id: field.id, name: field.name, kind: field.kind, options: field.options }))} />
            </section>
          )}
          {projectForms && (
            <section className="card px-5 py-4" aria-labelledby="forms" id="forms-section">
              <h2 id="forms" className="mb-1 font-semibold">
                Forms
              </h2>
              <FormsPanel projectId={project.id} rows={projectForms.rows} build={projectForms.build} />
            </section>
          )}
          {automations && (
            <section className="card px-5 py-4" aria-labelledby="automations" id="automations-section">
              <h2 id="automations" className="mb-1 font-semibold">
                Automations
              </h2>
              <AutomationsPanel projectId={project.id} rows={automations.rows} build={automations.build} limit={automations.limit} />
            </section>
          )}
          {can.edit && (
            <section className="card space-y-4 px-5 py-4" aria-labelledby="reuse">
              <h2 id="reuse" className="font-semibold">
                Duplicate and templates
              </h2>
              <SaveTemplateForm projectId={project.id} name={project.name} />
              <div className="border-t border-line pt-4">
                <h3 className="mb-2 text-label font-semibold">{extras ? "Duplicate it" : "Copy it as a new project"}</h3>
                <FromTemplateForm copyFrom={project.id} departments={activeDepartments} defaultName={`${project.name} (copy)`} extras={extras} />
              </div>
            </section>
          )}
          {extras && (
            <section className="card px-5 py-4" aria-labelledby="import-export" id="import-export-section">
              <h2 id="import-export" className="mb-2 font-semibold">
                Import and export
              </h2>
              <ImportExportPanel projectId={project.id} canEdit={can.edit} />
            </section>
          )}
          {extras && (
            <section className="card px-5 py-4" aria-labelledby="calendar-feed" id="calendar-feed-section">
              <h2 id="calendar-feed" className="mb-2 font-semibold">
                Calendar feed
              </h2>
              <CalendarFeedPanel scope="PROJECT" projectId={project.id} current={feed ? { hint: feed.hint, createdAt: feed.createdAt.toISOString(), lastUsedAt: feed.lastUsedAt?.toISOString() ?? null } : null} />
            </section>
          )}
          <section className="card space-y-3 px-5 py-4" aria-labelledby="lifecycle">
            <h2 id="lifecycle" className="font-semibold">
              Archive or delete
            </h2>
            <div className="flex flex-wrap gap-2">
              {isMember && <ProjectCommandButton projectId={project.id} command="LEAVE" label="Leave project" />}
              {can.manage && (project.archivedAt ? <ProjectCommandButton projectId={project.id} command="UNARCHIVE" label="Unarchive" /> : <ProjectCommandButton projectId={project.id} command="ARCHIVE" label="Archive" />)}
              {can.manage && <ProjectCommandButton projectId={project.id} command="DELETE" label="Delete project" danger confirmText="Its tasks stay; they just leave this project. You can restore it for 30 days." />}
            </div>
            {!can.manage && <p className="text-caption text-ink-muted">Only owners can change the details, archive or delete the project.</p>}
          </section>
          <section className="card px-5 py-4" aria-labelledby="history">
            <h2 id="history" className="mb-2 font-semibold">
              History
            </h2>
            <ol className="space-y-1 text-label">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="text-ink-muted">{indiaDateTimeText(event.createdAt)}</span> · {event.actorName ?? "System"}: {EVENT_WORD[event.type] ?? event.type}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
