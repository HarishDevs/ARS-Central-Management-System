import { requireFeature } from "@/server/settings/feature-guard";
import type { Metadata } from "next";
import { SquarePen } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { CreateTaskForm } from "@/features/modules/TaskForms";
import { listLiveTypes } from "@/lib/db/repositories/module-types.repository";
import { listPeopleFacts, personFacts } from "@/lib/db/repositories/tasks.repository";
import { teamOf } from "@/server/work/task-access";
import { loadFieldLookups } from "@/lib/db/repositories/lookups.repository";
import { mayCreate, parseTaskSettings, utcToIndiaLocal } from "@/server/modules/settings";
import { mayAssignTo } from "@/server/modules/task-rules";
import { isAdminActor } from "@/server/modules/tasks";
import { personLabel } from "@/lib/people/label";
import { parseOnBehalfId, resolveOnBehalf, type OnBehalfResult } from "@/server/superadmin/control/on-behalf";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "New task" };

export const dynamic = "force-dynamic";

// v1.9.0 (D-143): New task. First the type (only those this person may
// create), then the type's form. The server checks everything again.
export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ type?: string; related?: string; onBehalfOf?: string }> }) {
  const { user } = await requireArea("users");
  // v1.72.1 (D-395): a switched-off feature says so (not a 404).
  await requireFeature("tasks", user);
  const query = await searchParams;
  // v1.94.0 (D-458): Super Admin creating a task as someone (from the control panel): their rules apply.
  const behalfId = parseOnBehalfId(query.onBehalfOf);
  const behalf = behalfId !== null && user.roles.includes("SUPER_ADMIN") ? await resolveOnBehalf(user, behalfId, "TASK") : null;
  const forId = behalf?.ok ? behalf.person.id : user.id;
  const behalfParam = behalf?.ok ? `&onBehalfOf=${behalf.person.id}` : "";
  // v1.48.2 (owner: "drop this task-from-templates part"): New task opens the
  // Create task window (My Tasks with ?create=task); a type's own form is
  // still reached by its link (?type=…, e.g. from Admin → Task types).
  if (!query.type && !behalf) redirect("/users/work/my-tasks?create=task");
  const [types, me, team] = await Promise.all([listLiveTypes("TASK"), personFacts(forId), teamOf(forId)]);
  const allowed = types.filter((type) => mayCreate(parseTaskSettings(type.settings).access, { id: forId, departmentId: me?.departmentId ?? null }));
  const chosen = query.type && /^\d+$/.test(query.type) ? allowed.find((type) => type.typeId === Number(query.type)) : allowed.length === 1 ? allowed[0] : undefined;
  const related = typeof query.related === "string" && /^[A-Za-z0-9-]{3,40}$/.test(query.related) ? query.related : "";

  if (!chosen) {
    return (
      <>
        <PageHeader title="New task" icon={SquarePen} description="Choose the kind of task. Each has its own form and rules, set by IT." />
        {behalf && <OnBehalfBanner behalf={behalf} what="Creating a task" />}
        {allowed.length === 0 ? (
          <EmptyState title="No task types for you yet" body="IT sets up the kinds of task in Admin → Set-up → Task types. Ask them if you need one." />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="task-types">
            {allowed.map((type) => (
              <li key={type.typeId}>
                <Link href={`/users/tasks/new?type=${type.typeId}${related ? `&related=${encodeURIComponent(related)}` : ""}${behalfParam}`} className="card block h-full px-5 py-4 hover:border-primary-600">
                  <span className="font-semibold">{type.name}</span>
                  {type.description && <span className="mt-1 block text-label text-ink-muted">{type.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const settings = parseTaskSettings(chosen.settings);
  const [everyone, lookups] = await Promise.all([listPeopleFacts(), loadFieldLookups()]);
  const admin = behalf?.ok ? isAdminActor(behalf.person) : isAdminActor(user);
  const assignable = everyone.filter((person) => mayAssignTo(settings, { creatorId: forId, creatorDepartmentId: me?.departmentId ?? null, creatorTeamIds: team, candidate: person }, admin));
  // v1.54.7 (owner): due date mandatory, 11:59 pm by default (today unless the type sets a number of days).
  const defaultDue = utcToIndiaLocal(new Date(Date.now() + (settings.defaultDueDays ?? 0) * 86_400_000)).slice(0, 11) + "23:59";
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/tasks", label: "Tasks" }, { href: "/users/tasks/new", label: "New task" }, { label: chosen.name }]} />
      <PageHeader title={`New task: ${chosen.name}`} description={chosen.description ?? "Fill in the task and choose who should do it."} />
      {behalf && <OnBehalfBanner behalf={behalf} what="Creating this task" />}
      <CreateTaskForm
        onBehalfOf={behalf?.ok ? behalf.person.id : undefined}
        typeId={chosen.typeId}
        form={chosen.form}
        people={everyone.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
        assignable={assignable.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
        lookups={lookups}
        defaultPriority={settings.defaultPriority}
        defaultDue={defaultDue}
        requireDue={settings.requireDueDate}
        allowRelated={settings.allowRelatedRequest}
        relatedDefault={related}
        selfId={user.id}
      />
    </>
  );
}

function OnBehalfBanner({ behalf, what }: { behalf: OnBehalfResult; what: string }) {
  return (
    <p role={behalf.ok ? "status" : "alert"} className={`mb-4 rounded-md px-4 py-2 text-label ${behalf.ok ? "border border-warning-600/40 bg-warning-50 text-ink" : "bg-danger-50 text-danger-600"}`} data-testid="on-behalf-banner">
      {behalf.ok ? (
        <>
          {what} on behalf of <strong>{behalf.person.name}</strong>. It will be theirs and every usual rule applies. It shows &ldquo;Created by Super Admin on behalf of {behalf.person.name}&rdquo;.
        </>
      ) : (
        behalf.message
      )}
    </p>
  );
}
