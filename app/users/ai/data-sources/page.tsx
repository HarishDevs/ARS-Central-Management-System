import { requireAiPage } from "@/features/ai/guard";
import { redirect } from "next/navigation";

// D-180 (owner): the AI module is the assistant only; this address now opens it.
// v1.72.1 (D-395, QA F-17): checks access itself (the layout alone is not enough for a client move).
export default async function Page() {
  await requireAiPage();
  redirect("/users/ai/assistant");
}
