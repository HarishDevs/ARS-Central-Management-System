# Release notes

## v1.90.0 (25 Nov 2026): every ticket status count, Undo on repeating tasks, select and approve on Waiting for me, TODAY() and NOW()
The owner's four requests of 25 Nov 2026 (D-427..D-430), the build execution policy (D-431) and the engineering governance addendum (D-432). **No migration, no new data collected, no new setting.**

- **Ticket dashboards: every status count** ("display all status count"): each category's card still says *10 open · 2 to assign · 0 overdue*, and now lists every status with its count (New, Assigned, In progress, Awaiting confirmation, Reopened, Closed with the auto-closed ones, and Overdue), zeros included, in the order tickets move. Each count opens the category's dashboard filtered to that status. You see counts only for the tickets you may see, as before.
- **Fixed: Undo on a repeating task** ("after completing a task, if we click on Undo and then complete the same task again, the task for the next day is not being created"). Completing a repeating task moved its repeat to the next task; Undo reopened the task without its repeat, so completing it again made nothing. Now Undo (or Reopen) also takes back the next task it made, when nobody has worked on it yet, and gives the repeat back, so completing again makes the next day's task, once. If someone already worked on the next task, it stays and no second one is made.
- **Waiting for me: select and approve several** ("in the table itself I want select and bulk approval option"): a tick box on each approval row (and on each phone card), Select all for the page, a bar with *N selected*, **Approve** and **Clear**, and one optional comment for every approval. Approve asks first (*Approve 7 requests?*), approves each request on its own with the same checks, record and messages as a single approval, and then says *Approved 7 · Skipped 2* with the reasons and links. Work steps and requests on hold are left for one by one; at most 50 at a time; there is no bulk Reject (a possible follow-up). The Terms add one line: approving several at once is your own decision for each request.
- **Formulas: TODAY() and NOW()** ("Add TODAY() and NOW() in the formulas functions"): *[NFD] − TODAY* now reads (brackets optional, any case) and gives the days left; **NOW()** is the date and time now, so a date minus NOW() gives days with decimals (ROUND tidies it). Both are in the Functions list with examples, are worked out when you look (never stored, nothing in the task's activity) and count as one input each. A typed dash (– or —) now counts as minus. The ready-made NFD Delay is now DAYS(TODAY(), [NFD]) (the same result; fields already saved keep working).
- **How builds are run** (owner): every build follows `docs/ops/BUILD-EXECUTION-POLICY.md` and `docs/ops/ENGINEERING-GOVERNANCE.md`; known test failures are kept in `docs/qa/KNOWN-FAILURES.md`, technical debt in `docs/TECH-DEBT.md`, and a live status file per build in `docs/ops/build-status/`.

**Owner steps:** publish as usual (GoDaddy: pull the tag and restart; no new dependencies, so no `npm install` is needed). No migration runs (none added); no setting to change. After publishing: open Waiting for me and tick two requests to see the bar; open Tickets → Ticket dashboards to see the status counts.

## v1.89.0 (25 Nov 2026): navigation, motion and one look for every screen
One release in stages (owner): navigation fixes, then the motion and transition system, UI unification, visual baselines and sign-off. **No migration, no new data, no new setting to change.**

**The release in short (for the owner):**
- **Getting around** (stage 1): signing in again brings back the same view; links to pages you can't open land on your Home; ← Back and breadcrumbs return to the list you came from as you left it; Back with an unsent comment asks first.
- **Motion** (stage 2): pages change with a short fade; one set of timings for menus, windows and panels; nothing moves with Reduce motion; Analytics and Task Summary no longer jump while loading.
- **One look for every screen** (stages 3a-3c): the same frame (top bar, sidebar, page spacing) in the app, Admin and Super Admin; one size for buttons and fields; every list with the same toolbar and as cards on a phone; every record page laid out the same way; wider pages on large screens; tablets start with the sidebar folded.
- **Accessibility** (stage 3d): readable status colours, forms that say what is missing, menus and pickers that stay where you clicked, one popover look, screen-reader announcements.
- **Dates** (stages 3e and 4): one way of writing dates and times (India time, 12-hour); one date picker for every date field in the app.
- **Fixed in the last stage:** after an action in the task side panel (Mark complete, Undo, a reaction) the panel showed the old state and its buttons stayed greyed out until it was closed.
- **Quality:** the release was checked in Chrome, Firefox and Safari's engine (WebKit) on Windows, at nine screen sizes, light and dark; 155 reference screenshots now guard the layout. Not checked: real Safari on a Mac / iPhone, real screen readers, a slow network (see `docs/qa/FINAL_QA_SIGNOFF.md`).
- **Owner steps:** none for the app. Page transitions: only if **Super Admin → Settings → Features → Page transitions** was ever saved as Off (stage 2).

**Stage 1: navigation fixes** (D-419, from the navigation audit of v1.88.0, `docs/qa/NAVIGATION-AUDIT.md`):
- **Signing in again returns you to the same view:** the same page with the task or record you had open beside it, and the same view, filters and sort (it kept only the page before).
- **A link to a page you can't open** (for example a shared Admin link) signs you in to your Home, not to a "page isn't available" screen. Such a page's browser tab no longer shows its name either.
- **The way back from Admin → Records** (← Back to Admin → Records, and the first breadcrumb) now works for tasks, tickets, meetings and notices too, not only requests, back to the same filtered list.
- **Breadcrumbs name the list you came from:** a task opened from Task Summary says Task Summary, a request opened from the Inbox says Inbox, and both return to it as you left it.
- **← All users** (and ← All pages, ← All templates) keep the list's search and sort.
- **The browser's Back with an unsent comment** in a task or record beside a list now asks **Discard draft?** first, like ×, Esc and a click outside.
- **← Back** on a colleague's card or the Danger zone pages never takes you out of ARS CMS.

**Stage 2: motion and transition system** (D-420, from `docs/qa/GLOBAL_MOTION_AUDIT.md` and `GLOBAL_TRANSITION_INVENTORY.md`; record in `docs/qa/GLOBAL_MOTION_DESIGN_SYSTEM.md`):
- **Pages now change smoothly:** the main area fades in with a small rise (0.2 s) when you open another page; the sidebar and top bar stay still. Back and Forward stay instant and keep your place. Pages that take longer than 0.3 s simply appear (no waiting for an animation).
- **One set of timings everywhere** (the owner's: 100 / 150 / 200 / 250 / 300 ms): menus 0.15 s, windows and side panels 0.25 s, pages 0.2 s. Windows, side panels, toasts, the Pico Bot panel and the draft task window come in and leave smoothly; buttons respond when pressed; progress bars, the tour spotlight, the phone tab bar and the approval journey's van move without reflowing the page.
- **The sidebar** opens and folds in one step, with its labels fading in at the same moment (the page and the sidebar no longer move by different amounts).
- **Analytics no longer jumps or flickers** while it loads (the page bar and sections are placed before the first paint).
- **Reduce motion** on your device: nothing moves and pages don't animate; scrolling to a field with an error jumps instead of gliding.
- **Fixed:** with page transitions on, Safari (WebKit) could freeze for up to 4 s on a slow page and stop answering after quick clicks; a "Transition was skipped" error was reported on quick clicks.
- **Owner steps:** nothing for most installations: page transitions are now **On by default**. If **Super Admin → Settings → Features → Page transitions** was ever saved as **Off**, that saved choice is kept: set it to **On** (or leave Off to keep them off). The switch remains the off switch.

**Stage 3a: one layout and sizes for every screen** (D-421, the owner's reference dimensions; from `docs/qa/UI_UX_DEFECT_REPORT.md` batches 0 and 1; record in `docs/qa/UI_REFACTORING_LOG.md` and `BUG_FIX_LOG.md`):
- **Fixed:** a very long title with no spaces (a pasted link, reference or code) made the task page, and any page whose title is a record's name, scroll sideways by up to 1,800 pixels. It now wraps inside the page.
- **Fixed:** at 400 % zoom (320 pixels wide) the task page no longer scrolls sideways; a long assignee name is shortened with "…".
- **Wider pages:** on large screens the page now uses the room beside the sidebar (up to 1,600 pixels) and starts right next to it, instead of a centred 1,280-pixel column. Help, Privacy and Terms keep a comfortable reading width.
- **The same frame everywhere:** top bar 64 pixels (56 on phones, now in Admin and Super Admin too), sidebar 250 pixels (72 when folded, icons centred), 24 pixels of space around the page (16 on phones). Page titles are 24 pixels on every page that uses the shared title.
- **Tablets** (768 to 1,279 pixels wide) start with the sidebar folded to its icons, so the page has more room; **☰** opens it and your choice is remembered on that device.
- **Buttons and fields have one set of sizes:** buttons 40 pixels (compact and toolbar buttons 32), fields 42 (compact fields 32); on touch screens every button and field is at least 44 pixels tall.
- **Privacy:** the cookies paragraph now names the sidebar's two small cookies (`ars_sidebar`, your fold choice; `ars_vw`, "tablet" or "wide"); effective date 24 November 2026.
- **The Classic view is unchanged** (owner's decision for now).
- **Owner steps:** none.

**Stage 3b: shared components** (D-422, `docs/qa/UI_UX_DEFECT_REPORT.md` batch 2; record in `docs/qa/UI_REFACTORING_LOG.md` and `BUG_FIX_LOG.md`):
- **Every field and button now has its named size on every page** (fields 42, compact fields 32, buttons 40, compact buttons 32): about 200 places in 70 screens (Projects, the Tickets board, Admin set-up, Super Admin and more) had their own heights.
- **Buttons are as wide as their words** (they filled the whole form before, for example **Save changes** on a calendar entry and **Approve and share points** on a meeting). The sign-in screens keep their full-width buttons.
- **Lists on a phone are cards:** Tasks, Meetings, Tickets, Admin → Users and Records, and the Super Admin logs (audit, sign-ins, deliveries, AI history) show one card per row, with each value after its column name, the way Approvals and Information already did. Nothing scrolls sideways; a computer still shows the table.
- **One list toolbar:** Projects now has the same toolbar as the other lists (its search is the toolbar's search icon); the tabs of Projects, Meetings and Tickets sit in the toolbar's row.
- **Every page has a visible title:** the **AI Assistant** shows its title like the other modules, **Home** on a phone says Home, and every phone screen title has one size (22, bold). Section headings are one size (18), figures in tiles one size (22).
- **On touch screens** the priority box in task lists, a section's name and the round task tick are at least 44 pixels to tap; a mouse keeps the dense list.
- **Windows (dialogs):** one title size, one close button (40 pixels, 44 on touch), the same padding; the "page isn't available" screen in Admin and Super Admin now leads to their own home (it showed a requests search before), and **Search the app** in the main area.
- **Forms** for a new task, notice, meeting and ticket keep a comfortable width (960 pixels) on wide screens.
- **Owner steps:** none.

**Stage 3c: the module pages** (D-423, `docs/qa/UI_UX_DEFECT_REPORT.md` batch 3; record in `docs/qa/UI_REFACTORING_LOG.md` and `BUG_FIX_LOG.md`):
- **Every list has the same toolbar:** Portfolios, the coordinator board and every Admin → Records tab now use it. In Records the filter chips and **Add filter** sit on the toolbar's line with **Sort** and **Group** (Tickets and Meetings gained **Sort**); on the board the status chips lead the line and **Category** and **Only overdue** are under **Filter**. The audit log's download dates are one **From – To** date picker.
- **More lists are cards on a phone:** the Insights dashboards, reports, workload and metrics, the Admin set-up lists (budgets, task / information / ticket forms), the coordinator board, a portfolio's list and the Super Admin data pages (jobs, retention, backup, page access, Google, WhatsApp templates, AI data sources). Nothing is left as a squeezed table.
- **"New …" everywhere:** each list's main button says **New ticket**, **New meeting**, **New project**, **New portfolio**, **New user**, **New task** or **New information**, with a **+** icon.
- **A record's page reads the same in every module:** its status and priority badges sit beside the title, **← Back to …** (when there is one) at the right end of the breadcrumb line, and record numbers look the same in every list.
- **Windows** for a holiday date, deleting a task from its side panel, saving a project as a template, sharing a project or task and the keyboard shortcuts now open and close like every other window (same title, close button, buttons on the right).
- **A mistyped address** inside the app shows **This page isn't available** inside the app, with the sidebar and your area's way home; someone who may not open an area still sees the plain page, as before.
- **Fixed:** in Admin → Records → Tickets and Meetings a click on a row did not open the record beside the table.
- **Admin settings that are one form** (meeting settings, ticket categories, approver groups, AI rules, a reminder rule) keep a readable width on wide screens.
- **Owner steps:** none.

**Stage 3d: accessibility, overlays and the last layout items** (D-424, `docs/qa/UI_UX_DEFECT_REPORT.md` batch 4; record in `docs/qa/UI_REFACTORING_LOG.md`, `BUG_FIX_LOG.md` and `ACCESSIBILITY_TEST_REPORT.md`):
- **Readable status colours:** green and orange status text is a shade darker, so a due date on the highlighted Task Summary row passes the contrast rule (5.0:1, was 4.2:1); dark theme unchanged.
- **Create task says what is missing** instead of greying out its button (name, person, due date), and takes you to it. **Out of office** ties "choose a person" to the picker.
- **Menus and pickers stay where you clicked:** a menu opened while the task pane was still sliding in (⋯) could open off screen, and the phone date sheet in Create task sat above the bottom edge; fixed at the root (an entry animation no longer leaves a transform behind).
- **One popover look:** menus, the bell, and the date and people pickers share the same corners, border, shadow and short unfold; a people picker returns you to its button after Esc or a choice.
- **Screen readers:** the corner messages are always announced; every list page has the same structure (title, tabs, toolbar, list).
- **Phones:** the last row of a list scrolls clear of Pico Bot's button.
- **Task Summary opened with a task beside it** no longer jumps while it loads.
- **Moving between the app, Admin and Super Admin** changes the page without the fade (the whole frame changes there). **Safari and iPhone / iPad browsers** change pages without the fade for now: it crashed the page in the Safari test browser.
- **Fixed:** the Profile → App & devices page could hang Safari-type browsers in testing (it no longer looks up a notification subscription before notifications are allowed) and showed a hydration error there; the Dashboards hub opens Utilisation with a proper redirect (no page refresh tag).
- **Owner steps:** none.

**Stage 3e: dates, date pickers and wording** (D-425, `docs/qa/UI_UX_DEFECT_REPORT.md` batch 5; record in `docs/qa/UI_REFACTORING_LOG.md`, `BUG_FIX_LOG.md` and `GLOBAL_DESIGN_SYSTEM.md` §10):
- **One way of writing dates and times, India time, everywhere:** "24 Nov 2026", "24 Nov 2026, 3:05 pm", "24 Nov" within the year, "Tue, 24 Nov 2026, 11:00 am to 12:30 pm" for a meeting. Admin → Records now shows 12-hour times (it showed 24-hour ones), the meetings list no longer shows "24 Nov, 2026", and days no longer start with a 0 ("1 Nov"). Emails, WhatsApp messages and notifications use the same forms.
- **"2 h ago", "Yesterday"** and the like are worked out in your browser (the page first shows the exact time, then the short one, in the same place); the exact time is in the tooltip. The server and your browser can no longer write a time differently, the likely cause of an occasional loading error seen in testing.
- **The date picker everywhere you choose dates to look at:** Analytics and report periods, the Admin and ticket dashboards, Home's custom period, the Task, Information and request filters, Search, a calendar entry and **Out of office**. One button shows the dates in the app's format; the calendar works with the keyboard and opens as a sheet on a phone; you can still type a date. Out of office keeps its rules: it can start up to 30 days back and last up to 90 days (the picker stops at the 90th day).
- **Filter chips** read "Raised 1 Nov to 10 Nov 2026" instead of "2026-11-01 to 2026-11-10".
- **Names match:** the pages that create a meeting, a ticket or a user are titled **New meeting**, **New ticket** and **New user**, like the buttons that open them; the sidebar and search say the same. The buttons that save them keep their words (Schedule meeting, Raise ticket, Create user). Help, the tour and the guide call your task list **Task Summary**, as the sidebar does.
- **Downloads are unchanged:** report files keep their date format, so anything that reads them keeps working. The Admin → Records download shows the same 12-hour times as the screen.
- **Owner steps:** none.

**Stage 4: the last date fields, reference screenshots and the final checks** (D-426; record in `docs/qa/FINAL_QA_SIGNOFF.md`, `UI_REFACTORING_LOG.md`, `BUG_FIX_LOG.md`, `VISUAL_REGRESSION_REPORT.md`):
- **One date picker everywhere:** the remaining date fields now open the same date button and calendar as the rest of the app: a meeting's date, **Points due by**, **MOM due by**, **Record as held**, action and open-point dates; a task's due date and **Start on**; an information item's **Takes effect** / **Expires on**; a ticket's **Required date** and **Target date**; date fields in request, task and ticket forms; a request task's due date; Admin holidays, department holidays, a workflow's task due date and date rules; project and portfolio date fields, field and chart filters, Power search dates and the form designer's default date; the search window's **Between** dates (one From – To picker). Pick a day or type it (dd-mm-yyyy or yyyy-mm-dd); where a time belongs to the date, a time box sits beside the button and is filled in when you pick the day (5:00 pm for a due time, changeable). An empty required date says **Choose a date.** What is saved is unchanged.
- **Fixed:** after an action in the task side panel (Mark complete and its Undo, adding or removing a reaction) the panel could keep showing the old state with its buttons greyed out; it now refreshes as before. Undo after Mark complete shows the task open straight away.
- **Fixed:** on Task Summary the **Show** label beside the range was squeezed to two lines.
- **Reference screenshots:** 155 screenshots of the key screens (every area and role, the task panel, the search window, Create task, the date picker, phone cards, empty and not-found pages, a dark sample; the main pages at all nine screen sizes) are stored with the code; a later change that moves the layout shows up as a difference (`docs/qa/VISUAL_REGRESSION_REPORT.md`).
- **Owner steps:** none.

## v1.88.0 (23 Nov 2026): simple formulas
No migration (D-418, owner: "use all these as simple formulas in my app"):
- **Formula fields take functions** (names in any case): ADD, SUBTRACT, MULTIPLY, DIVIDE, DATEADD, DATESUBTRACT and ROLLUP (as in Asana), plus DAYS, WORKDAYS (on the Working calendar), IF with > < >= <= = <>, ROUND, MIN, MAX, ABS and COALESCE. Open **Functions** in the formula editor for a help card with an example; **Insert** puts the function in.
- **The task's own dates are inputs:** Start date, Due date, Created on, Completed on and **Today** (worked out whenever you look; never stored; nothing in the activity).
- **Ready-made formulas:** TAT, Delay, NFD Delay and Delay Days, the same as your Asana fields, in days. Delay and NFD Delay use the project's "Revised Target" / "NFD" date field, or ask you to pick one.
- **A formula can give a date** (DATEADD, DATESUBTRACT, MIN/MAX of dates, IF): it shows as a date. **Formatting** opens only for a correct formula that gives a number.
- **Checked as you type** with a **Preview** on a task of the project; clear messages for wrong types, wrong numbers of values, and the limits (10 inputs, 2 layers of formulas, 500 characters, no loops).
- Formulas work the same in the List, Board, task pane, sorting, filters, exports, Dashboard charts and automation conditions (a date result compares as a date). Formulas saved before keep working unchanged.
- **Owner steps:** publish v1.88.0 (nothing else).

## v1.87.0 (23 Nov 2026): smoother screens that keep your place
No migration (D-417, the owner's "Global Smooth Motion, Navigation Continuity & Interaction Experience System", built from the header and motion audit; details in `docs/GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`):
- **Closing a task or record beside a list** (×, Esc, a click outside) leaves the list exactly as it was (height, filters, sort) and adds no step to Back: Back no longer reopens what you closed.
- **Folded groups and sections stay folded** when you come back to a page in the same tab (after a task's full page and Back, for example).
- **Breadcrumbs and "← Back to …" return to the list as you left it** (sort, filters, page). A request opened from **Admin → Records** offers **← Back to Admin → Records** for people who can open Admin.
- **Esc and a click outside close only what is on top** (a menu, picker, the bell or the search over a task closes first). A task or record in its centred window keeps the keyboard inside it and the page still behind it. Esc while a comment is still sending waits for it ("Saving…"). A confirmation can't be pressed twice; it can't be closed while it is working.
- **Motion:** one set of timings everywhere (100 / 150 / 220 / 280 / 350 / 450 ms); tasks and records slide in and out; menus, the bell, pickers, filter panels and the search unfold; phone sheets slide away; the sidebar's labels, current-page bar and groups move smoothly, and the folded sidebar shows names beside its icons; only a changed figure on an overview card is emphasised. **Reduced motion** on your device turns all of it off.
- **Owner steps:** publish v1.87.0 (nothing else). Page transitions stay Off (your call).

## v1.86.0 (23 Nov 2026): Home's header buttons stay put; unsent comments are safe
No migration (D-416, from the header and motion audit, `docs/qa/HEADER-AND-MOTION-AUDIT.md`):
- **+ Add widgets** and **Customise** no longer disappear when you move between the Task Management and Meetings overviews (they came back only after a refresh).
- **Customise** ends when you move to another overview: you are never left moving widgets with no **Done** button.
- The **period** picker shows the period of the overview you are on: a Custom period chosen on one overview no longer follows you to the next.
- **Admin → Insights:** on a tablet every tab shows (they wrap onto a second row); on a phone they still scroll sideways, with a fade at the edge where more tabs are.
- **Task pane and record pane:** a comment or reply you typed but haven't sent is never lost by accident: Esc, ×, a click outside or a link away first asks **Discard draft?**
- **Owner steps:** publish v1.86.0 (nothing else).

## v1.85.3 (23 Nov 2026): Out of office can go back 30 days
No migration (D-415, owner: "allow past dates for everyone, up to 30 days back"):
- **Out of office** (yours, or IT setting it for someone in Admin → Users) can start up to **30 days before today**, to record leave already taken. Starting further back says so.
- **Dates that are already over** are only recorded: nobody is asked to cover them, your delegate isn't told, nothing moves, and you get one "Out-of-office recorded" message.
- **Dates that started earlier and run on:** your delegate covers from now, as before. Only tasks due from today on move to the day after you're back; overdue tasks keep their dates.
- **Owner steps:** publish v1.85.3 (nothing else).

## v1.85.2 (23 Nov 2026): fix
No migration (D-414):
- Admin → Records → **Tickets** and **Meetings** open again. Since v1.85.0 both showed "This page couldn't be shown" whenever there were tickets or meetings to list (the server tried to run a browser-only helper to build the sort, page and row links).
- A new check fails the build's tests if any server page uses a browser-only helper again. Every Admin and Super Admin page was opened against a copy of the live data before release.
- **Owner steps:** publish v1.85.2 (nothing else).

## v1.85.1 (23 Nov 2026): fixes
No migration (D-413):
- A mistyped or old address under /users shows "This page isn't available" again for everyone (with a real 404), instead of "You don't have access" for some people. Tasks still open beside every screen.
- Super Admin → Backup, restore & migrate: **Secrets** on a package (Show the server secrets, Download .env for a VPS) works; it answered "unexpected answer" before. **Restore** no longer now and then refuses a package that was just checked ("The package changed or was removed since it was checked").
- **Owner steps:** publish v1.85.1 (nothing else).

## v1.85.0 (23 Nov 2026): the Admin panel, reorganised
No migration. Admin (IT team) only (D-412, owner-approved redesign, docs/ops/ADMIN-REDESIGN-BRIEF.md):
- **Five groups:** Overview, Records, Insights, Set-up, People & organisation (31 entries in 9 groups before).
- **Overview:** today's figures (each opens its list), **Search records** (one search across approval requests, tasks, information, tickets and meetings; the first five of each, See all, or open one beside its list) and **Needs attention** built in (the old Needs attention address opens it there).
- **Records:** five tabs, now with **Tickets** and **Meetings**. One table for all: filters are **chips** (field, operator, value, e.g. "Status is Approved", "Submitted on or after 1 Nov 2026"; Add filter, × to remove; kept in the address, a sheet from the bottom on a phone), click a column title to sort, Group by and saved views as before. **Click a row** and the record opens in a **pane** on the right: ⤢ for a centred dialog (remembered), **Open full page** for its own page, Escape or × to close.
- **Insights:** one hub with tabs: Summary, Dashboards, Analytics, Reports, Workload (with reassign) and AI analytics. Each tab keeps its switch and page access.
- **Set-up:** one page with a section list: Approvals (custom approval, approver groups, DoA, budgets), Tasks (task types, task settings and holidays), Information types, Ticketing (forms, categories), Meetings, Automation (reminders & escalations, notifications) and AI rules. **Search settings** sits above the list. On a phone the list is the first page and each section has a way back.
- **People & organisation:** Users & roles, Departments and Working calendar (the Users screens are unchanged; their redesign comes next).
- **Every old address still works**: it moves on to the new page by itself.
- **Owner steps:** publish v1.85.0 (nothing else).

## v1.84.0 (23 Nov 2026): the Super Admin panel, reorganised
No migration. Super Admin only, plus the shared panel parts for both Admin and Super Admin (D-411, owner-approved redesign, docs/ops/ADMIN-REDESIGN-BRIEF.md):
- **Five groups in the sidebar:** Health, Connections, Security & access, Data, Monitoring. Groups fold and stay as you left them; **Search settings** at the top finds any page or setting across both panels (only what you may open); **Back to the app** at the bottom. The Admin sidebar folds its groups too.
- **Health console** (the start page): a card per provider, job, backup and delivery, each saying **OK**, **Warning**, **Failed** or **Not set up** with an icon (never colour alone), when it was last checked, and a **Test** or **Open**; a **Needs action** list says what to fix first.
- **Providers & security is split up:** **Email**, **WhatsApp** (with WhatsApp templates), **Phone & desktop notifications**, **Google sign-in & calendar**, **Salesforce** and **AI providers** each have one page with their status, settings and Test together; **Sign-in security**, **General** and **Feature switches** have their own pages.
- **No more duplicates:** the S3 and Google Drive backup settings live in **Backup, restore & migrate**; the retention values in **Retention & legal holds**; **Import data** is the Super Admin's alone (Admin → Import data moves there; the Admin copy was the same screen with the same kinds).
- **Danger zone:** deleting requests and Demo data left the everyday pages. Deleting ticked requests now asks you to type **DELETE** (checked on the server too); Demo data still asks for **LOAD DEMO**.
- Sentence case everywhere ("Salesforce", "AI activity history", "AI reports", "Job runner & automation").
- **Every old address still works** (bookmarks, emails, help links): it moves on to the new page by itself.
- **Owner steps:** publish v1.84.0 (nothing else).

## v1.83.0 (23 Nov 2026): every task opens in the side pane
No migration. For everyone with Tasks (D-410, owner's request):
- **Click a task anywhere** (My Tasks and Task Summary, project List, Board, Calendar and Timeline, the Tasks lists, Home and its widgets, Task search and the search bar, the Inbox and the bell, Calendar, meeting action items, people, requests, tickets) and it opens in the **side pane** on the right, beside the screen you are on. The screen stays where it was and keeps working. The address keeps the screen with `?task=…`, so Back and refresh keep the task open. The pane is the one from project views: resizable, at your saved width.
- **⤢ Open in a dialog** in the pane's bar opens the task in the centred window with every action; its **Back to the side pane** button returns. Your choice is remembered for the next task.
- **Open full page** (↗ in the pane, the button in the dialog, and ⋯ → Open full page) opens the task's own page. A middle-click or Ctrl-click on any task opens its full page in a new tab.
- Email links, shared and copied links and opening a task's address directly still show the full page. On a phone, a task still opens on its own full-screen page; below 1024 px wide the pane is a window in the middle.
- The side pane no longer needs a project view or the "pm_foundations" switch. Escape closes the pane on every screen, and the keyboard focus goes back to the task you opened.
- **Owner steps:** publish v1.83.0 (nothing else).

## v1.82.0 (23 Nov 2026): Backup, restore & migrate centre (part 2): moving between servers
Migration `202611241200_backup_transfer.sql` (runs on start; no triggers). Same switch as v1.81.0. Super Admin → Backup, restore & migrate → **Move to another server** (D-409, BK-1 part 2):
- **Receive here / Send there:** on the new server make a **one-time pairing code** (shown once, works once, 2 hours to start); on the old server pick a package, type the new server's address and the code. The package goes across in pieces (a dropped connection carries on) and appears there as **Received**; check and restore it there with its passphrase. Works GoDaddy → VPS and VPS → GoDaddy.
- **Pull from there:** the other way round: offer a package with a code on one server, pull it from the other.
- **From a link:** copy a package from an https address (e.g. a shared or pre-signed storage link) in pieces.
- **S3-compatible storage:** **To S3** on any package (multipart, in pieces) and **From S3 storage** to bring one back, with the keys in Providers & security → Off-site backup (the key must be allowed to read for restores).
- **Database to database:** copy this database straight into another MySQL (host, port, user, password, database typed; the password is never stored; the target's name typed to confirm). A safety snapshot of the target comes first (kept here); it is loaded beside the target's live tables and switched in at once, with the same undo as a restore. Attachments go with a package.
- **After a move:** **Check the system now** compares row counts with the package, checks every attachment's checksum and whether sign-in will work (an active Super Admin, SESSION_SECRET, stored keys readable with this ENCRYPTION_KEY, Google sign-in, APP_BASE_URL). The server secrets screen now also gives a ready **.env for a VPS** (this server's database, keys and folders; the package's other values).
- Wrong pairing codes are refused and, after 20 tries from one address in 15 minutes, every try is. Every send, pull, receive and database copy is audited and told to every Super Admin by email and WhatsApp.
- **Owner steps:** publish v1.82.0 (the migration runs by itself). To move GoDaddy → VPS: install v1.82.0 on the VPS, switch the centre on there, Receive here → code; on GoDaddy Make a backup → Everything, then Send there; on the VPS Restore… → Everything → Show the server secrets → Download .env → restart → Check the system now.

## v1.81.0 (23 Nov 2026): Backup, restore & migrate centre (part 1)
Migration `202611241100_backup_centre.sql` (runs on start; no triggers). A new Super Admin switch, **Backup, restore & migrate centre** (`features.backup_centre`, default **Off**); only the Super Admin can use it whatever the switch says (D-408, BK-1, owner brief `docs/ops/BACKUP-CENTRE-BRIEF.md`):
- **One encrypted file for the whole system (.arsbak):** every table and row, every attachment and the server secrets (ENCRYPTION_KEY, SESSION_SECRET, database, Firebase and other keys), with a summary and a checksum for every part. Encrypted end to end with AES-256-GCM using a key made from a **passphrase you type** (at least 12 characters; never stored, never sent anywhere but this server). Made in steps of about 20 seconds, so a big system never hits a time limit.
- **Make a backup:** Everything or Database only; keep it on the server (Private Storage), download it when ready, copy it to the Google Drive backup folder.
- **Scheduled packages** (daily or weekly, keep the newest N, optionally to Drive), encrypted with the server's `BACKUP_ENCRYPTION_KEY` because nobody types a passphrase at night. Set in Providers & security → Backups. The daily database backup carries on as before.
- **Restore** a package from the server list, an **upload** (in pieces, resumable, no size limit) or **Google Drive**: first **Check package** (passphrase, every part's checksum, version, sizes; nothing changes), then choose **Everything**, **Database only**, **Attachments only** or **Chosen tables**, and type the database's name. A **safety snapshot** of the system as it is comes first. The backup is loaded beside the live data and switched in at once; if anything fails the live data is switched straight back (or the snapshot is restored). An older backup is brought up to date by the migrations. Encrypted settings are re-keyed to this server's ENCRYPTION_KEY. Everyone signs in again afterwards. A maintenance notice shows for everyone while it runs.
- **After the restore** of a full package: **Show the server secrets** in it (passphrase again), marked Same / Different / Not set here, with **Copy as .env** for a VPS.
- **Move to another server** (GoDaddy ↔ VPS) with the package: make Everything here, upload and restore there, set the secrets shown. App-to-app sending with a pairing code, direct database-to-database copy, S3 and restore from a link follow in v1.82.0.
- **Told and recorded:** every download, restore (start, finish, undo), upload and showing of secrets is in the audit log and goes to every Super Admin by email and WhatsApp.
- **GoDaddy Import trap:** Overview → Backups and the centre warn that Database Manager → Import deletes every table first, and point to the centre.
- `restore.js` and `restore-on-start.js` read the new package too (`RESTORE_PASSPHRASE`, optional `RESTORE_MODE`).
- **Owner steps:** publish v1.81.0 (the migration runs by itself). Super Admin → Providers & security → Feature switches → **Backup, restore & migrate centre** → On. Make a first full backup with a passphrase you keep in your password manager, and download it. Optional: Backups → Scheduled full package → Daily (needs `BACKUP_ENCRYPTION_KEY`).

## v1.80.0 (23 Nov 2026): Smoother to use: motion, loading and keyboard flow
No migration. One new Super Admin switch, **Page transitions** (`features.page_transitions`, default **Off**). The owner-approved interaction, motion and loading review (D-407):
- **Dialogs and drawers** open and close with a short fade (dialogs grow slightly, drawers slide in); the background fades with them. Escape, × and a click outside close them as before; focus goes back to the button that opened them.
- **Menus and filter panels** (Filter, Sort, Group, Options, the ⋯ menus) unfold with a short fade; their arrow turns. **Folded groups** glide open (one group, or Expand all).
- **A click is heard at once:** a sort title, page number, tab or quick filter shows a small spinner and the table dims until the new one arrives. Page links inside the app (Earlier / Later, page numbers, the notification tabs, the ticket board) no longer reload the whole page. The request, task, ticket and meeting lists show a table-shaped outline while they load.
- **A comment appears straight away** as "Posting…" and goes again (your words stay) if it can't be sent.
- **One kind of message per event:** a done thing (Saved, Posted, View saved) is a short message in the corner that repeats what you pressed; a problem stays next to the form.
- **Back keeps your place:** back from a request, the list returns at the same height with the row you opened selected.
- **Discard draft?** Closing Create task or an approver's Change details by Escape, × or a click outside after typing asks first (Keep editing / Discard).
- **Keyboard:** J / K move between the rows of any list, Enter opens one (never while typing). **Next waiting for you:** decide a request you opened from Waiting for me and the next one waiting opens, briefly highlighted, with a link back.
- **Phone:** swipe a sheet or a drawer down to close it.
- **Look:** calmer steel-blue greys from ARS Blue (every text and edge still meets the contrast rules in light and dark), one type scale (12 / 14 / 16 / 20 / 28; small labels are 14 px), no more ALL-CAPS labels, and page titles without the big icon tile.
- **Page transitions (switch, Off by default):** when IT turns it on, the main area cross-fades between pages, a request or ticket's title moves into the heading when opened from a list, and focus goes to the new heading. Off, pages change exactly as before. Never with Reduce motion.
- **Reduce motion** (your device setting): only quick fades, nothing moves.
- **Owner steps:** publish v1.80.0. Nothing else; Page transitions stays off until you switch it on in Super Admin → Settings → Feature switches.

## v1.79.0 (22 Nov 2026): The three Home overviews work the same way
Migration `202611241000_home_overview_scope.sql` (runs on start; no triggers). Approvals, My Work and Meetings on Home now have the same parts:
- **Header:** the greeting with today's date, the title (*Approvals – Overview*, *My Work – Overview*, *Meetings – Overview*), your designation and department, a one-line description, the area switch and the **period** picker (Today, This week, This month, Last 30 days, Last 90 days, Custom period) on all three.
- **Quick actions:** the create action first (New request, Create task, Schedule meeting), the pages you can open, and **+ Add widgets** and **Customise** at the right end.
- **Four cards** with the same design. Approvals: Waiting for me, Overdue for me, My open requests and **Decided by me** in the period (with the change against the period before; *Changes asked of me* is now the *Returned to you for changes* widget). Meetings: Upcoming, To approve, MOM to write and **Held** in the period (meetings you ran or attended, with the change; *My open actions* is now the *My action items* widget). My Work: unchanged.
- **Your own widgets on each overview**, kept separately: move (drag, keyboard or ⋯ Move up/down), Half or Full width, Remove, Add widgets, Reset to that overview's default. Each overview's sections are widgets now (Approvals: Waiting for me, Due soon or overdue, Returned to you for changes, My recent requests, Your drafts, Quick insights; Meetings: Needs attention, Coming up, My action items, Waiting for my approval, Done to confirm, Quick insights, How meetings are running, Register). Until you customise, each shows today's screen in today's order.
- **New widgets you can add:** **Private notepad** (the same note on every overview), a **day-by-day chart** (Approvals: requests you raised and steps you decided; Meetings: meetings you ran or attended and actions you completed), **Needs attention** (Approvals: overdue and due-soon steps and returned requests; My Work: overdue tasks and tasks due today) and **Quick insights** on My Work (completion rate, on-time share, average days to complete).
- Every list still shows only what you may see; the meeting figures still need the *Meetings: dashboard figures* page access. The phone layout is unchanged.
- **Owner steps:** publish v1.79.0 (the migration runs by itself). Nothing else.

## v1.78.0 (24 Nov 2026): Task Summary, extra tabs and reach: Dashboard, Notes and Files tabs, Request access, the Tasks card on a profile
Comes with the Projects phase A switch (Dashboard tabs also need Projects phase D, Files tabs phase E, as on projects). Migration `202611231200_task_summary_r3.sql` (runs on start; no triggers).
- **Dashboard tab:** + beside your Task Summary tabs adds a Dashboard: open, overdue, due today and completed numbers, and charts of open tasks by due date, project and priority, open against completed, and what you completed each day (or week) in the last 14, 30 or 90 days. Each chart has **View as table**.
- **Notes tab:** your own notes in rich text, saved a second after you stop typing. Only you can read them, even when you share your Task Summary; managers and shared viewers see that they are private.
- **Files tab:** every file on the tasks given to you, as a gallery or a list, with the same filters as a project's Files.
- **Shared or managed Task Summaries:** someone opening yours sees your Dashboard and Files counting only the tasks they may already see (nothing masked, the rest left out), never your notes.
- **Request access:** if you can't open someone's Task Summary, **Request access** (with an optional note) tells them. They see the request in **Share** (a number on the button) with **Grant** (a read-only share, as Invite; you are told) or **Decline**.
- **Tasks card on a profile:** when you may open someone's Task Summary, their profile shows their soonest open tasks you may see and **View all tasks**; your own profile shows **My tasks**.
- **Create task keeps your draft:** what you type in the Create task window comes back, minimised, if the page reloads (this browser tab only) until you create the task or close it (**Discard draft**).
- **Employee code in person groups:** grouped by Created by or Assignee, a heading reads *Name · code*. Task Summary's **Sort** no longer lists Assignee (it is always you).
- **Deferred by the owner (22 Nov 2026):** Add tasks with AI, for a later release.
- **Owner steps:** publish v1.78.0 (the migration runs by itself). Nothing else.
## v1.77.1 (22 Nov 2026): Quick actions on every overview; Create offers meetings and tickets
- **Task Management overview:** **+ Add widgets** and **Customise** moved up to the right end of the quick-action row (Create task, View all tasks, Projects, Search tasks, Calendar).
- **Approval overview:** a quick-action row: **New request** (moved here from the header), Waiting for me, My requests, Approved by me, Delegate, Reports, Search.
- **Meeting overview:** a quick-action row: **Schedule meeting** (moved here from the header), All meetings, To approve, My meetings, Follow-ups, Calendar.
- **+ Create** in the sidebar now also offers **Meeting** (Schedule a meeting) and **Ticket** (Raise a ticket), each only for people who can open that page.
- Only pages you can open are shown. No data, rule or migration changes.

## v1.77.0 (23 Nov 2026): Task Summary, organise and share: Share read-only, your team's Task Summary, Customise › Fields, Board and Calendar tab settings
Comes with the Projects phase A switch. Migration `202611231100_task_summary_r2.sql` (runs on start; no triggers).
- **Share:** the lock button beside Task Summary's title lets chosen people open your Task Summary, read-only. **Invite** works once you choose someone; they are told. The list shows who can see it: you, your managers in the reporting line (always, read-only) and the people you added, each with **Remove**.
- **Only what they may see:** anyone opening someone else's Task Summary sees only the tasks they may already see; the rest are left out (no names, not counted).
- **Your team's Task Summary:** managers (every level) open a team member's Task Summary read-only from the **people button** beside Share or from the person's profile (**View Task Summary**). A banner says *Viewing: <name>'s Task Summary · read-only*, with **Back to my Task Summary**. Nothing can be changed from there.
- **Customise › Fields:** choose the columns your lists show; new tabs and Reset start with them, and **Also use in my List tabs** updates the tabs you have.
- **Board tabs:** Filter, Sort, Group (columns by date or My sections) and Search, saved with each tab. **Calendar tabs:** Weeks or Months, Filter and **Show weekends**, saved with each tab.
- **Your picture** beside the title opens your profile.
- **Owner steps:** publish v1.77.0 (the migration runs by itself). Nothing else.

## v1.76.2 (22 Nov 2026): One-time restore of the 22 Nov backup on start-up
- GoDaddy's Database Manager import would not start, so the release carries the 22 Nov 2026 backup (taken 8:55 pm IST), **encrypted** (AES-256-GCM; the key is not in the repository), and restores it once when the app starts, before the migrations. Nothing happens unless the owner sets the two secrets below; it refuses to replace a database that already has requests, records the restore so it never repeats, and never stops the app from starting.
- **Owner steps:**
1. GoDaddy → the app → **Secrets**: add `RESTORE_CONFIRM` = the database name (`db_30yc8vknqm`) and `RESTORE_BACKUP_KEY` = the value in the key file kept on the owner's PC (`ARS-RESTORE-KEY.txt`, never in the repository).
2. **Update Preview** (or Publish): on start the app restores the bundled backup (`database/restore/ars-db-20261122-152503.sql.gz.enc`, 22 Nov 2026 8:55 pm IST) once, then the migrations add anything newer. It takes about a minute; the log shows `[restore-on-start] restored … statements`.
3. Sign in and check requests, tasks and users are back. Then **Publish to Live**.
4. Remove both secrets (a second start skips anyway: the restore is recorded in table `ops_restores`).
5. **Skip the two optional trigger files** (`database/optional/*.sql`). The app works without them. **Never use Database Manager → Import database for them (or for any partial SQL): the importer drops every table first.** That is what emptied the database twice on 22 Nov 2026.
6. Re-enter anything done after 8:55 pm IST on 22 Nov 2026.

## v1.76.1 (22 Nov 2026): Fix: the app could not start on an empty database
- After the live database's tables were deleted (22 Nov 2026), the app (preview and live) could no longer start: on an empty database `npm start` runs every migration, and the three oldest (September/October 2026) created triggers that GoDaddy's MySQL refuses. Those trigger blocks are now optional, like every other trigger since v1.9.0, so a fresh or emptied database is rebuilt and the app starts. Databases that already ran them are not affected.
- The guard test now checks every migration, not only those since v1.9.0.
- **Owner steps:** Update Preview → Restart Preview App (it now starts and rebuilds an empty schema) → Database Manager → Import the backup `.sql` → Publish to Live. (Correction, 22 Nov 2026: do **not** run the optional trigger files through Database Manager → Import: it drops every table first.)

## v1.76.0 (23 Nov 2026): Task Summary for daily use: all your tasks in a tab, your own sections with rules, and CSV
Comes with the Projects phase A switch. Migration `202611231000_task_summary_r1.sql` (runs on start).
- **Show ▾ on each tab:** a Task Summary tab shows the *Summary window* (as before: overdue, due today, the next 7 days and completed today) or *All my open tasks* (every open task given to you, with a **Due later** section). Set up tabs like "Pending Today", "Overdue", "Pending Tasks" (All my open tasks) and "Assigner" (grouped by Created by).
- **Tabs save themselves:** your filters, sort, groups and columns are kept as you change them; **Reset** goes back. Two of your tabs may have the same name.
- **My sections:** group a tab by **My sections**: Recently assigned (new and reassigned work lands there and stays until moved), Today, Upcoming, Later and your own (**Add task ▾ › Section**). Drag, or **Alt + ↑ / ↓**; deleting a section moves its tasks to Recently assigned. A task's details have **Task Summary section** for you. A repeating task's next one keeps its section. Board tabs can use them as columns.
- **Customise › Rules:** every night at midnight, tasks due today move to **Today** and tasks due within N working days to **Upcoming** (holidays don't count), once per due date; the task's activity says so, only to you.
- **Chips:** **Filters: 1**, **Sorts: 1**, **Groups: 1**, each with **×** (in every task table).
- **Task visibility** now follows the projects' privacy: Everyone at ARS, a department, a project's members, or Collaborators.
- **Title ▾ › Sync / export:** Calendar feed, **CSV** (this tab, downloaded at once, 5 an hour) and Print.
- **Owner steps:** publish v1.76.0 (the migration runs by itself). Nothing else.

## v1.75.0 (22 Nov 2026): One date picker for every From–To date, the new task side pane, and repeating tasks for anyone
No migration and no new data stored.
- **One date picker everywhere:** wherever Tasks and projects take a date or a From–To range there is now one picker: two boxes at the top (**+ Start date**, which becomes a Start box, and **Due date**; type dd-mm-yyyy or yyyy-mm-dd, or click a day), the month with Monday first, the days of the months around it dimmed, weekly offs and holidays dimmed (point at one to see its name), today circled and the range shaded (the shading follows the mouse before you click). A start after the due date is swapped and said so. At the bottom: the **clock** (time), **repeat** (where a task can repeat) and **Clear**. It works with the keyboard (arrows by day, Page Up / Page Down by month, Home / End to Monday / Sunday, Enter picks, Escape closes) and on phones it opens from the bottom of the screen.
- **Where:** the Create task window (Start and Due with the time and Repeat: it replaces the separate due date, time, calendar and repeat buttons), the task pane and the task page (a **Due date** row: start – due), list and My Tasks due cells (one day), the project's **Dates** in its header (owners set From and To right there), project Settings (From – To), portfolio dates, status update dates, the template "Starts on", the bulk due date, custom date fields, project form date questions, automation dates, the Files tab From – To, and the day of a time entry.
- **How dates read:** "Today", "Tomorrow", a weekday within the week, "1 Dec", and ranges such as "30 Nov – 4 Dec", "7 – 11 Dec" or "28 Dec 2026 – 5 Jan 2027".
- **Filter by a date window:** a list's **Filters › Due date** (and the new **Start date**) has **Is between…** and **Is not between…** with From – To (both days included); save it with the view as usual.
- **The task side pane, new layout:** **Mark complete** on the left; the collaborators' pictures with **+**, **Share**, then like, copy link, full page, ⋯ and close on the right; a line saying who sees the task (with **Make public** for the project's owner when the project is private); the task's name in large bold type (click to rename); rows for **Assignee**, **Due date** and **Dependencies**; **Projects** with a count and **+**, each project folding open over its fields (the first five, then "Show N more"); and the comment box always at the bottom of the pane.
- **Repeating tasks for anyone:** a repeating (periodic) task can now be given to anyone you may give tasks to, one or several people (each gets their own repeating copy). The person who set it, the assignee, IT and the project's editors can change or stop the repeat. The next one goes to the same person and they are told. A reassigned repeating task keeps repeating.
- **History:** a changed due or start date now records the old and the new date.
- **Owner steps:** publish v1.75.0 (no migration).

## v1.74.1 (22 Nov 2026): Fixes from a click-through of every screen
Every page was opened as each kind of person (requester, approver, HOD, staff, coordinator, IT, Super Admin, someone without Tasks and Projects, and signed out), in light and dark, on a computer, a tablet and a phone, and the menus, tabs and back links were tried both ways. No new data, no migration, nothing to switch on.
- **Analytics:** opening the "requests behind a number" address on its own (without a number chosen) now opens the Analytics dashboard instead of "This page isn't available".
- **Phones:** on Task search, "Save this search as" fits the card (its Save button ran off the edge); on the Calendar list a long title takes its own line (up to two lines) instead of a few letters and "…"; the Super Admin overview's "Not configured" labels stay on one line.
- **Tablets:** Home's My Tasks box shows cards below 1024 px (its table ran past the box); the Completed tile's change sits under its note (the word "Completed" broke in two); Admin → Ticket categories uses two columns, so the name box can be typed in; the status cards on Task Summary can be scrolled with the keyboard.
- **Tables:** in every list table the first column (the name or number) now lines up with the rest of the row at the top (it sat in the middle of tall rows); on Users & roles the names line up whether or not a row has a tick box; on Admin → Insights the number columns line up on the right and the month table uses the full width.
- **Empty states:** a meeting with nobody invited says "Nobody is invited yet."; a ticket's empty Timeline says "Nothing has happened yet.".
- **Sign-in screens:** "Signed out" and "Wasn't you?" use the same heading size and spacing as the other sign-in screens; "Need access?" and the Privacy / Terms links line up with the form.
- **Easier to tap and read aloud:** a project's "Who can see it" choices, the meeting form's "If the points aren't approved in time" choices, the broadcast form's role ticks and a reminder rule's "Send to" ticks have more room between them; a ticket remark's file picker has a spoken name.
- **Wording and colour:** Admin overview says "1 department", "1 open request" (not "1 departments"); **Sign out** on the phone's More page is a darker red in light mode, so it is easy to read.
- **For IT:** a new end-to-end check opens every page in each role, theme and width and records errors, accessibility problems, sideways scrolling and controls hidden under bars (`npx playwright test -c playwright.crawl.config.ts`; `CRAWL_FULL=1` for all six combinations).
- **Owner steps:** publish v1.74.1 (no migration).
## v1.74.0 (22 Nov 2026): Project dates as From and To, estimated time from dates, and the Gantt's critical path
Comes with the planning features (Super Admin → Features → "Projects B, planning"). No migration.
- **From and To:** a project's start and due dates now read as **From** and **To**. The project shows its **working days** between them (both days counted, weekly offs and holidays skipped) and its **estimated hours** (working days × hours per working day): in the header ("Dates: From 7 Dec To 18 Dec · 10 working days · 80 h"; owners click it to change the dates), on Overview, in Settings, as a new **Duration** column in a portfolio's list, and as a **Project dates** bar at the top of the Timeline and Gantt. A To date before the From date is refused.
- **Hours per working day:** IT sets it in Admin → Task settings → **Project planning** (default 8 hours; half hours allowed).
- **Estimated time from dates:** a task without an estimate is now estimated from its dates (its working days from start to due × hours per working day; a task with only a due date is one day). The task's **Time** section says "Estimated from dates". An estimate you type always wins; clearing it goes back to the one from dates. It follows the dates as they change (including tasks moved with their dependencies). The project's **Time logged x of y estimated** and Workload's **Estimated time** use it.
- **Critical path on the Gantt:** **Options › Show critical path** highlights the chain of tasks that sets the project's end (striped bars and thicker arrows), with a summary ("Critical path: 6 tasks, 18 working days, ends 12 Dec") and the critical tasks in order. **Options › Show slack** adds a **Slack** column and a thin bar showing how many working days each task can slip. It updates while you drag a bar and after you save; a screen reader hears each bar's slack.
- **Owner steps:** publish v1.74.0 (no migration). Optionally set the hours per working day.

## v1.73.0 (22 Nov 2026): Tasks and projects, part 2: the same layout and dropdown menus on the other screens
The rest of the Tasks and projects screens follow the same layout and option lists as the project screens did in v1.72.0, with dropdown menus where a choice is made. No new data, no migration, nothing to switch on.
- **Rename a project from its header:** project owners click the project's name, type the new one and press Enter (Escape keeps the old name).
- **A task's ⋯ menu:** **Create follow-up task** and **Duplicate task** open the Create task window filled from the task; check it and create it as usual.
- **Create task ▾:** **Create and add another** keeps the window open for the next task. The window's **+** menu works with the arrow keys.
- **Task Summary (My Tasks):** the title's **▾** menu has Add task, the morning summary email, Table with filters, the calendar feed and Print; each task on the Board and the list has a **⋯** menu (open, copy link, go to its project) and shows its comment count.
- **Home:** **Add widgets** is always at the top; each widget has an **Actions ⋯** menu (move up or down, half or full width, remove).
- **Portfolios:** the Portfolios page shows cards (with a **New portfolio** tile and a **⋯** on each card) or a list (**View as list**). In a portfolio: the actions menu follows the usual order, the status menu shows each status's colour, the people pictures open Share, **Add work ▾** offers new projects and portfolios, **Filter**, **Sort** and **Group** are dropdown menus, each column has a sort menu and each row a **⋯** menu (remove is there now).
- **Forms:** the form builder has a bar at the top: who may submit (with **Change**), View form, **Share form**, Copy link and **⋯** (Duplicate form, Unpublish, Delete form).
- **Dashboard:** a widget's **⋯** has View chart, Edit chart, **Duplicate**, **Size ›**, the moves and Remove. **Workload:** the period and the measure are dropdown menus, and Add task is there.
- **Automations:** the trigger, **Add step** and each step's action are dropdown menus grouped like the catalogue.
- **Timeline and Gantt:** new **Sort** (start date, due date, name), **Group** (sections or none) and **Options** (expand or collapse all sections, go to today). **Calendar:** a **Filter** (incomplete, completed, all tasks, just mine) and **Search this view**.
- **Sidebar and Create:** a sidebar section's **⋯** sorts its projects (A–Z, recently opened, manual); the department section's **+** starts a new project or portfolio; **+ Create** works fully with the keyboard.
- **Owner steps:** publish v1.73.0 (no migration).

## v1.72.2 (22 Nov 2026): Look and feel fixes from the visual review
No new data, no migration, nothing to switch on.
- **Messages you can see over dialogs:** a "saved", "copied" or error message raised while a dialog is open now shows on top of the dialog (it used to hide behind it), and you can close it there.
- **Easier to read:** faint text (table headings, hints, placeholders) is a little darker, so it stays readable on grey rows and the selected row; empty fields have a clearer edge; done bars on the Timeline and Gantt are solid green with white text; the Home chart's **Completed** bars use the dashboards' colours (blue and orange) and are easy to see; **Sign out** on the phone's More page is readable in dark mode.
- **Fields look the same everywhere:** the project Files, Messages and Page tabs, time tracking, the chart builder and Workload use the app's normal fields (they looked like plain browser boxes); filter boxes on lists are one height; the small round selects (form designer, Pico Bot, Assistant) show a focus ring.
- **Menus and pop-ups:** the account menu, the row ⋯ menus on the users and request lists, people pickers and other pop-ups share one look and open above sticky bars and the task pane; the account menu works with the arrow keys, and **View** and **Text size** are choices in it. The Gantt's "Link tasks" box is a normal dialog.
- **Touch screens:** buttons that appeared only on mouse hover (a chat's ⋯, a tab's ⋯, "Add a task" on a calendar day, the Gantt's link handle, the drag handle) now show on phones and tablets.
- **Loading and empty screens:** Home's task sections load with a grey outline like the rest of the app; small "Loading…" lines have a spinner; empty project tabs, portfolios and admin lists show the usual empty box.
- **Numbers and text size:** big numbers on Home, dashboards, Meetings, Tickets and Portfolios share one size and follow the Classic **Text size**, as does the phone layout's text.
- **Smaller fixes:** the phone task page's title and assignee picture follow the app's styles; a dialog's buttons stay above a phone browser's toolbar; the journey card's tips stay on screen at the first and last stop; the figures on the analytics heatmap's middle shade are dark, so they stay readable.
- **Owner steps:** publish v1.72.2 (no migration).

## v1.72.1 (22 Nov 2026): Finding your way: clear lists, switched-off pages, the way back
Fixes from a review of every page's empty, loading and error states and of moving around the app. No migration. Nothing to switch on.
- **Clear really clears.** On a list where you saved a default view (Waiting for me, My pending requests, My approved requests, Approved by me, Collaborating, Search, Analytics, a report), **Clear** or **Reset filters** now shows the whole list instead of bringing your default view straight back. Opening the list from elsewhere still opens your default view.
- **On a phone:** **More → Work** now has **Tickets** (and the Coordinator board for coordinators) and **Portfolios**, for the people who have them. The More tab stays lit on ticket and meeting pages.
- **"Switched off" instead of "page not found":** when IT switches off Tasks, Information, Analytics, the AI Assistant, Portfolios or Project templates, their pages say so plainly, with **Go to Home**.
- **The way back:** projects, project templates and portfolios show **Projects ›** / **Portfolios ›** above the name; a colleague's profile card has **← Back**.
- **Long lists say when they are cut short:** AI activity history, Admin → Notifications (sent and devices) and Meeting follow-ups (actions and open points) say "Showing the latest N" with **Show more**; on a phone the Approvals lists link to the full list when there are more.
- **Search (Ctrl K) finds tickets and meetings** by number or title: only those you can see on the Tickets and Meetings lists.
- **Smaller fixes:** `/users/approvals?tab=…` on a computer opens the matching list (or the first one you may open); an old Task home link to a task opens the task; **Project templates** always opens the same place; **New task** is highlighted while its window is open; the Admin menu leaves out Records → Tasks / Information and AI Analytics when they are switched off; empty lists offer their main action (a project, a ticket, a meeting, a task, a request); page titles match their headings; Profile's loading outline no longer covers the Calendar and Devices tabs.
- **Owner steps:** publish v1.72.1 (no migration).

## v1.72.0 (22 Nov 2026): Project screens laid out like the reference, with dropdown menus
The project screens now follow the reference layout and its option lists (owner's request); colours, type and icons stay ARS. No new data, no migration, no new switch: what you see depends on the switches already on.
- **One kind of dropdown menu everywhere on a project:** every ▾ and ⋯ opens a menu you can use with the keyboard (↓ / ↑, Home / End, a letter jumps to an item, Enter chooses, → opens a sub-menu, Escape closes it and puts you back on the button). Menus open where they are fully visible and are never cut off by a table or the task pane.
- **Project header:** the **▾** menu now lists, in order, Edit project settings, Manage project permissions, Set colour, Copy project link, Duplicate, Save as template, Add to portfolio, **Import ›**, **Export or sync ›** (CSV, Excel, time entries, JSON, calendar feed, Print), Archive and Delete project. The colour tile and the member pictures are links (colour; members). The status menu shows each status's colour. The separate copy-link button is gone (it is in the ▾ menu).
- **Customize** opens a panel on the right: **+ Add** (field, form, automation), then Automations, Fields and Forms with how many each project has, and Project settings. Escape or ✕ closes it.
- **Tabs:** a tab's ⋯ menu is Rename, Set as default (greyed on the default tab), **Make a copy**, Copy link, Move left / right, Remove. **+ Add tab** groups the views under **Popular** (List, Page, Gantt, Board, Calendar, Timeline) and **Other** (Workload, Dashboard, Files, Messages, Overview), each with an icon and a line about it.
- **Toolbar (List and Board):** **+ Add task ▾** offers Task, **Milestone** (the new task is a milestone) and Section. **Sort** is a menu in the reference order (None, Start date, Due date, Assignee, Created by, Created on, Last modified, Completed on, Likes, Alphabetical, the fields, Project) with Ascending / Descending and **Clear sort**. **Group** has one **Group by** dropdown (the Board's **Columns by** moved here) and **Clear**. **Options** is a list (Show/hide columns, Filters, Sorts, Groups, Subtasks, Rows), each opening its own page. The Board has the same toolbar as the List.
- **Sections:** each section has **+** (add a task to it) and one **⋯** menu: Add automation to section, Rename section, Add section, expand or collapse subtasks and groups, Hide empty groups, **Delete section** (asks where its tasks go, as before). **+ Add section** at the end opens the name box.
- **Board cards:** the priority sits with the field chips; the counts (comments, subtasks…) sit on the right of the card's last line.
- **Timeline, Gantt and Calendar:** + Add task, ‹ Today ›, the **unit** is a dropdown (Days, Weeks, Months, Quarters; the Calendar's Weeks or Months), zoom − / +, and a **Filter** menu on the Timeline and Gantt (Incomplete, Completed or All tasks; Just my tasks).
- **Task pane ⋯:** Add to another project, Add subtask, Add tags, Attach files, Copy task link, Open full page, Print, the project's "by hand" automations, Delete task (asks first). All activity's order is a dropdown (Oldest first / Newest first).
- **Project settings:** one column in the reference order (Project details, Dependencies, Scheduling, Members, Permissions, Fields, Forms, Automations, Duplicate and templates, Import and export, Calendar feed, Archive or delete, History) with a list of the sections beside it; on a phone, a **Jump to** dropdown.
- **Loading:** a project and its settings show a grey outline of the page (header, tabs, toolbar, rows) while they load; it stays still if your device asks for reduced motion.
- **Owner steps:** publish v1.72.0 (no migration). Nothing to switch.
## v1.71.2 (22 Nov 2026): Fixes from the security and logic reviews
No migration. Nothing to switch on.
- **Your own request stays out of your hands.** Nobody passes on, puts on hold, resumes or asks a question on an approval of their own request, not even while covering for the approver as their out-of-office delegate. IT staff can't hand over, move (Workload → Move pending tasks) or give a stuck step of their own request to someone; another IT person does it. Work steps follow the same rule.
- **Only the Super Admin removes the IT Admin role from another IT Admin** (before, an IT Admin could remove it and then change that person's email or sign-in method).
- **Tickets: files on an internal remark are internal.** The requester no longer sees or downloads them; coordinators and the assignee see them marked "internal".
- **Automations:** saving or publishing someone else's automation makes you its owner (it then runs with your rights), and the previous owner is told. The builder says so before you save.
- **Approvals:** when every level was skipped and the HOD was asked instead (DR-02), asking for changes, a recall or a change of details now goes back to the HOD after resubmitting, not to the approvers of a level the route never took (new values that now take that level's path still go there). An approval can no longer be handed to someone who already decided another part of the same level.
- **Clean-up and clocks:** `database/optional/v190_append_only_triggers.sql` now lets the 30-day clean-up remove the history of tasks deleted more than 30 days ago (the old copy stopped the clean-up on every run) and runs in phpMyAdmin as pasted. The database connection now always runs in UTC, so reminders, escalations, expiry notices and the automation limit can't drift if the database's own clock isn't UTC (live already is: no change there).
- **Health checks:** `/api/health` now tells anyone only "ok" and the version, and `/api/health/deep` only "ok" or "degraded" (the 200 / 503 answers are unchanged, so uptime monitors keep working). The details (job runner, storage, backup age, database clock) are shown to a signed-in Super Admin, or to a monitor that sends the new optional `HEALTH_SECRET`. Each address may check 60 times a minute.
- **Smaller fixes:** a calendar-feed address is also limited per caller; searches for `%` or `_` in Analytics and Meetings match those characters only; file downloads keep their own strict security policy; a number field typed as only "₹" or "%" is refused instead of saved as 0; an archived choice can't be newly added to a multi-choice field; a start date like 31 February gets a message instead of an error; after a job-runner outage a ticket gets only its closure, not reminders 2 and 3 at the same time; an approval reminder whose recipients couldn't be read is sent on the next run instead of never; files sent with "done" on a work step are kept only if the request accepts the "done".
- **Owner steps:** publish v1.71.2. If you ever ran `database/optional/v190_append_only_triggers.sql` in phpMyAdmin, run it again once (DEPLOYMENT G0s). Optional: set `HEALTH_SECRET` (24+ characters) in GoDaddy if your uptime monitor should see the details.

## v1.71.1 (22 Nov 2026): Fix: the 30-day clean-up and edited task comments
- Where IT had added the comment-history guard in phpMyAdmin (v1.63.1), a deleted task with an edited comment stopped the 30-day clean-up. The guard now lets the clean-up remove the edit history of a task deleted more than 30 days ago; everything else stays locked.
- The phpMyAdmin file `database/optional/v1600_comment_triggers.sql` is rewritten so it runs in phpMyAdmin as pasted (its triggers need the DELIMITER lines it now has).
- **Owner steps:** publish v1.71.1, then run `database/optional/v1600_comment_triggers.sql` once in phpMyAdmin (again, if you ran it before).

## v1.71.0 (22 Nov 2026): Files, Messages and Page tabs, and time tracking (Project Management phase E, part 2)
Behind the switch **Projects E, templates and extras** (from v1.70.0). With it Off nothing changes. This completes the Project Management plan (phases A to E).
- **Fix: a task's ⋯ menu beside a project view.** On a narrow pane the task's action bar wraps and the ⋯ menu ran out of the pane, where the list behind it took the clicks ("Run by hand" couldn't be chosen). The menu now always opens inside the pane, above ⋯ when there is no room below.
- **Files tab** (Add tab → Files): every file on the project's tasks and subtasks, on its form submissions and in its messages, as a **gallery** or a **list**. Filter by type, task, who added it and date; search; sort. Images preview, PDFs open in the browser, every file downloads, **Go to task** opens the task beside the view. Only files on tasks you can see.
- **Messages tab** (Add tab → Messages): conversations with everyone on the project. A message has a subject, formatted text with @mentions and files (the usual 10 files, 10 MB each); replies are one level; reactions as on comments. Members are told of a new message, the people in a conversation of a reply, and people you @mention always (if they can see the project). The writer and IT edit or delete; every earlier text is kept (**Show edits**). Commenters and above write; viewers read.
- **Page tab** (Add tab → Page): the project's brief, one formatted page (headings, lists, links, @mentions) that everyone on the project reads; owners and editors change it. **Link a task** adds a link to one of the project's tasks; linked tasks show beside the page with their status (only those you can see). Every save is a version: the **version history** keeps the newest 50, and any of them can be shown or restored. A save over someone else's newer save is refused, never lost.
- **Time on tasks:** a task's new **Time** section: log time by hand (day, how long, a note) or with **Start timer / Stop**; an **estimate**; every entry with who logged it, totals per person and against the estimate. You change your own entries; the project's owners and editors (and IT) can change anyone's (kept in the task's history and the audit log). The project's **Overview** shows the time logged against the estimates and **Download time entries (CSV)**. The Dashboard's **Time entries** charts count logged time too, and **Workload** can be shown by **Estimated time**.
- **Owner steps:** back up the database, publish v1.71.0 (the migration `202611222000_pm_e_collab.sql` runs on start: new tables `project_messages`, `project_message_versions`, `project_message_reactions`, `project_pages`, `project_page_versions`, `task_time_entries`, the column `tasks.time_estimate_minutes`, and new values for tab types and file owners; no triggers; rollback inside). With **Projects E** on for IT, try the three tabs and a task's Time section (DEPLOYMENT G0q), then leave it On.

## v1.70.0 (22 Nov 2026): Templates, duplicate, import and export, calendar feeds (Project Management phase E, part 1)
Behind a new feature switch, **Projects E, templates and extras**, Off until IT turns it on. With it Off nothing changes.
- **Complete templates:** **Save as template** now keeps the sections, tasks and subtasks (dates as days from the start; every task keeps a due date), custom fields of all 11 types with their options and values (library fields stay shared), dependencies with their type, saved tabs, the dashboard, forms, automations, and the project's scheduling and permissions. The people tasks were given to become **placeholders**.
- **Projects → Project templates:** my templates, **organisation templates** (IT chooses them with *Share with everyone*) and templates shared with me; **Preview** (what's in it, by section, "Day 1…"), **Use template**, **Rename**, **Delete**. Using one asks who gets each placeholder's tasks (empty = you; each person is told once). Forms come as **unpublished drafts** and automations as **drafts owned by you**: nothing runs until you publish it.
- **Duplicate with choices** (Project settings → Duplicate it): tasks, subtasks, assignees, due dates, fields, dependencies, tabs, dashboard, forms, automations, members, status updates (off unless ticked), and **move every date by N days**.
- **Export:** CSV or Excel with the List's columns and every custom field (only what you can see), or the full structure as JSON (owners and editors).
- **Import:** tasks from an Excel or CSV file (500 rows, 2 MB, 10 imports an hour): choose the file, say what each column is (name, description, section, assignee by name / email / User ID, due date, priority, custom fields), **check the rows** (each problem listed by row), then import; rows with problems only left out if you tick it.
- **Calendar feeds:** a secret address for your Task Summary or a project, for Google Calendar or Outlook (read-only; open tasks with a due date that you can see at that moment). Shown once; make a new one or stop it at any time.
- **Owner steps:** back up the database, publish v1.70.0 (the migration `202611221900_pm_e_extras.sql` runs on start: `projects.template_shared` and the table `calendar_feeds`; no triggers; rollback inside). Switch **Projects E, templates and extras** to IT only, try it (DEPLOYMENT G0p), then On. Calendar apps reach `/api/calendar/…` from their own servers: don't block that path in Cloudflare.

## v1.69.0 (22 Nov 2026): Portfolios (Project Management phase D, part 3)
Behind a new feature switch, **Projects D, portfolios**, Off until IT turns it on. With it Off nothing changes.
- **+ Create → Portfolio** (or **Projects → Portfolios → Create portfolio**): three steps: name, colour, who can see it (private to members, a department or everyone) and the tab it opens on; the projects (and portfolios) to add, from those you can see; people with a role (owner, editor, commenter, viewer). People added are told.
- **Deny by default:** being in a portfolio never opens its projects. A project you can't see shows as **Private project** with who added it ("ask them or the project's owner for access") and is left out of every count and chart.
- **List:** each project's latest **status**, **task progress** (a bar and "4 of 6 tasks done (66%)"), due date, owner, **priority** and the portfolio's own columns (**Customize**: text, number, single-select, date, person). Filter, sort, group, search. Owners and editors **Add work** (a search box that works with the keyboard) and remove rows.
- **Nesting:** a portfolio can hold other portfolios, up to 5 levels, never inside itself; a sub-portfolio's row adds up its projects.
- **Progress:** counts on track / at risk / off track, the portfolio's **status updates** (owners and editors; people in it are told) and About.
- **Timeline:** bars by quarter from each project's start to due date; ↑ / ↓ rows, ← / → quarters.
- **Dashboard:** totals, projects by status, incomplete tasks by project, completion over 30 days and sub-portfolios by status, drawn with the project dashboard's charts (View as table).
- **Star** portfolios (sidebar), **Ctrl K** finds them, **Portfolios** page (mine, all I can see, archived, deleted). Owners of a portfolio are told when a project in it is set **Off track**. Deleted portfolios stay 30 days, then go with the 30-day clean-up; their projects are never touched.
- **Owner steps:** back up the database, publish v1.69.0 (the migration `202611221800_pm_d_portfolios.sql` runs on start: six new tables and a new star type; no triggers; rollback inside). Then switch **Projects D, portfolios** to IT only, try it (DEPLOYMENT G0o), then On.

## v1.68.1 (22 Nov 2026): Fix: "removed for good in 31 days"
- The Deleted pages could say a just-deleted task or project would be removed "in 31 days" when the database's clock ran a moment ahead of the app's. It now never says more than 30.
- **Owner steps:** none (no migration); publish v1.68.1.

## v1.68.0 (22 Nov 2026): Project automations: rules that act on a project's tasks (Project Management phase D, part 2)
Behind a new feature switch, **Projects D, automations**, Off until IT turns it on. With it Off nothing changes.
- **Project settings → Automations → Add automation** (owners and editors; only owners when *Only admins customise* is ticked): a builder laid out as a flow of cards: the **trigger**, the **steps**, and optional **Paths** (if / otherwise, with conditions on the section, assignee, priority, due date status, completion, name or custom fields). Every card is added, moved (↑ / ↓) and removed with buttons and the keyboard; cards say **Requires setup** until complete.
- **Triggers:** task added to the project or a section, moved to a section, a field changed (also custom fields, optionally to one value), completed / reopened / blocked, assigned, due in N days, overdue, attachment, comment or collaborator added, a project form submitted, **Run by hand** from a task's ⋯ menu, **on a schedule** (daily or weekly at a time, for matching tasks) and an **incoming webhook** (another system creates a task, or updates one by its number or ID field).
- **Steps:** move to a section, add to another project, complete or reopen, assign, set the due date (days or working days), priority or a custom field, create a task or subtasks, add a comment (by ARS-CMS Automation for the rule), add collaborators, notify people. No approval steps.
- **Draft and publish:** edits are a draft; **Publish** makes them run (for new activity only). Switch on / off, duplicate, delete, owner and **Become owner**.
- **Safe by design:** each rule acts with its **owner's rights** (never more), recorded as "<rule> (automation)"; if the owner loses access it pauses and the project's owners are told. A rule's own changes never start it again; at most 3 rules in a chain; 500 runs an hour per rule; each change runs a rule once. A failing rule tells its owner once. **Run log** of the last 200 runs for owners and editors.
- **Admin → Task settings → Project automation limits:** automations per project (50) and steps per automation (20).
- **Owner steps:** back up the database, publish v1.68.0 (the migration `202611221700_pm_d_automations.sql` runs on start: four new tables; no triggers; rollback inside). The job runner's new step **Project automations** runs every 5 minutes (time triggers, schedules, clean-up). Then switch **Projects D, automations** on for IT only, build a rule in a test project, move a task and check the run log, then switch it on for everyone.

## v1.67.1 (22 Nov 2026): Fix: the 30-day clean-up stopped on projects with forms or dashboards
- The automatic clean-up of items deleted more than 30 days ago (v1.62.0) didn't know about intake forms (v1.66.0) or dashboards and Workload capacity (v1.67.0). A deleted project with a form, a dashboard or a capacity setting, or a deleted task made from a form, made the whole clean-up fail, so nothing more was removed.
- Now a project goes with its forms (their versions, submitted answers and cover images), dashboard charts and capacity settings. Tasks made from its forms stay, like its other tasks, and only lose the link to the form. A task made from a form goes with its submitted answers.
- A new check fails the build if a future table that points at a task or a project isn't handled by the clean-up.
- **Owner steps:** none (no migration); publish v1.67.1.

## v1.67.0 (22 Nov 2026): Project dashboards with charts, and Workload (Project Management phase D, part 1)
Behind a new feature switch, **Projects D, dashboards and workload**, Off until IT turns it on. With it Off nothing changes.
- **Dashboard tab** (Add tab → Dashboard): a new dashboard starts with 8 widgets: Total completed, incomplete and overdue tasks, Total tasks, Incomplete tasks by section, Tasks by completion status (donut), Upcoming tasks by assignee, and Task completion over time (Total and Completed per day).
- **Add widget → Chart** opens the chart builder with a live preview. Chart styles: **Bar, Stacked bar, Grouped bar, Line, Burnup, Burndown, Donut, Number** and **Lollipop**. Data source: **Tasks**, or **Time entries** (the runs of the project's timer fields). X-axis (or Group): assignee, creator, section, task type, completion status, due date status, a date (due, start, created or completed; by day, week or month), a single-select, multi-select, people or date field, or (time entries) the person who logged the time. Y-axis: the number of tasks, or the sum or average of a number, formula or timer field; **Add metric** adds another series on the same axis (up to 4). Filters: completion, task type, only mine, assignees, creators, sections, due date status and the List's field filters. **Data labels**, a **Benchmark line**, **Show as percentage** (donut), half or full width.
- **Add widget → Text** for notes on the dashboard (links are clickable).
- Every chart: hover a column or slice, or focus the chart and use the arrow keys, to read each value; **View as table** shows the figures as a table; **View full size** shows chart and table together. Charts use one colour set that was checked for colour-blind readers, in light and dark.
- Owners and editors edit, resize, remove and **reorder** widgets (drag the handle, or focus it and press Space, the arrow keys, then Space; Escape cancels; also Move earlier / later in ⋯). Up to 20 widgets a dashboard.
- **Figures count only tasks you can see**, never cancelled or deleted ones, and refresh while the page is open.
- **Workload tab** (Add tab → Workload): people × days (14) or weeks (8) for the project's assignees and members, counting **open tasks** on each working day from start to due (or an **effort field**: a number field, or a timer field in hours, shared out evenly over those days). Each person has a **capacity** a working day (5 tasks or 8 hours unless set; weekly offs and holidays have none); **Set capacity** (owners and editors) sets the project's and each person's. Over capacity is shown with a warning sign and the word **Over**. Click a cell to see its tasks and **Reassign** them.
- **Owner steps:** back up the database, publish v1.67.0 (the migration `202611221600_pm_d_dashboards.sql` runs on start: the dashboard widget and capacity tables, a flag on projects, two new tab types; no triggers; rollback inside). Then switch **Projects D, dashboards and workload** on for IT only, add a Dashboard and a Workload tab to a project and check the figures, then switch it on for everyone.

## v1.66.3 (22 Nov 2026): Fix: a section's ⋯ menu was cut off (owner)
- In a project's List, a section's **⋯** menu (Hide empty groups, Expand / Collapse all groups) opened inside the table: the next sections' icons showed through it and the table's edge cut it off. It now opens on top of the page, fully visible, and its choices respond to the first click. A custom field column's ▾ menu opens the same way.
- **Owner steps:** none (no migration); publish v1.66.3.

## v1.66.2 (22 Nov 2026): Section names fit their words (owner)
- In a project's List, a section's name box is now as long as its name (it grows as you type), with the task count, delete and ⋯ menu right beside it, instead of a box across the whole row.
- **Owner steps:** none (no migration); publish v1.66.2.

## v1.66.1 (22 Nov 2026): Clearer names for the Projects feature switches (owner)
- Super Admin → Settings → **Feature switches** showed three switches all named "Projects" (the rest of each name was in the ⓘ). They are now:
  - **Projects A, views and lists**: tabs for every view, faster list, row density, task pane, Home widgets (phase A, v1.61.0–v1.63.0);
  - **Projects B, fields and planning**: custom fields, dependency types, Gantt, week calendar, status updates (phase B, v1.64.0–v1.65.0);
  - **Projects C, intake forms**: project forms that make tasks (phase C, v1.66.0).
- The plain **Projects** switch elsewhere on the page (if shown) is the Projects module itself. Only the names changed; the switches keep their settings.
- **Owner steps:** none (no migration); publish v1.66.1.

## v1.66.0 (22 Nov 2026): Project forms: a form people fill in becomes a task in your project (Project Management phase C)
Behind a new feature switch, **Projects: intake forms that turn submissions into tasks, for signed-in people (phase C)**, Off until IT turns it on. Only people signed in to ARS-CMS can open a form; a link for people without an account is not part of this release.
- **Build a form** in a project's settings (**Customize → Forms → Add form**). It is the same form designer the app already uses for approval, task and ticket forms, with the question types a project form needs: **Text, Long text, Single-select, Multi-select, Date, Number, Attachment** and **Heading**. Give each question a name, a description, options and **Required**; move it with the buttons, by dragging or with **Alt + ↑ / ↓**; duplicate or delete it. The form's title starts as the project's name; add a description and a cover image (PNG, JPG or WEBP). The filler's **Name and Email** come from their account.
- **Connect to field:** an answer can fill the task's **name**, **description**, **due date** or **priority**, or a **project field** of a matching type (text, number, date, single- or multi-select with the same options). The assignee is never taken from an answer.
- **Branches:** on a Single-select or Multi-select question, **Add branch** on an option and tick the later questions shown only when that option is chosen (up to 5 levels).
- **Settings:** the section for new tasks, the task name (an answer, or "<form> submission"), the **default assignee** (required: every task has one), the **due date in working days** after the submission (required; weekly offs and holidays skipped), copy all answers to the description (on), a confirmation message, a **Submit another response** button, submitters added as collaborators (on), **who may submit** (everyone signed in, chosen departments, or the project's members), and notices to the assignee and the project's owner.
- **Publish** checks the whole form (it stays off while something needs fixing, with the list of what) and keeps each published version as it was: people fill in the published version while you change the draft. **Share**: copy the link or show its **QR code**. **Unpublish** closes the link ("This form isn't accepting submissions"); **Duplicate** and **Delete** are in the Forms list.
- **Filling in:** one card, mobile-friendly, every control by keyboard; required questions are marked and "This field is required" shows under each missing answer; files by **Select a file** or drag and drop (10 MB each, the usual file types). Sending twice by accident makes one task; one person can send a form at most 20 times an hour.
- **Each submission is a task** at the top of the chosen section, created by **ARS-CMS Automation** (the app's system account: it can never sign in) on behalf of the person who filled it in: assignee and due date from the settings, connected fields filled in (dates too), the project's ID field numbered, the answers as "Question: answer" lines with a link back to the form, the files attached, the filler as a collaborator. The assignee and the project's owner are told; the filler gets a confirmation (in the app and by email) and, when they may see the task, **View request**.
- **Home:** the **Forms** widget lists the forms you may submit and your recent submissions.
- **Owner steps:** back up the database, publish v1.66.0 (the migration `202611221500_pm_c_intake_forms.sql` runs on start: the system account, the form, version and submission tables, the task's form link; no triggers; rollback inside). Then switch the feature on for IT only, build and try a form, then On (DEPLOYMENT G0l).

## v1.65.0 (22 Nov 2026): Dependency types and auto-shifting dates, an editable Timeline and a Gantt view, a week calendar, fuller status updates (Project Management phase B, part 2)
Behind the same feature switch as v1.64.0, **Projects: custom fields, field library, dependency types and auto-shift, editable Timeline, Gantt, week calendar, fuller status updates (phase B)**, Off until IT turns it on. With it Off everything works as in v1.64.0 (every link is "waits for", finish to start).
- **Dependencies with a type:** in a task, **Blocked by** and **Blocking** list its links. **Add dependency**: choose *Blocked by* or *Blocking*, find the other task by its name or number (from any project you can see; the project shows beside it) and pick the type: **Finish to start** (the usual), **Start to start**, **Finish to finish** or **Start to finish**. Change a link's type or remove it in place. A link that would go round in a circle is refused; a task has at most 30 links. *Lag* shows 0 days (it can't be changed yet). "Ready to start" messages follow the type.
- **Dependent tasks move with their task:** **Project settings → Dependencies**: *Off* (default), *Keep the gap* (dependent tasks move by the same number of days) or *Use up the slack* (they move only when they would clash). **Scheduling**: count working days only (weekly offs and holidays of the Working calendar are skipped; on by default). When a task's dates change, its dependent tasks move at once, for everyone, and the message says **"N dependent tasks moved"** with **Undo** (15 minutes, for the person who moved them). Done tasks never move, a start date never passes its due date, and each moved task's history says why. Their assignees are told.
- **Timeline, now editable, and a new Gantt tab** (**+ Add tab → Gantt**): **Days, Weeks, Months, Quarters** with zoom in and out, **Earlier / Today / Later**, a today line, shaded weekly offs and holidays, rows by section (fold a section), milestones as diamonds. **Drag a bar** to move it, **drag its ends** to change the start or due date (the due time stays), **drag its dot onto another bar** to link them. From the keyboard: focus a bar, **← / →** move it, **Shift + ← / →** the due date, **Alt + Shift + ← / →** the start date, **Enter** saves, **Escape** cancels, **L** links, **↑ / ↓** go to the next bar. The Gantt also has **Due date** and **Blocked by** columns (e.g. "Survey · FS", **+** to add). Arrows run from a task to the tasks waiting for it: grey while open, green when done, red when the dates clash. Large projects (300+ tasks) scroll smoothly.
- **Calendar:** **Weeks** beside **Months** (Saturday and Sunday share a column; a task with a start date shows on each day up to its due date). Moving a task keeps its due time and moves its start date with it. From the keyboard: focus a task, **Space** picks it up, **← / →** a day, **↑ / ↓** a week, **Enter** drops it, **Escape** cancels. **No start date** lists the tasks with only a due date, each with a box to give it a start date.
- **Status updates:** a headline (suggested "Project – 22 Nov"), the status (required), the **owner**, the project's **dates**, **Summary** and **Next steps**, **Highlights** (milestones and tasks completed in the last 7, 14 or 30 days: tick what goes in; milestones start ticked), and **Recipients** (the project's members, and anyone else you add). **Remind the project owner every Friday** sends the owner a reminder each Friday morning.
- **Home for everyone:** people without the Approval module now get the same Home widgets as Task Management's Home (greeting, widgets, Customise), with their other modules listed below.
- **Owner steps:** back up the database, publish v1.65.0 (the migration `202611221400_pm_b_schedule.sql` runs on start: link types, scheduling settings, Undo records, the Gantt tab type and the new status update parts; no triggers; rollback inside). Then switch the feature on for IT only, try a project's Gantt and Dependencies setting, and switch it On. The reminder runs in the job runner (no new cron). See DEPLOYMENT G0k.

## v1.64.1 (22 Nov 2026): Fix: project List layout (owner)
- **Section headings and "Add a task" lines stay in view** when the List is wider than the screen and you scroll sideways. Before, they scrolled away and left empty bands with only the counts and menus.
- **The List fills its card** on a wide screen (the Name column takes the spare room) instead of stopping after the last column.
- Custom fields: the Fields section shows the full manager (11 types, library, ✎ edit) only when IT switches on **pm_planning** (Super Admin → Settings → Feature switches); with it off you see the earlier Text / Number / Choice / Date form.
- **Owner steps:** none (no migration); publish v1.64.1.

## v1.64.0 (22 Nov 2026): Custom fields with 11 types, a field library, filter, sort and group by any field (Project Management phase B, part 1)
Behind a new feature switch, **Projects: custom fields with 11 types, field library, filter, sort and group by a field (phase B)**, Off until IT turns it on. With it Off, project fields work as before (text, number, choice and date).
- **Eleven types:** Text, Number (plain, percent, currency with ₹ or your own symbol, or your own unit; 0 to 6 decimals, with a live example), Single-select and Multi-select (coloured options you can reorder), Date (optionally with a time), People, Formula (+ − × ÷ and brackets over the task's number, date and timer fields; worked out by the app), ID (a prefix and a number for every task, like PO-12, never changed), Timer (start and stop your own timer; the field adds up everyone's time as h:mm), Reference (links to other tasks) and Lookup (a value from the linked task).
- **Add field** (Project settings → Fields, or **+** at the end of the List's columns): **Create new** or **Choose from library**; title, type, description, options, **Add to the ARS field library** (so other projects can use it) and **Notify collaborators when this field's value is changed** (for select, multi-select, date, people and reference fields).
- **Change a field later:** rename, add, rename, recolour, reorder (Alt + ↑ / ↓) and archive options, change the number format. **Remove from the project** keeps the values (add it back any time); **Delete** can be undone for 30 days, then the field and its values are removed for good.
- **Who may customise:** the project's owners and editors, or only its admins when **Project permissions → Only admins customise** is ticked. A library field is changed only by its creator and the IT team.
- **Everywhere:** List columns with a column menu (**Sort ascending / descending, Filter by this field, Group by this field, Hide column, Edit field**), Board cards (coloured chips; choose which fields show), the task pane and page, and Task Summary (the fields of each task's projects). **Filters, Sort and Groups** take any field in List tabs; the Board's **Columns** can be a field (moving a card between a single-select field's columns sets the option, by mouse or keyboard). Save view keeps them.
- **History:** "changed Stage to Done" appears in the task's activity.
- **Limits** are in **Admin → Task settings → Custom field limits** (defaults: 150 fields per project, 60 fields with values per task, 500 options per field).
- **Owner steps:** back up the database, publish v1.64.0 (the migration `202611221300_pm_b_custom_fields.sql` runs on start; it copies every existing field value into the new typed columns and keeps the old column; rollback inside). Then switch the feature on for IT only, check a project's fields, and switch it On. See DEPLOYMENT G0j.

## v1.63.1 (22 Nov 2026): Fix: the app didn't start on GoDaddy after v1.60.0
- **Cause:** `npm start` runs the database migrations first. The v1.60.0 migration `202611211000_comment_edits.sql` creates triggers without marking them optional; GoDaddy's MySQL refuses triggers for the app's user, the migration stopped, and the app exited ("Process exited before becoming ready").
- **Fix:** those trigger blocks are now optional, like every other trigger since v1.9.0: the runner skips them with a warning and carries on from where it stopped. A new test fails the build if any migration adds a trigger that isn't optional.
- **Owner steps:** publish v1.63.1 (Retry build / Update Preview). The pending migrations (v1.60.0 to v1.63.0) then run on start. **Then, once, in phpMyAdmin, run `database/optional/v1600_comment_triggers.sql`**: it removes the old "request comments can't change" trigger if your database has it (otherwise editing or deleting a request comment fails) and adds the comment-history guards.

## v1.63.0 (22 Nov 2026): Your Home widgets, a private notepad, Task Summary tabs (Project Management phase A, part 3)
Behind the same feature switch as v1.61.0 and v1.62.0 (**Projects: tabs for every view… (phase A)**), Off until IT turns it on.
- **A greeting:** Home opens with today's date and "Good morning / afternoon / evening" with your name, on Approvals and on Task Management.
- **Your widgets:** on Task Management, Home's sections are now widgets you arrange with **Customise**: move them (drag the handle, or focus it and press **Space**, **↑ / ↓**, **Space**; **Escape** cancels; **Alt + ↑ / ↓** moves at once), make them **Half** or **Full width**, **Remove** them and **Add** them back, or **Reset**. Your layout is kept for you on every device.
- **Widgets:** My Tasks (Upcoming / Overdue / Completed / All), **Projects** (**Recent** or **Starred**), Latest status updates, **Private notepad**, My weekly workload, Tasks I've assigned, and **People** (who you report to, and your team's open and overdue tasks). Only widgets of the modules you have are offered.
- **Private notepad:** notes and links with formatting, saved by itself as you type; only you see it.
- **Task Summary tabs:** your own **List**, **Board** and **Calendar** tabs, with **Rename**, **Set as default**, **Duplicate**, **Copy link**, **Move left / right** and **Remove** (Alt + ← / → reorders); a List tab's filters, sort and groups are kept with **Save view** (**Reset** goes back).
- **Recently assigned:** tasks someone gave you in the last 3 days have their own section in Task Summary, after Overdue.
- The Approvals view of Home and its tables are unchanged.
- **Owner steps:** back up the database, run `database/migrations/202611221200_pm_a_home_widgets.sql` (after 202611221100; adds the layout and notepad tables; rollback inside), then publish v1.63.0.

## v1.62.0 (22 Nov 2026): Board from the keyboard, the task pane beside the view, reactions, celebrations, Undo, Starred projects, the 30-day clean-up (Project Management phase A, part 2)
Behind the same feature switch as v1.61.0 (**Projects: tabs for every view… (phase A)**), Off until IT turns it on, except where noted.
- **Board:** move a card without a mouse: focus it, press **Space** to pick it up, **↑ / ↓** to move it between cards and **← / →** between columns, then **Space** or **Enter** to drop it (**Escape** puts it back). A screen reader hears each step. **Alt + ↑ / ↓** still work. The arrow keys also move between cards, and **Enter** opens one. Cards show the project's field values (e.g. "Cost: 100"), and each column says how many tasks it holds.
- **The task pane:** in a project view on a wide screen (1024 px and up) a task opens on the right, beside the view, so the board or list stays usable. Drag its left edge (or focus it and press **← / →**) to make it wider or narrower (380 to 720 px); your width is remembered. Its bar has **Mark complete**, **Collaborators**, **Like**, **Copy link**, **Open full page** and **⋯** (copy link, full page, delete), and a line says who can see the task. Smaller screens keep the centred window; phones the full screen.
- **Reactions:** beside **Like** on a task's comments, react with 👍 ❤️ 🎉 😄 👀 ✅. Press a reaction again to take yours back. Only people who can see the task can react.
- **Finishing a task:** a quick new tick animation, and, if you like, a short burst of colour: **Profile → Celebrations: Off, Occasional (about one in four, the default) or Always**. IT sets the default in **Admin → Task settings**. Nothing moves if your device asks for reduced motion.
- **Undo:** **Mark complete** in a task now offers **Undo** (as a row's tick already did), and so does **deleting** a task (from a task, the pane's **⋯** or the bulk bar). Undo for delete works everywhere, switch or not.
- **Sidebar:** **Starred** projects (star one from its header or the project list) and your department's projects, each with a sort menu (**Manual, A–Z, Recently opened**). In Manual, **Alt + ↑ / ↓** (or the arrows beside a project) moves it.
- **Deleted for good after 30 days:** tasks and projects that have been in **Deleted** for more than 30 days are now removed for good by the nightly jobs, with their comments, reactions, files and fields (a deleted project's tasks are not deleted; they just leave it). **Deleted tasks** and **Projects → Deleted** say when each item goes. IT can turn this off in **Admin → Task settings**. A ticket's or meeting's task, and tasks of requests under a legal hold, are always kept.
- **Owner steps:** back up the database, run `database/migrations/202611221100_pm_a_reactions_sidebar.sql` (reactions and sidebar order tables; it also lets the clean-up remove the history of a task deleted over 30 days ago; rollback inside; if the trigger blocks are skipped for lack of rights, run them once in phpMyAdmin), then publish v1.62.0. With the switch On or IT only, the clean-up starts at the next job run: if you want to keep anything deleted more than 30 days ago, restore it first or turn the clean-up off in Admin → Task settings.

## v1.61.0 (22 Nov 2026): Project tabs for every view, a faster List, fresher screens (Project Management phase A, part 1)
- **Tabs for every view** (behind the new feature switch, Off until IT turns it on): a project's Overview, List, Board, Timeline and Calendar are tabs. Owners and editors add more from **+** (e.g. a second Board), and each tab's **⋯** menu has **Rename**, **Set as default** (starred; opens first), **Duplicate**, **Copy link**, **Move left / right** and **Remove** (one tab always stays; tasks are never touched). Reorder by dragging or with **Alt + ← / →** on a focused tab. Up to 50 tabs per project.
- **Save view:** filters, sort, groups and columns change only your screen (**Unsaved changes**) until an owner or editor presses **Save view**; **Reset** goes back. Board tabs save their filters and sort too.
- **The List:** works fully from the keyboard (arrows, Home/End, Enter opens, Space selects; screen readers hear it as a tree of sections, tasks and subtasks); subtasks open under their task (▸); a section's **⋯** menu has **Hide empty groups** and **Expand / Collapse all subtasks**; a new **Last modified** sort; sections of 1,500+ tasks scroll smoothly (only the rows on screen are drawn).
- **Row height:** Options → **Rows: Comfortable or Compact**, remembered for you.
- **Fresher screens for everyone:** project views, My Tasks and an open task refresh every 15 seconds while visible (was 30 s), as soon as you come back to the window, and after every change; they pause while the window is hidden and never while you're typing.
- **Project colours** now come from the theme (light and dark); red and green projects show as orange and a calmer green so they no longer look like overdue or done.
- **Owner steps:** back up the database, run `database/migrations/202611221000_pm_a_views_prefs.sql` (rollback inside), publish v1.61.0, then switch **Projects: tabs for every view… (phase A)** to IT team only or On in Super Admin → Settings → Feature switches when ready.

## v1.60.0 (21 Nov 2026): Edit and delete every comment (owner)
- **Every comment can be edited and deleted:** comments on requests (Discussion), ticket remarks and task comments. **Edit** and **Delete** show under each comment for the person who wrote it and for IT.
- **Nothing is lost:** an edited comment is marked **(edited)**, and **Show edits** lists what it said before each change, with who changed it and when. A deleted comment shows "This comment was deleted", and **Show what it said** shows its last text. Everyone who can see the comment can see its earlier versions.
- No time limit. Task comments already had Edit for their author; IT can now edit them too, and their versions are kept the same way.
- **Owner steps:** back up the database, run `database/migrations/202611211000_comment_edits.sql` (adds the versions table and edit/delete marks; request comments still can't be removed from the database; rollback inside), then publish v1.60.0.

## v1.59.5 (20 Nov 2026): Add a subtask with the Create task window (owner)
- On a task's page, **Subtasks** has an **Add subtask** button, and the **+** beside "Add a subtask..." is now a button too. Both open the same **Create task** window (name, for Myself or Others, project, description, due date and time, priority, periodic, files, collaborators), titled **Create subtask** and showing the task it goes under.
- **Create subtask** makes it under this task and you stay on the task, which lists it. Typing a name and pressing Enter still adds a quick subtask (due today).
- A subtask for several people makes one subtask each, all under this task.
- **Owner steps:** no migration; publish v1.59.5.

## v1.59.4 (20 Nov 2026): Ticket status by department: a table for every form (owner)
- **Status by department** now has a separate table for each ticket form (e.g. IT Hardware Ticketing and IT Software Ticketing), named after the form, with its category. Any form IT creates gets its own table as soon as it has a ticket in the period.
- A category with two or more forms also gets a table for all its forms together (e.g. "IT Ticketing (all forms)"), shown first.
- **Owner steps:** no migration; publish v1.59.4.

## v1.59.3 (20 Nov 2026): Tickets are updated on the ticket, no task (owner)
- **Assigning a ticket no longer makes a task.** The assignee updates the ticket itself: **Start work** (In progress), then **Mark resolved** with what was done, which asks the requester to confirm, as before.
- Both are on the ticket's page (**Your work on this ticket**) and on each row of **My tickets → Assigned to me** (the **Update** column, replacing Open task).
- Reopened: it goes back to the same assignee, who starts it again on the ticket (or the coordinators reassign it).
- Tickets assigned before this release: their open tasks are cancelled with a note ("now updated on the ticket itself"), and the work continues on the ticket. Finished tasks stay as history, linked from the ticket.
- Assigned tickets are in Tickets only (not in Tasks or the task calendar).
- **Owner steps:** back up the database, run `database/migrations/202611201000_ticket_tasks_retired.sql` (cancels the open tasks linked to tickets; rollback inside), then publish v1.59.3.

## v1.59.2 (20 Nov 2026): Resizable columns, two-line cells, ticket status by department (owner)
- **Resize any column**: drag the right edge of a column title in any table (user, Admin, Super Admin), and in the task lists and project lists. Double-click the edge to go back to the automatic width. In the task and project lists, a focused edge also moves with ← / → (Enter resets). Widths are kept in this browser, per page and table.
- **Long text no longer stretches rows**: text in a table cell shows at most two lines, then "…". Hover to read all of it, or widen the column. Task names in the task lists work the same way.
- **Ticket analytics → Status by department**, like the owner's sheet: one table per ticket form (e.g. IT Software, IT Hardware) for the chosen period, with Department, Total, On time, Delay, Overdue and Not due, and a Total row. A **Priority** filter on top (All, Critical, Most important, Important, High, Normal).
  - **Due:** the coordinator's Target date, or the requester's Required date (end of that day) when no Target is set.
  - **Finished:** when the ticket is closed.
  - **On time:** closed by the due time, or with no due date. **Delay:** closed after it. **Overdue:** still open past the due time. **Not due:** still open, not yet due.
  - A reopened ticket counts as open again.
  - Every column sorts; the Total row stays at the bottom.
- **Owner steps:** no migration; publish v1.59.2.

## v1.59.1 (20 Nov 2026): Sent back for changes on its own page (owner)
- **Sent back for changes** is now its own page (sidebar → My Approvals → Sent back for changes; on phones, Approvals → more), instead of a table under Waiting for me. Waiting for me shows a link with how many there are.
- The page has every table feature: **search** (number, title, requester, reason), **filters** (approval type, requester, department, your step, sent-back dates), **sort** on every column both ways (request, type, priority, requester, department, step, sent back, days with the requester, reason), **Group by** (department, requester, type, step, priority, month; groups start folded, Expand all / Collapse all), **saved views** and pages of 50.
- **Owner steps:** no migration; publish v1.59.1.

## v1.59.0 (20 Nov 2026): Approvers change a request's details from Waiting for me; sent-back requests stay on the list (owner)
- **Change details from the table** (Waiting for me, and the Waiting for me table on Home): each approval row has a **Change** button. It opens the request's values (files stay as they are) and, on a custom request, the **levels after yours**: change who approves a level, add a level, remove one or move it. A **reason is required**. Only the approver the request is waiting on now (or their active delegate) can do it, and not while it is on hold.
- **What happens:** new values start your level again in a new round, so everyone at your level sees them; earlier approvals stand unless the new values change the route, in which case it restarts from the earliest affected level (as when a requester resubmits). Changing only the levels to come restarts nothing. New approvers must be able to approve (Manager and above), active, and never the requester or you. Levels up to yours never change.
- **Who is told:** the requester and everyone who already approved get "Request details changed" with what changed and the reason. The request's history, its "What changed in round N" and the audit log record it.
- **Sent back for changes** stays on your Waiting for me, in its own **Sent back for changes** table: the request, the requester it waits for, your step, when and your reason. Open it to review; when the requester resubmits it comes back to you as a normal approval.
- Notification settings: "An approver changes a request's details" is under **Updates on requests you raised**.
- **Owner steps:** no migration; publish v1.59.0.

## v1.58.1 (20 Nov 2026): a request's Priority sorts in every table (owner)
- **Priority sorts everywhere** a request's Priority is shown: Admin → Records → Approval requests and Super Admin → Requests (over every page, in the database), and the Home tables (Waiting for me, Due soon or overdue, Returned to you for changes, My recent requests), which now sort on every column. Ascending puts the form's first option first (e.g. Critical). A Priority that is confidential for you, or missing, always goes last, so the order gives nothing away.
- **Owner steps:** no migration; publish v1.58.1.

## v1.58.0 (19 Nov 2026): Sort every column, saved views everywhere, groups start folded (owner)
- **Sort any column, both ways, in every table** (user lists, Admin and Super Admin): click a column title for A→Z (oldest, smallest), again for Z→A. Empty values always go last. Paged lists (requests, Waiting for me, tasks, information, meetings, tickets, Admin users and records, audit, sign-ins) sort on the server, so the order covers every page, not just the one shown; short tables sort in place. The sort is in the address, so it survives reloads and bookmarks.
- **Saved views on every list** with filters, sort or group: **Save this view** keeps what is on screen (filters, search, group, sort, tab) under a name; your views show as chips (open, make default, delete). Views are **yours only** (sharing removed; a view shared before can still be unshared). A default view opens when you arrive at the list with nothing chosen; pressing Clear on the list stays clear.
- **Groups start folded**: when a Group by is chosen, every group starts collapsed; open one by its heading, or use **Expand all / Collapse all** above the table. The Coordinator board (always by status) and a project's own Sections start open.
- **More Group by** on Admin and Super Admin lists (Department wherever people are listed): users, workload, needs attention, notifications, AI analytics, dashboards, records, task/information types and ticket forms; audit, sign-ins, requests, deliveries, templates, AI history and automation runs.
- **Select all** on bulk lists ticks only the rows you can see (not those in a folded group).
- **Fixed:** **New task** clicked inside the app (sidebar, Classic tabs) now opens the Create task window every time (it only opened on a fresh page load); a request row's **⋮ menu** stays open and follows its row when the page scrolls (a row just below the fold closed it straight away).
- Also: report saved views keep a column sort; the Admin records registers start ascending on a first click like every other table.
- **Owner steps:** no migration; publish v1.58.0.

## v1.57.7 (19 Nov 2026): WhatsApp fallback versions deleted at Meta (owner)
- An older approved WhatsApp template version that Meta no longer lists at all (deleted there without a status) loses its approval at the next sync, so it can never be brought back as the fallback when the live version is paused or rejected. It still shows as Replaced. Nothing changes if Meta returns an empty list (treated as a provider hiccup).
- A test now covers the v1.57.6 rule that a meeting action item's task can't be deleted from the task pages.
- **Owner steps:** no migration; publish v1.57.7 (run v1.57.6's migration first if not done yet).

## v1.57.6 (19 Nov 2026): State fixes from the state-machine review (owner)
The owner decided each of ten risks found in a review of how records move between statuses. All fixed:
- **Tickets:** a ticket's task can't be deleted from the task pages (reassign it on the ticket). Reassigning an In-progress ticket to someone else puts its task back to Open, so the new person can start it.
- **Meetings:** an action item's task can't be deleted from the task pages. The Meeting Owner can approve or return the meeting points while the MOM is being written or was returned; points still waiting when the MOM is approved are approved with it. Closing an open point closes it in every meeting of its follow-up chain. Send back on an action always reopens its task, with a history entry and a message to the assignee. Unused code (Start, a never-set "deleted" filter) removed.
- **Approvals:** a work-step task is updated with the task locked and checked, so it can't clash with the assignee. When a request is approved, rejected, withdrawn or deleted, its open consultations (advice asked) are withdrawn: the person asked is no longer prompted and the request shows "Closed without an answer".
- **Background jobs:** large exports give up after 3 tries and tell the person; a finished or failed job only counts for the run that claimed it; only one automation run at a time ("Run now" says so if another is going); stuck runs are recovered: the weekly HOD report and scheduled reports interrupted by a crash are marked failed and retried once, stuck AI data syncs are marked failed, and messages picked up but never sent are released and sent.
- **WhatsApp templates:** only the newest approved version is live; a paused template is no longer shown as approved; if the live version is paused or rejected, the previous approved version goes live again.
- **Message deliveries:** the darkest cells of the delivery heatmap are readable in dark mode.
- **Owner steps:** back up, run `database/migrations/202611191200_job_state_recovery.sql` (adds an `attempts` count to export, report and HOD-report runs; rollback inside), publish v1.57.6.

## v1.57.5 (19 Nov 2026): Group on every list with a table (owner)
Every list page with a table now has **Group**, and its groups fold from their headings:
- **Tasks → Assigned to me / Assigned by me / Team tasks / Periodic tasks:** Department, From (or Assignee), Type, Priority, Status, Due date.
- **Information inbox / Sent by me:** Department (sender's), Sent by, Type, Importance, Status.
- **Meetings:** Department, Type, Status, Meeting Owner, Coordinator, Priority, Mode.
- **Meeting follow-ups:** Department (responsible person's), Responsible, Meeting, Status, Due date.
- **My tickets:** Department, Category, Ticket form, Priority, Status, Assigned to, Requestor (with a search box too).
- **A category's ticket dashboard:** the same choices under **Group by** in its filters.
(Request lists, Waiting for me, task tables, project lists and the Coordinator board already had grouping.) The choice is kept in the address, so a grouped view can be bookmarked.
- **Owner steps:** no migration; publish v1.57.5.

## v1.57.4 (19 Nov 2026): Folding groups; Group on Waiting for me (owner)
- **Every group folds:** when a list is grouped, click a group's heading (▾ / ▸, with its count) to fold its rows away and again to open them: request lists (table and phone cards), Waiting for me, and the Coordinator board's status groups. Task tables, project lists and My Tasks on a phone already folded.
- **Waiting for me → Group:** Department (of who raised it), Raised by, Approval type, Your step, Priority and Due date (Overdue, Due today, Later, No due date). It is kept in the address, in saved views and across pages.
- **Owner steps:** no migration; publish v1.57.4.

## v1.57.3 (19 Nov 2026): Group by Department everywhere (owner)
- **Department** is now a choice in every **Group** option:
  - every request list (My pending requests, My approved requests, Collaborating, Approved by me), by the requester's department (before: only lists of other people's requests);
  - every task table (Task Summary, Assigned to me, Assigned by me, Team tasks, Task search, Periodic tasks, a project's table), by the assignee's department;
  - a project's List view (Group: Sections, Assignee, **Department**, Due date, Priority);
  - My Tasks on a phone (Group by).
- People without a department are grouped last as "No department".
- **Owner steps:** no migration; publish v1.57.3.

## v1.57.2 (18 Nov 2026): Ticket and task show each other's remarks, files and activity; Open task (owner)
- **Ticket and its task in step:** the ticket page's **Remarks** also show the task's comments (marked "on task TSK-…"), its **Timeline** also shows the task's activity ("Task TSK-…: Started / Completed / …"), and its attachments include the task's files (as before). The task page shows the ticket's remarks under its comments (**Remarks on ticket …**), the ticket's files under Attachments, and the ticket's timeline in **All activity**. Nothing is copied: each is kept once and shown in both places. Internal ticket remarks stay hidden from the requester.
- **My tickets → Assigned to me** has a **Task** column with **Open task**, so the assignee goes straight to the task to start or complete it.
- **Owner steps:** no migration; publish v1.57.2.

## v1.57.1 (18 Nov 2026): Coordinator board as a table; tickets seen by category (owner)
- **Tickets → Coordinator board is a table**, like My tickets: Ticket, Subject (category · form), Requestor, Department, Priority, Assigned to (task number), In this status, Target date (red when overdue), Needed by, Notes (auto-close day, reopened). Rows are grouped by status in the order a ticket moves (New, Reopened, Assigned, In progress, Awaiting confirmation, Closed in the last 7 days), each group with its count.
- A **chip per status with its count** above the table (All, New, Reopened, …) shows just that status. Category, search and Only overdue work as before.
- The sidebar's Coordinator board link has its own icon.
- **Each coordinator sees only their categories:** a coordinator of the Admin ticket forms sees only Admin on Ticket dashboards and the Coordinator board (other categories are no longer listed).
- **Who else sees tickets, by category:** Admin → Ticket categories → Who else sees tickets now has **Categories they see**: e.g. tick IT Software and IT Hardware for the IT department, so Admin tickets stay with the Admin coordinators. Tick none for every category (as before). IT Admins and the Super Admin still see everything.
- **Owner steps:** back up, run `database/migrations/202611191100_ticket_viewer_categories.sql` (after 202611191000; adds a category to each viewer row, rollback inside), publish v1.57.1, then set the categories in Admin → Ticket categories.

## v1.57.0 (18 Nov 2026): Item list with "provided" ticks; IT sees every ticket (owner)
- **New form field: Item list** (Form Designer → Advanced → Item list). The requester lists each item and the **quantity needed**: no rate, no GST (for example stationery). On the request or ticket, an **Items to provide** table shows each item with a **Provided** tick and "n of m provided"; ticking records who and when, and can be undone.
  - Who ticks: on an approval request, its approvers, the assignee of a work task raised from it, and IT; on a ticket, its coordinators, its assignee and IT (until it closes). Everyone who can see the record sees the ticks.
  - For approval forms and ticket forms (not task or information forms). Up to 100 items, quantities 1 to 100,000.
- **Ticket dashboards for the IT team:** Admin → Ticket categories → **Who else sees every ticket**: choose departments (e.g. the IT department) and people. They see the Ticket dashboards, the Coordinator board, Ticket analytics and every ticket (and can add remarks); assigning stays with each form's coordinators. IT Admins and the Super Admin always do.
- **Owner steps:** back up, run `database/migrations/202611191000_item_checks_ticket_viewers.sql` (two new tables; rollback inside), publish v1.57.0, then in Admin → Ticket categories choose the IT department under "Who else sees every ticket", and add an Item list field to the forms that need it.

## v1.56.0 (18 Nov 2026): Coordinator board for tickets; meetings as a table; every meeting on the calendar (owner)
- **Meetings list is a table** (like the tickets): Meeting number, Title (type and open actions), Date and time, Mode / venue (with **Join** when there is a link), Owner, Coordinator, Department, Priority, Invited, Status (and points status). Tabs, filters and search work as before.
- **Analytics → Ticket analytics** (for everyone with Ticketing), by access: **Whole organisation** (IT) counts every ticket; otherwise the scope at the top counts the tickets raised by or assigned to you, your reporting line (My team) or your departments, **plus every ticket of the forms you coordinate**. Figures: raised, closed, auto closed, open now, overdue, reopened, first response and resolution times, average rating; where the open tickets are and who has them; by category, form, department and priority; twelve months; the overdue list.
- **Every meeting you are on is on your Calendar** (as Owner, Coordinator, participant or the one who scheduled it), even without the Meeting Management module.
- **Tickets → Coordinator board:** a separate page for coordinators (and IT) that shows where every ticket is now, status by status: **New** (to assign), **Reopened**, **Assigned**, **In progress**, **Awaiting confirmation** and **Closed** (last 7 days), each with its count.
- Each card: ticket number, subject, priority, requester and department, form, **who has it** (and the task number), **how long it has been in this status**, the target date (red when overdue), the needed-by date, when it auto-closes while awaiting confirmation, and how many times it was reopened. Most urgent first.
- Filters: category, search (number or subject), **Only overdue**. Click a card to open the ticket.
- Coordinators see the tickets of the forms they coordinate; IT sees all; nobody else sees the page or its menu item.
- **Owner steps:** no migration; publish v1.56.0 (it includes v1.55.2 and v1.55.3 if those aren't published yet: meetings reach the calendar from v1.55.2).

## v1.55.3 (18 Nov 2026): Reopened tickets reopen their task; dashboards for coordinators (owner)
- **Reopen a ticket → its task reopens too.** When the requester reopens a ticket, the same task goes straight back to **Open** in the assignee's Tasks (Assigned to me → Open), with the reason in the task's history. The coordinators are still told and can reassign it with a new target date. Before, the task stayed Completed until a coordinator reassigned it.
- **Ticket dashboards are for coordinators only** (people set as coordinators on a ticket form), plus IT. Everyone else no longer sees the menu item, and the page answers "not found". My tickets stays for everyone with Ticketing.
- **Owner steps:** no migration; publish v1.55.3.

## v1.55.2 (18 Nov 2026): Meeting form, meeting links, 10 attachments, ticket form (owner)
- **Schedule a meeting:**
  - required fields carry a red **\*** (title, type, date, starts, ends, Meeting Owner, Coordinator, mode, priority, who can see it);
  - the date and time start at **today and now** (rounded up to 5 minutes, one hour long); change them as needed;
  - **the end is always after the start:** moving the start past the end moves the end an hour later, and an earlier end is refused (in the browser and on the server);
  - **Organising department** and **Departments involved** say "Type a department name" and count departments, not people.
- **Meeting notifications:** everyone on a new meeting (Owner, Coordinator, participants) is told, in the Inbox and by email, with the date, start and end time, mode, venue, **meeting link** and their role; whoever scheduled it gets a copy. Changes carry the same details.
- **Meeting link everywhere:** shown on each meeting in the meetings list (**Join**) and on the **Calendar**, where meetings are now their own kind (Show → Meetings) with start–end times and a **Join** button.
- **Attachments: up to 10 files** at a time in every form (requests, approval form fields, tasks, information, tickets, remarks). Each file is still up to 10 MB; a form's Attachments field can be set to 1–10 files.
- **Raise a ticket:** the description box is headed **Issue Description**; **Priority** and **Required date** are required.
- **Owner steps:** no migration. Publish v1.55.2. Uploads can now be up to about 100 MB in one go; if the host refuses large uploads, raise its request size limit to at least 102 MB.

## v1.55.1 (18 Nov 2026): Ticketing is its own module; one priority scale (owner)
- **Ticketing is a module** (owner: "i want the ticketing as a separate module"). It is given per person like the others: **Admin → Users & roles → person → Module access → Ticketing**, or several people at once with **Modules** in the users list. The Ticketing feature switch is gone. Nobody has the module until IT ticks it (the Super Admin always has it). Without it, Tickets doesn't show in the sidebar and Raise a ticket, My tickets and the dashboards answer "not found"; a ticket you're on (as its assignee, say) still opens from its link. People without it see Ticketing as **Coming soon**. The user import file takes `TICKET` in its modules column.
- **One priority scale everywhere** (owner: "Critical, Most Important, Important, High, Normal"): tasks, information, meetings, meeting actions and tickets. **High** is new, between Important and Normal. Existing tickets move from High → **High**, Medium and Low → **Normal**, and ticket forms' default priority the same way. Information's "Urgent" is now called **Critical**. A ticket's task now keeps exactly the ticket's priority. Approval forms' own Priority fields keep the options IT set in the Form Designer.
- **Owner steps:** back up, run `database/migrations/202611190900_ticket_module_priorities.sql` (rollback inside), publish, then give **Ticketing** in Users & roles.

## v1.55.0 (18 Nov 2026): Ticketing System (owner)
A simple Ticketing System inside ARS CMS. It is **switched off** until the Super Admin turns it on: Settings → Feature switches → Ticketing System (IT team only for a trial, then On).

The flow: **raise → coordinator assigns → the work is a task → completed → the requester confirms → closed.**
- **Three categories ready:** IT Software, IT Hardware, Admin. Each has its own ticket numbers (`IT-SW-2026-00001`…), forms and dashboard, plus categories IT adds.
- **Forms are built in the existing Form Builder** (Admin → Ticket forms), the same one as approval forms. Each form has its category, its coordinators and who may raise it. Nothing is hard-coded, and a ticket keeps the form version it was raised with.
- **Raise a ticket:** your name, employee ID, department and email filled in; subject, description, priority (High, Medium, Low), required date, the form's fields and attachments.
- **Coordinators** are told, assign the ticket to an employee with a target date and remarks, and can reassign. **Assigning makes a task** in the employee's Tasks, with the ticket number in its title and linked for good.
- **The assignee works in Tasks:** Start, remarks, documents, then Complete with completion remarks. Completing asks the requester to confirm. It **never closes the ticket**.
- **The requester confirms** (optional rating 1–5 and feedback) or **reopens** with a reason. Reopening returns the ticket to the coordinators with the same task, and the earlier work stays in the history.
- **No answer:** a reminder after 2 and after 3 working days, and the ticket closes by itself after 4 complete working days ("Closed – auto closed"; Working Calendar). Each reminder and the closure happen once, and a last-minute confirm or reopen wins.
- **Statuses:** New, Assigned, In progress, Awaiting confirmation, Reopened, Closed, Closed – auto closed.
- **Pages:** Raise a ticket, My tickets (raised by me / assigned to me), the ticket page (details, attachments, linked task, remarks with internal ones for staff, timeline) and Ticket dashboards (one per category: totals, ticket table, filters by date, department, priority, status, assigned employee).
- **Owner steps:** run migration `202611181000_ticketing.sql` (additive), publish, then in Admin build the ticket forms (category, coordinators), and switch the Ticketing System on.

## v1.54.16 (14 Nov 2026): Message deliveries dashboard; Group by Department and any form field (owner)
- **Super Admin → Message deliveries** is now a dashboard:
  - totals: all messages, email accepted, WhatsApp sent (and delivered or read), failed (and how many wait for a retry), skipped;
  - messages per day, by channel;
  - a status bar;
  - a table of channel and provider by status;
  - why messages failed or were skipped, and which events send the most.

  Choose the period (24 hours, 7, 30 or 90 days), channel, status and provider. The list below follows the same filters. Every number opens the matching list.
- **Group by on the request lists** now also offers:
  - **Department** (the requester's department, on lists of other people's requests);
  - **every field of the forms** on the page ("Form: Vendor name", "Form: Amount" …). Fields with the same name on different forms are grouped together.

  A confidential field groups as "Hidden" for anyone who may not see it.

## v1.54.15 (14 Nov 2026): email works through GoDaddy's relay (owner)
- **Found and fixed:** ARS CMS runs in its own container on GoDaddy. There, `localhost:25` accepts email but never sends it, so nothing arrived and nothing bounced.
- Emails now go through **GoDaddy's hosting relay** (`relay-hosting.secureserver.net`, port 25). The test email arrived in the Inbox. ARS CMS email no longer depends on Resend's daily quota (Resend stays as a fallback).
- **Email diagnostics** builds its test message with the same email library as real email; GoDaddy's relay had refused the hand-built one ("bare LF").
- GoDaddy's tracking number ("SBo0x…") is recognised and kept with each email in Message deliveries.

## v1.54.14 (14 Nov 2026): email delivery audit and diagnostics (owner)
- **Super Admin → Settings → Email diagnostics** runs on the live server. It shows:
  - which mail routes the hosting allows: the local relay, GoDaddy's relay, the hosting mail server on 465/587, and an outside SMTP provider on 587/2525;
  - the DNS behind the sending domain;
  - every reply of a real SMTP conversation.
- It can send one test message and show the relay's **queue id**, which GoDaddy needs to trace it. **Download report** saves it for support. No password is used; at most 6 runs an hour; every run is in the audit log.
- **Message deliveries** shows which provider sent each email and its reference (with the queue id). An email the mail server took is shown as **ACCEPTED**, because acceptance isn't delivery.
- A mail server's **permanent refusal** (5xx) is no longer retried.
- New documents: docs/EMAIL_DELIVERY_AUDIT.md, EMAIL_ROOT_CAUSE_ANALYSIS.md, EMAIL_PROVIDER_COMPARISON.md, GODADDY_SUPPORT_REQUEST.md, EMAIL_IMPLEMENTATION_GUIDE.md, EMAIL_TEST_PLAN.md, EMAIL_PRODUCTION_CHECKLIST.md.

## v1.54.13 (14 Nov 2026): the email test shows the relay's receipt (owner)
- With GoDaddy's relay (localhost, port 25, RELAY) the live test turned green: the relay accepted the email. The email still hadn't arrived in the inbox.
- **Send test email** now also shows the mail server's own reply (for example "250 OK id=…"). If the email goes missing, GoDaddy support can trace it by that reply.
- Undelivered mail comes back as a bounce to the mailbox's **Inbox** in Roundcube.
- Roundcube's Sent folder never shows emails sent by ARS CMS (only those sent from Roundcube), and Track Delivery shows nothing on this hosting.

## v1.54.12 (14 Nov 2026): email through GoDaddy's relay for hosted apps (owner)
- GoDaddy's guidance for Web Hosting (cPanel) is that apps on the hosting send mail through its relay: server **localhost** (or **relay-hosting.secureserver.net**), port **25**, **no SSL, no password**.
  - Its limits: 500 emails a day per sender, and 500 an hour for the whole hosting account.
  - Port 465 with a password (blocked: "EACCES") and the mail program (no email arrived) don't work for the app.
- New **SMTP security** choice: **RELAY**. Set Send email through = SMTP, SMTP server = localhost, port = 25, security = RELAY; no password is needed. Emails are sent as the SMTP user (no_reply@cms.arssteels.net).
- The test message suggests the next setting to try when one is blocked.

## v1.54.11 (14 Nov 2026): the email test never hangs (owner)
- On the live site the SENDMAIL test ran past the page's 30-second limit ("This is taking longer than expected").
- The mail program (and the SMTP server) now gets **20 seconds**. If it hasn't finished, the test says so: the email may still arrive, so check the inbox and cPanel → Track Delivery.
- Such an email is **not sent again** automatically, and Resend doesn't send a second copy. When the mail program refuses an email, its own reason is shown.

## v1.54.10 (14 Nov 2026): email through the hosting's own mail program (owner)
- On the live site the SMTP test said **"connect EACCES 68.178.145.238:465"**: GoDaddy's hosting doesn't let the app open connections to mail servers, its own included.
- New choice in Super Admin → Settings → Email: **Send email through = SENDMAIL**. It hands each email to the hosting's own mail program, the way PHP and WordPress sites on cPanel send mail, so no network connection is needed. It sends as the mailbox in "SMTP user" (no_reply@cms.arssteels.net) and needs no password.
- The hourly limit and the Resend fallback work the same as with SMTP. **Send test email** says which way it went, or why it failed.

## v1.54.9 (14 Nov 2026): a smaller formatting bar; the email test says why SMTP fails (owner)
- **Formatting bar:** Bold, Italic and Underline are always shown. The **+** button opens the rest (strikethrough, code, link, lists, quote, heading, clear formatting, emoji and @mention) and closes them again. Typing @ and a name still offers people.
- **Send test email** (Super Admin) now tests the chosen provider only. With SMTP chosen, a failure shows the mail server's own reason (for example a refused or timed-out connection, or a wrong password) with what to do, instead of Resend's error.

## v1.54.8 (14 Nov 2026): email from the GoDaddy mailbox (owner)
- **Email can be sent from no_reply@cms.arssteels.net,** the cPanel mailbox on our GoDaddy hosting, instead of Resend.
  - Set it up in Super Admin → Settings → Email: send through SMTP, the server and port from cPanel's Connect Devices (filled in), and the mailbox password (stored encrypted).
  - **Send test email** says which way the test went.
- **Resend stays as a fallback:** if the mailbox can't send, or the hourly limit is reached, Resend carries the email (can be switched off). Without the fallback, emails over the hourly limit wait and are sent later.
- Every email goes the same way: notifications, sign-in alerts, retries, weekly HOD reports and scheduled reports. Message deliveries shows which provider sent each one.
- Owner steps: docs/DEPLOYMENT.md, section G1b (DNS records for cms.arssteels.net, settings, what to do if the test falls back).

## v1.54.7 (13 Nov 2026): formatted text everywhere, due dates by default, task files, Periodic tasks list; Google sign-in after the domain move (owner)
- **Formatting shows as formatting, like an email body.** Bold, italic, lists, quotes, links, @mentions and emoji in a task description (and marks inside marks, such as bold italic) now display formatted instead of as symbols. The same editor, with its toolbar, is used wherever long text is written: task descriptions (Create task, task forms, editing), remarks, project and status descriptions, meeting descriptions and discussion, information messages, long answers in request forms and About me.
- **Due dates are required for tasks,** with **11:59 pm** as the time unless you change it (Create task has a time box next to the date; editing works the same way). A quick "Add a task" line without a date is due today at 11:59 pm. A due date can be moved, not removed.
- **Attachments on a task:** the task page lists the task's files and has **Add files**.
- **The bell's count goes down** as soon as you open a notification, and stays right when you come back to the tab.
- **Assigned to me and Assigned by me** list only ad hoc tasks. **Periodic tasks** now has the same tabs, Filter, Sort, Options and pages, plus how each repeats, how many are done and Stop repeating.
- **Waiting for me** no longer has the "Approve several at once" panel: each approval is opened and decided on its own page.
- **New project:** the Back button no longer wraps onto two lines.
- **Google sign-in after the Workspace move from arsenergy.co.in to arssteels.co.in:** someone whose ARS CMS account still has the old address can now sign in with the new primary address. The existing account is found (never a new one), linked to that Google account, and its email updated to the new address; id, User ID, roles and history are unchanged. The Google account's permanent id is now kept too. Details: docs/GOOGLE_AUTH_DOMAIN_MIGRATION.md. **The owner runs migration 202611131000_users_google_sub.sql** (additive; the app works before it runs).

## v1.54.6 (13 Nov 2026): Google sign-in says why it can't sign you in (fix)
- **Why some people couldn't sign in with Google:** ARS CMS refuses a Google account that doesn't match an active account set up by IT (that is the 403), but it said the same thing for every reason. Now the message says which: no ARS CMS account uses that Google email (use the Google account of your registered email, or ask IT to correct it); the account is linked to a different Google sign-in; the account is inactive; the account signs in with User ID and password; the Google email isn't verified. A "Reference for IT" is shown.
- **Super Admin → Sign-in history** shows the reason and a shortened email (e.g. ra***@gmail.com) for refused Google sign-ins, so IT can see who tried and fix the account.
- **Pop-up problems** (pop-ups blocked, the site's address not allowed, browser storage blocked, offline) each get a plain message and are logged.
- **An office signing in together** is no longer stopped by the sign-in limit (Google sign-in: 300 per 15 minutes per network, was 30).
- Reports: docs/GOOGLE_AUTH_ROOT_CAUSE_REPORT.md, GOOGLE_AUTH_FIX_IMPLEMENTATION.md, GOOGLE_AUTH_TEST_REPORT.md, GOOGLE_AUTH_DEPLOYMENT_CHECKLIST.md.

## v1.54.5 (12 Nov 2026): Out of office moves your tasks; a warning for tasks while someone is away (owner)
- **Setting Out of office** moves your open tasks due within those dates to the first working day after the to-date (keeping the time of day). Whoever gave you each task is told, and the task's history says why. The save message says how many moved and to when.
- **A new task (or a new due date) on a day the assignee is out of office** asks first, like a holiday: keep the date anyway, or move it to the day after they are back. It always warns, whatever the holiday setting.

## v1.54.4 (12 Nov 2026): Task Summary sections by date; repeating tasks are your own (owner)
- **Task Summary** has four fixed sections that follow the dates: **Overdue**, **Due today**, **Due in the next 7 days** and **Completed today** (List and Board). Tasks move between them by themselves; the sections can't be renamed or rearranged and there are no "add a task to section" rows (use Add task).
- **Repeating (periodic) tasks are only for yourself.** In Create task, choosing Periodic sets the task for you; choosing Others makes it ad hoc. A task given to someone else can't be made to repeat, and giving a repeating task to someone else makes it ad hoc (it stops repeating).

## v1.54.3 (12 Nov 2026): Task Summary, Assigned to me, Assigned by me (owner)
- The sidebar's **Tasks** group: **Task Summary**, **Assigned to me**, **Assigned by me**, Periodic tasks.
- **Task Summary** (was My Tasks) shows only what matters now: your incomplete tasks that are overdue, due today or due in the next 7 days, and the tasks you completed today. Its cards: in the summary, Overdue, Due today, Next 7 days, Completed today. List, Board and Calendar work as before.
- **Assigned to me** is the full list of tasks given to you (with Open, Overdue, Due in 2 days, Blocked, Completed, Cancelled and All tabs and the filters); **Assigned by me** is the same for tasks you gave others.

## v1.54.2 (12 Nov 2026): select tasks with Ctrl + click and Shift + click (owner)
- The task tables (My Tasks and a project's List) have no selection check boxes any more. **Ctrl + click** (Cmd on a Mac) a task to add it to the selection or take it out; **Shift + click** selects every task between the last one you clicked and this one. A plain click still opens the task. Selected tasks are highlighted; **Esc** clears the selection. Under the table: the shortcuts, **Select all shown** and **Clear selection**. The bulk bar (complete, assign, due date, priority…) works as before.

## v1.54.1 (12 Nov 2026): remarks with task actions; a folding Planning and people card (owner)
- **Remarks in a task's Actions card:** type a remark, then press any action (Start, Complete, Mark blocked, Back in progress, Reopen, Cancel, Reassign). The remark goes with the action (it fills the reason when one is needed and its box is empty) and is posted to the task's **Comments** as "Started: …", "Completed: …" and so on. The box empties after the action.
- **Planning and people** (repeats, milestone, start date, tags, followers, delete) is a card that folds; its title line says what is inside (repeats, tags, followers). Click it to open.

## v1.54.0 (12 Nov 2026): your own approval templates; a new New request; every approver named (owner)
- **Approval templates are yours:** the approval types IT used to set up are gone (requests already raised from them still finish). Save the approval levels of a request as a template: on the workflow step of New request, or from a request you raised (Save as an approval template). **Approval templates** lists yours with who approves each level; **Use this template** opens New request with exactly those levels and approvers (change anything) and an empty form: no details or files are kept. Rename or delete them there. Only you see your templates.
- **New request, one step at a time:** Request details, then Approval workflow, then Review & submit, each a page of its own; no summary column. A slim step bar with Save as draft, Reset, Back and Next / Submit stays at the top while you scroll. Clearer fields (blue outline when active, red when something is missing), a drag-and-drop file area with each file's type, size and a ready mark, and small notices you can close.
- **Every new level starts as Specific people** (change it to a manager, HOD or group if you like).
- **Every approver named:** the review shows who each level goes to (the people chosen, or the reporting manager / HOD by name); the request page's Approval levels name who each upcoming level will go to; the journey road shows each level's name and approver under it.
- **Admin:** Approval types & workflows (and its export) is removed; Custom approval set-up (the New request form and step options) stays. Approval authority (DoA) has no matrices to read any more.
- One small database change on start (approval templates).

## v1.53.0 (11 Nov 2026): Projects is its own module; "Coming soon" for modules not given (owner)
- **Main modules:** Approvals, Tasks, Projects, Information, Meeting Management (then the AI Assistant), released one at a time. Home, Inbox, Calendar and Analytics are common to all.
- **Projects separated from Tasks:** the project pages, + Create → Project, the Projects sidebar group and every project change need the new **Projects** module. Nobody has it yet: IT switches it on per person or in bulk (Admin → Users) when Projects is released. The Super Admin is never limited.
- **Coming soon:** a module not switched on for a person shows as a blurred, locked card or choice marked **Coming soon** on Home (the Approvals / Task Management / Meetings switch, the Projects card and quick link), in the Classic menu and in Analytics (the dashboard list and the Executive overview). Nothing of its content is sent. Typing its address shows "coming soon for you".
- **Tasks without Projects:** a task's project shows as its name with a lock, no link; no project picker on Create task; no Add to project, section or project-field changes. You see only the tasks you are on (assigned, created, given by you, followed) and your team's: a project no longer opens other tasks to you.
- **Project notifications** (added to a project, status updates) are not sent to people without Projects, and older ones are hidden from the Inbox, the bell and their counts; they reappear once Projects is switched on.
- **Projects needs Tasks:** IT can't give Projects without Tasks (user form, bulk Modules, import), nor take Tasks away while Projects stays.
- **Phone Home:** modules not switched on show as locked "Coming soon" tiles too.
- **Approval levels name the approver of every level:** on the request page, a level not reached yet shows who it will go to ("will approve"), worked out from the route now (the specific people, the HOD, the reporting manager…).
- **Fixed: Waiting for me showed "No due date"** for a request whose form has a Due date. The Due date column (and Home) now shows the request's own due date (a form date field named or labelled "due"), red when it has passed; a step's own deadline shows under it as "Step due".
- **Hidden pages:** a page set to Hidden in Page access is still not shown at all (unchanged).
- **New people** start with Approvals and Tasks (before: every module but AI). Existing people keep their modules.
- The sidebar has **Tasks** and **Projects** as separate groups.
- One small database change on start (adds the Projects module).

## v1.52.3 (11 Nov 2026): arrange table columns, delete request files before approval (owner)
- **Arrange columns:** on My pending requests, Collaborating, My approved requests, Approved by me and Waiting for me, drag a column title onto another to move the column (or focus a title and press Alt+← / Alt+→). The order is saved for you and used on every visit; the Columns button also has ↑ ↓ to reorder and still hides or shows columns.
- **Deleting a request's files:** the requester, or the person who added a file, can delete it until an approver approves the first level. After that files are locked, unless an approver asks for changes: then they can be deleted again while the request is back with the requester. Delete asks first; the timeline says who deleted which file; the file is kept for the record but no longer shown or downloadable.
- **Fixed:** picking a person inside a filter panel or a table cell no longer closes the panel.
- One small database change on start (marks deleted files).

## v1.52.2 (11 Nov 2026): tasks in a popup, formatted comments, Asana-style activity, people pickers, attachments list (owner)
- **Comments format like an email:** bold, italic, underline, strikethrough, code, links, bulleted and numbered lists, quotes, headings, emoji and @mentions (type @ and a name), on tasks (comments, replies, edits) and request discussions. Comments show with their formatting. Ctrl+B / I / U work; Ctrl+Enter sends.
- **All activity like Asana:** each entry with the person's initials, "Name did this · Today at 2:27 pm", comments in full, completion with a green tick, and runs of small updates folded under "Show N previous updates".
- **Attachments, one by one:** choosing files lists each file by name and size; choosing again adds to the list (it no longer replaces the first files); remove any file before sending. On New request, request templates, request attachments, tasks and information.
- **A task opens in a popup** over the list you clicked it in (My Tasks, Home, projects, search, periodic tasks), with everything its full page has: complete, start, block, reopen, cancel, reassign, edit, subtasks, projects, dependencies, followers, comments and activity. Close it with ×, Esc or a click outside; **Open full page** opens the task's own page.
- **Comments and All activity** on every task, as two tabs like Asana: All activity lists who did what and when (comments included), oldest or newest first.
- **My Tasks** shows **Priority** beside the due date (wide enough for "Most Important").
- **Choosing people:** every name reads **Name - Employee code** (the User ID) with the **department below**, in search pickers and in single-person lists (assign, reassign, followers, mentions, approvers, managers, filters). Each list opens where it is fully visible (above when there is no room below), has a **×** to close, and closes when you click outside or press Esc. Filter, Sort, Group and Options menus also keep inside the screen and have a ×.
- No database change.

## v1.52.0 (11 Nov 2026): Meeting analytics, MOM timing as ticks, forms without false errors (owner)
- **Meeting analytics** (Analytics → Meeting analytics, with the Meeting module): meetings held and cancelled, points / start / end / MOM on time, how often meetings are extended and by how much, attendance, how long the Owner takes to approve points and MOM, action items done, confirmed and overdue, open points; compared with the previous period; by meeting type, department and Coordinator; action owners and ageing; twelve months; meetings needing attention and the most extended. **Whose meetings** follows the scope: your own, your team (everyone below you in the reporting line), the departments you head, or the whole organisation (IT). ED and MD (Management group) can switch to all meetings. Management-only meetings count only for the people on them, ED, MD and IT.
- **Enter MOM** replaces Start meeting / End meeting / Record as held. A meeting can be scheduled before or after it happens, and its date and times can be edited until the MOM goes to the Owner.
- **MOM timing:** tick **Started on time** (or enter when it started) and **Meeting was extended** (enter when it ended; the extra minutes are worked out and shown in the meeting details as "Extended: Yes, by N min").
- **Ticks, not calculations:** Points shared in time, Started on time, Ended on time and MOM in time are the Coordinator's ticks, used on the meeting page, Home → Meetings and Meeting analytics.
- **Attendance** is a tick per person: ticked = present, not ticked = absent.
- **Fixed for every form:** saving a form that opens its new record (Add user, Schedule meeting, New request, Create task, new project, new approval type…) flashed "The server sent back an unexpected answer" before the new page opened, and could ask "Leave?" on the way. Both are gone. A refused save still shows its own message and still asks before you leave with unsaved changes.
- One small database change on start (the four on-time ticks on meetings).

## v1.51.1 (11 Nov 2026): Meeting Overview on Home, modules for many users, toolbar filters everywhere (owner)
- **Home → Meetings:** a third choice beside Approvals and Task Management. It has the cards (upcoming, to approve, MOM to write, my open actions), **Needs attention** (points or MOM late or due soon, meetings not started or still running, overdue actions, completed actions to confirm), Coming up, Waiting for my approval, Done to confirm, **Insights**, and for a period the on-time figures, by type, by department and the register. The separate Meeting dashboard page and its menu entry are gone (old links open Home → Meetings). The figures follow page access ("Meetings: dashboard figures").
- **Users & roles:** tick several people and press **Modules** to give modules, take them away, or set exactly which ones they have. Each person is checked as on the user page and recorded in the audit log.
- **One kind of filter on every list:** the big search and filter forms are gone (task search, request search, users, meetings, analytics, admin dashboards, AI analytics, reports, Super Admin audit, sign-ins and requests). Each page has the toolbar instead: **Filter** (a dropdown with Apply), Sort, Group, Options and a small search icon.
- **Searches start from the bar at the top (Ctrl K).** Its Saved searches now show only what you can open (task searches with the Task module, team searches if people report to you, requests with the Approval module, meetings with the Meeting module) and your own saved task searches. The Task search page shows what was searched as chips you can remove.
- **Meetings in the Inbox:** meeting messages (invitations, points and MOM to approve or ready, cancellations, reminders, action follow-ups) have their own **Meetings** view in the Inbox and the bell, instead of sitting under Tasks. Each is linked to its meeting.
- One small database change on start: the Inbox category gains Meeting, and meeting messages already sent move to it.

## v1.51.0 (10 Nov 2026): Meeting Management (owner)
- **New module: Meetings** (sidebar → Meetings; Classic → Meeting Management). Everyone has it; IT can switch it off per person (module access).
- **One Meeting Owner and one Coordinator per meeting** (they can be the same person). The Coordinator schedules the meeting, adds the meeting points, marks attendance and writes the MOM. **Only the Meeting Owner approves the points and the MOM.** Everything approved is sent to the participants.
- **Schedule a meeting:** type (IDM, Intra Department, MD, ED, Management, Production and Despatch, Project Review, Review, Critical, External, Other), date and times, Owner, Coordinator, participants and departments (all chosen by typing a name), mode, venue or link, priority, General or Management-only, guests, and optional deadlines for the points and the MOM. The Owner chooses what happens if the points aren't approved in time.
- **The meeting page:** points (reorder, presenter), Approve / Return for the Owner, Attend / Maybe / Can't attend for invitees, Start meeting or Record as held, attendance, the MOM (discussion per point, decisions, action items, open points), history, and an "On time?" panel.
- **Action items become tasks** when the Owner approves the MOM: a General task for the responsible person with its priority and due date, linked to the meeting (the task page shows the meeting).
- **Follow-ups:** a register of every action and open point. The Owner or Coordinator confirms a completed action, or sends it back (the task reopens). **Schedule follow-up meeting** carries the open actions and open points forward. A meeting closes once every action is confirmed or carried forward.
- **Meeting dashboard:** meetings held, points and MOM in time, started on time, attendance and actions, by type and department, worked out from the recorded times.
- **Admin → Meeting settings:** meeting types with default points, and the Management group (ED, MD) who see every meeting.
- **Reminders:** the Coordinator is reminded when the points or the MOM are due within a day.
- **Picker tidy-up everywhere:** a one-person picker that is filled now shows just the chosen name (remove it to choose someone else).
- This release runs one database change on start (the meeting tables, a meeting link on tasks, and the Meeting module for every user). Rollback steps are in the migration file.

## v1.50.3 (10 Nov 2026): follow-ups from New request; a clear "no access" screen (owner)
- **Fixed: Raise a follow-up.** On a request raised with **New request** (CUS-…), the button sent you to Request templates, which only lists IT's approval types (and can be turned off for some people), so the follow-up couldn't be raised. It now opens **New request** with the title and matching details copied and a note "Raising a follow-up to …"; on submit the new request is linked to the approved one (an expired approval asks why, as before). Requests raised from a template still go to Request templates to choose the type; its "Something else? New request" link keeps the follow-up too.
- **Follow-up management on the request page** (custom and template requests):
  - A **Follow-ups** card lists every follow-up raised from the request, with its status and who has it now, and holds **Raise a follow-up**.
  - The **Work tasks** card has **Add a follow-up task** (task, assign to, priority, optional due date). The task is linked to the request, listed in the card and in the person's Task Management, without raising a new approval. Needs the Task module; assignment follows the General task type's rules.
- **No-access screen.** A page you can't open (turned off for you by IT, or part of a module you don't have) now says **"You don't have access to this page"**, names the page and why, and offers Go to Home. A request or task that isn't shared with you still shows "This page isn't available", so nothing private is confirmed.

## v1.50.2 (10 Nov 2026): no more false failure messages (owner)
- **Fixed:** creating a user could first show a failure message although the user was created. The welcome email (and WhatsApp) was sent while the page waited, and a slow provider ran past the page's time limit. The user page now opens at once and says **"A welcome email is on its way"**; the email follows a moment later.
- The same fix everywhere messages are sent while you wait: approval submits and decisions, comments and mentions, collaborators, task changes, information notices and Super Admin request deletes. Messages are saved first and sent just after the screen answers; anything that can't be sent is retried by the background job every 5 minutes, as before.
- **Bulk Re-invite / Send set-password link** (Users & roles) now answers at once and sends the emails in the background.
- **Task Management audit:** a full gap analysis against the 145-point Task Management checklist is in `docs/task-management-audit/` (11 reports). No application changes were made for it.

## v1.50.1 (10 Nov 2026): task links open for everyone on the task; new task priorities (owner)
- **Fixed:** the link in a "Task for you" email showed "This page isn't available" for someone without the Task module (for example an approval-only user given a task). Anyone a task is assigned to, assigned by or created by can now open that task and work on it; the Task module still controls Task Management (lists, creating tasks, projects).
- **Task priorities** are now **Critical**, **Most Important**, **Important** and **Normal** (in that order), in Create task, task lists, search, bulk "Set priority", work-task levels and task pages. Existing tasks keep their meaning (Urgent shows as Critical, High as Most Important, Normal stays Normal).
- This release runs one small database change on start (adds the Important priority). Nothing else to do.

## v1.50.0 (5 Nov 2026): go-live release: work task options, linked items, PDF like the screen, security fixes (owner)
- **Work task steps:** a level set to **Work task** now has **Task priority** (Low, Normal, High, Urgent) and an optional **Task due date**. The task reaches the person's Task Management with that priority and due date when the step starts (put the work level after the approval levels to have it start once they approve). The due date also shows in **Waiting for me**.
- **Request page:** a **Work tasks** card lists the tasks raised from the request (number, title, who, due date, status), next to **Linked requests**.
- **Linked requests:** type a number or words of the title and pick from the list; only requests you can see are offered.
- **PDF download** now looks like the request screen: the ARS header, title with status and priority, Request details in two columns, Approval levels, Work tasks, Linked requests, Attachments and History, with page numbers.
- **Security:** a lock from wrong passwords no longer signs someone out of sessions already open, and the count starts again after a lock runs out (so nobody can keep a colleague locked out using their email or mobile number). A User ID can't be 10 to 15 digits (it would look like a mobile number). Sign-in limits count one mobile number once however it is typed.
- **Shorter wording** on many screens (Out of office, bulk approve, collaborators, admin approval types, DoA, form fields). Admin calls them **Approval types** everywhere.

## v1.49.6 (4 Nov 2026): welcome emails, users bulk actions, Home tidy-up (owner)
- **New users get a welcome email:** every user added with **Add user** or created by an **import** is emailed their User ID and a link to set their password (Google users are told to sign in with Google). There is no tick box any more. After an import the message says how many emails are on their way.
- **Set-password and invitation links now work for 12 hours** (they were 72).
- **Admin → Users & roles:** tick users (or **Select all on this page**) and **Re-invite**, **Send set-password link**, **Deactivate** or **Activate** them together. Each asks first; the answer says how many were done and why any weren't. Only people you may change can be ticked.
- **Home:** **Recently viewed** and **Finished in the last 30 days** are gone. **My recent requests** shows 8 at a time, with page numbers for the rest.
- **Waiting for me:** the last column is **Due date**; a step without a response time says **No due date**.

## v1.49.5 (4 Nov 2026): approvals pages by role, the right tab for each request, Delete selected (owner)
- **Pages by role:** people whose designation isn't ticked **Approver** now see only **New request**, **My pending requests**, **My approved requests** and **Collaborating** under My Approvals (sidebar, Classic tabs, search and the phone bar). Approvers see every page. Anyone with something waiting for them still sees Waiting for me.
- **Fixed:** a request opened from **Waiting for me** highlighted **My pending requests**. The highlighted page, the breadcrumb and **← Back** now name the list the request belongs to for you: Waiting for me, My pending requests, My approved requests, Approved by me or Collaborating. Same in the Compact and Classic views.
- **My pending requests:** the **Open** card is gone (Waiting for approvers, Sent back and On hold cover it). **My approved requests:** no cards; use Filter.
- **Request page:** the decision buttons keep each label on one line ("Ask for changes", "Ask a question").
- **Super Admin → Requests:** tick requests (or the box in the header for the whole page) and **Delete selected**, with one reason. Each request is deleted and logged on its own; one under a legal hold is skipped and named.
- The phone bar's **New** opens New request.
- **Sign in:** in the User ID box you can type your **User ID**, your **mobile number** (with or without +91, spaces allowed) or your **email**. The password and the WhatsApp code are still asked every time. Forgot password takes the same.

## v1.49.4 (3 Nov 2026): notifications panel layout (owner)
- **Fixed:** in the bell's panel, the All / Approvals / Tasks / Information row was squeezed when the list was long (cut off, with a small scrollbar). It now keeps its height on every screen; only the list scrolls.

## v1.49.3 (3 Nov 2026): users list actions and Department filter; see-through dropdowns fixed (owner)
- **Admin → Users & roles:** a **Department** filter (or "No department") next to Status and Module, and an **Actions** column with a three-dot menu on each row: **Re-invite**, **Send set-password link** (or **Send reset-password link** when they already have a password), **Deactivate user** / **Activate user**, and **Open user**. Each asks first, naming the person, and the answer shows as a message. People you can't change (yourself, or another IT Admin unless you are the Super Admin) only offer Open user.
- **Fixed:** the people search list ("Nobody matches.", the names) was see-through, so the text under it showed through. Checked every dropdown and panel: faded colours (the phone top bar and tab bar, highlighted rows, coloured borders) also didn't show and now do.

## v1.49.2 (3 Nov 2026): module access in the users import (owner)
- The users file has a **modules** column (before roles): **APPROVAL**, **TASK**, **INFORMATION**, **AI** separated by ; or **ALL**. Empty: a new person gets Approval, Task and Information; an existing person keeps what they have.
- The same rule as the user page: nobody changes their own module access, and only the Super Admin changes another IT Admin's.
- Files made before this column still import (the column can be left out).

## v1.49.1 (3 Nov 2026): import with Excel files (owner)
- **Admin → Import** works with **Excel**: **Download template** and **Download current …** give an Excel workbook (.xlsx) with the sheet to fill (columns set to Text, so User IDs and WhatsApp numbers stay as typed) and a **How to fill** sheet. Upload the filled workbook as it is; dates, numbers and TRUE/FALSE are read correctly. The problem list downloads as Excel too.
- CSV files still work, with commas, semicolons or tabs (Excel's "Text (Tab delimited)" too; before, a tab file showed every column as missing).
- An old .xls file asks to be saved as Excel Workbook (.xlsx).
- The users file's roles column lists EXPORTER (may download reports) with USER, IT_ADMIN and SUPER_ADMIN.

## v1.49.0 (2 Nov 2026): the ARS GREEN STEEL CMS brand, and New request / New task straight to the form (owner)
**Branding** (the owner's approved ARS GREEN STEEL CMS logo and brand sheet):
- The app is called **ARS CMS** everywhere: browser tab ("… · ARS CMS"), installed app, sign-in, emails' subjects, phone notifications, PDF summary and loading screens.
- The approved logo is in the header, the sign-in and other sign-in pages, the phone top bar, the public pages and the approval journey; the square icon (from the same logo) is the browser tab icon, the phone/desktop app icon (Android, iPhone, maskable) and the install card. Colours: primary blue #004B8D, accent #0A72D9, ARS red #E30613.
- **Sign-in and loading screens** (owner's phone references): sign-in pages have a pale background with a city skyline and the ARS swooshes; on a phone the logo sits large above "Welcome to ARS CMS". The loading screen is the splash: the logo on its own blue, with a bar and what is happening. New loaders: the ring round the mark, the dotted ring, and "Loading ARS CMS…" with a bar (Classic view's loading box uses the dotted ring and bar).
- **Logo without a background** on the blue sign-in panel (the one-line ARS | GREEN STEEL CMS), on the loading screen and on the phone sign-in (navy lettering on light, white on dark).
- **Round loaders** have the ARS lettering in the middle; each time one appears it is the ring or the dotted ring, at random.
- **Default profile picture:** until someone uploads a photo, they show the ARS CMS round icon: **blue for approvers**, **white for other users** (header, account menu, More, Profile, people cards). Anyone can still upload their own photo.
- **Phones with the app installed:** close and reopen it to pick up the new icon; some launchers need the app removed and installed again.

**Shortcuts to the form:**
- On a phone, the **+** on Approvals and Home's **New request** open the **custom approval form** (the templates list is still under More → Request templates).
- **New task** and **Add task** everywhere open the **Create task** window directly; the old "choose a task type" page is gone from the menus (a task type IT set up with its own form still opens from its link).

**Fixed:** in the Classic view, the Tasks Management tab bar now shows on every task page.

## v1.48.1 (2 Nov 2026): a slimmer Approval Journey (owner)
- The journey is smaller: the road and the van take less height, and the side column (Request Status, Approval Levels (Detailed), Status guide) and the level details panel are gone; the request page below shows the same facts.
- A level's details (name, status, time and **approver**) show when you **hover** over it (or reach it with the keyboard); tapping a level takes you to the page's Approval levels card.
- Folded, the journey keeps a **small road with the van** in its header, from the title to the status, so you still see where the request is.
- The percentage (e.g. "100% Completed") always shows in the header.
- On a phone the refresh, share and fold buttons sit in the header's top-right corner, beside the ARS mark.
- **Fixed:** in New request, choosing **Work task** or **FYI** for a step (and other dropdowns in the form) now sticks; the form used to put the old choice back.
- **On hold:** the approver who put a request on hold sees **Resume** first, with the reason, and the decisions return after it; on a phone the bottom bar is one **Resume** button while it is on hold.

## v1.48.0 (2 Nov 2026): the new Approval Journey, request page and one colour per status (owner)
**Approval Journey** (from the owner's design and reference folder), on computers and phones:
- A header with the ARS mark, the request number and title, its status, the number of levels, **refresh** (checks for news now) and **share** (copies the link).
- A scenic road (hills, trees, the ARS plant) with the van; each level shows its name, status and time; the flag at the finish.
- **Request Status**: a ring with the percentage, "X of Y levels completed", request number, requester, submitted on, valid until.
- **Approval Levels (Detailed)**: every level, who decided and when; the current one highlighted; tap one for its details.
- When it ends, a banner: Request Approved (with confetti, once), Rejected at <level> by <name>, On hold, Changes required, Expired, Withdrawn.
- A **Status guide** (closed by default) explains every status.

**Request page**, laid out like the owner's picture:
- **Request details** with an icon per row in two columns (Priority as its coloured pill); **Approval levels** with a "Waiting for … to decide" banner and tiles (Progress, Completed, Remaining, Time in process, Last update) above the level cards.
- On the right: your decision (if it's yours to decide), Recall & change, Withdraw, Attachments, Collaborators, Discussion.
- Below: Linked requests, **Timeline** (the latest 3, newest first; **Show more** opens the rest in a scrolling box), Reuse; then Raise again like this (and, for the Super Admin, Super Admin and Delete).
- On a phone everything is one column, in the owner's order: the journey (the road and its banner; the Request Status and detailed-levels cards are left out, their facts are below), then Request details, then Approval levels and the rest.

**One colour per status, everywhere** (lists, cards, the request page, the journey, phone cards): In progress / Waiting / Pending blue; On hold amber; Changes required / Asked for changes orange; Approved / Done green; Rejected red; **Withdrawn purple** (was grey); Skipped / Given the task / Told purple; **Expired grey**; Not started / Not needed / Closed grey; Blocked orange-red. Readable in light and dark themes.

## v1.47.1 (2 Nov 2026): priority colours everywhere (owner)
- Every priority now shows in colour wherever it appears: tables (task lists, project lists and boards, My Work on Home, Analytics "Oldest open tasks", Records, the request lists), headings (the task page, the task pane, the request page, an information item) and the phone rows.
- Built-in priorities: **Urgent** red, **High** orange, **Important** yellow, **Normal** blue, **Low** grey (Home → My Work used to say "Medium" for Normal; it now says Normal like everywhere else). Editable priority boxes in task tables wear the same colour.
- A request priority option IT hasn't coloured yet takes a colour from its name (Critical red, Most important and High orange, Important yellow, Normal/Medium blue, Low grey); a colour chosen in the Form Designer always wins.

## v1.47.0 (2 Nov 2026): priority and coloured choices (owner)
- **Colours for choices:** in the Form Designer, each option of a Dropdown, Radio buttons or Multi-select field can have a colour (red, orange, yellow, green, teal, blue, purple, pink, grey, or none). Wherever that value shows (request and task details, task tables, the New request summary) it is a coloured pill, readable in light and dark mode.
- **Request priority:** if a request's form has a choice field with the key `priority` (as in Custom approval), its value is the request's priority, in its colour: beside the title on the request page and in the PDF; a **Priority** column (after Status) in My requests, Collaborating, My approved requests, Approved by me and Waiting for me, with **Sort: Priority (highest first)** and **Group: Priority** in your option order; in search, Super Admin requests, Admin Records (and its CSV), the Home widgets (My recent requests, Waiting for me, Due soon, Returned, Finished, Recently viewed) and the phone cards. Requests without one show "—". A confidential priority field shows *Hidden* to people who may not see confidential values.
- **Task priority** shows as the same kind of pill in every task list, board and table (Urgent red, High orange, Low grey).

## v1.46.0 (2 Nov 2026): the remaining build, and the owner's decisions (owner)
**On your phone**
- A task keeps **Add a comment** at the bottom of the screen, as in Asana: tap it, write, @mention, **Send**.
- **Information** uses the phone pattern (Choose view, Manage view with search and sort, **+**, **…** for Received and Sent by me).
- **New request:** the steps and the buttons are one slim row each (Details, Workflow, Review; Draft, Reset, Next), so most of the form fits on the first screen.
- **Analytics:** the dashboard, whose numbers and period fold into one row above the numbers.
- **Calendar:** **Show** is one dropdown (ticked kinds with their counts), on a computer too.
- **Pico Bot** opens to about three quarters of the screen; it grows out of its button and shrinks back into it.

**Approvals (owner's decisions)**
- **Resubmitting after a change that alters the route** (for example a higher amount needing another level) restarts from the first level the change affects; earlier levels keep their approvals. The history shows what changed.
- **Parallel levels where any one or any N is enough:** a new setting, *If one branch rejects*: end the request (default, as before) or only when the required number can no longer be reached.
- **No request ends approved by nobody:** if every level is skipped, it goes to the requester's HOD (or IT), unless IT ticked *May finish without an approver* on that predefined type.
- **Expired** approvals show as Expired in lists, search, the request page, phone cards and the PDF; amending one or raising a follow-up asks for a reason.
- **Rules:** form rules and workflow rules now use one editor (all or any of several rows; dates compare as dates). Saved rules are converted once when this version starts (the one migration in this release).

**IT and Super Admin**
- Confirmations before high-impact admin actions (deactivating groups, departments, designations; closing a type; saving working days; removing a provider key; hiding a page for everyone). Loading demo data needs **LOAD DEMO** typed and is refused on a database with many real people.
- Page restrictions can no longer be side-stepped through an address that isn't a configured page.
- Break-glass signs in with its password alone while its emergency window is open; every such sign-in is recorded and alerted.
- Super Admin home: **Origin lock** on/off and **WhatsApp templates still to switch on**.
- **Google Drive backup:** the encrypted daily backup can be copied to an ARS shared-drive folder (settings, Test, newest copies kept).
- **Security records** (sign-in attempts, WhatsApp codes, ended sessions, used links) are deleted after 90 days.
- **Records:** requests show their **Amount** (Hidden when confidential and you may not see it), in the CSV too.

**Fixes**
- Create task: choosing a collaborator closes the list; the calendar and repeat buttons now work on a wide window (they open the due date and the repeat settings).
- Records CSV: a stray character before the first heading (two byte-order marks) is gone.

## v1.45.0 (2 Nov 2026): the phone app, laid out like Asana (owner)
On a phone (a computer is unchanged):
- **The same pattern on every list:** a big title with **…** for that screen's other pages, flat lists, and a floating bar above the tabs: **Manage view**, **Choose view** (which list) and the red **+**. Choices open as sheets from the bottom.
- **Tabs:** Home, Approvals, **My tasks**, Inbox, More; the open one sits in a pill and shows its name.
- **My tasks:** one row per task: tick the circle to complete it (with Undo), the title, its projects, the priority dot (Important, Urgent) and the due date (red when overdue). Manage view: **Compact mode**, **Sort** (due date, priority, title, newest) and **Group by** (none, due date, project); groups fold.
- **A task:** back, **Mark complete**, copy link and **…** (its actions) at the top; a big title with **Assigned to** and **Due date**.
- **Inbox:** grouped by day, each notification as a card (kind, title, message with **See more**, time), bookmark and archive. Choose view: **All activity**, **Bookmarks**, **Archived**; Manage view: filters, unread only, newest first.
- **Approvals:** the four lists in Choose view, **+** for a new request, **Compact mode** for one line per request.
- **Search:** one box for requests or tasks, then quick filters and shortcuts.
- **More:** your photo, name and email; **Out of office** (says whether it is on) and **Notifications** tiles; Settings (including colour mode), Support (Help centre, terms, privacy), Sign out and the app version.
- Not copied from Asana because ARS-CMS doesn't have them: Do not disturb, likes on a task, a language choice, several accounts.

## v1.44.1 (2 Nov 2026): phone fixes (owner)
- **On your phone, the notifications panel fits the screen.** It ran off the left edge; it now spans the screen under the top bar, stops above the bottom bar, and its filters (All, Approvals, Tasks, Information) scroll sideways if they don't fit. On a computer it is unchanged.
- **Loading screens on your phone:** while a page loads, you see the shape of that screen (Home, Approvals, Tasks, Inbox, More, a request with its journey, a task, or a general list) instead of the old page. Pages that load at once show nothing extra. A computer is unchanged.

## v1.44.0 (2 Nov 2026): the approval journey (owner)
- **The approval journey** on every request: your request is sealed into an envelope and loaded into the red ARS van, which drives along the road of approval levels. It waits beside the level deciding now with the request out for review; each approval stamps it green, it goes back into the van and the van drives on to the next level; at the flag the road turns green and shows 100%.
- A rejection shows a red stamp where it stopped; changes asked show an orange stamp and the van drives back to you, then sets off again when you resubmit.
- **Work tasks** and **Information (FYI)** are shown beside the road, each with its own status: who has the task and whether the request waits for it; who was told and whether the message was delivered, is pending or failed.
- It follows the request live (every 10 seconds while open, at once when you come back) and never replays on a reload. Hide it with the arrow at its top right. With "reduce motion" on, nothing moves.
- **Work steps that don't hold the request up:** in New request, a Work task level now has **The request waits until it's done**. Untick it to give the work as tasks and let the request move straight on; finishing those tasks doesn't decide anything on the request, and the people given them can read the request.
- A task from a request shows that request's journey (small) on its page; lists and phone cards show its progress in small.

## v1.43.0 (2 Nov 2026, published with v1.44.0): the phone layout; tasks from approvals highlighted; QA fixes; Classic and request page layouts (owner)
**On your phone** (screens below 768 px; a computer looks and works exactly as before):
- A bar at the bottom with **Home**, **Approvals**, **Tasks**, **Inbox** and **More**, with the number waiting for you and unread.
- **Home** says what needs you in one line, then four counts, quick actions (New request, New task, Search, Ask AI), the first approvals waiting, your tasks due today and your requests in progress.
- **Approvals**: Waiting for me, My requests, Approved and Drafts as cards: number, title, who raised it and their department, the amount, who has it, when it was submitted, how long it has waited, Overdue or Due soon, and the status.
- **On a request**, Approve, **Return** (ask for changes), Hold and Reject stay at the bottom, above the bar.
- **Tasks**: Today, Upcoming, Overdue, Completed and Assigned by me as cards; the red **+** adds a task.
- **Inbox**: All, Approvals, Tasks, Information and a new **Mentions** tab.
- **More**: your profile and every other page you can open, and Sign out (it asks first).
- The installed app's splash screen uses the new page colour; long-press its icon for Approvals, Tasks and Inbox.

**Tasks from approvals:** a task made by an approval's work step is tinted and shows the request number (it opens the request) in every task list, board and table, on Home and in the task pane.

**Fixes from the full QA pass** (`qa/BUG_REGISTER.md`):
- files of a confidential field could be downloaded by people who may not see confidential values; their names now show as "a confidential file" in the history;
- people told by an FYI step can read the request but not comment, add files or link it;
- IT's and the Super Admin's sign-ins always end after the idle time, even on a phone;
- "Try as" can no longer connect someone's Google Calendar or mark their notices read;
- a work-step task can't be added to a project, moved under another task, repeated or deleted on its own;
- a monthly repeating task due on the 31st keeps the 31st (or the month's last day);
- Home loads with fewer database queries; two optional indexes speed up the Inbox and completed tasks (`database/optional/v1421_qa_indexes.sql`; IT runs it once approved, nothing runs by itself).

**Classic view layouts:**
- **Create task in the Classic view** is now the same centred, two-column floating window as in Compact, dressed like a Tally window: a solid blue title bar in capitals, square corners, a blue frame and a grey button bar. (The fields used to be drawn over one another.)
- **Classic forms:** a field's box no longer shrinks to nothing next to its label in narrow spaces (Task search filters, Out of office dates, the step name in New request): it moves under its label instead.
- **Analytics on phones:** the page bar puts its section names on their own row.
- **Sidebar logo:** "ARS-CMS" stays on one line.
- **Request page, laid out as the owner's sketch:** the title and request number with the approval road beside them across the top (each level's approver, then the finish flag); on the left Request details, then Approval levels (the status, the progress figures and level by level); on the right Needs your action, with the decisions as a grid of buttons (Approve, Ask for changes, Put on hold, Ask a question, Reject), then Attachments, Collaborators and the rest.
- Every screen of the Classic view was checked on a computer and a phone.
- **Work and FYI steps (owner's report):**
  - a **Work task** step is now also a task in Task Management for each person on it (My Tasks, boards, calendar, Home), linked to the request. Ticking it done marks the work done on the request, which moves on; if the step closes on the request (done there, withdrawn, rejected), the task closes too. Only the person it's for can tick it; it's handed over on the request;
  - people told by an **FYI** step can now open the request from their message (it said "Not found" before);
  - the "Kind of step" box no longer cuts its words off (Approval, Work task, FYI), with a line saying what each does; the summary says "needs someone to do…" or "someone to tell…" for those steps.

## v1.42.0 (1 Nov 2026): the remaining screens in the new look; editable task tables (owner)
- **Calendar:**
  - a clearer toolbar (round arrows, Today, and Month / Week / Day / **Agenda**);
  - category chips with a tick and how many entries each has;
  - today circled, weekends shaded;
  - each kind of entry has its own coloured stripe.
- **Boards (My Tasks and projects):** columns have a coloured top edge and a count. Cards show who it's for (initials), the due date with an icon, the priority and the project.
- **Create task:**
  - on a computer, a card in the middle of the screen: task details on the left, task settings on the right (due date, **priority**, repeat, collaborators, Task with a form);
  - on a phone, the bottom panel as before;
  - the Classic view keeps the corner panel.
- **Task tables:** due date, assignee, priority, **collaborators** and **tags** now change in their cells in every task table (projects, My Tasks, task search), wherever you may change the task. Created by can't be changed.
- **Analytics:**
  - People and Departments show completion and on-time bars in their tables;
  - Departments add comparison charts;
  - Data quality shows a card per check (green when clean);
  - Trends opens with headline cards and the change against the comparison period.
- **Analytics, "My tasks":** a new choice in Whose numbers for the tasks given to you, with the Overview and the Tasks dashboard.
- **New request:** the Save as draft / Reset / Back / Next / Submit bar is at the top of the page, under the steps.
- **New request:** **Next** only when every required field is filled in (a red star marks them; what's missing is shown beside it). The approval workflow can be changed only after Next. **Submit** is on the last step.
- **The road:** while a level waits, the van is halfway to it; it reaches the approver's name once they approve.
- **Request page:** the road is at the top, centred and smaller, with **Request details** below it, now including the requester's details (User ID, department, designation, email, reporting manager). On the right: your action box first (smaller), then Attachments, then Collaborators.
- **Home, redesigned:**
  - **Approval Overview:** cards for what's waiting, overdue, your open requests and changes asked; Waiting for me first; your drafts (open or delete), recently viewed and **Quick insights** (requests raised, approved, average approval time) for a period you choose.
  - **My Work – Overview:** Total, Upcoming, Overdue and Completed for a period you choose (Today to a custom range); My Tasks with tabs; your projects with progress; the latest updates on your tasks and projects; your weekly workload.
  - Approvers open on Approvals, everyone else on Task Management; switch at the top.
- **New look for ARS-CMS:** a new ARS-CMS mark and logo beside ARS Green Steel, new app and browser icons (install the app again to see the new icon on your phone), ARS Blue throughout, and blue sidebar icons.
- **Loading and results:** animated ticks, seals and crosses for done, approved and failed (from IconScout, in ARS colours); a new loading screen, shimmering placeholders while pages load, and an animated tick when something is saved, submitted, decided or a task is completed (a cross when it fails). With "reduce motion" turned on, nothing moves.
- **New request:** on a computer each column scrolls on its own; each approval level is a small card on top (click to edit it); options IT has fixed aren't spelled out on every level.
- **Request details** opens with the requester's name and department.
- **Fixed:**
  - Admin → Custom approval (and other long forms) asked "Leave without saving?" after Save;
  - choosing a status in a project's header (Set status) now selects it in Post a status update and takes you there;
  - in the dark theme, the open list of dropdowns (for example Share → Invite) was unreadable.
- User Guide, Help and the tour cover the above. The privacy policy and terms are unchanged: no new data is collected or shared.

## v1.41.0 (1 Nov 2026): install the app, notifications on your phone, the approval road (owner)
- **Install ARS-CMS as an app** on Android, iPhone, iPad, Windows and Mac. A card offers it on the first visit (on iPhone and iPad it shows the Share → Add to Home Screen steps). **Maybe later** is remembered. Profile → **App & devices** always has it.
- **Phone and desktop notifications:** turn them on per device in Profile → App & devices.
  - Approvals, tasks, reminders, information and IT's notices arrive even when the app is closed or you're signed out. Tapping one opens the record.
  - Choose which kinds come under Profile → Notifications → **Phone & desktop**.
  - The Super Admin makes the keys once (Settings → Phone & desktop notifications); no outside account is needed.
- **Stay signed in all day on phones:** on a phone, a tablet or the installed app you stay signed in until midnight (India time); computers keep the inactivity sign-out. The Super Admin can change who gets this.
- **Admin → Notifications:**
  - IT sends a notice to people, departments, roles, heads of department, managers or everyone, with a category and priority.
  - History shows how many the push services accepted.
  - Devices lists every registered device.
- **The approval road:** on every request, a road shows the journey, with the red ARS van at the level waiting now. It drives on by itself as levels finish and reaches the flag with a big tick when fully approved. Tap a point to see who decides there.
- **My requests, redesigned:**
  - Raised by me / Shared with me with totals.
  - Status cards (All to Overdue).
  - Search also by approval type and approver.
  - Your own columns, a progress bar per row and a ⋮ menu of what you can do.
  - Numbered pages.
  - The same on My approved requests, Approved by me and Collaborating.
- **New request in three steps** (details, workflow, review) with a live summary and an action bar. People pickers show initials, designation and department.
- **Tables and Analytics fit the window:** every table scrolls in its own box with the header kept in view, and long tables come in pages. Each Analytics board is split into pages that fit the screen.
- **Look:** the main screens get the new header icons and summary cards in the Compact view (Classic stays as it was), in both light and dark themes.
- **Fixed:** with the sidebar folded, the Create (+) menu was hidden and labels such as "Information" were cut off.
- Privacy policy, terms, User Guide, Help, tour and first-use checklist cover all of the above.

## v1.40.0 (1 Nov 2026): every audit finding addressed (owner)
- **Security:** four Super Admin pages could be read without signing in through a client-navigation request; every admin page now checks access itself, and a test keeps it so. Signing in no longer hints which User IDs exist. The break-glass account's actions are recorded and alerted.
- **Approvals:** nobody can skip a step of their own request, and a request is never approved without at least one real approval (a step skipped for having nobody now waits for IT instead). Changing the approver chosen in a field restarts that step on resubmit.
- **Resubmit:** a request sent back for changes goes through the same duplicate, unique-value and budget checks as a new one. A background step that partly failed is shown as failed.
- **Privacy, terms, Help and tour:** updated for every module (AI Assistant, tasks and projects, Inbox, profile photo, weekly HOD email, encrypted backups); the tour now covers Home, Inbox, Create, My Tasks, Draft task, Projects and your profile.
- **Messages:** WhatsApp rate limits are retried properly, sign-in codes can't be crowded out by bulk messages, a message is never sent twice after a crash, and a scheduled report reaches everyone else when one address fails.
- **Backups:** every backup gets a checksum; with a key set they are encrypted, and an automatic off-site copy can be switched on (S3-compatible storage). `/api/health/deep` lets a monitor alert when backups or jobs stop.
- **New:** a weekly email to each head of department (off until switched on).
- **Smaller:** "Home" everywhere (no more "Overview"), page titles that match their headings, a task given to someone else opens on its page, Home's task sections load after the approvals, project edits can't overwrite each other, and the user guide and technical documents are up to date.
- **Database:** two additive migrations (`notification_outbox.claim_token`, `hod_report_runs`), applied on start.


## v1.39.0 (31 Oct 2026): workflows save as you work (owner)
- **Workflows (IT):** changes save into the draft by themselves a few seconds after you stop (nothing is published), and Save draft saves at once. If a colleague saved or published in the meantime, you're told and nothing of theirs is overwritten.
- **Rules:** the "only when" rules on form fields and the conditions in workflows now use the same row (field, test, value), and both show a field that is no longer on the form.
- **Publishing:** this release adds one column to the database; it is applied when the app starts.

## v1.38.0 (31 Oct 2026): Workflow Designer and settings console (owner)
- **Workflows (IT):** a map of the flow above the levels: click a box to open that level. Levels fold, can be dragged or moved with Alt+↑/↓, duplicated, and removed with a question first and Undo after. Each level says what needs fixing before you save. Unsaved changes are kept in your browser and offered back next time. Test mode now has the right box for every kind of field.
- **Settings (Super Admin):** categories down the side, a search across every setting, a mark on anything not saved yet, and a question before leaving with unsaved changes. AI settings are saved with one button (it was nine).

## v1.37.0 (31 Oct 2026): Form Designer, Home and one Inbox (owner)
- **Form fields (IT):** a new designer. Add fields from a library, drag them into order (or use ↑/↓), duplicate them, and remove them with a question first and Undo after. Settings are grouped in tabs, and changing a field's type tells you what would be lost.
- **Custom approvals:** the DoA option is gone (it never applied to custom requests).
- **Home:** Overview and Task home are now one page, **Home**: your approvals first, then your tasks, team and projects.
- **Inbox:** notifications and the task inbox are one **Inbox** in the sidebar, with Bookmarks and Archive for every kind of notice. Notification settings are now **Profile → Notifications**.
- **Sidebar:** Search and Search tasks are gone (use the search bar at the top); the space is called **Central Management System**.
- **Draft task like Asana:** a taller, narrower panel that grows with your screen, and a toolbar: formatting (bold, italic, lists), emoji, @mention (people mentioned become collaborators), attach a file or paste a screenshot, collaborators, due date and repeat. Type **/** in the description for the menu. If Pico Bot is on for you, ✨ writes the description from the task's name.
- **Fixed:** after a decision, "Next waiting for you" now always appears.

## v1.36.0 (31 Oct 2026): easier to use, everywhere (owner)
- **Approving:** Reject now stands apart and asks before it rejects; after any decision a **Next waiting for you** button takes you to the next one; budget warnings show right above the decision buttons; the approval steps are a connected line with ✓ for done.
- **Raising:** a new request starts with your reporting manager as approver; a custom request can be **raised again** with the same approvers.
- **Search** finds a request number typed without dashes or zeros (e.g. "pur 2026 123").
- **Fewer slips:** deleting a section, saved search, field, template or comment asks first; the task tick is easier to hit.
- **Small things:** "← Back to …" returns to your list; the Overdue tile opens the overdue items; strips that scroll sideways show there's more.

## v1.35.0 (31 Oct 2026): every screen state handled (owner)
- **Slow connection:** a save that takes more than a few seconds says "Still working…", and a thin bar at the top shows a page is on its way.
- **Offline:** when the connection comes back the app checks ARS answers, then says "Back online".
- **No results** for a search or filter now name what you searched and offer **Clear search** and **Reset filters**, everywhere.
- **Leaving a long form you changed** asks first.
- **Clearer messages** for view-only pages, too many searches, copying blocked by the browser, and parts of a page that failed to load (instead of looking empty).
- **Maintenance notice:** IT can show a message to everyone (Super Admin → Settings → General).

## v1.34.0 (31 Oct 2026): Classic view like Tally (owner)
_Shipped in the same commit as v1.35.0 (b764c41); the `v1.34.0` tag points there (audit OPS-05)._
- In the **Classic** view every screen now looks like Tally: a title bar, square ruled boxes, forms laid out as **Label : value**, the field you are typing in highlighted, ruled tables with the current row highlighted.
- **Every list's toolbar looks like Asana's:** Filter, Sort and Group show as soft blue pills with × when in use, a line before Options, and Search as an icon (Admin → Records too).
- **Collapsible sidebar:** ☰ folds it into a narrow row of icons (like Asana) and opens it again; the app remembers.
- **Your profile:** upload your photo, write About me, and see everything IT holds about you (manager, head of department, your team, access, modules…). Colleagues' names open their profile card.
- **Notification settings, all in one place:** choose kind by kind what reaches you in the app, by email and on WhatsApp; the morning summary; **Do not disturb** (pause, quiet hours, days off).
- **Search like Asana:** the search bar in the middle of the top bar finds requests, tasks, projects, people, information and pages; recents and saved searches; **Filters** for a full search.
- **Tally keys on every form:** **Enter** moves to the next field (and finally to the button), **Ctrl+A** accepts the form, **Esc** goes back. The Compact view is unchanged.

## v1.33.0 (31 Oct 2026): sidebar, Myself/Others, Overdue, list toolbar (owner)
- **Tasks & projects** is now a group in the sidebar with Home, Inbox, My Tasks, All projects, Periodic tasks, Search tasks, New project, Templates and Task with a type; the Tasks pages use the full width.
- **Draft task:** the task is for **Myself** by default, or **Others**: type part of a name to find people.
- **My Tasks** has an **Overdue** section at the top for open tasks past their due date.
- **Every list** (requests, Waiting for me, information, typed tasks) has the task table's toolbar: **Filter**, **Sort**, **Group** (request lists), **Options** (per page, save the view) and **Search**.

## v1.32.0 (30 Oct 2026): Tasks like Asana (owner)
- **The Tasks area looks and works like Asana** in the ARS colours: a left bar with Create task, Home, Inbox, My Tasks, all your projects (by department, with Starred), Periodic tasks and Search; tasks open in a panel beside the list.
- **Compact table** for projects, My Tasks and search: numbered rows, ticks, Filters (quick filters and field filters), Sort, Groups, Options and **saved tabs**.
- **Tick to complete** on every task list, and **Mark complete** on every task.
- **Periodic and ad hoc tasks:** choose when creating; periodic tasks are marked ↻ and have their own list.
- **Share** any project (invite people or a department with a role, who can see it, copy link) or task (collaborators, copy link).
- **+ Create** at the top of the sidebar: Approval request, Task, Project (and Information); the sidebar has the new look and one **Tasks & projects** entry.
- **Ad hoc tasks** can go to several people at once (each gets their own copy); only the creator changes an ad hoc task's details. **Periodic tasks** repeat.
- **Project permissions:** choose who can update a field (for example the due date) and who can share the project's tasks with other projects.
- **Draft task** panel to create a task in seconds; **New project** step by step, blank or from a template; **Save as template** from the project menu.

## v1.31.0 (30 Oct 2026): the rest of Task & Project Management (owner)
- **Repeating tasks:** daily, weekly on chosen days, monthly, yearly, or some days after completion; the next one is made when a task is completed, with its people, projects, tags and subtasks, never on a holiday.
- **Project fields:** your own columns (text, number, choice, date) in a project's List and on its tasks.
- **Templates and copies:** save a project as a template, start projects from templates, or copy a project; dates move to the new start.
- **Change many tasks at once:** tick tasks in a project List or My Tasks to complete, assign, date, prioritise, move, tag or delete them together.
- **Task inbox:** everything about your tasks in one place, with bookmarks and archive.
- **Morning summary:** each working morning, your overdue, due-today and new tasks by email and in the app (switch it off in My Tasks).
- **Department holidays:** a department's own days off count for its people's tasks. Set up in Admin → Task set-up → **Task settings** (formerly Task holidays), with the summary and repeating-task options.

## v1.30.0 (30 Oct 2026): Task & Project Management (owner)
- **Projects** under Tasks: private, department or everyone; members (people or departments) as owner, editor, commenter or viewer; sections; **List, Board, Calendar, Timeline** and **Overview** with status updates; star, join, archive, delete and restore.
- **Tasks and subtasks:** subtasks up to five levels, "waiting for" other tasks, milestones, start dates, tags, a task in several projects, delete and restore within 30 days.
- **Working together:** comments with replies, @mentions, likes and pins; followers who see the task and hear about it.
- **My Tasks** (Recently assigned, Today, Upcoming, Later and your own sections; list, board, calendar) and **Task home** (your tasks, what you assigned, your team, your projects, latest status updates).
- **Task search** with filters, quick and saved searches; Ctrl+K finds tasks and projects; keyboard: Q, G then H/M/P/S, J/K, X.
- **Reporting line:** managers see the tasks of everyone below them at every level (read and comment), Team tasks covers every level, and Task home shows your team.
- **Holidays:** a task date on a holiday asks to keep it or move it to a working day (or is refused, as IT chooses); holidays show on task calendars; no task reminders on holidays; IT can move or tell about all tasks due on a holiday. Set up in Admin → Task set-up → **Task holidays**.

## v1.29.0 (29 Oct 2026): loaders and the full Classic way around (owner)
- **After signing in** (also after setting or resetting a password) an ARS loading screen shows until your workspace is ready.
- **Classic view:** every page change shows a Central Management System box ("Opening Waiting for me…") while it loads.
- **Classic navigation, in and out:** Overview dashboard and pages like Profile or Help now show where you are and go back with Esc; Esc in a search or text box first leaves the box, then goes back; the Central Management System lists your other spaces (Admin, Super Admin) and **Quit (sign out)**.

## v1.28.1 (29 Oct 2026): Classic view keyboard fixed (owner)
- **Fixed:** in the Classic view the arrow keys, Enter, the highlighted letters and Esc did nothing for some people (for example the Super Admin). They now work for everyone.

## v1.28.0 (28 Oct 2026): text size in the Classic view (owner)
- The Classic view now follows the sketch exactly: sign-in, then the **Central Management System** box listing the modules, then each **module page** with its pages as tabs and its boxes.
- In the Classic view, choose a **text size** (Small, Normal, Large, Larger, Largest) under View in the profile menu or on Profile. All text in the app changes at once; the layout keeps its shape. Saved on your account.

## v1.27.0 (28 Oct 2026): Classic view; reminders and escalations your way (owner)
- **Classic view** (Tally-style), chosen per person in the profile menu → View: after sign-in a Gateway menu (Approval, Tasks and Information Management, Pico Bot, Overview, Search, Calendar, Analytics) with highlighted letters; each module has its own menu and summary boxes; pages show their module's pages as tabs; Esc goes back. **Compact** is today's layout.
- **Reminders & escalations** (Admin → Automation): rules for pending approvals and open tasks on any field and value, including form fields; escalation levels to managers, the requester, HOD, IT or named people; repeats; your own wording; email or inbox only; a Test button that sends nothing. Escalation emails always go out.

## v1.26.0 (28 Oct 2026): sign in either way (owner)
- **New sign-in choice "Both"** in Admin → Users → How they sign in: the person can sign in with Google or with their User ID and password plus a WhatsApp code, whichever they prefer. Both needs a WhatsApp number; Re-invite sends them a link to set their password.
- CSV user import accepts BOTH in the sign_in_method column.

## v1.25.1 (28 Oct 2026): My Approvals menu (owner)
- The My Approvals menu now reads: New request, My pending requests, My approved requests, Waiting for me, Approved by me, Collaborating, Request templates.

## v1.25.0 (27 Oct 2026): simpler approvals and analytics for each person (owner)
- **New names:** "New request" is now **Request templates** (the approval types IT set up), and "Custom approval" is now **New request** (choose your own approvers).
- **New request is simpler:** everyone can add levels and parallel steps. The DoA matrix, choices (if / otherwise) and "Skip this step when…" appear only if IT switches them on in Admin → Custom approval.
- **Tasks menu order:** New task, My tasks, Assigned by me, Team tasks.
- **Analytics shows what you need:** only the dashboards for your modules and role, and the overview shows only your modules.
- **Fixed:** "Opening…" stayed on the Analytics page after a dashboard had opened.

## v1.24.0 (26 Oct 2026): Pico Bot knows the ARS Salesforce (owner)
- **A Salesforce guide for Pico Bot** is added to Admin → AI Rules → Salesforce chats (only if that page is empty): which object holds what, the words people use (dealer code, executive, CO/DO, secondary order, regions), the status values in use, data traps to avoid and ready recipes for common questions (executives logged in by region, attendance, secondary orders, dealer 360, targets, collections, stock). Pico Bot now goes straight to the right data.
- **Combined chats** also follow the Salesforce (and other) rules.
- **Privacy:** date of birth and KYC ids in Salesforce are never read by Pico Bot.

## v1.23.3 (26 Oct 2026): 360-degree dashboards (owner)
- **Big requests work:** a dealer 360 view (sales, orders, payments, targets…) gets more lookups and room for a long answer; an answer that runs out of room is retried with more.
- **Fixed: a Salesforce chat could refuse Salesforce questions** ("This chat is limited to Salesforce data").
- **Partly answerable requests** (for example ERP data, which Pico Bot can't see) are answered for the Salesforce part, with a note on the rest.
- **Privacy:** Aadhaar, PAN and bank details in Salesforce are never read by Pico Bot.

## v1.23.2 (26 Oct 2026): your question leaves the box when you send it (owner)
- In the AI Assistant, pressing Enter now empties the box at once; your question shows in the chat while Pico Bot is analysing. If asking fails, the question comes back to the box so you can edit or resend it. The floating Pico Bot panel does the same.

## v1.23.1 (26 Oct 2026): Pico Bot finds and fetches more reliably (owner)
- **Ask with everyday names:** "executives", "attendance", "region", "last login" are understood directly, so answers need fewer steps.
- **No more page-size totals:** a list that was cut off is never reported as the total.
- **A failed question no longer derails the next one** in the same chat.
- **Fewer "try again" failures:** busy providers are waited out and malformed lookups are retried.
- **Long answers aren't cut short:** the assistant page waits up to 5 minutes instead of 30 seconds.

## v1.23.0 (26 Oct 2026): Pico Bot gives real numbers or none (owner)
- **No more invented figures.** Every number in an answer is checked against the data Pico Bot actually read. If a number isn't there, Pico Bot must fetch it or leave it out; if nothing could be read, it says so instead of showing a made-up dashboard.
- **"Today", "this week" and dates work in Salesforce** (for example orders created today), in India time.
- **Regions, dealers, owners and other linked records show their names**, not Salesforce ids, in lists and breakdowns, and you can filter by name ("orders in Chennai North").
- **Breakdowns by two things at once** (region and status) with count and quantity together.
- **Pico Bot finds things by the names you use** ("executives" finds the Executive records).
- **Security:** password, session, token and key fields in Salesforce are never readable by Pico Bot.

## v1.22.4 (26 Oct 2026): the split-screen home page is back (owner)
- **The home page is the split screen again** (blue panel left, welcome right), now with what Google's review needs on the page itself: the name ARS-CMS, what it is for, what you can do, who can use it and how Google data is used, with the privacy policy link. **Sign in** turns smoothly into the sign-in form.

## v1.22.3 (26 Oct 2026): back on approval.arssteels.net (owner)
- **ARS-CMS lives at https://approval.arssteels.net again.** The app's fallback address, the privacy policy, the terms and the sample links in message templates use it. The name ARS-CMS and the new home page stay.
- Links already sent on arssteels.net can open the same page on approval (`LEGACY_HOSTS=arssteels.net,www.arssteels.net`). Steps: docs/DOMAIN-MIGRATION.md → Rollback.

## v1.22.2 (26 Oct 2026): a real home page for ARS-CMS (owner)
- **The home page is now a public page about ARS-CMS**, not the sign-in screen: the name ARS-CMS at the top, what it is for, what you can do (approvals, information, tasks, Google Calendar), who can use it and how Google data is used, with links to the privacy policy and terms. **Sign in** is one click away. Google's verification needs this.

## v1.22.1 (26 Oct 2026): home page ready for Google's review (owner)
- **The home page now says what ARS-CMS is for**, in plain view on desktop and phones, including the optional Google Calendar link. Google's OAuth review needs this.
- **docs/DOMAIN-MIGRATION.md:** DNS steps are in GoDaddy (arssteels.net uses GoDaddy's name servers), and a new "Google verification" section explains each finding from Google's review and the order to resubmit.

## v1.22.0 (25 Oct 2026): ARS-CMS, ready for arssteels.net, Pico Bot, AI Analytics, New chat fix, full site audit (owner)
- **New name: ARS-CMS (Central Management System)** on the home page, sign-in, browser tabs, the installed app, emails, the privacy policy and terms, and in Pico Bot. WhatsApp wording keeps the Meta-approved text until the templates are resubmitted.
- **Ready to move to arssteels.net:** every link comes from one setting (`APP_BASE_URL`); the old address can redirect page by page (`LEGACY_HOSTS`) while webhooks, the job runner and sign-in callbacks keep working. Step-by-step guide: docs/DOMAIN-MIGRATION.md.
- **Fixed: six pages scrolled sideways on phones** (AI Analytics, Super Admin Requests, Automation, WhatsApp templates, AI Reports, Budgets): a hidden screen-reader label in wide tables, and wide charts in page grids, widened the page.
- **Pico Bot** (Progress Insight Companion Bot) is the AI assistant's new name everywhere: the floating button, the chat panel, the assistant page, settings and messages.
- **Fixed: New chat** after an answer took you back to the old chat. It now opens an empty chat and stays there (also from the sidebar).
- **Admin → AI → AI Analytics:** adoption, questions, answered %, answer time, conversations, tokens and estimated cost, with the change from the previous period; questions and failures over time; by chat, department and data lookup; providers and models; top users; when people ask (weekday × hour); why answers failed; the daily limit. IT Admins and the Super Admin.
- **Site audit:** an automated check now crawls every page each role can reach (desktop and a touch phone) for broken links, broken downloads, page and console errors, broken images and sideways scrolling, and runs with every release.

## v1.21.0 (25 Oct 2026): Admin → Records (owner)
- **New in Admin: Records → Approval requests, Tasks, Information.** Every record in the app, whoever raised it, in one spreadsheet-style table each: numbered rows, a fixed header, scroll sideways for more columns.
- **Approval requests:** number, title, type, raised by, department, status, current step, waiting on, approvals given, round, submitted, closed, days open.
- **Tasks:** number, title, type, priority, status, overdue, assignee, department, assigned by, created, due, completed, related request.
- **Information:** number, title, type, priority, status, created by, department, created, published, effective, expires, recipients, read, acknowledged.
- **Filters:** search, status, type, department, person (raised by / assignee / created by), waiting on (requests), priority, overdue only (tasks), and a date range. Click a column title to sort.
- **Download CSV** (opens in Excel) with the same filters, up to 10,000 rows; follows the "Can export" setting and is recorded in the audit log.
- IT Admins and the Super Admin only; read-only; deleted requests are never shown.

## v1.20.1 (25 Oct 2026): home page on the sign-in layout (owner)
- The home page now uses the same blue brand panel as the sign-in page, with the welcome on the white side.
- **Sign in to continue** turns the welcome smoothly into the sign-in form; the brand panel stays in place. With reduced motion it simply opens.
- The brand panel reads "ARS Steels · Internal Workspace". The sign-in pages now always fill the window height.

## v1.20.0 (25 Oct 2026): ARS Internal Workspace, cleaner screens everywhere (owner)
- **New home page:** "Welcome to ARS Internal Workspace", one Sign in button, and Privacy Policy, Terms of Use and IT Support at the bottom. Signed-in people still go straight to their space.
- **New name** in the browser tab, the sign-in page and the installed app: ARS Internal Workspace.
- **Cleaner screens across the app:** instructions on Admin, Super Admin, request, task, information, analytics and profile pages are now in ⓘ hover hints. Statuses, figures, warnings and confirmations stay on screen.
- Nothing changed in how approvals, tasks, information, sign-in or permissions work.

## v1.19.0 (25 Oct 2026): analyst chat, cleaner screens, Try as, AI Rules (owner)
- **Pic bot is a business analyst.** Answers start with the point in plain English, then figures, tables, metric cards and charts for dashboards, insights and next steps. Bold text, lists and tables show properly. No technical details on screen (sources and provider are in the ⓘ).
- **AI Assistant screen** (from the owner's sketch): **+ New chat**, your AI limit (used, remaining, total) and connection status at the top; your chats in the sidebar under **AI Assistant** with a search, newest first. Each chat's **⋯** menu: **Rename**, **Pin to top**, **Delete**. Clicking **AI Assistant** opens a new chat and the list.
- **Removed:** AI Dashboard, Business Intelligence, Insights & Recommendations (old links open the assistant).
- **Super Admin:** **Salesforce Settings** (own page), **AI Details** (Data Sources, AI Reports, AI Activity History), and **AI settings** arranged as General, one card per provider, and Common settings.
- **Try as**, for IT Admins and the Super Admin, on every person's page: a one-time link to open in a private window. Your own session is never replaced; the trial is **view-only** and shows who opened it.
- **AI Rules** (Admin): write the company's rules for Pic bot, for all chats or one chat, in a formatted editor. Every AI provider follows them with every question.
- **Cleaner screens:** page and field instructions are in ⓘ hover hints; on/off settings are switches, lists are checkboxes, choices are dropdowns; thin scrollbars in the theme's colours.
- **Behind the scenes:** three additive database changes, applied automatically when the app starts.

## v1.18.0 (24 Oct 2026): Salesforce "all objects"; Super Admin unrestricted (owner)
- **All Salesforce objects:** enter `*` in AI settings → "Objects and fields Pic bot may read" to let Pic bot read any object the connected Salesforce user can read. Pic bot finds the object, reads its field list from Salesforce, then queries, still read-only, at most 50 rows, and with Salesforce's own permissions (WITH USER_MODE). A fixed list still works as before. The hourly copy needs a fixed list.
- **The Super Admin has no restrictions in Pic bot:** every chat (General, Approvals, Tasks, Information, Salesforce, Combined) and all Salesforce records, whatever their own settings or the global chat switches. Only the emergency stop applies (and Salesforce must be connected). Their user page says so instead of showing boxes.
- **More reliable answers:** up to 6 lookup rounds per question (was 4); a provider refusing a malformed lookup (Groq "tool_use_failed") is retried up to twice; on the last round the model is told to answer from what it has.
- **Smaller Salesforce lists** for providers with low token limits (Groq free tier: 8,000 tokens a minute).
- **Checked locally (UAT sandbox, Groq):** "How many Account records are there?" → 90, from Salesforce.
- **Tests:** the AI-settings e2e now expects seven providers (it failed in CI on v1.17.1 because it still expected four).

## v1.17.1 (24 Oct 2026): NVIDIA default model
- The NVIDIA default model is now **nvidia/nemotron-3.5-bolt-e4b** (from NVIDIA's API reference, owner). Checked locally: Test passed in 0.5 s.

## v1.17.0 (24 Oct 2026): three more AI providers (owner)
- **New providers in AI settings:** **Groq** (groq.com; keys start with gsk_; not xAI's Grok), **Gemini** (Google AI Studio) and **NVIDIA (Nemotron)** (build.nvidia.com; keys start with nvapi-). Each has its key, model, "may see business data" (off by default) and Test, and can be the active or fallback provider. There are now seven.
- **Model names may contain "/"** (for example Groq's openai/gpt-oss-120b or NVIDIA's nvidia/… models).
- **Reasoning models:** the provider Test now leaves room for models that think before answering; when an answer runs out of room, Pic bot says so instead of "empty answer".
- **Checked locally:** Groq test passed (0.8 s, openai/gpt-oss-120b); Pic bot refused data chats while Groq was not approved for business data, as designed.

## v1.16.1 (24 Oct 2026): settings fixes (owner, while testing Pic bot)
- **Saving AI settings no longer needs every provider filled in.** An empty box for a provider you don't use (for example the ChatGPT or Grok model) is simply left unset. Before, the save failed with "Too small: expected string to have >=2 characters".
- **Choices are dropdowns.** Every setting with fixed choices is now a dropdown with plain names instead of a text box, on AI settings and Providers & security: who may see business data (Allowed / Not allowed), active and fallback provider, the on/off switches, feature switches (On / Off / IT team only), Salesforce environment, report downloads and the over-budget rule.
- **Clearer messages** for text that is too short or too long ("Use at least 2 characters.").
- **Docs:** Salesforce connect troubleshooting in CHATBOT_DEPLOYMENT_GUIDE (redirect_uri_mismatch, invalid_scope with an MCP-only app).

## v1.16.0 (24 Oct 2026): Pic bot - ai (owner request)
- **Pic bot - ai** is now a floating assistant on every page:
  - **The logo** sits at the bottom right. Click it to chat without leaving the page.
  - **In the panel:** new chat, your chats (history), delete, copy an answer, retry, stop, and a label showing what the chat may use.
  - **On phones** the panel fits the screen.
- **Chat modes**, set per person by IT (user page → **Pic bot - ai**):
  - **Approvals, Tasks, Information:** answers only from that module, for your own data.
  - **Salesforce data:** live, read-only, only allowed objects and fields, and only your own records unless IT allows all.
  - **General chat:** no company data.
  - **Combined:** your data plus general answers.
  - General and Combined are off until the Super Admin switches them on. Nobody gets anything their modules don't allow.
- **Super Admin → AI settings:**
  - **Switches:** an emergency stop, the launcher, general chat, combined chat and which module chats exist.
  - **Limits:** questions per minute, questions at once per person and for everyone, context and answer length.
  - **Salesforce:** Connect (OAuth with PKCE), Test and Disconnect, the allowed objects and fields, and the callback URL to give Salesforce.
  - **Monitoring:** usage by person, failed answers, security events and live counts, plus a cost estimate if you enter your prices.
- **Behaviour:** a question sent twice (double click or retry) is answered once and charged once. Stop cancels the request to the provider.
- **Measured** with a simulated provider: 10 people asking at once were all answered (about 0.8 s each, plus the real provider's time).
- **Not yet connected:** a real Salesforce org needs a sandbox Connected App from you. Oracle ERP is still not reachable from this hosting.
- **After publishing:** `docs/CHATBOT_DEPLOYMENT_GUIDE.md` §3.

## v1.15.0 (24 Oct 2026): the AI module, and module access per person (owner request)
- **Module access.** Each person now has **Approval, Task, Information and AI** check boxes (Admin → Users & roles → a person's page, or Add user).
  - Everyone keeps exactly what they had (Approval, Task, Information). Nobody has AI until it is ticked.
  - Without a module, its pages are hidden from the sidebar and refused even if the address is typed.
  - The Users list shows each person's modules and filters by them. Nobody can change their own; the Super Admin is never limited.
- **The AI module** (for people with AI ticked), a new **AI** group in the sidebar:
  - **AI Dashboard:** your own live figures from ARS (approvals waiting, requests, tasks, information, suggestions to decide), each showing where it came from. Business sections that need Salesforce or Oracle say so until those are connected.
  - **AI Assistant:** ask in plain words.
    - Answers use only approved data tools and your own data, and show their **evidence** (source and time read).
    - Any figure the AI couldn't find in the data is **flagged**. It can't approve, send or change anything.
  - **Insights & Recommendations:** suggestions the AI recorded for a person to decide. Your manager (or an IT Admin) approves or rejects them; they expire after 7 days; nothing is carried out automatically.
  - **Data Sources:** what each source is, whether it is connected, and how fresh it is.
  - **AI Activity History:** your own conversations only.
- **Super Admin → AI settings:**
  - providers **Claude, ChatGPT, Grok and DeepSeek**, with keys stored encrypted;
  - an active provider and a fallback, switchable at any time, and a **Test** button;
  - per provider, whether it **may see business data** (off by default);
  - daily limits, retention and usage per provider;
  - Salesforce (read-only, hourly).
- **Not yet connected:** Salesforce (needs your sandbox integration user), Oracle ERP (needs a relay inside the ARS network; GoDaddy can't reach it), Power BI datasets.
- **Security update:** zod (the validation library used by every form) 3.24 → 4.6.7, for a high-severity advisory published today (GHSA-mrhx-c7xc-m3w5: oversized inputs could exhaust memory). Two small code changes; every test suite passed again on the new version.
- **Owner steps after publishing:** DEPLOYMENT Part R.

## v1.14.0 (23 Oct 2026): onboarding tour for users (owner request)
- **A guided tour** of ARS Approvals opens by itself the first time each person visits Overview. In 15 short steps it opens each page and highlights what it's talking about:
  - **Approvals:** raising a request, custom approval, approving from Waiting for me, following My requests.
  - **Tasks:** My tasks, giving someone a task, Information notices.
  - **Calendar:** the calendar views and kinds of dates, and connecting Google Calendar.
  - **Everyday:** notifications, Go to and search, going on leave.
- Back, Next and Skip (or ← → and Esc). Finishing or skipping is remembered on every device. Take it again any time: account menu → **Take the tour**, or Help.
- Works on phones (the card sits at the bottom of the screen). Steps for pages someone can't open are left out.
- **User management:** Re-invite and Reset password are now only on each user's page, not on the Users & roles list.

## v1.13.0 (23 Oct 2026): invite users and reset passwords by email (owner request)
- **Add user** has a new tick box, "Email an invitation now" (on by default).
  - Google users are told they've been added and to sign in with Google as their email.
  - User ID + password users get their User ID and a link to set their password.
  - If the email can't be sent, the page says so; the user is still created.
- **Re-invite** and **Reset password** are on each user's page and on every row of **Users & roles**.
  - Reset emails a link to choose a new password. The current password keeps working until a new one is set.
  - Reset shows only for people who already have a password; before that, Re-invite sends the set-password link.
- Choosing the password is still confirmed by a WhatsApp code, as before (owner's choice).
- **Owner:** make sure email (Resend) is set up in Super Admin, or nothing can be sent.

## v1.12.7 (23 Oct 2026): Next.js security update
- **Next.js 15.5.27 → 15.5.28** for two advisories published today: a critical remote code execution in image optimisation with SVG files (GHSA-2464-fhr4-w9xw) and a denial of service through Server Actions (GHSA-p3m5-59mp-jv5r). CI's audit step caught it.
- Nothing changes for users. **Owner: publish soon.**

## v1.12.6 (23 Oct 2026): Google Calendar no longer sends people to "localhost" (owner report)
- **Owner report:** after pressing Allow on Google's screen, the browser opened `localhost:20011/…` and said "This site can't be reached".
- **Cause:** the way back to ARS was built from the address the app sees behind the host's proxy, which is its internal one. The calendar was in fact connected.
- **Now:** the way back is relative, so it always stays on approval.arssteels.net.
- **Owner action:** after publishing, open Profile → Calendar. If it doesn't say Connected, press Connect Google Account again.

## v1.12.5 (20 Oct 2026): "Couldn't reach the server" on submit and delete explained (owner report)
- **Owner report:** submitting or deleting a request said "Couldn't reach the server".
- **Cause:** every publish gives the app's form actions new ids. A page that was already open when the new version went live still uses the old ones, so the server doesn't recognise them and every submit, delete or draft save on that page failed until it was reloaded. The message wrongly blamed the connection.
- **Now:** such a page says "ARS was updated since this page opened… reload", and a **Reload page** banner appears. The banner also appears by itself within a minute of a new version going live.
- **Server errors** now say "Something went wrong on the server" with a reference IT can find in the server log, instead of the connection message.
- **Owner action:** after publishing, reload open ARS tabs once.

## v1.12.4 (20 Oct 2026): file uploads that fail now say why (owner report)
- **Owner report:** attaching a file to a task failed with "Couldn't reach the server", and a custom approval was submitted but its files "couldn't be saved". Both happen when the server can't write to its upload folder (`UPLOAD_DIR`).
- **Super Admin → Overview → File storage:** shows whether uploads work, the folder in use, and the cause with its fix (folder not set, missing, no permission, read-only or disk full).
- **Health check:** `/api/health` now also reports `storage` (`ok` or `failed`).
- **When storage fails:** forms say "Your files couldn't be stored on the server", and what was typed is kept. The task form no longer blames the connection. The Super Admin is alerted (at most once a day), and the server log has the exact error code.
- **Owner action:** open Super Admin → Overview after publishing. If File storage is red, set `UPLOAD_DIR` to the Private Storage path (DEPLOYMENT Part C) and restart.

## v1.12.3 (17 Oct 2026): clearer Google Calendar connect errors
- **Calendar boxes not ticked:** Google now shows each permission as a checkbox. If the calendar boxes aren't ticked, ARS says exactly which two to tick, instead of a generic message.
- **Broader grant accepted:** a broader calendar permission granted on an earlier attempt (`calendar.events`) is accepted; before, it was refused as "no calendar access".
- **No lasting access from Google:** shown separately, with how to fix it.
- **Diagnosis:** the audit log records which permissions Google granted (names only, never tokens) when a connection fails.

## v1.12.2 (17 Oct 2026): ready for Google OAuth verification
- **Public home page** at https://approval.arssteels.net/ for people who aren't signed in: what ARS Approvals is, who runs it, why it asks for Google Calendar access, and links to the policies. Signed-in people still go straight to their space.
- **Privacy policy** (`/privacy`) and **terms of use** (`/terms`), public. The privacy policy describes exactly what the calendar sync reads, stores and writes, and carries Google's "Limited Use" statement. The sign-in page links to both. **Owner: have them approved before filing.**
- **Narrower Google permission:** the calendar sync now asks for `calendar.events.owned` (calendars the person owns) instead of `calendar.events` (every calendar they can see). Every Calendar method the sync uses accepts it, and the calendar picker lists owned calendars only.
- **Logo for Google's Branding page:** `/brand/ars-logo-120.png` (120 × 120).
- **The filing guide** (a shared doc) gives the exact Branding values, the scope justifications to paste, domain verification in Cloudflare, the demo-video script and common rejection reasons.

## v1.12.1 (17 Oct 2026): analytics dropdowns, forced sign-out page, Google Calendar for every domain (owner)
- **Analytics:** the dashboard and "Whose numbers" are now two dropdowns instead of a scrolling row of tabs and chips. Choosing one opens it straight away; the period and comparison carry over.
- **Sign-out after 30 minutes without activity applies to everyone, the Super Admin included** (D-158).
  - When it happens, the page goes to a new **Signed out** page that says why and has **Sign in again** (back to the same space). The reasons it can show: inactivity, the 12-hour limit, signed out on this device, ended from another device or by IT, account switched off, account locked.
  - An ended session stays ended: coming back to the tab doesn't revive it.
- **Google Calendar for people in every ARS domain:** "Error 403: org_internal" is Google refusing accounts outside the project's own Workspace because the consent screen is **Internal**. Set it to **External** and publish it (Google Auth Platform → Audience). The steps are now on the Super Admin Google Calendar page and in DEPLOYMENT Part Q. No code change was needed for other domains: ARS doesn't restrict which Google account a person connects.

## v1.12.0 (16 Oct 2026): the Analytics Center
**One Analytics page, nine dashboards as tabs:**
- Executive overview
- Approval analytics (the existing approval dashboard)
- Task analytics
- Information analytics
- Employee analytics
- Department analytics
- SLA & performance
- Trends & forecasts
- Data quality

**How the boards work**
- **Shared filters:** whose numbers (own, team, department, organisation), the period and the comparison. Filters carry over between tabs.
- **New periods:** Today, Yesterday and Previous quarter.
- **Every board** shows "As of" and India time.

**Executive overview**
- Approvals, tasks and information side by side, each against the previous period.
- Approvals: raised, open, completed, completion rate, turnaround, overdue.
- Tasks: created, open, completed, completion rate, overdue.
- Information: published, awaiting acknowledgement, acknowledgement rate, opened in ARS.
- People: active contributors.
- **Also:** a 12-month activity chart, open and overdue work by module, departments' open work, and alerts. Each alert shows the fixed rule that raised it; there are no predictions.

**Task analytics**
- Status now; due today and in the next 7 days; no due date; reopened, postponed and reassigned.
- Completion and cancellation rates; time to complete (average, median, 90th percentile).
- Completed by the due date, and days late.
- Age buckets (configurable: **Super Admin → Settings → Analytics age buckets**), breakdowns, and the oldest open tasks.

**Information analytics**
- Lifecycle (drafts, scheduled, active, expired, archived).
- Acknowledgement rate over **eligible recipients**, and time to acknowledge.
- "Opened in ARS", kept separate from acknowledgement; email/WhatsApp delivery kept separate from both.
- Pending acknowledgements by age, rate by department, type and sender, and the lowest-rate records.

**Employee and department analytics**
- Each person's and each department's approval, task and information figures, in separate columns and never combined into one score.
- Employees: search, sort and pages.
- Departments: for heads of department and IT.

**SLA & performance:** approval response times by department and step, and task due-date performance by priority.

**Trends:** this period against the comparison period, and 12 months by module. A next-month estimate appears only once there are 12 months of history.

**Data quality:** 14 checks (for example open tasks without a due date, published information with no recipients, people without a department), each with where to fix it.

**Exports:** CSV of the employee, department and 24-month tables, with the same scope and period, and the scope, period and generation time at the top. Needs the Can export permission; audited.

**Not available, and said so on screen (no invented numbers):**
- overdue acknowledgements (information has no deadline field);
- total views (only the first opening is recorded);
- task effort and utilisation, dependencies and recurring tasks (not recorded or not supported).

**Documents:**
- the metric dictionary (`docs/ANALYTICS_METRIC_DICTIONARY.md`, also in the app) now has 76 metrics, each with its board, reliability and limits;
- `application-audit/ANALYTICS_IMPLEMENTATION_TRACKER.md`;
- `application-audit/ANALYTICS_TEST_REPORT.md`.

**Database:** no migration. One new setting (`analytics.aging_days`).

## v1.11.0 (16 Oct 2026): Google Calendar two-way sync, and one calendar for everything
**Super Admin → Integrations → Google Calendar** (new)
- Set up the Google OAuth client. The client secret is stored encrypted and never shown again.
- Set the policies: direction, privacy, event text, conflicts, deletions, reconcile interval, retries, which modules sync.
- **Test configuration** checks the database, encryption, the redirect URI, Google's acceptance of the client, and the job runner. **Enable** works only when every check passes.
- The page also shows health (last 24 h), connected people (with **Revoke** and **Full resync**), failed syncs (with **Retry** and **Retry all**), conflicts, the sync log and the audit history. There is a **Maintenance mode** that pauses syncing.

**Profile → Calendar** (new)
- Each person connects their own Google account. ARS asks only for calendar events, the calendar list and the account email.
- They can choose a calendar, press **Sync now**, review conflicts, reauthorise, and disconnect (optionally removing the events ARS added).

**What syncs**
- **To Google:** approvals waiting on you (by due time), your tasks (by due time), information of types marked **Show on calendars** (on the effective date), your requests' needed-by dates (off by default), and your personal entries.
- **Event text:** private, showing only the reference ("Approval due: PR-0042") and a link. No titles or amounts unless the Super Admin adds {title}.
- **From Google:** your own Google events become personal entries in ARS. Edits and deletions follow both ways.
- **A calendar change never approves, rejects, completes or acknowledges anything.**

**How it syncs**
- Incremental, using Google's sync tokens. Push notifications are renewed automatically, and every connection is reconciled every 15 minutes (configurable).
- A retried sync never makes a duplicate. ARS's own writes are recognised, so nothing loops.
- Failures are retried with backoff and then reported to the Super Admin.

**Calendar page**
- Month, week and day views; filters for Approvals, Tasks, Information, Needed by and Personal.
- Entries from Google are marked, and each entry shows its sync status.
- You can add, edit and delete personal entries.

**Admin → Information types:** a new **Show on calendars** option (off by default).

**Database:** one additive migration (7 new tables, no triggers). There are no new environment variables.

**Before people can use it**, the owner creates the Google OAuth client. See `application-audit/GOOGLE_CALENDAR_INTEGRATION_REPORT.md` §4 and DEPLOYMENT Part Q.

## v1.10.0 (16 Oct 2026): security hardening and website fixes
The owner's 39-point brief: 19 security checks and 20 website fixes. Full detail is in `application-audit/SECURITY_WEBSITE_FIX_TRACKER.md`.

**Security**
- **CSV user import (AUD-01):** an IT Admin can no longer change another IT Admin's email, WhatsApp number or sign-in method by import. This is the same rule as the user form.
- **Start-up seed (AUD-03):** a Super Admin role removed from `itadmin` now stays removed. The seed gives roles only to an account that has none.
- **Page access follows the action (G-3):**
  - Admin actions name their own page, so a Hidden or View-only rule holds wherever the action is posted from.
  - Super Admin addresses refuse everyone else.
  - "Out of office for someone else" needs Full access to Users & roles.
  - The admin Analytics pages check the Admin area themselves.
- **Sign-in & devices** can't be restricted by a page rule, so signing out a lost device always works.
- **Limits:** PDF summaries, quick search, the notification list, downloads, dashboard CSV and the WhatsApp webhook have per-person limits. Going over answers "429, try again in a minute".
- **Headers:**
  - signed-in pages and API answers are `Cache-Control: private, no-store`;
  - API preflights from other sites get no CORS permission;
  - a plain-HTTP visit (as reported by Cloudflare) is sent to HTTPS.
- **Audit log:** it now also records:
  - request submit, hold, resume, withdraw, reopen and resubmit;
  - pausing and resuming report schedules and alerts;
  - dashboard CSV downloads.
- **Approval-type export:** a failure no longer shows an internal error message.
- **New tests:**
  - an API-route and Server-Action inventory, which fails on any unguarded new route;
  - SQL-injection checks for list sorting and search;
  - a cross-user access check (requests, PDF, tasks, files, admin addresses).

**Website**
- **Page titles:** every page has its own browser title (for example "Waiting for me · ARS Approvals"). Record pages never show the record's content.
- **Favicon:** ICO and PNG fallbacks.
- **Logo:** clicking it goes to the space's first page.
- **Copyright:** the year updates itself.
- **Phone menu:**
  - focus moves into the menu, Tab stays inside it, and Escape returns focus to the button;
  - the list scrolls;
  - the bottom bar shows in My approvals only.
- **IT contact and user emails** are clickable (mailto).
- **Discard draft (Custom approval):** uses the app's own confirmation instead of the browser's.
- **Layout check:** an automated test confirms no page scrolls sideways at 360, 390, 768, 1366 or 1920 px across all spaces, every navigation link works, and the 404 page is correct.

**No database migration.** The only database-related change is the seed rule.

## v1.9.2 (16 Oct 2026): the user sidebar, regrouped (owner)
- **Order:** Overview; **My Approvals**; **Tasks**; **Information**; then Search, Calendar and Analytics.
- **Collapsible groups:** My Approvals, Tasks and Information open and close like a dropdown.
  - **My Approvals:** New request, Custom approval, Waiting for me, My requests, My approved requests, Approved by me, Collaborating.
  - **Tasks:** My tasks, Assigned by me, Team tasks, New task.
  - **Information:** Information inbox, Sent by me, New information.
- **Group behaviour:**
  - The group holding the page you're on opens by itself.
  - The groups you open or close stay that way in this browser.
  - A closed My Approvals shows the waiting count on its header.
  - The same groups appear in the phone menu.
  - Groups work with the keyboard (Enter or Space on the header).
- **Admin and Super Admin:** sidebars unchanged.

## v1.9.1 (16 Oct 2026): fix for the v1.9.0 deploy
- **Cause:** the GoDaddy preview stopped at start with "Process exited before becoming ready". The runtime log showed the migration stopping at statement 5 (`CREATE TRIGGER trg_task_events_no_update`): "You do not have the SUPER privilege and binary logging is enabled". The hosted database user may not create triggers.
- **Fix:** the four new triggers, which guard the task and information history against edits, are now optional.
  - If the database refuses them, the migration prints a warning and carries on.
  - The app only ever adds history rows, so it works the same without them.
  - To add them anyway, run `database/optional/v190_append_only_triggers.sql` once in cPanel → phpMyAdmin → SQL.
- **Safety:** the earlier triggers on the audit log, approval timeline and comments are unchanged, and a required trigger that is refused still stops the migration.
- **Deploying:** statements 1–4 of the v1.9.0 migration are already on the database. The next start carries on from statement 5, with the same 15 statements in the same order.

## v1.9.0 (16 Oct 2026): Tasks, Information, the notification bell, module set-up
**For everyone**
- **Tasks** (sidebar → Tasks): create a task of a type IT set up, assign it to someone, and follow it to completion.
  - **Steps:** start, mark blocked (if allowed), complete with a note or file when the type asks, reopen, cancel, reassign, edit, comment and attach files.
  - **Lists:** My tasks, Assigned by me and Team tasks (people who report to you), with quick tabs (open, overdue, due in 2 days, blocked, completed, cancelled), search, filters, sorting and paging.
  - **Reminders:** before a task is due, and once when it is overdue.
  - **Separate from approvals:** a task can point to an approval request, but completing it never approves the request.
- **Information** (sidebar → Information): send information of a type IT set up.
  - **Recipients:** people, departments, groups or (if allowed) everyone, fixed when it's published.
  - **Read and acknowledged are separate:** opening it marks it read; when acknowledgement is asked, recipients press **Acknowledge**. The sender sees who read and who acknowledged.
  - **Lifecycle:** drafts, publishing, withdrawing (recipients are told), archiving and expiry dates.
- **Notification bell:** opens a dropdown with your latest 10 notifications.
  - Filters: All / Approvals / Tasks / Information.
  - Opening one marks only that one read. **Mark all read** is a separate button.
  - **Read more** opens the Notifications page with the same filter, which now has All, Approvals, Tasks, Information and System views.
- **Sidebar:**
  - entries are grouped by module (Approvals, Tasks, Information);
  - it stays in place while the page scrolls;
  - it scrolls on its own only when its entries don't fit.
- **Approvals:**
  - **Changed values re-route a resubmitted request.** If changing a request's values on resubmit changes its route (an amount band or a condition), it restarts from the first level, so no level the new values need is skipped.
  - **One person, one vote per step:** one person can't decide two parts of the same step (for example as a delegate and as a named approver).
  - **Some approval types are limited** to certain departments or people.

**For IT (Admin)**
- **Task types** and **Information types**: the form (same builder as approval types), how they work, and who may create them.
  - **Lifecycle:** draft, check, preview, publish, version history, retire and reactivate.
  - **Versions:** a published version is never changed in place, and records keep the version they were made with.
  - **History:** every change is in the type's history and the audit log.
- **New field types** for every form, approvals included:
  - currency (₹, paise), date and time, multi-select, checkbox, radio buttons and web link (URL);
  - for task and information forms, each field can be shown in lists, matched by search, or changeable later.
- **Approval types: "Who may raise this type"** (everyone, chosen departments or chosen people). IT can always raise it.
- **Reports:** Task register, Task workload by assignee, Information register, Outstanding acknowledgements.

**For the Super Admin**
- **Feature switches:** Task Management and Information Management (Providers & security → Features).
- **Page access:** covers the new pages.
- **Automation:** a new step, "Task and information reminders".
- **Database:** one migration, additive only (`202610160900_v190.sql`). v1.8.0 still runs on it.
- **Fixed from the audit:**
  - AUD-02: resubmit routing.
  - AUD-05: one vote per step.
  - AUD-08: a queued message is no longer marked sent when it couldn't be recorded.

## v1.8.0 (15 Oct 2026): approved lists, custom approval set-up, page access, inactivity sign-out
**For everyone**
- **My approved requests** (sidebar): your requests that were approved.
  - Quick tabs: still valid, expiring, expired, no expiry, amended.
  - Filters: approved by, approved-on dates, type, files, raised and activity dates.
- **Approved by me** (sidebar): every request where you approved a step, yourself or for someone you cover, and what happened after.
  - Quick tabs: still in progress, fully approved, rejected later, withdrawn, for someone else.
  - Filters: step you approved, your approval dates, raised by, their department, and every list filter.
- **Custom approval:** the fields are now set by IT. **Who approves → Specific people** is a search-and-pick box, like Collaborators.
  - Work tasks and FYIs can name anyone in the organisation.
  - Approval steps still list only people who can approve.
  - Options IT has fixed are shown as "(set by IT)".
- **Inactivity sign-out:** you're signed out after 30 minutes with no activity (the Super Admin can change this). Two minutes before, a "Still there?" message offers **Stay signed in**. Typing, clicking or scrolling in the page counts as activity.

**For IT (Admin → Custom approval)**
- **Fields:** set the fields everyone fills in on a custom approval, with the same field builder as approval types (rules, formulas, line items, files).
- **Preview:** see the fields before saving.
- **Step options:** for **All of them must approve**, **Respond within** and **If nobody to approve**, choose the default and whether people may change it. A fixed option is applied by the server whatever is sent.
- **When it applies:** only to new custom approvals; requests already raised keep their own fields.
- **Builder:** the approval type builder also uses search-and-pick for Specific people.

**For the Super Admin**
- **Page access** (Super Admin → Page access): every page of My approvals and the Admin space.
  - Levels: **Full**, **View only** (can look, can't change anything) or **Hidden**.
  - Who: everyone, a department or one person. The person's rule beats the department's, which beats everyone's.
  - **Check what a person can open** shows the result for anyone.
  - The first page of each space can be view-only but not hidden.
  - Enforced on the server: a hidden page is "not found" and leaves the menus; a view-only page shows a note and refuses changes. Every change is in the audit log.
  - Page access never applies to the Super Admin.
- **Sign-out after no activity:** Providers & security → Authentication: 5 to 480 minutes, 30 by default.
  - Applies to users and IT admins, never to the Super Admin.
  - If you had saved a value before (the old default was 120), that value stays until you change it.
- **Database:** one migration, additive only (`202610150900_v180.sql`). v1.7.2 still runs on it.

## v1.7.2 (12 Oct 2026): Collaborating screen, and filters everywhere
- **Collaborating** (sidebar): every request someone added you to follow, on its own screen. "Shared with me" in My requests now opens it.
- **Filters for Collaborating and My requests:**
  - quick tabs with counts (All, Open, Waiting for approvers, Sent back, On hold, Approved, Rejected, Withdrawn, Overdue);
  - search (number, title, who raised it);
  - several statuses at once, approval type (or custom approvals);
  - who raised it, their department and who added you (Collaborating only);
  - the step it's waiting at, and who it's waiting with;
  - overdue, due within 1 to 30 days, with or without files, approval still valid / expiring / expired;
  - date ranges for raised, added to you (Collaborating), closed and last activity;
  - order (newest, oldest, latest activity, due soonest, request number, latest added) and 25, 50 or 100 per page.
  - Every filter in use shows as a chip you can remove. Save filters as a view; you can share it or make it your default.
- **Waiting for me:** the same idea. Besides Show, Approval type and Order, **More filters** has:
  - search, raised by, their department, step;
  - mine or covering for someone;
  - due within, files, raised and waiting-since dates, and per page.
  - Saved views work here too. Bulk approval appears when no filter is in use, as before.
- The filter choices only list people, types and steps from your own lists. A filter can only narrow what you can already see.

## v1.7.1 (10 Oct 2026): navigation tidy-up, reports for IT only
- **Analytics keeps your space:** opening Analytics from the Admin space now stays in the Admin space (`/admin/analytics`, starting at the whole organisation). In My approvals it's still `/users/analytics`. The drill-down lists and "How these are worked out" stay in the same space too.
- **Help and Profile have moved** from the sidebar to the account menu (your name, top right) in every space, next to Notifications and Sign-in & devices.
- **"My work" is now "Overview".**
- **Reports are for the IT team and the Super Admin only.** They are now in the Admin space (**Admin → Reports**), with downloads, scheduled reports, alerts and background exports. Everyone else gets "not found" on the pages and the download links, and Reports is no longer in their sidebar. Old `/users/reports` links take IT to the new place.
  - In the job runner, an existing schedule owned by someone who isn't IT is skipped, and their alert rules are switched off.
  - Analytics itself is unchanged for everyone.

## v1.7.0 (10 Oct 2026): expiry, calendar, deeper analytics, background exports
**For everyone**
- **Approval expiry:** for approval types with "Approval valid for (days)", an approved request shows **Valid until …** (amber in its last 7 days) or **Expired on …**. The requester is told 7 days before. The date is fixed when the request is approved.
- **Needed-by calendar** (menu: **Calendar**): requests by their "needed by" date, by month. Choose "Mine and waiting on me" or "All I can see".
- **Refresh from profile** on a new request puts your current department and designation back into the form.
- **Amendments keep a draft** while you type, like new requests, and appear under Your drafts.
- **Confidential fields:** values IT marks confidential are shown only to the requester, the approvers and IT. Collaborators and advisers see "Confidential", and so do the PDF summary and the change history.

**Analytics and reports**
- **Click a number to see the requests behind it.** KPI cards, bars, chart legends and heatmap cells open a list with the same filters.
- **More filters:** status now, approver, step, response-time state, and how long a request has been open.
- **New numbers:**
  - due today and in the next 7 days;
  - typical (median) time to decide;
  - approved first time;
  - rework rate;
  - withdrawal rate.
- **Compare with** the previous period (this month is compared with the same days of last month), or the **same period last year**. Team and department views show a **comparison with the whole organisation** (rates and times only).
- **New charts:**
  - what became of the requests raised;
  - backlog and overdue over time;
  - decisions and response times passed over time;
  - a **department × step heatmap** of where tasks wait.
- **Saved views:** share a view with everyone (each person still sees only their own numbers), and make one your **default**.
- **Scheduled reports:** change a schedule, and send it to **other people too**. Each person gets the report with their own permissions; anyone who can't see it is skipped.
- **Alerts:** choose a **severity**, **quiet hours** (critical alerts ignore them) and **app inbox only** or inbox and email.
- **Large exports in the background:** up to 50,000 rows for Excel and CSV. You're told in the app when the file is ready; download it from Reports → My exports within 7 days.

**For IT**
- **Form preview** in the workflow builder: try the form, with its rules and formulas, before saving.
- **Move pending tasks** (Workload → Move pending tasks): tick tasks from anyone, choose one person and give a reason. Every task gets its own result.
- **Re-check and fix** on Needs attention, for requests flagged "Workflow state doesn't add up". It makes the task records match the workflow (audited). It never changes the workflow itself and never deletes anything.
- **Duplicate checks** can count anyone's requests, the same person's, or the same department's. New: **must-be-unique fields** (an invoice or PO number can't repeat on an open or approved request).
- When an out-of-office cover ends, both people are told how many approvals are back with the person.

**For the Super Admin**
- **Scheduled jobs stopped** alert: if the 5-minute job run hasn't run for 2 hours, you're told (at most once a day). The check runs when the health check is called or an IT page is opened.
- **Optional download permission:** Providers & security → Feature switches → **Report downloads: ROLE** limits downloads, emailed schedules and background exports to people with the new **Can export** role (plus IT).
- **Backup check:** `npm run db:verify-backup -- <backup file> --into=<empty database>` restores a backup into a separate empty database and proves every table, row count and trigger came back. It refuses the live database. See BACKUP_RESTORE_AND_ROLLBACK.md.
- **Performance:** measured p95 timings and new indexes (docs/PERFORMANCE_ANALYTICS.md). Analytics pages and the readiness check are rate-limited per person.
- Database: one migration, additive only (`202610140900_v170.sql`). v1.6.2 still runs on it, so rollback is a republish.

## v1.6.2 (10 Oct 2026): backups on GoDaddy
- Backups now go to **Private Storage** (`/private/backups`) when `BACKUP_DIR` isn't set: the only folder the app can write to that is kept across publishes. A cPanel home folder (`/home/...`) isn't visible to the app and made backups fail.
- When a backup fails, **Back up now** and **Automation** now say why in plain words (folder not writable, folder can't be created, disk full, database permission), with the folder it tried.
- Deployment guide Part P corrected.

## v1.6.1 (10 Oct 2026): files in forms, and collaborators
**For IT**
- **Attachments as a form field:** in the workflow builder, add a field of type **Attachments (files)**. Make it required (at least one file) and choose up to 1–5 files. Requesters attach files right there, and the files show under that field on the request.

**For everyone**
- **Collaborators:** when you raise a request (standard or custom), add anyone in the organisation to follow it, as many as 20 people. They can see it, comment and add files, and they're told how it goes. They don't approve. Add or remove people later on the request page; a collaborator can stop following.
- **My requests → Shared with me** lists the requests people added you to.

## v1.6.0 (10 Oct 2026): clearer, safer, measurable
**For everyone**
- **A refreshed look:** dark mode, a command palette (Ctrl K), keyboard shortcuts in Waiting for me, clearer errors with a summary at the top, toasts with Undo, and a phone navigation bar.
- **Check before submitting:** see missing fields, missing files, possible duplicates and the budget position before you submit. Possible duplicates need a short reason.
- **Smarter forms:** fields that appear only when needed, worked-out amounts, and line items with GST.
- **Templates and "raise again":** save a request as a template, or start a new one from an earlier request. Your department fills in from your profile.
- **Amend an approved request** (where IT allows it): change the allowed fields with a reason. The approval steps run again; the original approval stays on record.
- **Recall** a request before anyone decides; **answer questions** from approvers; see **links and follow-ups**.
- **Analytics:** your requests, your approvals, your team or department; KPI cards compared with the previous period; charts with table views; aging and response-time status.
- **Reports:** ready-made reports in Excel, CSV or PDF; save filters; have a report emailed to you on a schedule; set alerts when a number crosses your line.

**For approvers**
- **Ask for information**, **ask a colleague for advice**, or **pass one approval** to an eligible colleague.

**For IT**
- **Needs attention:** blocked steps, inactive approvers, requests with no activity, unsent messages and workflow states that don't add up, each with what to do.
- **Submission checks per type:** duplicate fields, minimum files, budget check, amendable fields.
- **Budgets** per department and financial year.
- **Versions:** compare any two, restore an old one as a draft, and **move open requests** to the live version safely.
- **Import and export** approval types between the test and live sites (always as a draft).

**For the Super Admin**
- **Automation:** every background job, its health and history; run now; resend messages that weren't sent.
- **Retention & legal holds:** holds stop records being deleted; the retention dry run shows what a policy would affect (nothing is deleted).
- **Feature switches:** turn new features on, off, or on for the IT team only.

## v1.5.0 (9 Oct 2026): easier every day
**For everyone**
- **My work** (the first page) shows what needs you first: due soon and overdue, waiting for you, returned for changes, your drafts, your recent requests and what finished lately. New people see a short "five things to know" list until they hide it.
- **Drafts:** what you type in a new request or custom approval is saved as you go. Come back to it from My work, or discard it. Submitting removes the draft; drafts go after 30 days.
- **Where is it now?** A line above the level map says who it's waiting for, since when, what comes next, and how many steps are done.
- **Search** finds any request you're allowed to see, with filters; save a search as a view.
- **Phones:** lists become cards, and buttons are easier to tap.
- **Notification settings** (Profile → Notifications → Settings): switch off email or WhatsApp for updates, reminders, comments and FYIs. Approvals waiting for you and security messages always come.
- **@mentions:** type `@` and a User ID in a comment to tell someone who can already see the request.
- **Download PDF** on a request: details, levels, decisions and history in one file.
- **Out of office** explains what your delegate will see, and lists what is waiting for you now.
- **Help** (sidebar): how-tos, what each status means, and **Copy details for IT**.

**For approvers**
- **Approve several at once** on Waiting for me: tick, review the list, approve. Work tasks and requests on hold are done one by one.
- A **due soon** heads-up comes before the response time runs out.

**For IT**
- **Workload** (Admin): who has how much waiting, how old it is, what is overdue.
- **Hand over** suggests the people with the fewest approvals waiting.
- **Test mode** shows which way each choice went, why steps were skipped, and how the route differs from the live version; it also says which requests a publish would affect.

**For the Super Admin**
- An alert (once a day) if the scheduled jobs or the daily backup fail.
- Every page and error has a **reference** that matches the server log.

## v1.4.0 (9 Oct 2026): everything pending
**For everyone**
- **Work tasks:** after approval, a step can hand work to someone, often the requester (e.g. raise the PO). It shows as **To do**, and they press **Mark as done**.
- **FYI steps** tell people (e.g. Finance) that a request reached a point; nothing to do.
- **Waiting for me** and **Notifications** have pages; custom approvals take attachments.
- New messages: task for you, FYI, request resumed, changes made, request removed, request moving again.
- The app can be installed on a phone ("Add to Home screen").

**For IT**
- **Builder:**
  - step kinds (approval, work, FYI);
  - approvers by **designation** (optionally the requester's department);
  - rules with several conditions (**all** or **any**);
  - choices inside choices;
  - a warning before leaving with unsaved changes.
- **Stuck requests** show **Stuck: needs IT** on the request page: give the step to people, skip it, try again, or pick a path.
- **Approval types:** remove one that was never used, or archive it; choose where a resubmitted request restarts; make a good custom approval into an approval type.
- **Escalation** goes up the management chain (up to 3 levels).
- Dashboards count approvals only (not work tasks).

**For the Super Admin**
- **Backups:** daily, plus **Back up now**, with a tested restore (deployment guide Part P).
- **Audit log CSV download**, and **Sign-in history**.
- **WhatsApp delivery receipts** (with the webhook), and a **health check** for an uptime monitor.
- Optional **origin lock** to Cloudflare, and optional **Power BI views**.

**Fixes and hardening**
- **Deleting a request:**
  - closes it properly;
  - tells the people waiting.
- **Publishing:** two people publishing at once can't clash.
- **Handover:** the new approver gets the full response time.
- **Hold:** time on hold doesn't count against the response time.
- **Request numbers:** the year follows India time.
- **Updates:** a failed update can carry on where it stopped.
- **Sign-in:**
  - a locked account isn't revealed to guessers;
  - "This wasn't me" links work once.
- **Google sign-in** accepts Google identities only.
- **IT Admin accounts:** one IT Admin can't change another's contact details.
- **Settings and logs:** safer provider settings and log masking.

## v1.3.6 (9 Oct 2026): fixes from the application audit
- **Fixed:** on an admin's user page, **Deactivate user** and **Sign out everywhere** now ask for confirmation and then work. Before, they did nothing.
- **Idle sign-out:** you're signed out after **2 hours without activity** (Super Admin can set 15–720 minutes under Sign-in security). Sessions still end 12 hours after sign-in.
- **Safer sign-in links:** after signing in, the app only returns you to a page inside this site.
- **One-time codes:** the limit of wrong tries per code now holds even for simultaneous guesses.
- **Messages waiting for a retry** (which can contain set-password links) are stored encrypted and deleted once sent, or after 7 days.
- **Email sending** gives up after 15 seconds instead of waiting indefinitely, and is retried by the job runner.

## v1.3.5 (9 Oct 2026)
- **Profile page:** in My approvals, the sidebar now has one **Profile** entry. It shows your details (department, designation, reporting manager and more), with tabs for **Notifications**, **Out of office** and **Sign-in & devices**. Old links still work.
- The account menu (top right) has a Profile link.
- New: `docs/APPLICATION_CURRENT_STATE_AUDIT.md`, a full audit of what is built, verified, missing and at risk.

## v1.3.4 (9 Oct 2026)
- **Security updates:** Next.js 15.5.27 and firebase-admin 14.5.0. The production dependency audit is now clean (0 known vulnerabilities).
- **Sign-in protection:** the per-address sign-in limit now uses the visitor's real address from Cloudflare, so it can't be dodged by faking a header.
- **Email** is sent from `no_reply@approval.arssteels.net` by default (replies still go to IT).
- **Super Admin → Message deliveries** shows when the job runner last ran, and warns if the cron job isn't running.
- The deployment guide has a step-by-step cron job setup (Part I).

## v1.3.3 (9 Oct 2026)
- The "People" picker (custom approvals and workflow steps) now has an accessible name for screen readers.
- Live notification test: WhatsApp works for request events. Email is blocked by Resend (HTTP 403) until the sending domain is verified in the Resend account that owns the API key (see DEPLOYMENT.md G2).

## v1.3.2 (9 Oct 2026): fix from the live test
- **Live fix:** the Import data page and the Audit log raised a page error (React #418) on the live site. Cloudflare rewrote the email addresses they showed. Addresses are now shown so Cloudflare leaves them alone, here and in everything people type (request titles, comments, field values, timeline, notifications, out-of-office reasons).
- A new automated check fails the build if any page shows an address in a form Cloudflare would rewrite.

## v1.3.1 (9 Oct 2026): reliability fixes from the QA audits
- **Forms no longer crash the page.** When the server errors, the connection drops, an upload is cut off, or the session has ended, the form now says so ("You're offline…", "Couldn't reach the server…", "Your session has ended…") and keeps what you typed. Before, the page went blank with "Application error".
- **No endless spinners:** after 30 seconds a form stops waiting and says the action may still have gone through.
- **Loading feedback:** a spinner on the menu link you clicked, and on dashboard period and page links. Quick period changes now always show the period you clicked last.
- **Readable busy buttons** (contrast 4.72:1, was 1.42:1); buttons keep their size while busy; screen readers hear "Working…".
- A friendly error page instead of a blank one, if anything else goes wrong.
- Workflow builder: every field has an accessible name.
- Audits: `docs/qa/LOADER-QA-REPORT.md` (retest: 70/70 executed pass) and `docs/qa/E2E-QA-REPORT.md`.

## v1.3.0 (8 Oct 2026): the form field creator
- **Fixed after testing key by key:**
  - **Dropdowns:** options are now a list. Type one and press Enter or **Add option**, or paste several at once. Duplicates are refused. Before, the box dropped every comma, so only one option could be made.
  - **Field keys** follow the whole label (before, "Delivery Date" became `d`). Saved keys are locked.
  - **Number boxes** keep a decimal point or a minus sign while you type.
  - **Dates in conditions:** "skip when *Needed by* is before / after …" uses a date picker and now works. Every condition's value box matches its field: a dropdown for options and lists, people for a person, numbers for amounts.
- **New: Department and Designation fields from the database.** The requester picks from the live list of active departments or designations; conditions can use them, e.g. skip a level for one department.
- **Help text** under any field.
- **Test mode** keeps the valid sample values even when one is wrong.
- **The request page** shows a level as "Skipped: <reason>" as soon as its condition applies, not only when it is reached.
- Dates show as 01 Dec 2026.

## v1.2.0 (8 Oct 2026): approver designations, request deletion, dashboards
- **Approver designations:** Admin → Departments → Designations has an **Approver** tick. Tick Manager and above.
  - Only people whose designation is ticked can be chosen as approvers: named workflow and custom approval steps, approver group members, department HOD, reporting manager, out-of-office delegate, handover, and person fields that pick an approver.
  - Choices already saved stay valid until changed.
  - Every existing designation starts ticked; untick the junior ones. New designations start unticked.
  - Import has a new `approver` column for designations.
- **Super Admin → Requests:** every request, searchable, with **Delete** (a reason is required). Also on the request page.
  - A deleted request leaves every screen, queue, reminder and report, and its pending approvals are cancelled.
  - The **Deleted** tab and the audit log keep who, when and why. There is no undo.
- **Admin → Dashboards**, four pages, each with a date, type and department filter and a CSV download:
  - **Utilisation**: every approval type, used or not;
  - **Department-wise raised**;
  - **Approver-wise**: given, decided, waiting, overdue, average time, on-time %;
  - **Raiser-wise by department**: with department subtotals.
  - The default period is the financial year to date.

## v1.1.0 (8 Oct 2026): bulk import
- **Import data** in the Admin and Super Admin spaces, for **Users, Departments, Designations, Approver groups and Holidays**:
  - **Download template** (CSV with the header row) or **Download current data** (the same columns, filled in, to edit and re-upload);
  - **Upload → Check file**: a dry run that shows new, changed, unchanged and problem rows, every problem by row and column, and a downloadable problem list;
  - **Import**: all rows in one go, or none.
  - The same rules as the forms: only the Super Admin grants Super Admin; password sign-in needs WhatsApp; no reporting loops; emails and numbers stay unique.
  - Each change and each import is in the audit log, and people whose WhatsApp number or sign-in method changed get the usual alert.
- **Loaders:** spinners on Download, Check and Import; a "Checking… / Importing… please keep this page open" bar; the controls are locked while working; a skeleton while the page loads.
- An **Import** button on the Users, Departments, Approver groups and Working calendar pages.

## v1.0.6 (8 Oct 2026): UI polish
- **Spaces:** My approvals, Admin and Super Admin are now called *spaces*. Your name at the top right opens one menu with your space, **Switch space**, Notifications, Sign-in & devices and **Sign out**.
- **Phones:** a menu button opens the page list as a drawer. Before this there was no menu below tablet width.
- **My approvals:** "Welcome back", compact counters that open the matching list, the top 5 items waiting and recent; My requests has one bar for search, filter and New request.
- **Admin:** the overview shows every module as a live card with counts (no more "Being built").
- **Super Admin → WhatsApp templates:** a status panel (how many are live, last sync, Sync button), short message names with the description behind "?", and tidy Open/Create buttons.
- Clearer active menu item, hover on cards and rows, softer cards, and content centred on wide screens.

## v1.0.5 (8 Oct 2026)
- **The Super Admin signs in with Google as `itsupport@arsenergy.co.in`** (D-082). `itadmin@arssteels.co.in` is an alias of another mailbox, and Google always reports the primary address, so it never matched (`UNKNOWN_ACCOUNT`).
- A one-time migration moves the bootstrap account (User ID `itadmin`, all its roles) to the new email.
- The bootstrap seed no longer overwrites the account on every start, so later edits in Admin → Users stay.

## v1.0.4 (8 Oct 2026): first live fixes
- **Email addresses on pages no longer break the page.** GoDaddy's Cloudflare layer rewrote any address in the HTML (email obfuscation) and injected a script the CSP blocks, which caused React error #418. Addresses are now rendered so Cloudflare leaves them alone; they look the same.
- **Google sign-in:**
  - the Firebase private key is accepted with or without surrounding quotes, as literal `
`, real line breaks or CRLF;
  - when a Google token can't be verified, the reason is written to the runtime log (never the token).

## v1.0.3 (8 Oct 2026)
- **Build fix:** `npm run build` removes the old `.next` folder first. GoDaddy reuses the app folder between builds, which broke Next.js with `ENOENT rename …/export/500.html`.
- **Email sender** is now `approvals@arssteels.net`, the domain verified in Resend. A new **Reply-to** setting defaults to `itadmin@arssteels.co.in`, so replies reach IT. Both can be changed in Super Admin → Providers & security → Email.

## v1.0.2 (8 Oct 2026)
- `npm start` now applies the database migrations and seeds before starting, so the default start command on GoDaddy creates and updates the database by itself. GoDaddy's "Import SQL" answered "Unauthorized", and the importer drops existing tables. `npm run start:app` starts without migrating.
- Deployment guide Part B updated: automatic setup first; the SQL import only as an option, with its warnings.

## v1.0.1 (deployment helpers, 8 Oct 2026)
- `npm run start:production` applies the database migrations and seeds, then starts the app. GoDaddy's Node.js hosting may have no terminal, so the first start sets up the database by itself, and later releases migrate themselves. Both scripts skip what's already done.
- `npm run db:check` runs the MySQL privilege check (triggers).
- `docs/DEPLOYMENT.md` is rewritten as a complete step-by-step guide (Parts A–O) for the "Deploy your Node.js app" wizard, including Resend domain verification, a new CEOITBox key, the secrets-file import, cron and troubleshooting.
- No change to app behaviour.

## v1.0.0 — first production release (8 Oct 2026)
The ARS Approval Platform: **multi-level approvals in any custom manner**. It replaces the 104 Asana approval projects.
Deploy with `docs/DEPLOYMENT.md`.

### What's in it
- **Sign-in and security:**
  - Google sign-in;
  - User ID + password with a WhatsApp code;
  - new-device alerts and "This wasn't me";
  - lockout and rate limits;
  - 12-hour server-side sessions;
  - strict security headers and CSP;
  - append-only audit log;
  - break-glass account.
- **Role areas:** `/users` (everyone), `/admin` (IT team), `/superadmin` (itadmin@ only). Everyone else gets a plain 404.
- **Approval engine:**
  - any number of levels;
  - sequential or parallel steps, with all / any-one / any-N approvers;
  - choices (if / otherwise) and skip rules;
  - approvers from people, groups, roles, the requester's manager or HOD, a named department's HOD, or a person picked on the form;
  - the requester never approves their own request;
  - a level with nobody to approve is blocked and IT is told, never silently passed.
- **DoA per approval type:** a matrix of amount limits × levels, set when the approval type is created. The DoA view shows every type's bands.
- **Requests:**
  - raise, approve, reject (reason required), ask for changes, then resubmit on the same number;
  - hold and resume;
  - withdraw by the requester; reopen by the Super Admin;
  - comments and attachments (PDF, images, Office, CSV, text; checked and never deleted);
  - custom approvals, where anyone routes to anyone;
  - My requests with search, a status filter and paging.
- **Out-of-office delegation; handover** of a leaver's approvals.
- **Response times on a working calendar** (working days and holidays), with reminders and escalation.
- **Notifications:**
  - in-app, email (Resend) and WhatsApp (CEOITBox);
  - an outbox, so nothing is lost on a crash;
  - automatic retries and a delivery log.
- **WhatsApp template creator:** write, submit to Meta, sync the status (approved goes live by itself), and test-send, through the CEOITBox API. Synced daily.
- **Insights** for IT: what's waiting where, how long each level takes, what's overdue.
- **Demo data** for trying the system before the real staff list, with **Try as**.

### Quality
- **Automated checks:** 213 unit tests, 53 MySQL integration tests and 15 browser end-to-end tests; lint, typecheck and a production build in CI on Node 22.
- **QA suite:** `docs/qa/QA-TEST-SUITE.md`, 600 test cases with smoke, sanity, regression and critical suites.
- **Defects fixed before release (S8-06):**
  - a negative amount skipped DoA levels;
  - a retried submit made a duplicate request;
  - a request raised twice from two tabs;
  - notifications lost on a crash;
  - an attachment limit race and duplicate uploads;
  - long comments cut without warning;
  - a WhatsApp template deleted at CEOITBox stayed live;
  - no search in My requests;
  - line breaks in email subjects.
- **Fixed during release preparation:** on Node 22 (GoDaddy) an empty file box made every plain submit fail. CI caught it; now fixed.

### Decisions kept as they are (owner, 8 Oct 2026)
- One person may approve more than one level of a request, directly or as a delegate.
- Requests don't expire.
- Rejection is final; "ask for changes" is the route back.

### Needs the owner after deploy
- Firebase Admin values.
- A Resend key.
- A **new** CEOITBox key for this app.
- The cron job.
- The `UPLOAD_DIR` folder.
- Submitting the 19 remaining WhatsApp templates.
- The real staff list, or the demo data in the meantime.
- Q-015: break-glass sign-in without WhatsApp.
