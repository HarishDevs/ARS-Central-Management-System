import type { NextRequest } from "next/server";
import { requireApiArea } from "@/server/authorization/guards";
import { searchRequests } from "@/lib/db/repositories/search.repository";
import { listRecent } from "@/lib/db/repositories/recent.repository";
import { parseSearchFilters } from "@/server/search/filters";
import { STATUS_WORD } from "@/features/ui/labels";
import { LIMITS, overLimit, tooManyResponse } from "@/server/security/limits";
import { apiError } from "@/lib/http/api-response";
import { quickWork } from "@/lib/db/repositories/work.repository";
import { listVisiblePortfolios } from "@/lib/db/repositories/portfolios.repository";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import { workViewer } from "@/server/work/task-access";
import { logError } from "@/lib/logging/logger";
import { searchPeople } from "@/lib/db/repositories/profile.repository";
import { photoUrl } from "@/server/profile/photo";
import { personLabel } from "@/lib/people/label";
import { listInfo } from "@/lib/db/repositories/info.repository";
import { infoListSql, parseInfoFilters } from "@/server/modules/info-lists";
import { indiaToday } from "@/server/modules/information";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import { quickMeetings, quickTickets } from "@/server/search/quick-more";

// WS-03/04 command palette data: requests matching the typed text (two or
// more characters), or the recently viewed ones. Access is the same SQL
// rule as search and the request page; knowing a number shows nothing more.
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiArea("users");
    if (await overLimit(`quick:${session.user.id}`, LIMITS.quick)) return tooManyResponse();
    const viewer = { id: session.user.id, isAdmin: session.user.roles.includes("IT_ADMIN") || session.user.roles.includes("SUPER_ADMIN") };
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const items =
      q.length >= 2
        ? (await searchRequests(viewer, { ...parseSearchFilters({ q }), page: 1 })).items.slice(0, 8).map((item) => ({ id: item.id, requestNo: item.requestNo, title: item.title, status: STATUS_WORD[item.status] ?? item.status }))
        : (await listRecent(viewer, 8)).map((item) => ({ id: item.id, requestNo: item.requestNo, title: item.title, status: STATUS_WORD[item.status] ?? item.status }));
    // D-215: tasks and projects the person can see (same rule as everywhere).
    const found = q.length >= 2 && hasModule(session.user, "TASK") && (await featureOn("tasks", session.user)) ? await quickWork(await workViewer(session.user), q) : { tasks: [], projects: [] };
    // D-307: projects only for people with the Projects module.
    const work = hasModule(session.user, "PROJECT") ? found : { ...found, projects: [] };
    // v1.69.0 (D-382): portfolios the person can see (Projects module and the "pm_portfolios" switch).
    const portfolios =
      q.length >= 2 && hasModule(session.user, "PROJECT") && (await featureOn("tasks", session.user)) && (await featureOn("pm_portfolios", session.user))
        ? (await listVisiblePortfolios(await workViewer(session.user), { q, limit: 5 })).map((item) => ({ id: item.id, name: item.name }))
        : [];
    // D-232: people and information too (the universal search).
    const people = q.length >= 2 ? (await searchPeople(q)).map((person) => ({ id: person.id, name: person.name, label: personLabel(person), email: person.email, detail: [person.department, person.designation].filter(Boolean).join(" · "), photo: photoUrl(person.id, person.photoUpdatedAt) })) : [];
    let information: { id: number; infoNo: string; title: string }[] = [];
    if (q.length >= 2 && hasModule(session.user, "INFORMATION") && (await featureOn("information", session.user))) {
      const found = new Map<number, { id: number; infoNo: string; title: string }>();
      for (const base of ["INBOX", "SENT"] as const) {
        const sql = infoListSql(parseInfoFilters({ q, tab: "all" }, base), base, session.user.id, indiaToday(), []);
        for (const row of (await listInfo(sql.where, sql.params, sql.orderBy, 5, 0, session.user.id)).rows) found.set(row.id, { id: row.id, infoNo: row.infoNo, title: row.title });
      }
      information = [...found.values()].slice(0, 6);
    }
    // v1.72.1 (D-395, QA F-08): tickets and meetings too (their module and page access, then their lists' own visibility).
    const access = q.length >= 2 ? await navAccess(session.user) : null;
    const tickets = access && hasModule(session.user, "TICKET") && !isHiddenHref("/users/tickets", access.hidden) ? await quickTickets(session.user, q) : [];
    const meetings = access && hasModule(session.user, "MEETING") && !isHiddenHref("/users/meetings", access.hidden) ? await quickMeetings(session.user, q) : [];
    return Response.json({ kind: q.length >= 2 ? "search" : "recent", items, tasks: work.tasks, projects: work.projects, portfolios, people, information, tickets, meetings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as Error)?.name !== "ForbiddenError") logError("quick search failed", error);
    return apiError("NOT_FOUND", "Not found.", 404);
  }
}
