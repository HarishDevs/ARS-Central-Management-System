# ARS-CMS navigation, routing and RBAC audit (v1.88.0)

- **Date:** 23 Nov 2026
- **Build:** `main` 893fb4b (v1.88.0), worktree `nav-audit`, production build (`npm run build` + `next start -p 3260`)
- **Data:** throw-away database `ars_approvals_test_nav`, seeded by the e2e global setup (it has since been dropped). The test people were E2E_STAFF (User), E2E_ADMIN (User + IT Admin), E2E_SUPER (User + IT Admin + Super Admin), E2E_REQ and E2E_MGR. The audit added 39 tasks and one two-level request.
- **Probe:** `tests/e2e/zz-nav-audit.spec.ts`, run with `audit/nav/playwright.nav-audit.config.ts` in chunks `@c1` to `@c6`.
- **Evidence:**
  - one record per check (start, action, result, expected, actual) in `audit/nav/log-*.jsonl`;
  - screenshots in `audit/nav/shots/`.
- **Scope:** audit only. No application code, permission or non-test data was changed, and nothing was committed.

Decisions checked first, so that intended behaviour is not reported:
- D-016: a 404 for areas a person may not open.
- D-410: `?task=` pane.
- D-411/D-412: 308 for old admin addresses, sent before the session check.
- D-413: real 404 for unknown `/users` addresses.
- D-417 (v1.87.0):
  - panes close without a history entry;
  - Escape while typing in a pane is ignored;
  - `?from=` is only on the request page;
  - Back with an unsent comment is a known limitation;
  - the request page's way back reopens the record beside the list.
- Super Admin is itadmin-only.
- `/users/approvals` → `/users/requests|queue` and `/users/notifications` → `/users/inbox` are intended aliases.

---

## A. Executive summary

| | Total | Passed | Failed | Blocked / N/A |
|---|---|---|---|---|
| The 12 advanced scenarios (scenario level) | 12 | 7 (S1, S3, S5, S7, S8, S9, S11) | 4 (S2, S6, S10, S12) | 1 (S4: reports have no record links) |
| Browser checks (sub-cases at 1280, 768 and 375, overlays, session, lists) | 63 | 45 | 12 | 6 |
| Server-level checks (pages, RSC, APIs, Server Actions, sessions, routing per role) | 197 | 188 | 9 | 0 |
| **All checks** | **260** | **233** | **21** | **6** |

The 21 failed checks reduce to **8 defects**. There are **0 Critical and 0 High**: 4 are Medium and 4 are Low. 7 are confirmed and 1 is suspected/partial (NAV-05 is confirmed on two pages and suspected wider).

**Overall assessment:**
- **RBAC is sound on the server.**
  - Every `/admin` and `/superadmin` page calls `requireArea` itself, not only in the layout. So a crafted RSC request that skips the layout still gets `notFound()` with no data.
  - Every admin and superadmin API refuses the wrong role.
  - Direct Server Action calls refuse the wrong role and stored nothing (the users table count was unchanged).
  - Ended, expired, forged and inactive sessions are refused.
  - Roles never drift when moving between `/users`, `/admin` and `/superadmin`, in one tab or in two.
- **The one RBAC gap is information only (NAV-01).** The 404 that a User or IT Admin gets for a restricted page still sends that page's own title (for example "Audit log · ARS CMS"), and the browser tab shows it. This tells them the page exists, against D-016.
- **Navigation continuity from v1.87.0 holds:**
  - panes open and close with the right history;
  - Escape and the overlay stack work;
  - folds and the list origin are kept;
  - `?from=` on requests works;
  - refresh, new tabs and the area round trip all work.
- **The remaining defects are about where people come back to:**
  - the session-end return address drops the query (NAV-02);
  - a task reached from Admin → Records has no way back to Admin (NAV-04, deferred in v1.87.0 and still present);
  - Back with an unsent comment loses the draft (NAV-06, deferred and still present);
  - a few plain links do not keep list state (NAV-03, NAV-05, NAV-08).

**Blocked:**
- **Firefox:** `browserType.launch: spawn UNKNOWN` on this machine.
- **WebKit:**
  - It launches, but locally it is not usable. The app's CSP has `upgrade-insecure-requests`, so WebKit upgrades every script and style on `http://localhost` to https and gets nothing, and the page renders unstyled with no JavaScript (`audit/nav/shots/X-webkit-pane-error.png`).
  - This is a local http artefact, not a production defect: production is https.
  - The WebKit 404 check alone passed.
