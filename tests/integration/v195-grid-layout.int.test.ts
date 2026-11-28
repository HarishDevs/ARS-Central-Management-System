import { describe, expect, it } from "vitest";
import { setUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { personalLayout } from "@/server/work/grid-layout-store";
import { DEFAULT_GRID } from "@/server/work/grid";
import { createUser } from "./helpers";

// v1.95.0 (D-476): a person's own column layout for a screen, read back from
// user_settings and laid over the screen's view (only hidden columns and order).
const tag = Date.now().toString(36);

describe("personal column layout (D-476)", () => {
  it("is read back for that person and that screen only; junk is ignored", async () => {
    const me = await createUser({ name: `Layout ${tag}` });
    const other = await createUser({ name: `Layout other ${tag}` });
    const view = { ...DEFAULT_GRID, sort: "due" as const, group: "section" as const };
    await setUserSetting(me, "work.layout.search", JSON.stringify({ hidden: ["tags"], hiddenFields: [], columnOrder: ["priority", "assignee"] }));
    expect(await personalLayout(me, "search", view)).toEqual({ ...view, hidden: ["tags"], hiddenFields: [], columnOrder: ["priority", "assignee"] });
    expect(await personalLayout(other, "search", view)).toEqual(view);
    expect(await personalLayout(me, "PROJECT.1.t1", view)).toEqual(view);
    await setUserSetting(me, "work.layout.PROJECT.1.t1", JSON.stringify({ hidden: ["not-a-column"] }));
    expect(await personalLayout(me, "PROJECT.1.t1", view)).toEqual(view);
  });
});
