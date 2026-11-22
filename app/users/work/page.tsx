import { redirect } from "next/navigation";
import { workPage } from "@/server/work/page-context";
import { legacyTaskHref } from "@/features/shell/nav-routes";

export const dynamic = "force-dynamic";

// D-236 (owner): Task home is merged into Home (/users), its Task Management
// view (D-264). Old links keep their tabs and task.
export default async function WorkHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await workPage();
  const params = await searchParams;
  // v1.72.1 (D-395, QA F-05): an old link to one task opens that task (Home's view may not show it).
  const task = legacyTaskHref(params.task);
  if (task) redirect(task);
  const keep = Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string" && ["tab", "given", "task"].includes(entry[0]));
  // D-264: Home's Task Management view.
  redirect(`/users?${new URLSearchParams([["home", "tasks"], ...keep])}`);
}
