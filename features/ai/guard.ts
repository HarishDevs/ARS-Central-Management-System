import { requireFeature } from "@/server/settings/feature-guard";
import "server-only";
import { requireArea } from "@/server/authorization/guards";

// D-168 (AI module branch): every AI page. requireArea already refuses
// people without the AI module (page access, D-168); the "ai" switch can
// turn the whole module off.
export async function requireAiPage() {
  const session = await requireArea("users");
  // v1.72.1 (D-395): a switched-off feature says so (not a 404).
  await requireFeature("ai", session.user);
  return session;
}
