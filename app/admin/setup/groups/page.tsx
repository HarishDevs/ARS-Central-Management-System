import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { GroupEditor, NewGroupForm } from "@/features/admin/GroupForms";
import { requireArea } from "@/server/authorization/guards";
import { listGroups } from "@/lib/db/repositories/groups.repository";
import { listApproverOptions } from "@/lib/db/repositories/approvers.repository";
import { personLabel } from "@/lib/people/label";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Approver groups" };

export default async function GroupsPage() {
  const { user } = await requireArea("admin");
  const [groups, people] = await Promise.all([listGroups(), listApproverOptions()]);
  const options = people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }));
  return (
    <>
      <PageHeader title="Approver groups" description="A group can be an approver on any step, e.g. any one of the Finance checkers. Changes apply to steps that start after the change.">
        {/* v1.84.0 (D-411): Import data is the Super Admin's alone now. */}
        {user.roles.includes("SUPER_ADMIN") && (
        <Link href="/superadmin/data/import?kind=groups" className="btn-secondary btn-compact">
          Import
        </Link>
        )}
      </PageHeader>
      {/* v1.89.0 (D-423): a single-column settings form keeps the form width (960), not the full page. */}
      <section className="card max-w-form divide-y divide-line">
        {groups.map((group) => (
          <GroupEditor key={group.id} group={group} people={options} />
        ))}
        <NewGroupForm />
      </section>
    </>
  );
}
