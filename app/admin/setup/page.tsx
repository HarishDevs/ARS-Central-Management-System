import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { NavIcon } from "@/features/shell/nav-icons";
import { requireArea } from "@/server/authorization/guards";
import { setupSections } from "@/server/panels/admin-hubs";

export const metadata: Metadata = { title: "Set-up" };
export const dynamic = "force-dynamic";

// v1.85.0 (D-412): the Set-up hub's first page: every section the person may
// open, grouped, with what it is for. On a phone this is the section list.
export default async function SetupHub() {
  const { user } = await requireArea("admin");
  const sections = await setupSections(user);
  const groups = [...new Set(sections.map((section) => section.group))];
  return (
    <>
      <PageHeader title="Set-up" description="How approvals, tasks, information, tickets, meetings, automation and AI are set up. Choose a section; each has its own Save." />
      <div className="space-y-6" data-testid="setup-hub">
        {groups.map((group) => (
          <section key={group} aria-labelledby={`setup-${group}`}>
            <h2 id={`setup-${group}`} className="mb-2 font-semibold">
              {group}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {sections
                .filter((section) => section.group === group)
                .map((section) => (
                  <li key={section.href}>
                    <Link href={section.href} className="card-link flex h-full items-start gap-3 p-4">
                      <NavIcon href={section.href} className="mt-0.5 h-5 w-5" />
                      <span>
                        <span className="block font-medium">{section.label}</span>
                        {section.description && <span className="mt-0.5 block text-label text-ink-muted">{section.description}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
