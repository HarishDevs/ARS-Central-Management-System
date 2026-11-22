import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { Avatar } from "@/features/ui/Avatar";
import { Email, SafeText } from "@/features/ui/SafeText";
import { personProfile } from "@/lib/db/repositories/profile.repository";
import { photoUrl } from "@/server/profile/photo";
import { RichText } from "@/features/work/RichText";
import { BackLink } from "@/features/ui/BackLink";
import { AlarmClock, ListTodo } from "lucide-react";
import { loadProfileCard } from "@/server/work/summary-extras";
import { dueLabel, TONE_TEXT } from "@/features/work/format";
import { featureOn } from "@/server/settings/features";
import { hasModule } from "@/server/modules/modules";
import { workViewer } from "@/server/work/task-access";
import { summaryAccess } from "@/server/work/summary-share";

export const metadata: Metadata = { title: "Profile" };

// D-230 (Asana's profile card): anyone signed in can see a colleague's
// photo, job, team, manager, people who report to them and About me, as in a
// staff directory. Not their sign-in details, number or access.
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireArea("users");
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const profile = await personProfile(Number(id));
  if (!profile || !profile.active) notFound();
  const mine = profile.id === user.id;
  // v1.77.0 (D-404): "View Task Summary" when this person may open it (their
  // manager above them, or they shared it with this person), read-only.
  const tasksOn = hasModule(user, "TASK") && (await featureOn("tasks", user).catch(() => false)) && (await featureOn("pm_foundations", user).catch(() => false));
  const viewer = tasksOn ? await workViewer(user) : null;
  const summaryOn = !mine && tasksOn;
  const canSummary = summaryOn && viewer ? (await summaryAccess(viewer, profile.id)).access !== null : false;
  // v1.78.0 (D-405, spec §3.17): the Tasks card, only when this person may open
  // their Task Summary (themselves, a manager above them, or shared with them),
  // listing only the open tasks they may see.
  const card = tasksOn && viewer ? await loadProfileCard(viewer, profile.id) : null;
  const now = new Date();
  return (
    <>
    {/* v1.72.1 (D-395, QA F-13): a way back (the card is reached from many pages). */}
    <BackLink fallback="/users" />
    <section className="card max-w-4xl px-6 py-6" data-testid="person-card">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Avatar name={profile.name} src={photoUrl(profile.id, profile.photoUpdatedAt)} size="xl" approver={profile.isApprover} />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="text-title font-semibold">
              <SafeText text={profile.name} />
            </h1>
            <p className="text-label text-ink-muted">{[profile.designationName, profile.departmentName].filter(Boolean).join(" · ")}</p>
            {profile.away && <p className="mt-1 inline-flex rounded-full bg-warning-50 px-2.5 py-0.5 text-caption font-semibold text-warning-600">Out of office until {profile.away.until}</p>}
          </div>
          {profile.aboutMe && <RichText text={profile.aboutMe} className="text-body" />}
          <dl className="grid gap-2 text-label sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink-muted">Email</dt>
            <dd>
              <Email address={profile.email} />
            </dd>
            <dt className="text-ink-muted">Reports to</dt>
            <dd>
              {profile.managerId && profile.managerName ? (
                <Link href={`/users/people/${profile.managerId}`} className="link">
                  <SafeText text={profile.managerName} />
                </Link>
              ) : (
                "—"
              )}
            </dd>
            {profile.departmentHeadName && (
              <>
                <dt className="text-ink-muted">Head of department</dt>
                <dd>
                  <SafeText text={profile.departmentHeadName} />
                </dd>
              </>
            )}
            <dt className="text-ink-muted">Their team</dt>
            <dd>
              {profile.directReports.length ? (
                <ul className="flex flex-wrap gap-2">
                  {profile.directReports.map((report) => (
                    <li key={report.id}>
                      <Link href={`/users/people/${report.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 hover:bg-surface-muted">
                        <Avatar name={report.name} src={photoUrl(report.id, report.photoUpdatedAt)} size="xs" approver={report.isApprover} />
                        <SafeText text={report.name} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                "Nobody reports to them"
              )}
            </dd>
          </dl>
          {mine && (
            <Link href="/users/profile" className="btn-primary btn-compact w-auto">
              Edit profile
            </Link>
          )}
          {canSummary && (
            <Link href={`/users/work/my-tasks?of=${profile.id}`} className="btn-secondary btn-compact inline-flex w-auto items-center gap-1.5" data-testid="person-view-summary">
              <ListTodo aria-hidden="true" className="h-4 w-4" /> View Task Summary
            </Link>
          )}
        </div>
      </div>
    </section>
    {card && (
      <section className="card mt-4 max-w-4xl px-6 py-5" aria-labelledby="person-tasks-head" data-testid="person-tasks-card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="person-tasks-head" className="flex-1 font-semibold">
            {card.own ? "My tasks" : "Tasks"} <span className="text-label font-normal text-ink-muted">({card.total.toLocaleString("en-IN")} open)</span>
          </h2>
          <Link href={card.own ? "/users/work/my-tasks" : `/users/work/my-tasks?of=${profile.id}`} className="link text-label" data-testid="person-tasks-all">
            View all tasks
          </Link>
        </div>
        {!card.own && <p className="mb-2 text-caption text-ink-muted">Only the open tasks you may see are listed.</p>}
        {card.tasks.length ? (
          <ul className="divide-y divide-line">
            {card.tasks.map((task) => {
              const due = dueLabel(task.dueAt, now, true);
              return (
                <li key={task.id} className="flex items-center gap-3 py-2 text-label" data-testid="person-task-row">
                  <Link href={`/users/tasks/${task.id}`} className="min-w-0 flex-1 truncate link">
                    <span className="text-ink-muted">{task.taskNo}</span> <SafeText text={task.title} />
                  </Link>
                  {due && (
                    <span className={`inline-flex shrink-0 items-center gap-1 text-caption ${TONE_TEXT[due.tone]}`}>
                      {due.tone === "danger" && <AlarmClock aria-hidden="true" className="h-3.5 w-3.5" />}
                      {due.tone === "danger" ? `Overdue: ${due.text}` : due.text}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-label text-ink-muted">{card.own ? "No open tasks. Well done." : "No open tasks you may see."}</p>
        )}
      </section>
    )}
    </>
  );
}
