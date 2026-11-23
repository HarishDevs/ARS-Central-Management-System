import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/authorization/page-access", () => ({
  isHiddenHref: (href: string, hidden: Set<string>) => hidden.has(href),
  navAccess: async () => ({ hidden: new Set<string>(), viewOnly: [] }),
}));
vi.mock("@/server/panels/admin-nav", () => ({ adminNav: async () => [] }));

import { adminEntries, superAdminEntries } from "@/server/panels/settings-index";
import { searchIndex } from "@/features/ui/SettingsSearch";
import { SETTING_DEFINITIONS } from "@/server/settings/definitions";
import { SETTING_GROUP_PAGE, SUPERADMIN_NAV } from "@/server/panels/superadmin-nav";
import { channelHealth } from "@/server/panels/health";

// v1.84.0 (D-411): Search settings finds only what the person may open.
describe("settings index", () => {
  it("has every Super Admin page and every setting (names only, never values)", () => {
    const entries = superAdminEntries();
    for (const item of SUPERADMIN_NAV) expect(entries.some((entry) => entry.href === item.href)).toBe(true);
    expect(entries.filter((entry) => entry.keywords?.includes(".")).length).toBe(SETTING_DEFINITIONS.length);
    for (const definition of SETTING_DEFINITIONS) expect(SETTING_GROUP_PAGE[definition.group]).toMatch(/^\/superadmin\//);
    expect(JSON.stringify(entries)).not.toMatch(/"value"/);
  });

  it("leaves out Admin pages hidden for the person", () => {
    const items = [
      { href: "/admin/setup/doa", label: "Approval authority (DoA)", section: "Set-up" },
      { href: "/admin/setup/budgets", label: "Budgets", section: "Set-up" },
    ];
    const entries = adminEntries(items, new Set(["/admin/setup/budgets"]));
    expect(entries.map((entry) => entry.href)).toEqual(["/admin/setup/doa"]);
  });

  it("search ranks name matches first and needs every word", () => {
    const entries = superAdminEntries();
    const smtp = searchIndex(entries, "smtp password");
    expect(smtp[0]?.href).toBe("/superadmin/connections/email");
    expect(searchIndex(entries, "feature switches")[0]?.href).toBe("/superadmin/security/features");
    expect(searchIndex(entries, "zzzz-nothing")).toEqual([]);
    expect(searchIndex(entries, "   ")).toEqual([]);
  });
});

describe("health: a channel from the delivery log", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000);
  it("is Not set up without a key, Failed when the newest attempt failed, Warning with failures today", () => {
    expect(channelHealth([], "EMAIL", false, now).health).toBe("OFF");
    expect(channelHealth([{ channel: "EMAIL", status: "FAILED", createdAt: at(1) }], "EMAIL", true, now).health).toBe("FAILED");
    expect(channelHealth([{ channel: "EMAIL", status: "SENT", createdAt: at(1) }, { channel: "EMAIL", status: "FAILED", createdAt: at(2) }], "EMAIL", true, now)).toMatchObject({ health: "WARNING", failed: 1 });
    expect(channelHealth([{ channel: "EMAIL", status: "SENT", createdAt: at(1) }, { channel: "EMAIL", status: "FAILED", createdAt: at(30) }], "EMAIL", true, now).health).toBe("OK");
    expect(channelHealth([{ channel: "WHATSAPP", status: "FAILED", createdAt: at(1) }], "EMAIL", true, now).health).toBe("OK");
  });
});
