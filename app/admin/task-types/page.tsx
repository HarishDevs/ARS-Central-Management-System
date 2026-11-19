import type { Metadata } from "next";
import { ModuleTypesListScreen } from "@/features/admin/ModuleTypeScreens";
import { requireArea } from "@/server/authorization/guards";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Task types" };

export const dynamic = "force-dynamic";

// v1.9.0 (D-144): Admin → task-types. The screen checks the admin area itself.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // D-244 (audit SEC-02): the page checks its own area too (not only the
  // screen it renders, nor the layout).
  await requireArea("admin");
  // v1.58.0 (D-354): the address carries the sort, group and saved view.
  return <ModuleTypesListScreen module="TASK" searchParams={await searchParams} />;
}
