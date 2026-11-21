import "server-only";
import { featureMode } from "@/server/settings/features";
import { loadSetting } from "@/server/work/holiday-store";
import { parsePmExtras, PM_EXTRAS_KEY } from "@/server/work/pm-rules";

// v1.62.0 (D-368): is the 30-day purge running (the same test as the job)?
export async function purgeActive(): Promise<boolean> {
  if ((await featureMode("pm_foundations").catch(() => "OFF")) === "OFF") return false;
  return parsePmExtras(await loadSetting(PM_EXTRAS_KEY).catch(() => null)).purge;
}
