# Transition implementation report: the 50 areas (v1.89.0, D-420)

**Source:** [GLOBAL_TRANSITION_INVENTORY.md](GLOBAL_TRANSITION_INVENTORY.md) (same row numbers). **Tokens:** [GLOBAL_MOTION_TOKENS.md](GLOBAL_MOTION_TOKENS.md).
Status: **Done** (built as recommended or better), **Done (alt.)** (built differently, reason given), **Kept** (already right; only moved onto the tokens), **Not appropriate** (reason), **Deferred** (reason; not in this stage).

Rows that rely on a bare Tailwind `transition` / `transition-colors` / `transition-transform` are now on the tokens through the Tailwind `DEFAULT` (fast 150 ms, standard easing), without touching each component.

| # | Area | Status | What now |
|---|---|---|---|
| 1 | Page navigation | **Done** | On by default; old main fades out (fast, exit), new fades in + 4 px (standard 200, enter); WebKit freeze fixed; Back / Forward instant; skipped past 300 ms |
| 2 | Route changes (skeleton swap) | **Done** | The page that replaces a skeleton fades in (fast, `data-nav-reveal`); loader delay from `MOTION_DELAY.loader` |
| 3 | Sidebar | **Done (alt.)** | Width no longer animates (it relaid out `main` every frame and the two edges moved by different amounts, MOT-03); the width changes in one step and labels / rail items fade in at once (standard); indicator standard 200 transform |
| 4 | Header | Not appropriate | Static chrome; its buttons get the hover token |
| 5 | Nav menus | **Kept** / partly | Chevrons and rows on the token DEFAULT; MobileNav fades in (fast); its close stays instant (see 9) |
| 6 | Modals | **Done** | smooth 250 in (fade + scale 0.98, enter), fast 150 out (exit); reduce: 100 ms fade |
| 7 | Dialogs (other markup) | **Done** | Raw `dialog.ars-dialog` close through `closeTopLayer` (exit now plays in Firefox / Safari); `role=dialog` editors (FieldControls ×3, GridCellEditors ×2, TryAs, emoji, TaskCreator pickers) get `pop-in`; Customise gets `drawer-in`; the draft task window `motion-scale-in`. Inline confirmations inside forms (ImportPanel, UsersBulkActions, RequestForm): not appropriate (they appear in place, part of the page) |
| 8 | Drawers | **Done** | One value for both families: smooth 250 in, 16 px, fast 150 out (dialog drawer, panes, sheets) |
| 9 | Dropdowns | **Done** (open) / Not appropriate (close) | fast 150 in with the enter easing (the bell and + Create now match); close stays instant: focus returns at once and an exit would keep a second copy of the items in the page |
| 10 | Popovers | **Done** | `pop-in` (fast) on PeoplePicker and PersonSelect too; phone date sheet keeps `mob-sheet` (smooth) |
| 11 | Tooltips | **Kept** | fast fade after `--motion-delay-tooltip` 300 ms (token) |
| 12 | Buttons | **Done** | colour on hover token (instant 100, standard easing); press `scale(0.98)` (none under reduce) |
| 13 | Icons | **Kept** | chevrons on the token DEFAULT; spinner loop unchanged |
| 14 | Cards | **Kept** | `.card-link` on the token DEFAULT |
| 15 | Dashboard widgets | Deferred | Drag lift / FLIP reorder is new behaviour on a drag-and-drop surface; the static drag states are clear. Candidate for stage 3 |
| 16 | Tables | **Kept** | row hover on DEFAULT; pending dim `--motion-hover`; no row height animation |
| 17 | Forms | **Done** | error-summary scroll respects reduced motion (`scrollBehavior()`, A11Y-03) |
| 18 | Inputs | **Done** | `duration-150` literals → `duration-fast` |
| 19 | Checkboxes | **Done** | `--t-check/-fill/-pop` = fast / instant / standard (the private scale is gone) |
| 20 | Radios | Not appropriate | native |
| 21 | Toggles | **Kept** | fast (already) |
| 22 | Tabs | **Done (alt.)** | colour change on the hover token; each tab is a separate page, so the page transition covers the panel; a sliding indicator would need state across pages (not appropriate) |
| 23 | Accordions | **Kept** | open: rows fade + 4 px (fast, enter); close instant; never height |
| 24 | Loading indicators | **Kept** | loops (documented exception); shown after `MOTION_DELAY.loader` |
| 25 | Skeletons | **Kept** | shimmer loop (exception); the swap fades (row 2) |
| 26 | Progress | **Done** | `translateX` of a full-width bar (emphasis / standard / smooth) instead of `width` (Display, StepMap, ApprovalRoad, UploadProgress, tour) |
| 27 | Toasts | **Done** | in standard 200 (enter), out fast 150 (exit) before removal |
| 28 | Notification panel | **Kept** | `pop-in` fast; close instant (as 9) |
| 29 | Search suggestions | Not appropriate | results change while typing |
| 30 | Filter panels | **Done** | = dropdowns (enter easing) |
| 31 | Pagination | **Done** | `[data-link-pending]` fades (hover token) |
| 32 | Scroll | **Done** | Field and ReadinessPanel now guarded (A11Y-03); a unit test fails on any unguarded `behavior: "smooth"` |
| 33 | File uploads | **Kept** | dropzone colour on DEFAULT; real upload progress: deferred (not a motion item) |
| 34 | File previews | Deferred | the preview image unmounts while the dialog fades out (150 ms); keeping it needs a change to two callers' state; low impact |
| 35 | Drag and drop | Deferred | as 15 |
| 36 | Approval journey | **Done (alt.)** | vans and fill move by transform (container query units) instead of `left` / `width`; scene timings kept (owner feature D-273, exception) |
| 37 | Task status | **Kept** | check on tokens (19); celebration burst timing from tokens, enter easing |
| 38 | Activity timelines | Deferred | server-rendered lists redraw on every refresh; an entrance would replay on old comments without per-item "seen" tracking; the optimistic "Posting…" row stays |
| 39 | AI chat | **Done** | smooth in / fast out, enter / exit easing, no radius animation, JS wait from the token |
| 40 | AI streaming | **Done** / Not appropriate | typing dots: opacity fade (no bounce); a streamed reveal: not appropriate (answers arrive whole) |
| 41 | Mobile nav | **Done** | tab pill: fixed size, background scales / fades (no width); MobileNav fade |
| 42 | Bottom sheets | **Done** | smooth 250 in, fast 150 out |
| 43 | Empty states | Not appropriate | static; the page transition covers the first show |
| 44 | Error states | **Kept** | no shake on fields; toast icon unchanged |
| 45 | Success states | **Kept** | NextFlash outline emphasis 300; highlight time from `MOTION_DELAY.highlight` |
| 46 | Confirmations | **Done** | = modals |
| 47 | Focus / hover | **Done** | hover on the token (buttons, tabs); focus ring instant |
| 48 | Page content reveal | Not appropriate | `.motion-stagger` stays available (playground), not applied to lists (excess motion on every filter) |
| 49 | Data updates | **Kept** | LiveNumber emphasis 300 (was 350); Admin Insights KPI figures don't refresh in place, so there is no changed value to animate |
| 50 | View transitions list → detail | **Kept** | title morph smooth 250 |

**Other motion outside the 50:** landing → sign-in now leaves exactly with the CSS (MOT-05); the install invite uses `motion-slide-up` (it named a keyframe that did not exist); the onboarding spotlight moves by transform; the Analytics board no longer flickers (a hidden grid section stayed visible: UIQA-PERF-01).

**Totals (by the main status of each row):** Done or Done (alt.) 25 · Kept (moved onto the tokens) 16 · Not appropriate 5 (plus a not-appropriate part in rows 7, 9, 22 and 40) · Deferred 4 (15, 34, 35, 38). 50 rows.
