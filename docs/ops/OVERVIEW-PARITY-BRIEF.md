# Brief: the three Home overviews identically featured (owner, 22 Nov 2026)

Owner: "Match all 3 Overview Screens, it should be identically featured." Approved to build now, in parallel with Task Summary R3, as **v1.79.0** (R3 is v1.78.0).

The three overviews are Home's focus views (`app/users/(home)/page.tsx`, `?home=approvals|tasks|meetings`):
- **Task Management** — `features/home/MyWorkOverview.tsx` + `HomeWidgets.tsx` (the most complete; the reference).
- **Approvals** — inline in `app/users/(home)/page.tsx` ("Approval Overview").
- **Meetings** — `features/meetings/MeetingHome.tsx`.

## Every overview gets the same features
1. **Header:** the HomeGreeting (date + time-of-day greeting) when `pm_foundations` is on (as Tasks); page icon tile; title "<Area> – Overview" (Approvals – Overview, Task Management – Overview → keep "My Work – Overview" wording consistent: use one pattern for all three, e.g. "Approvals – Overview", "My Work – Overview", "Meetings – Overview"); the person's designation · department line; one-line description; right side: the area switcher + **PeriodPicker** (same periods, same URL keys) on all three.
2. **Quick-action row** (`features/home/QuickActions.tsx`, v1.77.1) on all three, create action first (primary), pages the person can't open left out, and **+ Add widgets / Customise** at the right end (the toolbar portal pattern from v1.77.1 — generalise it).
3. **Four summary cards** on each, the same card design as Tasks (value, label, note, and **change vs the previous period** where meaningful, using the chosen period). Approvals: Waiting for me, Overdue for me, My open requests, Decided by me this period (with change). Meetings: Upcoming, To approve, MOM to write, Held this period (with change). Tasks: unchanged.
4. **Personal widget layout per overview:** the existing Home widget system (`server/home/widgets.ts`, `home-service`, `home.repository`, `homeLayoutAction`) extended with an overview scope (approvals / tasks / meetings): each person has a separate layout per overview, Add widgets (dropdown of widgets not shown), each widget's ⋯ Actions (Move up/down, Half/Full width, Remove), Customise (drag handles, keyboard pick-up, Reset to that overview's defaults). Migration if the layout storage needs a scope column (forward-only, later than every existing migration, no triggers; existing Task layouts become scope "tasks").
5. **Standard widgets available on all three:**
   - **Private notepad** (one note per person shared by all three overviews, or per overview — choose and document; default: one shared note).
   - **Day-by-day chart for the period** (same chart component as "My weekly workload"): Tasks = assigned vs completed (existing); Approvals = requests raised by me vs steps I decided; Meetings = meetings I attended/held vs actions completed.
   - **Needs attention** (Meetings has it; build the Approvals one from overdue/due-soon steps and returned requests; Tasks from overdue tasks and tasks due today).
   - **Quick insights** (Approvals has it: avg decision time etc.; Meetings from its figures/insights; Tasks: completion rate, on-time %, average days to complete).
6. **Each overview's own sections become widgets** (so they can be moved/resized/removed): Approvals — Waiting for me, Due soon or overdue, Returned to me, My recent requests (keep pagination and column sorts), Drafts. Meetings — Coming up, Waiting for my approval, My action items, Done to confirm, Figures (KPI grid + tallies, only when the dashboard figures page access allows), Register. Tasks — unchanged.
7. Defaults: each overview's default layout reproduces today's screen order, so nothing disappears for anyone until they customise.

## Must keep
- Every list limited to what the person may see (unchanged queries); figures follow the existing page access (`isHiddenHref`, meetings dashboard access).
- The Classic view / Gateway (D-210), the tour's `data-tour` anchors (page-header, overview-tiles), FirstUseChecklist, QuietRefresh, mobile layout (`MobileHome`) unchanged in behaviour; phone width works.
- Existing e2e for Home/approvals/meetings keep passing (update only where the layout intentionally moved, and say so).
- WCAG 2.2 AA, light/dark tokens only, keyboard for every drag, announcements (reuse HomeWidgets).
