import { requireArea } from "@/server/authorization/guards";
import { redirect } from "next/navigation";

// D-191: Records opens on the approval requests.
export default async function Page() {
  // v1.72.1 (D-395): checks its own area (as every admin page does).
  await requireArea("admin");
  redirect("/admin/records/requests");
}
