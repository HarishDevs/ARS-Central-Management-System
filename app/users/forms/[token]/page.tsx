import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { FillForm } from "@/features/work/forms/FillForm";
import { fillView } from "@/server/work/intake-forms";

export const metadata: Metadata = { title: "Form" };
export const dynamic = "force-dynamic";

// v1.66.0 (D-374, PM phase C): a project form's link. Signed in only (the
// /users area); who may submit is the form's setting, checked on the server.
// An unknown link is "not found"; an unpublished one says it isn't accepting
// submissions (BR-FORM-015).
export default async function FormFillPage({ params }: { params: Promise<{ token: string }> }) {
  const { user } = await requireArea("users");
  const { token } = await params;
  const view = await fillView(token, { id: user.id, name: user.name, roles: user.roles, modules: user.modules });
  if (!view) notFound();
  if (view.state !== "OK") {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="card space-y-3 px-5 py-10 text-center" data-testid="form-unavailable">
          <Ban aria-hidden="true" className="mx-auto h-10 w-10 text-ink-faint" />
          <h1 className="text-page-title">{view.state === "CLOSED" ? "This form isn't accepting submissions" : "You can't submit this form"}</h1>
          <p className="text-label text-ink-muted">{view.state === "CLOSED" ? `“${view.name}” in ${view.projectName} has been unpublished.` : `“${view.name}” is open to some people only. Ask the owner of ${view.projectName} if you need it.`}</p>
          <Link href="/users" className="btn-secondary inline-flex">
            Go to Home
          </Link>
        </div>
      </div>
    );
  }
  return <FillForm token={token} name={view.name} description={view.description} coverUrl={view.coverUrl} fields={view.fields} submitter={view.submitter} confirmation={view.confirmation} submitAnother={view.submitAnother} />;
}
