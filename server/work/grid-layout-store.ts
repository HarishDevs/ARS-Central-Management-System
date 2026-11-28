import "server-only";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import type { GridConfig } from "@/server/work/grid";
import { LAYOUT_SETTING_PREFIX, parseLayout, withLayout } from "@/server/work/grid-layout";

// v1.95.0 (D-476): the person's own layout for a screen, laid over its view.
export async function personalLayout(userId: number, key: string, config: GridConfig): Promise<GridConfig> {
  const raw = await getUserSetting(userId, `${LAYOUT_SETTING_PREFIX}${key}`).catch(() => null);
  return withLayout(config, parseLayout(raw));
}