- **S4 (report → record):** neither Admin → Insights → Reports (request register, pending approvals) nor `/users/reports` have clickable record rows, so the scenario does not apply as written.
- **L2 (pagination):** the test data fits on one page of Admin → Records.

---

## B. Defect register

| ID | Module | Title | Role | Severity | Priority | Category | Reproducibility | Status | Fix status (v1.89.0, D-419) |
|---|---|---|---|---|---|---|---|---|---|
| NAV-01 | Admin, Super Admin (all 71 pages) | A restricted page's 404 still sends and shows the page's own title | User, IT Admin | Medium | P2 | RBAC: unauthorised access (information) | Always | Confirmed | Fixed 24 Nov 2026: the admin and superadmin layouts' `generateMetadata` (`server/authorization/area-metadata.ts`) runs the same role and page-access checks; refused = title template without `%s` (all 71 pages read "ARS CMS"). Unit scan of every page + e2e. |
| NAV-02 | Shell / session | When a session ends, the way back drops the query (`?task=`, filters, view, sort) | All | Medium | P2 | Session | Always | Confirmed | Fixed 24 Nov 2026: `returnAddress()` (lib/http/safe-next.ts) in SessionWatch and the middleware: path + query, validated by `safeNextPath`. |
| NAV-03 | Admin → Users & roles | "← All users" on a person's page drops the list's search and sort (the breadcrumb keeps them) | IT Admin, Super Admin | Low | P3 | State (search/filter loss) | Always | Confirmed | Fixed 24 Nov 2026: "← All users / pages / templates" are OriginLinks (4 pages). |
| NAV-04 | Admin → Records → task full page | A task opened from Admin → Records ignores `?from=`; its only in-page way back is "Tasks" in the users area | IT Admin, Super Admin | Medium | P2 | UX (back / breadcrumbs), role context | Always | Confirmed (deferred in v1.87.0, still present) | Fixed 24 Nov 2026: `returnToFor()` (server/authorization/return-to.ts) on the task (TaskDetail), ticket, meeting, information and request pages: first crumb + "← Back to Admin → Records". |
| NAV-05 | Users area detail pages | The breadcrumb parent is fixed and not the list the page was opened from (task from Task Summary → "Tasks" = Assigned to me; request from Inbox → "Waiting for me") | All | Low | P3 | UX (breadcrumbs) | Always on the pages tested | Confirmed on 2 pages, suspected wider | Fixed 24 Nov 2026: `originWay()` + OriginLink `crossList` on the parent crumb and the request's ← Back: an allow-listed users list (CROSS_LISTS) the page was opened from is named and linked. |
| NAV-06 | Task pane | Browser Back with an unsent pane comment closes the pane and loses the draft without asking | All | Medium | P2 | Navigation persistence | Always | Confirmed (deferred in v1.87.0, still present) | Fixed 24 Nov 2026: PaneControl capture-phase popstate guard: keeps the move from the router, restores the address, asks Discard draft? (Keep / Discard repeats the move). |
| NAV-07 | Sign-in | `next=` pointing at an area the person can't open lands on a 404 (with that page's title) instead of their home | User, IT Admin | Low | P3 | Routing (redirect) | Always | Confirmed | Fixed 24 Nov 2026: `landingFor()` on /login (server); SignInPanel goes through /login?next= so the area is checked. |
| NAV-08 | People profile, Super Admin danger zone | "← Back" (BackLink) goes back in the browser even when the previous entry is outside the app | All | Low | P3 | UX (back) | Always when the tab moved in the app before | Confirmed | Fixed 24 Nov 2026: BackLink checks the entry before this one (Navigation API: this site's entries only), else the tab's trail (`backStaysInApp`), not the sticky flag. |

Expected results, actual results and repro steps for each defect:

**NAV-01: a restricted page's 404 still sends and shows its title**
- **Expected:** a plain 404 that is identical to an unknown address (`<title>ARS CMS`), so a restricted page does not even confirm that it exists (D-016).
- **Actual:**
  - The status is 404 and no data or navigation is sent.
  - But the RSC stream carries the page's `metadata`, and `document.title` becomes, for example:
    - "Health console · ARS CMS";
    - "Audit log · ARS CMS";
    - "Page access · ARS CMS";
    - "Users & roles · ARS CMS".
  - An unknown address (`/superadmin/does-not-exist`) shows only "ARS CMS". The difference works as an oracle for which pages exist.
- **Repro:**
  1. Sign in as E2E_STAFF.
  2. Open `/superadmin/monitoring/audit`. It answers 404, and the tab reads "Audit log · ARS CMS".
  3. As E2E_ADMIN, `/superadmin/security/pages` shows "Page access · ARS CMS".

**NAV-02: the session-end way back drops the query**
- **Expected:** the signed-out and sign-in `next` keeps the full address, and after sign-in the same screen comes back (pane, view, filters).
- **Actual:**
  - In the browser: SessionWatch sends `next=<pathname>` only. `/users/work/my-tasks?view=list&task=1` came back as `/users/work/my-tasks` (no pane, default view).
  - In the middleware: an expired or invalid cookie on `/admin` or `/superadmin` gives `next=/admin/users`, and `?q=abc` is lost.
  - The server path (requireArea with NEXT_HEADER) keeps the query correctly.
- **Repro:**
  1. Open `/users/work/my-tasks?view=list&task=1`.
  2. End the session (delete the session row, or idle out).
  3. Focus the tab. The page goes to `/signed-out?reason=unknown&next=%2Fusers%2Fwork%2Fmy-tasks`.

**NAV-03: "← All users" drops the list's search and sort**
- **Expected:** the link returns to `/admin/users?q=E2E&sortBy=login&dir=desc`.
- **Actual:** it goes to `/admin/users`. The breadcrumb "Users & roles" and browser Back both keep the query.
- **Repro:**
  1. Open `/admin/users?q=E2E&sortBy=login&dir=desc`.
  2. Open a person.
  3. Click "← All users".

**NAV-04: a task from Admin → Records has no way back to Admin**
- **Expected:** a "Back to Admin → Records" link, as the request page has.
- **Actual:**
  - "Open full page" goes to `/users/tasks/38?from=/admin/records/tasks?q=NavAudit&sort=title&open=38`.
  - The task page ignores `from`. Its breadcrumb is only "Tasks → /users/tasks", which leads an admin to the users area's Assigned to me.
  - Browser Back works.
- **Repro:**
  1. As E2E_ADMIN, open `/admin/records/tasks`.
  2. Apply a power-search chip.
  3. Open a row.
  4. Click Open full page.

**NAV-05: the breadcrumb parent is fixed**
- **Expected:** the breadcrumb parent is the list the person came from, or OriginLink rewrites it.
- **Actual:**
  - OriginLink only adds a query when the origin's path equals the crumb's path, so a different origin list is ignored.
  - Task Summary → Open full page → the crumb is "Tasks" (`/users/tasks`).
  - Inbox → request → the crumbs are "Home / Waiting for me".
- **Repro:** S3b and S8a in `log-c2.jsonl`.

**NAV-06: Back with an unsent pane comment loses the draft**
- **Expected:** the draft is kept, or the person is asked first. × does ask "Discard draft?" (O3 passes).
- **Actual:** Back goes to `/users/work/my-tasks` with no prompt. Forward reopens the pane with an empty comment box.
- **Repro:**
  1. Open a task pane.
  2. Type a comment without sending it.
  3. Press browser Back.

**NAV-07: `next=` to an area the person can't open lands on a 404**
- **Expected:** a person who can't open the `next` area lands on their home (`/users`), as for an invalid `next`.
- **Actual:** `/login?next=/admin/users` as E2E_STAFF gives a 307 to `/admin/users`, which answers 404 with the title "Users & roles · ARS CMS".
- **Repro:** sign in as a User from a link to an admin page (for example, a shared admin link).

**NAV-08: BackLink leaves the app**
- **Expected:** the link stays in the app (its fallback list) when the previous history entry is not an app page.
- **Actual:**
  - The `ars.nav.moves` flag is sticky for the tab (sessionStorage).
  - After any earlier move in the app, BackLink calls `router.back()` even when the tab came from an outside page (an email, another site). It left to the outside page (`audit/nav/shots/E1-backlink.png`).
- **Repro:**
  1. In one tab, go `/users` → `/users/inbox`.
  2. Go to any outside page.
  3. Open `/users/people/<id>` in the same tab.
  4. Click ← Back.

---

## C. Role-wise navigation matrix (what was tested and the result)

Key:
- ✅ = works as intended;
- ❌ = defect (ID);
- 404 = correctly refused;
- — = not applicable.

| Module / flow | User (E2E_STAFF) | Admin (E2E_ADMIN: User + IT Admin) | Super Admin (E2E_SUPER: all three) |
|---|---|---|---|
| `/users` pages (home, My Tasks, inbox, search) | ✅ 200 | ✅ 200 | ✅ 200 |
| `/admin/*` pages | 404 ✅ (title leaks ❌ NAV-01) | ✅ 200 | ✅ 200 |
| `/superadmin/*` pages | 404 ✅ (title leaks ❌ NAV-01) | 404 ✅ (title leaks ❌ NAV-01) | ✅ 200 |
| RSC request skipping the layout | no data ✅ | no superadmin data ✅ | — |
| Admin APIs (`/api/admin/*`, admin analytics export) | 404 ✅ | ✅ | ✅ |
| Super Admin APIs (`/api/superadmin/*`, import templates) | 404 ✅ | 404 ✅ | ✅ |
| Admin Server Actions (create user, groups) | refused ✅ | allowed ✅ | allowed ✅ |
| Super Admin Server Actions (jobs, retention, demo) | refused ✅ | refused ✅ | allowed ✅ |
| Account menu "Switch space" | none ✅ | Admin ✅ | Admin + Super Admin ✅ |
| Command palette spaces | — | — | Admin space, Super Admin space ✅ |
| Area round trip (users → admin → superadmin → back to app → Back ×3) | — | — | ✅ the right sidebar each time |
| Task pane (open, close, Escape, Back, refresh, new tab) | ✅ | ✅ | ✅ |
| Record pane, Admin → Records (open, Escape, ×, refresh) | — | ✅ | ✅ |
| Records → request full page → `?from=` way back | — | ✅ | ✅ |
| Records → task full page → way back | — | ❌ NAV-04 | ❌ NAV-04 |
| Users & roles list → person → back | — | breadcrumb ✅, Back ✅, "← All users" ❌ NAV-03 | same |
| Notification (inbox and bell) → record → Back | ✅ (MGR) | ✅ | ✅ |
| Session ends on a detail page → sign in again | ❌ NAV-02 (query lost) | ❌ NAV-02 | ❌ NAV-02 (middleware path); soft navigation ✅ |
| Sign out, then Back | no data ✅ | no data ✅ | no data ✅ |
| Sign out in tab 2 → tab 1 navigates | ✅ | ✅ | ✅ |
| 768 px (side pane, outside click, Escape, rail) | ✅ | ✅ | ✅ |
| 375 px phone layout (full task page, menus, no sideways scroll) | ✅ | ✅ | ✅ |

---

## D. Navigation flow map

```
                         ┌──────────── /login?next= (safe-next) ───────────┐
 no cookie ─middleware──►│ /users*: next = path+query ✅                    │
                         │ /admin*: cookie invalid/expired → /signed-out    │
                         │          next = path only  ✗ NAV-02              │
                         └──────────────────────────────────────────────────┘
 session ends in page ─SessionWatch─► /signed-out?next=<pathname only> ✗ NAV-02 ─► /login ─► pathname (pane/filters lost)
 next to a forbidden area ─► 404 with that page's title ✗ NAV-07 / NAV-01

 /users ──(account menu / palette)──► /admin ──► /superadmin ──(Back to app)──► /users        ✅ (Back walks the same way)
   │                                   │
   │ My Tasks ─click─► ?task=<id> (push) ─×/Esc/backdrop─► back|replace ✅ ─Back─► closes ✅
   │      │                              └─Open full page─► /users/tasks/<id> ─Back─► ?task=<id> ✅
   │      │                                                     └─crumb "Tasks"─► /users/tasks ✗ NAV-05
   │      └─ typed comment + browser Back ─► draft lost ✗ NAV-06 (× asks Discard ✅)
   │ Inbox ?type= ─► request ─Back─► Inbox ?type= ✅ (crumb "Waiting for me" ✗ NAV-05)
   │ Search ?q= ─► record ─Back─► Search ?q= ✅
   │ People/<id> ─← Back─► router.back() even to an outside page ✗ NAV-08
   │
 /admin/records/<kind>?filters ─row─► ?open=<id> ─Esc/×─► same list ✅ ─refresh─► pane kept ✅
        ├─ request: Open full page ─► /users/requests/<id>?from= ─"Back to Admin → Records"─► list + pane ✅
        └─ task:    Open full page ─► /users/tasks/<id>?from= (ignored) ─crumb─► /users/tasks ✗ NAV-04 (Back ✅)
 /admin/users?q&sort ─► /admin/users/<id> ─crumb─► list+query ✅ │ "← All users" ─► /admin/users ✗ NAV-03 │ Back ✅
 old /admin/<x> and /superadmin/<x> ─308 (query kept)─► new address ✅;  unknown /users/x ─► 404 ✅;  trailing slash ─308─► ✅
```

---

## E. Root cause per defect

| ID | Component / route | Cause | Evidence | Recommended fix |
|---|---|---|---|---|
| NAV-01 | All 71 `app/admin/**/page.tsx` and `app/superadmin/**/page.tsx` (for example `app/superadmin/monitoring/audit/page.tsx:21`, `app/admin/users/(list)/page.tsx:26`) | Static `export const metadata = { title }`. Next 15.5 streams metadata separately (AsyncMetadataOutlet), so it is resolved and sent even when the page's `requireArea()` calls `notFound()`. | `log-c1.jsonl` RBAC-PAGE/RBAC-RSC; `curl` of `/superadmin` as a User shows `"Health console · ARS CMS"` in the flight data; `shots/S10-*.png`; `/superadmin/does-not-exist` shows only "ARS CMS" | Replace the static `metadata` in admin and superadmin pages with `generateMetadata()` from one helper, e.g. `areaMetadata("superadmin", "Audit log")`. It calls `getCurrentSession()` + `evaluateAreaAccess()` and returns `{}` (the root "ARS CMS") when the area is not allowed. A unit/e2e guard then asserts that the 404 body has no `· ARS CMS` title for each restricted page. |
| NAV-02 | `features/shell/SessionWatch.tsx:44` (`next=${encodeURIComponent(pathname)}`); `middleware.ts:145` (`signedOut.searchParams.set("next", pathname)`) | Both build the return address from the path alone. The server guard (`guards.ts`, NEXT_HEADER) already keeps the query. | `log-c1.jsonl` SESSION-ENDED (expired cookie, `/admin/users?q=abc` → `next=/admin/users`); `log-c2.jsonl` S12a; `shots/S12a-signed-out.png` | SessionWatch: use `window.location.pathname + window.location.search` (or `useSearchParams`). Middleware: `next = pathname + request.nextUrl.search`. `safeNextPath` already validates both. |
| NAV-03 | `app/admin/users/[id]/page.tsx:49-51` | A plain `<Link href="/admin/users">`. The breadcrumb next to it uses OriginLink (`features/ui/Display.tsx:151`). | `log-c2b.jsonl` S2-all-users-link; `shots/S2-all-users-link.png` | Render "← All users" with `<OriginLink href="/admin/users">`. Scan for other "← All …" plain links next to Breadcrumbs. |
| NAV-04 | `app/users/tasks/[id]/page.tsx:15` (searchParams type has no `from`); `features/work/TaskDetail.tsx:250-255` (fixed crumb) | `parseReturnTo` is wired only into `app/users/requests/[id]/page.tsx:197`. RecordPane adds `?from=` for every kind (`features/ui/RecordPane.tsx:38`). This is documented as a known limitation in `GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md` §11. | `log-c2b.jsonl` S6b; `shots/S6b-task-fullpage.png` | Read `from` in the task page and pass it to TaskDetail. Use `parseReturnTo(query.from, area => evaluateAreaAccess(user, area).allowed)` to replace the first crumb and show "← Back to Admin → Records". Do the same for tickets, meetings and information. |
| NAV-05 | `features/shell/motion-rules.ts:88-100` (`originFor` only matches the same pathname); `features/work/TaskDetail.tsx:252`; request page `backTo` | The origin list is used only when it is the crumb's own path. A different source list (Task Summary, Inbox) is ignored. | `log-c2b.jsonl` S3b and S8a (crumbs) | Optional: let `originFor` return the remembered origin when it is an allow-listed users list (`/users/work/my-tasks`, `/users/inbox`, `/users/search`), with its label, or name the crumb from the origin. Low priority: browser Back already works. |
| NAV-06 | `features/ui/PaneControl.tsx` (× and Escape guarded) with no popstate guard | The App Router gives no hook to cancel a Back. The draft is held only in component state, so the unmount drops it. | `log-c4b.jsonl` O4; `shots/O4-unsent-back.png` | Keep unsent pane comments in sessionStorage per task (as `task-draft-store.ts` does for new tasks) and restore them on reopen. Optionally add a `beforeunload` guard for hard navigations. |
| NAV-07 | `app/(public)/login/page.tsx:12-13` (`redirect(next)` after `safeNextPath`) | `next` is checked only for being same-origin, not for whether the person may open that area. | `log-c3.jsonl` H3; `log-c1.jsonl` ROUTING (`/login?next=/admin` → 307) | On the login redirect (and after sign-in completes), when `next` is under `/admin` or `/superadmin` and `evaluateAreaAccess` fails, use `/users`. Fixing NAV-01 removes the title part. |
| NAV-08 | `features/ui/BackLink.tsx:22` with `features/shell/NavMemory.tsx:17` | `movedInApp()` is a sticky per-tab flag. `history.length > 1` does not prove the previous entry is an app page. | `log-c6.jsonl` E1; `shots/E1-backlink.png` | Reuse the pane-close trail (`currentTrail()` in `features/ui/pane-close.ts`). Go back only when `trail.prev` is set (an in-app page seen in this document's life) and the last move was forwards; otherwise follow the fallback `href`. |

---

## F. Recommended fixes in priority order

1. **NAV-01 (P2, security hygiene).**
   - Files: all admin and superadmin `page.tsx` files, plus a new helper in `server/authorization/` (e.g. `area-metadata.ts`).
   - Implementation:
     - `export async function generateMetadata() { return areaMetadata("admin", "Users & roles"); }`, where the helper returns `{ title }` only when `evaluateAreaAccess(session.user, area).allowed`.
     - A codemod can change the 71 static `metadata` exports.
   - Regression:
     - for each restricted page as a User and as an IT Admin, the 404 body has no `· ARS CMS` title and `document.title === "ARS CMS"`;
     - an allowed role still sees the right title.
2. **NAV-02 (P2).**
   - Files: `features/shell/SessionWatch.tsx`, `middleware.ts`.
   - Implementation: include the search in `next` in both places.
   - Regression (S12a):
     - `?view=list&task=<id>` survives session end → signed-out → sign-in, and the pane reopens;
     - an expired cookie on `/admin/users?q=x` gives `next=/admin/users?q=x`;
     - `safeNextPath` still refuses `//`, `\` and schemes.
3. **NAV-04 (P2).**
   - Files: `app/users/tasks/[id]/page.tsx`, `features/work/TaskDetail.tsx`, and the same for the ticket, meeting and information pages.
   - Implementation: `parseReturnTo` as on the request page; the first breadcrumb plus "← Back to Admin → Records".
   - Regression (S6b): Records → task → Open full page → the way back returns to the filtered list with the pane. A tampered `from` is ignored. A non-admin never gets an `/admin` link.
4. **NAV-06 (P2, known limitation).**
   - Files: `features/ui/PaneControl.tsx` and the pane comment composer (`features/work/CommentThread.tsx`).
   - Implementation: a per-task sessionStorage draft (2 h TTL, like the fold memory), restored on open and cleared on send or Discard.
   - Regression (O4): type → Back → Forward (or reopen) → the draft is there. Send clears it.
5. **NAV-07 (P3).**
   - File: `app/(public)/login/page.tsx` and the post-sign-in redirect in `server/auth/complete-sign-in.ts`.
   - Implementation: check the area of `next` and fall back to `/users` when the person may not open it.
   - Regression (H3): User + `next=/admin/users` → `/users`; Admin + `next=/admin/users` → `/admin/users`.
6. **NAV-03 (P3).**
   - File: `app/admin/users/[id]/page.tsx`.
   - Implementation: OriginLink.
   - Regression (S2): all three ways back keep `?q&sortBy&dir`.
7. **NAV-08 (P3).**
   - File: `features/ui/BackLink.tsx`.
   - Implementation: trail-based check.
   - Regression (E1): an outside page → profile → ← Back stays in the app. An in-app list → profile → ← Back keeps the list's filters.
8. **NAV-05 (P3, optional).**
   - File: `features/shell/motion-rules.ts` (`originFor`).
   - Implementation: allow-listed cross-list origins.
   - Regression (S3b, S8a): the crumb names the list the person came from.

---

## G. Reusable regression checklist

Run `tests/e2e/v1890-navigation.spec.ts` (v1.89.0; it replaced the probe `zz-nav-audit.spec.ts`), or check by hand.

**RBAC (server level, each role, plus no cookie):**
- [ ] `/admin/*`: User → 404; `/superadmin/*`: User and IT Admin → 404. The body and `document.title` do not name the page (NAV-01).
- [ ] RSC GET with a router-state tree that claims the layout is drawn: no data for the wrong role.
- [ ] `/api/admin/*`, `/api/superadmin/*` and the admin analytics export: wrong role → 404, no cookie → 404.
- [ ] Direct Server Action POST (`Next-Action` id from the build) as the wrong role → "Not found.", and no rows change.
- [ ] Ended, expired, bad-signature and inactive sessions → sign-in or signed-out, never a page or data.

**Routing:**
- [ ] Unknown `/users/x`, `/admin/x` and `/superadmin/x` → 404. A trailing slash → 308 without it.
- [ ] Old panel addresses → 308 to the new address, query kept (`/admin/attention` → `/admin#attention`).
- [ ] `?task=` with an invisible or unknown id → page 200, the pane says not found, and no title is shown.
- [ ] `?from=` tampering (`//host`, `/superadmin` for an IT Admin, a users list) is ignored. `login?next=` with an external, `/\`, or scheme value goes to `/users`.

**Panes and overlays:**
- [ ] A task link → `?task=` push. ×, Escape and the backdrop close it without a history entry. Back closes it. Focus returns to the row.
- [ ] Record pane: Escape and × keep the list's filters and sort. Refresh keeps `?open=`.
- [ ] Palette over a pane: the 1st Escape closes the palette, the 2nd the pane. A ⋯ menu in the pane: Escape closes the menu only.
- [ ] An unsent comment: × asks "Discard draft?". Back keeps the draft (NAV-06).
- [ ] The bell or menu open + Back: no stuck overlay, no `inert`, no scroll lock.

**Return paths:**
- [ ] Admin → Users & roles (`?q&sort`) → person → breadcrumb, "← All users" and Back all keep the query (NAV-03).
- [ ] Admin → Records → request → Open full page → "Back to Admin → Records" returns to the list and pane.
- [ ] Admin → Records → task → Open full page → the same (NAV-04).
- [ ] My Tasks (fold + scroll) → another module → Back: fold and scroll kept. Board view kept.
- [ ] Inbox `?type=` → record → Back → same filter. Search `?q=` → record → Back → same results.
- [ ] BackLink after arriving from outside the app stays in the app (NAV-08).

**Session:**
- [ ] Session ends on `/users/…?view&task` → signed-out `next` keeps the query → sign-in reopens the same screen (NAV-02).
- [ ] Session ends on `/admin/…?q` (an expired cookie) → `next` keeps the query (NAV-02).
- [ ] Sign out → Back: no protected content. Sign out in tab 2 → tab 1's next navigation → sign-in with `next`.
- [ ] Signed in, `/login` → `/users`. `next` to a forbidden area → `/users` (NAV-07).

**Multi-role:**
- [ ] Account menu spaces: User none; IT Admin Admin; Super Admin Admin and Super Admin. The palette lists the spaces.
- [ ] users → admin → superadmin → Back to app → Back ×3: each step shows its area's sidebar.
- [ ] Two tabs in different areas keep their own area after reloads.

**Responsive:**
- [ ] 1280: side pane. 768: side pane, outside click and Escape close, the rail sidebar works.
- [ ] 375 phone layout: task links open the full page, and a desktop `?task=` link opens the full task page. The admin and superadmin menus list the area's items. No sideways scroll on `/admin/users`, `/admin/records/tasks`, `/superadmin`, `/superadmin/monitoring/audit`, `/users/inbox` or `/users/work/my-tasks`.
- [ ] Firefox and WebKit: `E2E_BROWSER=firefox` (with `E2E_FIREFOX_PATH` on this machine) or `E2E_BROWSER=webkit`; the e2e server sets `E2E_LOCAL_HTTP=1` so WebKit loads the app on http://localhost (v1.89.0, section H).

---

## H. v1.89.0 follow-up (24 Nov 2026, D-419)

All eight defects are fixed in shared code (the **Fix status** column of the register in B). The probe `tests/e2e/zz-nav-audit.spec.ts` and its runner config were replaced by the permanent spec `tests/e2e/v1890-navigation.spec.ts` (NAV-01..08 and the scenarios S1, S2, S3, S5, S6, S7, S8, S9, S10, S11, S12; S4 stays not applicable: reports have no record links). Every server check is unchanged; the spec also checks that the wrong role is still refused (pages and APIs).

**Test harness (the two blocked items):**
- **Firefox "spawn UNKNOWN":** not a Playwright, path-length, antivirus or headless problem. Windows 11 build 26300 (26H2) refuses to start the unsigned Playwright Firefox 155 (`firefox-1543`) from any folder under `%LOCALAPPDATA%` (the Application event log, source SideBySide: "Dependent Assembly mozglue … could not be found"; `mozglue.dll` and its manifest are there). The same files start from `%TEMP%` or another drive. Workaround: a copy of the build at `D:\pw-firefox-1543\firefox` and `E2E_BROWSER=firefox E2E_FIREFOX_PATH=D:\pw-firefox-1543\firefox\firefox.exe` (playwright.config.ts). After a Playwright upgrade, copy the new `firefox-<rev>\firefox` folder the same way.
- **WebKit on http://localhost:** the CSP now leaves out `upgrade-insecure-requests` only when the browser asked for a loopback host (localhost, 127.0.0.1, [::1]) and the server is not in production, or was started with the explicit `E2E_LOCAL_HTTP=1` (set in the e2e server environment). Production's policy is unchanged byte for byte (unit test `tests/security/v1890-navigation.test.ts`). Run with `E2E_BROWSER=webkit`.

### Appendix: code inspected

| Area | Files |
|---|---|
| Middleware | `middleware.ts` (public prefixes, 308 panel redirects before the session check, `/admin` cookie pre-check, signed path header, unknown-users rewrite) |
| Guards | `server/authorization/guards.ts`, `policy.ts`, `page-access.ts` |
| Routing | `lib/routing/users-routes.ts`, `panel-redirects.ts`, `unknown-users-path.ts` |
| Safe redirects and session | `lib/http/safe-next.ts`; `features/shell/SessionWatch.tsx` |
| Task pane | `app/users/layout.tsx` and `app/users/@pane/*`; `features/work/TaskPaneHost.tsx`, `TaskPane.tsx` |
| Record pane and overlays | `features/ui/RecordPane.tsx`, `pane-close.ts`, `overlay-stack.ts`, `PaneControl.tsx` |
| Place, fold and back links | `features/shell/PlaceMemory.tsx`, `NavMemory.tsx`, `motion-rules.ts`; `features/ui/fold-memory.ts`, `OriginLink.tsx`, `BackLink.tsx`, `Display.tsx` (Breadcrumbs) |
| Return links | `lib/nav/return-to.ts`; `app/users/requests/[id]/page.tsx` |
| Server code | every admin and superadmin `page.tsx` (all call `requireArea`); every `"use server"` file (admin actions go through `getAdminActor` → `requireApiArea`; superadmin actions through local `superAdmin()` helpers); every `app/api/**/route.ts` |

**Web storage in use (sessionStorage, per tab, unless noted):**
- `ars.nav.moves`;
- `ars.place:*`;
- `ars.origin:*`;
- `ars.fold:*`;
- task draft store;
- PowerSearch/DataTable column widths and record-pane mode (localStorage);
- `ars.nav.groups.<area>.<user>` (sidebar groups, localStorage);
- tour and PWA flags.

None of these hold role or permission state. Roles are always read on the server.
