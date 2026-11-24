import Link from "next/link";
import { StatePage } from "@/features/ui/StatePage";
import { PAGES } from "@/server/authorization/pages";
import { MODULE_LABEL } from "@/server/modules/modules";

// v1.50.3 (owner: "if I don't have access to any screen, show an error screen
// for that"): a page the person may not open (hidden by Page access, or in a
// module they don't have) says so plainly, instead of "This page isn't
// available". Records (a request or task not shared with them) keep the
// plain not-found page, so it never confirms that a private record exists.
const WHY: Record<string, string> = {
  HIDDEN: "IT has turned this page off for you.",
  MODULE: "It belongs to a module that isn't switched on for you.",
  UNKNOWN_PAGE: "Your access doesn't include this page.",
};

export function NoAccess({ pageKey, why, home }: { pageKey: string | undefined; why: string | undefined; home: string }) {
  const page = pageKey ? PAGES.find((item) => item.key === pageKey) : undefined;
  const moduleName = why === "MODULE" && page?.module ? MODULE_LABEL[page.module] : null;
  // v1.89.0 (D-422): drawn by the shared StatePage.
  return (
    <StatePage kind="no-access" title="You don't have access to this page" body={moduleName ? `It belongs to the ${moduleName} module: coming soon for you. It opens once IT switches it on for you.` : (WHY[why ?? ""] ?? WHY.UNKNOWN_PAGE!)} testId="no-access">
      {page && <p className="font-semibold text-ink">{page.label}</p>}
      <p className="max-w-md text-label text-ink-muted">If you need it for your work, ask IT to give you access.</p>
      <Link href={home} className="btn-primary btn-compact">
        Go to Home
      </Link>
    </StatePage>
  );
}
