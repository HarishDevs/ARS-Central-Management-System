import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isOpenAddress, pageForPath } from "@/server/authorization/pages";
import { isUnknownAdminPath, isUnknownUsersPath, UNKNOWN_AREA_ADDRESS, UNKNOWN_PAGE_REWRITE, unknownAreaRewrite } from "@/lib/routing/unknown-users-path";

// v1.89.0 stage 3c (D-423, UI unification batch 3: the module pages). Static
// guarantees; the behaviour is in tests/e2e/v1890-ui-modules.spec.ts.
const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
function files(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const source = [...files("app"), ...files("features")];

describe("one table component (UIQA-TBL-01)", () => {
  it("RecordTable is merged into DataTable (records look); nothing imports it", () => {
    expect(fs.existsSync(path.join(root, "features/ui/RecordTable.tsx"))).toBe(false);
    expect(source.filter((file) => /from "@\/features\/ui\/RecordTable"/.test(read(file)))).toEqual([]);
    expect(read("features/ui/DataTable.tsx")).toMatch(/look\?: "list" \| "records"/);
    for (const file of ["features/admin/RecordsRegister.tsx", "features/admin/TicketMeetingRecords.tsx"]) expect(read(file)).toMatch(/look="records"/);
  });
});

describe("the shared list toolbar (UIQA-CON-01)", () => {
  it("Records' power search leads the shared toolbar; Portfolios and the board have no page-made search box", () => {
    expect(read("features/admin/RecordsRegister.tsx")).toMatch(/lead=\{<PowerSearch inToolbar/);
    expect(read("features/admin/TicketMeetingRecords.tsx")).toMatch(/lead=\{<PowerSearch inToolbar/);
    expect(read("app/users/work/portfolios/page.tsx")).not.toMatch(/id="portfolio-q"/);
    expect(read("app/users/tickets/board/page.tsx")).not.toMatch(/<form method="get" className="card/);
    for (const file of ["app/users/work/portfolios/page.tsx", "app/users/tickets/board/page.tsx", "app/users/tickets/page.tsx", "app/users/meetings/page.tsx", "app/superadmin/monitoring/audit/page.tsx"]) expect(read(file), file).toMatch(/<ListPage/);
  });

  it("the audit log's download dates use the shared date range picker, not native date inputs", () => {
    const audit = read("app/superadmin/monitoring/audit/page.tsx");
    expect(audit).toMatch(/<DateRangePicker[\s\S]*names=\{\{ start: "from", due: "to" \}\}/);
    expect(audit).not.toMatch(/type="date"/);
  });
});

describe("dialogs (UIQA-CON-18)", () => {
  it("no raw <dialog> outside the shared Dialog, except the command palette's own surface", () => {
    const raw = source.filter((file) => /^\s*<dialog(\s|>|$)/m.test(read(file)) && !file.endsWith(path.join("ui", "Dialog.tsx")));
    expect(raw.map((file) => file.replace(/\\/g, "/"))).toEqual(["features/shell/CommandPalette.tsx"]);
    expect(read("features/shell/CommandPalette.tsx").match(/^\s*<dialog(\s|>|$)/gm)).toHaveLength(1);
  });
});

describe("consistency items", () => {
  it('CON-07: list pages say "New …" with the + icon, never "+" in the words', () => {
    expect(read("app/users/tickets/page.tsx")).toMatch(/<Plus [^>]*\/> New ticket/);
    expect(read("app/users/meetings/page.tsx")).toMatch(/<Plus [^>]*\/> New meeting/);
    expect(read("app/users/work/projects/page.tsx")).toMatch(/<Plus [^>]*\/> New project/);
    expect(read("app/users/work/portfolios/page.tsx")).toMatch(/<Plus [^>]*\/> New portfolio/);
    expect(read("app/admin/users/(list)/page.tsx")).toMatch(/<Plus [^>]*\/> New user/);
    expect(source.filter((file) => />\s*\+ Create (project|portfolio)/.test(read(file)))).toEqual([]);
  });

  it("CON-10: record numbers through one RecordNo", () => {
    for (const file of ["features/requests/RequestListScreen.tsx", "features/modules/TaskListScreen.tsx", "features/modules/InfoListScreen.tsx", "app/users/meetings/page.tsx", "features/tickets/TicketParts.tsx", "app/users/tickets/board/page.tsx"]) expect(read(file), file).toMatch(/<RecordNo /);
  });

  it("CON-09: bordered boxes use the card radius (16 stays for dialogs, panes and the palette)", () => {
    for (const file of ["features/work/MyTasks.tsx", "features/work/ProjectWorkspace.tsx", "features/work/CommentThread.tsx", "features/requests/CustomApprovalForm.tsx"]) expect(read(file), file).not.toMatch(/(kanban-col[^"`]*|border border-line bg-(surface|raised\/95)[^"`]*)rounded-xl|rounded-xl border border-line bg-(surface|raised\/95)/);
  });

  it("CON-11 / CON-12: the way back sits on the breadcrumb's line; badges in the PageHeader badge slot", () => {
    for (const file of ["app/users/requests/[id]/page.tsx", "app/users/information/[id]/page.tsx", "app/users/meetings/[id]/page.tsx", "app/users/tickets/[id]/page.tsx", "features/work/TaskDetail.tsx", "app/admin/users/[id]/page.tsx"]) {
      const text = read(file);
      expect(text, file).toMatch(/<Breadcrumbs[\s\S]*back=/);
      expect(text, file).not.toMatch(/<PageHeader[^>]*>\s*\{returnTo && <ReturnToLink/);
    }
    for (const file of ["app/users/requests/[id]/page.tsx", "app/users/information/[id]/page.tsx", "app/users/meetings/[id]/page.tsx", "app/users/tickets/[id]/page.tsx", "features/work/TaskDetail.tsx"]) expect(read(file), file).toMatch(/badge=\{\s*<>/);
  });

  it("CON-15: the overview header uses the section spacing token like PageHeader", () => {
    expect(read("features/home/OverviewParts.tsx")).toMatch(/<header className="mb-section /);
  });

  it("single-column Admin settings forms keep the form width (960)", () => {
    for (const file of ["app/admin/setup/meetings/page.tsx", "app/admin/setup/ticket-categories/page.tsx", "app/admin/setup/groups/page.tsx", "app/admin/setup/ai-rules/page.tsx", "app/admin/setup/reminders/[id]/page.tsx"]) expect(read(file), file).toMatch(/max-w-form/);
  });
});

describe("unknown addresses inside the area's shell (UIQA-LAY-03)", () => {
  it("each area has a guarded [...rest] page that answers notFound(), with no title of its own", () => {
    for (const area of ["users", "admin", "superadmin"]) {
      const text = read(`app/${area}/[...rest]/page.tsx`);
      expect(text).toMatch(new RegExp(`requireArea\\("${area}"\\)`));
      expect(text).toMatch(/notFound\(\)/);
      expect(text).not.toMatch(/export (const metadata|(async )?function generateMetadata)/);
    }
  });

  it("the users catch-all has the same slug name as the @pane slot's (Next refuses two names for one dynamic path)", () => {
    const top = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\[\.\.\./.test(entry.name)).map((entry) => entry.name);
    expect(top("app/users")).toEqual(top("app/users/@pane"));
  });

  it("the middleware sends a page view of an unknown /users or /admin address to the area's not-found address; anything else as before", () => {
    expect(unknownAreaRewrite("/users/not-a-page", true)).toBe(UNKNOWN_AREA_ADDRESS.users);
    expect(unknownAreaRewrite("/admin/not-a-page", true)).toBe(UNKNOWN_AREA_ADDRESS.admin);
    expect(unknownAreaRewrite("/users/not-a-page", false)).toBe(UNKNOWN_PAGE_REWRITE); // a POST / Server Action: the root 404, as in D-413
    expect(unknownAreaRewrite("/admin/not-a-page", false)).toBeNull(); // unchanged for Admin
    for (const known of ["/users/tasks", "/users/tasks/42", "/admin", "/admin/users", "/admin/users/7", "/admin/setup/task-types/3", "/admin/records/requests"]) expect(unknownAreaRewrite(known, true), known).toBeNull();
    expect(isUnknownUsersPath("/users/not-a-page")).toBe(true);
    expect(isUnknownAdminPath("/admin/setup/not-a-page")).toBe(true);
    expect(unknownAreaRewrite("/superadmin/not-a-page", true)).toBeNull(); // Super Admin: its [...rest] page alone
    const mw = read("middleware.ts");
    expect(mw).toMatch(/const pageView = \(request\.method === "GET" \|\| request\.method === "HEAD"\) && !request\.headers\.has\("next-action"\)/);
    expect(mw).toMatch(/signPath\(pagePath,/);
  });

  it("the not-found addresses are open (no page rule) and are no configured page; real pages keep their rules", () => {
    for (const address of Object.values(UNKNOWN_AREA_ADDRESS)) {
      expect(isOpenAddress(address), address).toBe(true);
      expect(pageForPath(address), address).toBeNull();
    }
    expect(isOpenAddress("/users/not-a-page")).toBe(false);
    expect(isOpenAddress("/admin/not-a-page")).toBe(false);
  });
});
