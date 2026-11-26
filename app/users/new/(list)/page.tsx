import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState } from "@/features/shell/PageHeader";
import { listApprovalTemplates } from "@/lib/db/repositories/approval-templates.repository";
import { loadDirectorySnapshot, toDirectory } from "@/lib/db/repositories/directory.repository";
import { userNames } from "@/lib/db/repositories/approvals.repository";
import { allSteps, previewRoute } from "@/server/approvals/route-preview";
import type { BuilderStage } from "@/server/workflows/builder";
import { TemplateCard, type TemplateCardData } from "@/features/requests/Templates";
import { formatIndiaTime } from "@/server/notifications/security-messages";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Approval templates" };

// v1.54.0 (owner, D-309): the person's own approval templates. IT's approval
// types are gone; a requester saves the levels of a request as a template,
// and using one opens New request with the same levels (all editable) and
// an empty form.
export default async function ApprovalTemplatesPage({ searchParams }: { searchParams: Promise<{ followUp?: string }> }) {
  const { user } = await requireArea("users");
  // Older links: a follow-up now starts on New request.
  const followUp = (await searchParams).followUp;
  if (followUp && /^\d{1,10}$/.test(followUp)) redirect(`/users/custom?followUp=${followUp}`);
  const templates = await listApprovalTemplates(user.id);
  // Under each level, who it goes to (worked out now, for this person).
  const directory = templates.length ? toDirectory(await loadDirectorySnapshot()) : null;
  const ids = new Set<number>();
  const previews = templates.map((template) =>
    directory
      ? previewRoute(template.stages as BuilderStage[], user.id, directory, (id) => {
          ids.add(id);
          return String(id);
        })
      : {},
  );
  const names = await userNames([...ids]);
  const cards: TemplateCardData[] = templates.map((template, index) => ({
    id: template.id,
    name: template.name,
    updated: formatIndiaTime(template.updatedAt),
    levels: allSteps(template.stages as BuilderStage[]).map((step) => {
      const preview = previews[index]?.[step.id];
      const people = (preview?.names ?? []).map((id) => names.get(Number(id)) ?? `User #${id}`);
      return { label: step.label, who: people.length ? `${preview?.note ? `${preview.note}: ` : ""}${people.join(", ")}` : (preview?.note ?? "") };
    }),
  }));
  return (
    <>
      {/* v1.91.3 (D-437, owner: "All the approval screen layout should match the Waiting for me"): no visible
          title bar (title, ⓘ); one h1 for screen readers. Its New request button stays (an action the
          person uses), on its own line at the right. */}
      <h1 className="sr-only">Approval templates</h1>
      <div className="mb-4 flex justify-end" data-tour="page-actions">
        <Link href="/users/custom" className="btn-secondary btn-compact inline-flex items-center gap-1.5">
          <FilePlus2 aria-hidden="true" className="h-4 w-4" /> New request
        </Link>
      </div>
      {cards.length === 0 ? (
        <EmptyState
          title="No approval templates yet"
          body="Raise a request, then on its page choose Save levels as a template (or save them while filling in New request). Your templates appear here; only you see them."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="approval-templates">
          {cards.map((card) => (
            <TemplateCard key={card.id} template={card} />
          ))}
        </ul>
      )}
    </>
  );
}
