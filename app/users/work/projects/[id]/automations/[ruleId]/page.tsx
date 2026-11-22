import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { AutomationBuilder } from "@/features/work/automations/AutomationBuilder";
import { RunLog, WebhookCalls } from "@/features/work/automations/RunLog";
import { peopleOptions, workPage } from "@/server/work/page-context";
import { builderData } from "@/server/work/automations";

export const metadata: Metadata = { title: "Project automation" };
export const dynamic = "force-dynamic";

// v1.68.0 (D-380, PM phase D part 2): one project automation: the builder
// (owners and editors; owners only with "Only admins customise" may change
// it, editors then see it read-only) and its run log. The "pm_automations"
// switch must be on; anyone else gets "not found".
export default async function ProjectAutomationPage({ params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const { user } = await workPage();
  const { id, ruleId } = await params;
  if (!/^\d{1,10}$/.test(id) || !/^\d{1,10}$/.test(ruleId)) notFound();
  const data = await builderData(Number(ruleId), { id: user.id, name: user.name, roles: user.roles, modules: user.modules });
  if (!data || data.rule.projectId !== Number(id)) notFound();
  const people = await peopleOptions();
  const { rule } = data;
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/work/projects", label: "Projects" }, { href: `/users/work/projects/${rule.projectId}`, label: data.projectName }, { href: `/users/work/projects/${rule.projectId}/settings#automations`, label: "Automations" }, { label: rule.name }]} />
      <PageHeader title={rule.published ? "Edit automation" : "Add automation"} />
      <div className="space-y-6">
        <AutomationBuilder
          ruleId={rule.id}
          projectId={rule.projectId}
          initial={{ name: rule.name, draft: rule.draft, rowVersion: rule.rowVersion }}
          published={Boolean(rule.published)}
          version={rule.publishedVersion}
          draftChanged={rule.draftChanged}
          enabled={rule.enabled}
          paused={rule.pausedReason}
          build={data.build}
          owner={{ name: rule.ownerName, isMe: data.isOwner, canRun: data.ownerCanRun }}
          sections={data.sections}
          fields={data.fields}
          forms={data.forms}
          projects={data.projects}
          people={people.map((person) => ({ id: person.id, label: person.label }))}
          webhookUrl={data.webhookUrl}
          maxSteps={data.limits.stepsPerRule}
        />
        <RunLog runs={data.runs} />
        {(rule.published?.trigger?.type === "WEBHOOK" || data.deliveries.length > 0) && <WebhookCalls calls={data.deliveries} />}
      </div>
    </>
  );
}
