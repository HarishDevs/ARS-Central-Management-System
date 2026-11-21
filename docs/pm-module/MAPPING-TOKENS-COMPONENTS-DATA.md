# Spec package → ARS-CMS mapping (tokens, components, data model, infrastructure)

Read-only mapping, 2026-11-21.
- **Spec:** `D:\REA\Asana\asana-reverse-engineering\docs` (11-design, 02-ui/COMPONENT_INVENTORY, 04-data, 12-modules).
- **App:** `D:\Omniroute\ARS Approval System` (v1.60.0).

Legend: **Mapped** = same role, same or near value. **Partial** = the role exists but the value or mechanism differs. **Missing** = no equivalent, with a proposed name.

---

## 0. Constraints that shape the mapping

**ASSET_REUSE_POLICY.md** (docs/11-design):
- **Never reuse Asana assets.** That covers the logo and names, icons (rail, sidebar, check-circle), illustrations and celebrations, Asana font files, CSS, token files, class names, the exact palette (coral Create button, pastel tiles, chip colours), microcopy, sync WebSocket formats and internal endpoint names. Commercial chart libraries seen in Asana count too.
- **Free to use:** layout conventions, interaction patterns, view types, generic IA nouns, and measurements used as benchmarks. Open-source assets are fine: Lucide (ISC), Inter (OFL), Apache ECharts.
- **Rules:** do not trace screenshots, and do not download from asana.com. Record every icon, font and illustration licence in `THIRD_PARTY_ASSETS.md`. A brand review checks for confusing similarity.

**What this means for ARS-CMS:**
- ARS already uses Inter (`next/font`, `--font-inter`) and `lucide-react` 0.469.0, so both comply.
- ARS's brand comes from `D:\Omniroute\assets` (ARS Blue #0053a0, ARS Red). The spec's teal and amber brand is marked `DECISION NEEDED` in DESIGN_TOKENS.md.
- **Recommendation:** map by **role** and keep ARS's own hues. Don't import the teal palette.
- No `THIRD_PARTY_ASSETS.md` exists in the ARS repo yet. Add one if you adopt the policy.
- ARS charts are hand-made SVG, so no licence issue arises.

**ARS theming mechanics** (`styles/globals.css`, `tailwind.config.ts`):
- Colours are CSS variables, exposed through a `token()` helper in Tailwind that supports opacity modifiers via `color-mix`.
- Dark mode works two ways: `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }`. The spec uses `:root:not([data-theme="light"])`, which behaves the same.
- Tailwind `darkMode: ["selector", '[data-theme="dark"]']`.
- Font sizes scale with `--text-scale` (user setting, `features/shell/TextScale.tsx`).

---

## 1. Token mapping (docs/11-design/tokens.css + DESIGN_TOKENS.md)

**Counts (107 tokens in tokens.css):** Mapped **61** · Partial **23** · Missing **23**.

The 15 dark overrides map onto ARS dark values: every mapped surface, text and semantic token has a dark value in ARS.

### 1.1 Brand and accent (12)
| Spec token | Value | ARS-CMS equivalent | Status |
|---|---|---|---|
| `--brand-50` | #effaf8 | `--color-primary-50` (`bg-primary-50`) #eef4fb | Mapped (role) |
| `--brand-100` | #d5f2ec | `--color-primary-100` (`bg-primary-100`) | Mapped |
| `--brand-200` | #abe4d9 | — (`--brand-wave-2` #cfe5ff is decorative) | Missing: `--color-primary-200` |
| `--brand-300` | #74cfc0 | — (spec: chart single-series colour) | Missing: `--color-primary-300` (or reuse `--chart-assigned`) |
| `--brand-400` | #3fb2a2 | — | Missing: `--color-primary-400` |
| `--brand-500` | #219587 | `--brand-accent` #0a84ff / `--color-focus` | Mapped (role: focus and fill) |
| `--brand-600` | #17786e | `--color-primary-600` = `--color-primary-solid` (`bg-primary-solid`, `.btn-primary`) | Mapped |
| `--brand-700` | #15605a | `--color-primary-700` = `--color-primary-solid-hover` | Mapped |
| `--brand-800` | #144d49 | — (`--brand-navy`, `--m-navy` #173b63 mobile only) | Missing: `--color-primary-800` |
| `--brand-900` | #12403d | — | Missing: `--color-primary-900` |
| `--accent-500` | #e0a12b amber (today and new badges) | `--tone-amber-fg/bg` (status tone). ARS's brand accent is `--color-accent-red` | Partial: add `--color-highlight` (today badge) |
| `--accent-600` | #c2851a | — | Missing: `--color-highlight-strong` |

### 1.2 Neutrals (12)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--n-0` | `--color-surface-white` (`bg-surface`) | Mapped |
| `--n-25` | — | Missing: `--color-surface-subtle` (optional) |
| `--n-50` | `--color-surface-page` (`bg-page`) | Mapped |
| `--n-100` | `--color-surface-muted` (`bg-surface-muted`) | Mapped |
| `--n-200` | `--color-border-default` (`border-line`) | Mapped |
| `--n-300` | `--color-border-strong` (`border-line-strong`) | Mapped |
| `--n-400` | — | Missing: `--color-neutral-400` (disabled icons) |
| `--n-500` | `--color-text-placeholder` (`text-ink-faint`) | Mapped |
| `--n-600` | `--color-text-secondary` (`text-ink-muted`) | Mapped |
| `--n-700` | — | Missing: `--color-neutral-700` |
| `--n-800` | — | Missing: `--color-neutral-800` |
| `--n-900` | `--color-text-primary` (`text-ink`) | Mapped |

ARS neutrals are cool slate (Tailwind slate). The spec's are warm. Keep ARS.

### 1.3 Semantic (8): all mapped, with dark values in both systems
| Spec | ARS-CMS |
|---|---|
| `--success` / `--success-bg` | `--color-success-600` / `--color-success-50` (`text-success-600`, `bg-success-50`); also `.st-green`, `--tone-green-*` |
| `--warning` / `--warning-bg` | `--color-warning-600` / `--color-warning-50`; `.st-amber`/`.st-orange` |
| `--danger` / `--danger-bg` | `--color-error-600` / `--color-error-50` (`text-danger-600`, `bg-danger-50`); `--color-error-solid` for fills |
| `--info` / `--info-bg` | `--color-info-600` / `--color-info-50`; `.st-blue` |

### 1.4 Identity colours (8): partial
| Spec | ARS-CMS | Status |
|---|---|---|
| `--id-1..8` (blue, violet, magenta, orange, ochre, green, cyan, grey) | `PROJECT_COLORS` (`server/work/access.ts`: green, blue, teal, amber, red, purple, pink, gray) with hex values in a JS constant, `COLOR_HEX` in `features/work/client.tsx`, rendered as an inline style by `ProjectDot`. Option pills use `OPTION_COLORS` (`server/forms/option-colors.ts`) and `--tone-*` vars. | Partial ×8 |

- **Missing:** CSS tokens `--color-identity-1..8`, with dark variants.
- **Policy gap:** the spec says identity colours must never reuse status colours. ARS's `red` and `green` project colours overlap the semantic tones.

### 1.5 Surface roles (14)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--bg-app` | `--color-surface-page` (`bg-page`) | Mapped |
| `--bg-surface` | `--color-surface-white` (`bg-surface`); `--color-surface-raised` (`bg-raised`) | Mapped |
| `--bg-sidebar` | `--color-surface-page` / `--color-surface-muted` | Mapped |
| `--bg-hover` | `--color-surface-muted` (`hover:bg-surface-muted`) | Mapped |
| `--bg-selected` | `--color-primary-50` | Mapped |
| `--bg-row-active` | none (the open board card uses `outline-primary-600`) | Partial → `--color-row-active` |
| `--border` | `--color-border-default` (`border-line`) | Mapped |
| `--border-strong` | `--color-border-strong` (`border-line-strong`) | Mapped |
| `--text` | `--color-text-primary` (`text-ink`) | Mapped |
| `--text-muted` | `--color-text-secondary` (`text-ink-muted`) | Mapped |
| `--text-subtle` | `--color-text-placeholder` (`text-ink-faint`) | Mapped |
| `--text-on-brand` | `--color-text-on-solid` (`text-on-solid`) | Mapped |
| `--focus` | `--color-focus` (`ring-focus`) | Mapped |
| (ARS extra) | `--color-overlay` (scrim); the spec has none | — |

### 1.6 Typography (17)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--font-sans` | `--font-inter` → Tailwind `font-sans` | Mapped |
| `--font-mono` | none (Tailwind default `font-mono`) | Missing: `--font-mono` |
| `--fs-xs` 11 | none (smallest is `text-caption` 12) | Missing: `text-micro` 11 × `--text-scale` |
| `--fs-sm` 12 | `text-caption` 12/16 | Mapped |
| `--fs-md` 13 | `text-label` 13/18 | Mapped |
| `--fs-base` 14 | `text-body` 14/20 | Mapped |
| `--fs-lg` 16 | `html` base 16 × scale; no named token | Missing: `text-subhead` 16 |
| `--fs-xl` 18 | none (`text-title` is 20) | Missing: `text-widget-title` 18 (or accept 20) |
| `--fs-2xl` 22 | `text-card-title` 22/30 | Mapped |
| `--fs-3xl` 28 | none | Missing: `text-greeting` 28 |
| `--fs-display` 44 / 300 | `text-display` 32/40 | Partial (size differs; add `text-kpi` 44 if wanted) |
| `--fw-regular/medium/semibold/bold` | Tailwind `font-normal/medium/semibold/bold` | Mapped ×4 |
| `--lh-tight` 1.25 | Tailwind `leading-tight` (1.25) | Mapped |
| `--lh-normal` 1.45 | Line heights are baked into the ARS fontSize tuples (≈1.38–1.43) | Partial |

Tabular numerals: ARS already sets `font-variant-numeric: tabular-nums` in globals.css (line ~462).

### 1.7 Spacing (10): all mapped
`--sp-0..12` (4 px grid) → Tailwind's default spacing scale: `p-1`=4, `2`=8, `3`=12, `4`=16, `5`=20, `6`=24, `8`=32, `10`=40, `12`=48. Same grid. ARS defines no CSS spacing variables and doesn't need them.

### 1.8 Radius (5)
| Spec | ARS-CMS (`borderRadius` override) | Status |
|---|---|---|
| `--r-sm` 4 | `rounded-sm` 4 | Mapped |
| `--r-md` 6 (buttons, chips, inputs) | `rounded-md` **8** | Partial (keep 8 = ARS brand) |
| `--r-lg` 10 (cards) | `rounded-lg` **12** (`.card` uses `rounded-xl`) | Partial |
| `--r-xl` 14 | `rounded-xl` **16** | Partial |
| `--r-full` | `rounded-full` | Mapped |

### 1.9 Shadows (3)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--shadow-1` (cards on board) | none (`shadow-card` is heavier; board cards use `shadow-card`) | Missing: `--shadow-hairline` / `shadow-subtle` |
| `--shadow-2` (popover, pane) | `--shadow-card` 0 8 24 .08 (`shadow-card`) | Partial (close) |
| `--shadow-3` (modal) | `--shadow-overlay` 0 20 48 .22 (`shadow-overlay`) | Partial (close) |
| (ARS extra) | `--shadow-button` (brand-tinted) | — |

### 1.10 Layout (9)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--topbar-h` 48 | `spacing.topbar` **64px** | Partial |
| `--rail-w` 60 | none (no rail; SideNav only) | Missing: `spacing.rail` |
| `--sidebar-w` 248 | `spacing.sidebar` **220px** | Partial |
| `--sidebar-w-min` 200 | none (sidebar not resizable) | Missing |
| `--pane-w` 440 | none (`TaskPane` is a centered `max-w-6xl` dialog) | Missing: `--pane-w` |
| `--row-h` 36 / `--row-h-compact` 30 | none (row height comes from padding classes) | Missing ×2: `--row-h`, `--row-h-compact` |
| `--header-row-h` 34 | none | Missing |
| `--board-col-w` 288 | Hard-coded `w-[304px]` in `features/work/ProjectWorkspace.tsx` (board) | Partial: promote to `spacing.board-col` |

### 1.11 Motion (4)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--dur-fast` 120 | `--motion-fast` 120 (`duration-fast`) | Mapped |
| `--dur-base` 180 | `--motion-base` 200 (`duration-base`) | Partial |
| `--dur-slow` 260 | `--motion-slow` 320 (`duration-slow`) | Partial |
| `--ease` cubic-bezier(.2,0,0,1) | `--ease-standard` identical (`ease-standard`) | Mapped |

Reduced motion: the spec zeroes the duration vars. ARS instead switches off each animation class under `prefers-reduced-motion` (several blocks in globals.css). Either approach works. Consider also zeroing `--motion-*`.

### 1.12 Z-index (5)
| Spec | ARS-CMS | Status |
|---|---|---|
| `--z-sticky` 10 | `--z-sticky` 35 (`z-sticky`) | Mapped (role) |
| `--z-pane` 30 | `--z-drawer` 50; `TaskPane` uses `z-[60]` | Partial |
| `--z-popover` 40 | none (menus use ad-hoc z) | Missing: `--z-popover` |
| `--z-modal` 50 | `--z-dialog` 60 | Mapped (role) |
| `--z-toast` 60 | `--z-toast` 70 | Mapped (role) |
| (ARS extras) | `--z-header` 30, `--z-palette` 80 | — |

### 1.13 Tokens worth adding (priority)
1. `--color-row-active` (light and dark): selected or open grid row.
2. `--color-identity-1..8` (light and dark): project, portfolio and team identity. Move `COLOR_HEX` out of JS. Avoid the status hues.
3. `--row-h`, `--row-h-compact`, `--header-row-h` plus a density switch: `[data-density="compact"]`, stored in `user_settings`.
4. `--pane-w` (resizable 380–720), if a right-side task pane is adopted.
5. `--z-popover`.
6. `--shadow-subtle` (board cards and hover).
7. `--color-highlight` (amber "today" badge). Optional, because ARS uses brand blue and red.
8. Type steps `text-micro` 11, `text-subhead` 16, `text-greeting` 28, `text-kpi` 44, all scaled by `--text-scale`.
9. `--color-primary-200/300/400/800/900`, to fill out the brand ramp for charts and hover states.
10. `--font-mono`.

---

## 2. Component mapping (COMPONENT_SPECS.md → CMP-01..38 from 02-ui/COMPONENT_INVENTORY.md)

**Counts (38 CMP IDs):** Exists **15** · Partial **19** · New **4**.

The non-ID spec parts in §2.13 are counted separately.

All paths are relative to `D:\Omniroute\ARS Approval System\`.

| CMP | Spec component | ARS-CMS file(s) | Status and notes |
|---|---|---|---|
| CMP-01 | Global rail (60 px, 4 areas, pressed state) | `features/shell/SideNav.tsx`, `features/shell/BottomNav.tsx` (mobile), `features/shell/nav-icons.tsx` | **New** `AppRail`. ARS has no icon rail. Its module areas live in SideNav. |
| CMP-02 | Sidebar (248, resizable 200–360, collapsible sections) | `features/shell/SideNav.tsx`, `features/shell/SidebarFrame.tsx` | Partial. Collapsible, but fixed 220 px and not resizable. |
| CMP-03 | Sidebar item (+ identity square, SR suffix) | `features/shell/SideNav.tsx`; `ProjectDot` in `features/work/client.tsx` | Exists. Check the ", Project" screen-reader suffix. |
| CMP-04 | Top bar (New, pill search Ctrl K, bell, avatar) | `features/shell/AppShell.tsx`, `CreateMenu.tsx`, `NotificationBell.tsx`, `ProfileMenu.tsx`, `CommandPalette.tsx` | Exists. Height is 64, not 48. |
| CMP-05 | Skip link | `features/shell/AppShell.tsx` (`.skip-link` in globals.css) | Exists. |
| CMP-06 | Menu (`menu`/`menuitem`/`menuitemradio`) | `features/ui/Menu.tsx` | Partial. Only `menu`/`menuitem`; no `menuitemradio` or `aria-checked`. |
| CMP-07 | Search panel / command palette (type filters, recents, saved) | `features/shell/CommandPalette.tsx`, `features/work/SearchParts.tsx`, `app/users/work/search` | Exists (D-232 was modelled on it). |
| CMP-08 | Object header (identity tile, inline title, star, status, members, Share) | `features/work/ProjectHeader.tsx`, `StarButton` in `features/work/ProjectForms.tsx`, `features/work/ShareDialogs.tsx` | Partial. No inline title edit in the header (rename is in settings). |
| CMP-09 | View tab strip (typed tabs, "+" add, **keyboard reorder**, 2 px underline) | Tabs in `app/users/work/projects/[id]/page.tsx` (list, board, calendar, timeline, overview); saved views in `features/work/TaskGrid.tsx` (`work_views`) | Partial. Lacks keyboard (Space) reorder, typed "+ add view" and the overflow fade. |
| CMP-10 | View toolbar (split Add task, Filter count, Sort, Group, overflow) | `features/work/TaskGrid.tsx` (Filters/Sort/Groups/Options); `features/ui/ListToolbar.tsx`, `ToolbarSearch.tsx`; `.tb-split`/`.tb-btn` classes | Exists. |
| CMP-11 | Task tree grid (`treegrid`, sticky header, virtualized >100, keyboard grid) | `features/work/TaskGrid.tsx`, `features/work/ProjectWorkspace.tsx` (list), `features/work/MyTasks.tsx`, `ColumnResizer.tsx`, `useColumnWidths.ts` | Partial. Uses `role="table"`, not `treegrid`. **No virtualization.** No arrow-key cell navigation. Resizable and sortable columns do exist. |
| CMP-12 | Section group header (collapse, name, add, more) | `features/work/ProjectWorkspace.tsx` (groups), `features/ui/GroupFold.tsx` | Exists. |
| CMP-13 | Inline task-name edit | `features/work/ProjectWorkspace.tsx` (`AddTask`, inline input), `features/work/TaskGrid.tsx` | Partial. Mainly add-row and rename; check in-cell rename for every row. |
| CMP-14 | Person cell / chip | `features/ui/PersonSelect.tsx`, `PeoplePicker.tsx`, `Avatar.tsx`; `CollaboratorsCell` in `features/work/GridCellEditors.tsx` | Exists. |
| CMP-15 | Date cell (remove, "No due date") | `features/work/TaskGrid.tsx` / `GridCellEditors.tsx` (native date inputs) | Partial. No custom DatePicker popover. |
| CMP-16 | Custom-field cell (per type; disabled when computed) | `FieldInput` in `features/work/MoreParts.tsx`; `features/ui/ChoicePill.tsx` | Partial. Only TEXT/NUMBER/SELECT/DATE; no multi-select, people, formula or read-only computed. |
| CMP-17 | Comment count badge | `RowBadges` in `features/work/ProjectWorkspace.tsx` (MessageSquare) | Exists. Shows as text; make it a button with "n comments". |
| CMP-18 | Board column (288, count, menu, collapse) | `features/work/ProjectWorkspace.tsx` (BOARD branch), `features/work/kanban.ts` | Partial. 304 px; check the column actions menu and collapse. |
| CMP-19 | Board card (+ keyboard drag Space/arrows, aria-live) | `features/work/ProjectWorkspace.tsx` (`kanban-card`) | Partial. HTML5 drag + **Alt+↑/↓** move with an `aria-live` status. The spec wants the Space lift/drop model. Card has no checkbox "Completed". |
| CMP-20 | Calendar grid (week/month, today badge, + Add) | `features/work/TaskCalendar.tsx` (`role="grid"`, month, holidays, drag) | Partial. Month only; no week unit. |
| CMP-21 | Gantt (zoom, unit, left grid, dependencies) | `features/work/Timeline.tsx` | Partial. Basic bars plus a "blocked" lock; no zoom, unit switch, dependency arrows or drag-resize. |
| CMP-22 | Workload chart (per person, per day) | `features/work/TeamWorkloadTable.tsx`, `app/admin/workload`, `WorkloadChart` in `features/home/HomeClient.tsx` | Partial. A table and a home chart, not a per-day capacity view. |
| CMP-23 | Dashboard widget (move, edit chart, filters) | `features/analytics/Charts.tsx`, `MetricsScreen.tsx`, `app/admin/dashboards`, `app/admin/analytics` | Partial. Analytics exist but there's no per-project dashboard view or user-built chart widgets. |
| CMP-24 | Rich-text editor (toolbar, undo/redo, slash, versions, outline) | `features/ui/RichEditor.tsx`, `features/work/RichText.tsx`, `rich-text.ts` | Partial. Has bold, italic, underline, strike, code, link, lists, quote, heading, emoji and @mention. Lacks highlight, code block, slash commands, version history and outline. |
| CMP-25 | Files gallery (tiles/list) | Files section in `features/work/TaskDetail.tsx`; `features/ui/FileListInput.tsx` | **New** `FileGallery` (project Files view). |
| CMP-26 | Inbox item (context, actor, like, archive) | `features/shell/NotificationList.tsx`, `NotificationCenter.tsx`, `app/users/work/inbox` | Partial. Archive and bookmark columns exist; no like or task mini-rows. |
| CMP-27 | Task detail pane (440 right pane, `role=dialog`, Esc, full page) | `features/work/TaskPane.tsx`, `TaskDetail.tsx`, `TaskWorkPanel.tsx` | Partial. Is a `role="dialog"`, but a centered `max-w-6xl` modal, not a resizable right-side pane. The full page exists. |
| CMP-28 | Visibility banner ("Visible to members of …") | — (lock icon in grid only) | **New** `VisibilityBanner`. |
| CMP-29 | Project membership block (multi-home, section per project, fields) | `features/work/TaskWorkPanel.tsx` (uses `taskProject` action in `app/users/work/actions.ts`) | Partial. Add/remove project exists; check the per-project section picker and the field group. |
| CMP-30 | Activity feed (Comments / All activity, collapse older) | `features/work/TaskActivity.tsx` (tablist) | Exists. |
| CMP-31 | Reactions toolbar (emoji + count, `aria-pressed`, Reply) | `features/work/CommentThread.tsx` (Heart like, one-level replies) | Partial. Likes only (`work_likes`), no emoji reactions. |
| CMP-32 | Comment composer (sticky, @mention, emoji) | `features/work/CommentThread.tsx` + `features/ui/RichEditor.tsx` | Exists. |
| CMP-33 | Home widget region (draggable layout) | `features/home/MyWorkOverview.tsx`, `HomeClient.tsx`, `app/users/(home)` | Partial. Fixed layout; no add/remove/reorder widgets and no notepad. |
| CMP-34 | Empty state | `EmptyState`/`NoResults` in `features/ui/Display.tsx`; `features/ui/States.tsx` | Exists. |
| CMP-35 | Status button / pill | `features/work/ProjectHeader.tsx` (status Menu with dot) | Exists. |
| CMP-36 | Profile header (photo, pronouns, OOO) | `features/shell/ProfileForms.tsx`, `ProfileTabs.tsx`, `app/users/profile` | Partial. No pronouns or pronunciation; OOO is modelled as delegation. |
| CMP-37 | Data grid (non-task) | `features/ui/DataTable.tsx`, `ClientSortTable.tsx`, `SortTh.tsx`, `TableColumns.tsx`, `PagedRows.tsx`, `.data-table` | Exists. |
| CMP-38 | Toast / live region | `features/ui/Toast.tsx` (`role=status`/`alert`, aria-live, Undo action) | Exists. Add the correlation ID on error toasts (spec §8). |

**Tally:**
- **Exists (14):** 03, 04, 05, 07, 10, 12, 14, 17, 30, 32, 34, 35, 37, 38.
- **New (3):** CMP-01 AppRail, CMP-25 FileGallery, CMP-28 VisibilityBanner.
- **Partial (21):** 02, 06, 08, 09, 11, 13, 15, 16, 18, 19, 20, 21, 22, 23, 24, 26, 27, 29, 31, 33, 36.
- **Also new, but not a CMP ID:** a right-side resizable **DetailPane** shell for CMP-27, and a density toggle (§2.13).

### 2.13 Spec parts without CMP IDs
| Spec part | ARS-CMS | Status |
|---|---|---|
| Split primary button | `.tb-split` class (globals.css), `features/ui/Button.tsx` | Exists |
| Completion check (18 px ring, success fill) | Task status controls in grid and board | Partial (no ring-check component) |
| Priority / field chips (22 px, tinted) | `features/ui/ChoicePill.tsx`, `.st-pill` + `.st-*` tones, `status-tones.ts` | Exists |
| Overdue (danger text + icon) | `TaskMeta` in `features/work/ProjectWorkspace.tsx` | Exists (check the icon redundancy) |
| Skeleton loaders (grid, board, calendar, KPI, inbox) | `features/ui/Skeleton.tsx` (Header/Tiles/List/Table/Chart/Form/Page), `.skeleton` shimmer 1.6 s, reduced-motion off; `BrandLoader`, `Loaders.tsx` | Partial (no board or calendar skeleton) |
| Density toggle (36/30) | — (`TextScale.tsx` scales text only) | **New** |
| Theme toggle | `features/shell/ThemeControls.tsx` | Exists |
| Dialog / modal | `features/ui/Dialog.tsx` (native `<dialog>`), `ConfirmButton.tsx`, `UnsavedGuard.tsx` | Exists |
| Undo toast (~15 s after delete) | `features/ui/Toast.tsx` action (8 s) + `RestoreTaskButton` (`SearchParts.tsx`) | Partial (shorter duration) |
| Bulk select bar | `features/ui/BulkSelect.tsx`, `BulkBar` in `features/work/MoreParts.tsx` | Exists |
| Kanban/Inbox centered 760 feed, date dividers | `NotificationList.tsx` | Partial |
| Dashboard KPI cards + `.sr` data table fallback | `features/analytics/Charts.tsx` (every chart has a table) | Exists |
| Not yet wireframed (spec §9): Files, Messages, Page editor, Portfolios, Goals | — | New (Portfolios, Goals, Messages, Page editor, Files) |

---

## 3. Data model comparison

ARS facts (from `database/migrations/*.sql` and `docs/DATA_MODEL.md`):
- MySQL InnoDB with `BIGINT UNSIGNED AUTO_INCREMENT` IDs. The spec proposes UUIDv7 on PostgreSQL.
- **Multi-tenant: none.** ARS is single-organisation. `organisation` (migration 202609281200) is a singleton. There is no `workspace_id` anywhere. `departments` play the "team" role.
- **Ordering:** fractional `DOUBLE position` columns (midpoint insert), not LexoRank strings. They are on `project_sections.position`, `task_projects.position`, `tasks.subtask_position`, `my_task_sections.position`, `my_task_placements.position`, `project_fields.position` and `work_views.position`. That is functionally the spec's "fractional index". The risk is that DOUBLE precision exhausts after about 50 repeated midpoint splits, so it needs an occasional renormalise.
- **Soft delete:** `deleted_at` (+ `deleted_by` on some) on `tasks`, `projects`, `project_sections`, `project_fields`, `task_comments`, `project_status_updates`, `calendar_items`, `approval_requests`.
- **30-day restore:**
  - It is implemented. See `server/work/service.ts` (`restoreTask`, and `setProjectLifecycle` RESTORE; message "You can restore it for 30 days."), `lib/db/repositories/work.repository.ts:909-919` (a Deleted list filtered to `deleted_at > now-30d`, creator or deleter) and `app/users/work/deleted/page.tsx`.
  - **There is no `purge_after` column and no purge job.** Rows older than 30 days simply drop out of the Deleted list and are never hard-deleted (ARS policy: "never deleted").
- **Optimistic concurrency:** `tasks.row_version`, `projects.row_version`. The spec calls it `version`.
- **History:** `task_events` and `project_events` (append-only, enforced by triggers on task_events), `audit_logs` (append-only), `comment_versions`.

### 3.1 Core entities (DATA_MODEL.md E-01..E-36)
| Spec entity | ARS-CMS table(s) | Status and missing columns |
|---|---|---|
| E-01 User | `users` (+ `user_settings` key/value, `user_sessions`, `user_devices`) | Exists. Missing: multiple emails (`user_email`), pronouns, pronunciation. |
| E-02 Workspace/Organization | `organisation` (singleton), `settings`/`system_settings` | Partial. Single tenant; no `workspace_id` on tables. |
| E-03 Team | `departments` (+ `approver_groups`) | Partial. No visibility (public/request/secret) and no team settings. |
| E-04 WorkspaceMembership | `users` + `user_roles`/`roles` + `users.module_access` SET | Partial. No guest or view-only license, no invited status. |
| E-05 TeamMembership | `users.department_id` (one department per user); `approver_group_members` | Partial. One department only; no team admin or request-to-join. |
| E-06 Project | `projects` | Partial. Has privacy (PRIVATE/DEPARTMENT/ORGANISATION), `default_access_role`, `default_view`, `color`, dates, `current_status`, `completed_at`, `archived_at`, `is_template`/`template_json`, `permissions_json`, `row_version`, soft delete. Missing: `icon`, `team_id` (`department_id` only), `default_view_id` FK, `archived_by`, `purge_after`, `work_days`/`work_hours`, `dependency_shift_mode`, `min_role_*` (partly in `permissions_json`), `email_alias`, `created_from_template_id`, `description_html` (TEXT exists). |
| E-07 ProjectMembership | `project_members` (USER/DEPARTMENT; OWNER/EDITOR/COMMENTER/VIEWER) | Exists. Missing `project_member_pref` (notification prefs) and `project_role_label`. |
| E-08 Section | `project_sections` (DOUBLE position, soft delete); `my_task_sections` (separate table) | Exists. Missing `is_default`/`is_undeletable`. The spec unifies project and My Tasks sections in one table; ARS keeps two. |
| E-09 Task (subtasks, multi-home) | `tasks` (+ `parent_task_id`, `root_task_id`, `depth`, `subtask_position`, `is_milestone`, `recurrence_json`, `series_id`, `starts_on`, `due_at`, `completed_*`, `cancelled_*`, `priority`, `status` ENUM, `type_version_id` → `module_types`, `form_data_json`, `related_request_id`, `ticket_id`, `meeting_id`, `assign_group_id`, `row_version`, soft delete) | Exists, with differences. Missing: `path` (materialised), a depth CHECK ≤ 5 (app-enforced?), `subtype` approval (ARS links approvals via `related_request_id` instead), `due_on` vs `due_at` split, `start_at`, `is_private`, `purge_after`, `source_submission_id`. `assignee_id` is NOT NULL in ARS; the spec allows NULL. |
| E-10 TaskMembership | `task_projects` (task, project, section, DOUBLE position) | Exists. Missing a 20-per-task cap trigger (check the app) and a `deleted_with_project_id` marker. |
| E-11 UserTaskList (My Tasks) | `my_task_sections` + `my_task_placements` | Exists (implicit per user; no `user_task_list` row). |
| E-12 Collaborator/Follower | `task_followers` (source CREATOR/ASSIGNEE/MANUAL/MENTION/COMMENT) | Exists. Missing `project_follower`/`goal_follower`/`tag_follower` and the source values `form`/`email`/`field`. |
| E-13 Assignee | `tasks.assignee_id`, `assigned_by`, `assigned_at`, `assign_group_id` | Exists. |
| E-14 Story (comment + system) | `task_comments` (one-level reply, pinned, edited, soft delete) + `task_events` (system) + `comment_versions` | Partial. Split into two tables; no `source` and no unified `story`. Fine as is. |
| E-15 Attachment | `record_files` (entity TASK/INFO), `request_attachments` | Partial. No `deleted_at` on `record_files`; no external link host; no project-level files. |
| E-16 CustomField | `project_fields` (kind TEXT/NUMBER/SELECT/DATE, `options_json`, position, soft delete) | Partial. Local only (no library/global scope). Missing types multi_select, people, reference, formula, id, timer, lookup; `format`, `precision`, `description`, `privacy`, `notify_on_change`, `id_prefix`/`id_counter`. |
| E-17 CustomFieldSetting | (implicit: `project_fields.project_id`) | Missing: `custom_field_setting` (`is_important`, `show_on_cards`, position per container). Only needed once library fields exist. |
| E-18 EnumOption | `project_fields.options_json` (JSON array; option colours via OPTION_COLORS) | Partial. Not normalised: no stable option IDs, no `enabled`, no per-option position rows. |
| E-19 CustomFieldValue | `task_field_values` (task, field, `value` VARCHAR(500)) | Partial. Untyped string; no `number_value`/`date_value`/`option_id`, no multi or reference tables, no project or portfolio object values. |
| E-20 Tag | `work_tags` + `task_tags` | Exists (unique name, colour). |
| E-21 Dependency | `task_dependencies` (blocker, blocked) | Partial. Missing `type` (fs/ss/ff/sf), `lag_days`, the 30-link cap, and a cycle check (verify in service). |
| E-22 Notification/Inbox | `notifications` (+ `archived_at`, `bookmarked_at`), `notification_deliveries`, `notification_outbox`, `notification_preferences`, `notification_rules` | Exists. Missing `story_id`/`event_id` links (it uses `deep_link`). |
| E-23 ActivityEvent | `task_events`, `project_events`, `approval_events`, `info_events`, `ticket_events`, `audit_logs` | Partial. Per-module event tables, not one `activity_event` outbox with old/new `change` JSON. |
| E-24 StatusUpdate | `project_status_updates` (status, title, body, `snapshot_json`, soft delete) | Partial. Projects only; missing `state` draft/posted, `visibility`, `blocks`, recipients, collaborators and templates. |
| E-25 Goal | — | **Missing** (`goal`). |
| E-26 GoalRelationship | — | **Missing** (`goal_link`). |
| E-27 Portfolio | — | **Missing** (`portfolio`). |
| E-28 PortfolioMembership | — | **Missing** (`portfolio_member`, `portfolio_item`). |
| E-29 Rule/Automation | `notification_rules` (+ `condition_rules`), `alert_rules`, `job_runs` | Partial (notification rules only). **Missing** project automations: `automation`, `automation_trigger`, `automation_step`, `automation_path(_condition)`, `automation_run(_step)`. |
| E-30 Form + FormSubmission | `module_types` + `module_type_versions` (`form_json`, versioned), `request_templates`, `workflow_versions.form_json`, `tickets` intake (`ticket_request_types`) | Partial. A versioned form engine exists for approvals, tasks and tickets, but there are **no project intake forms**. Missing `form`, `form_version` (could reuse the module_type_versions pattern), `form_question`, `form_question_option`, `form_branch_rule`, `form_field_mapping`, `form_submission(_answer/_attachment)`, `form_star`, `form_recent`, `tasks.source_submission_id`. |
| E-31 Webhook subscription | — (inbound only: `app/api/webhooks/ceoitbox`, `google-calendar`) | **Missing** (outbound `webhook`, `webhook_delivery`). |
| E-32 Integration/App | `gcal_*`, `ai_salesforce_connection`, `whatsapp_templates` | Partial (fixed integrations; no app registry or `authorized_app`). |
| E-33 Like/Reaction | `work_likes` (TASK/COMMENT/STATUS) | Partial (no `emoji` column). |
| E-34 ProjectTemplate | `projects.is_template` + `template_json`; `approval_templates`/`request_templates` | Partial (template is a flagged project, not versioned). |
| E-35 TaskTemplate | `module_types` (task kinds, `form_json`, settings) | Partial. |
| E-36 SavedView/Tab | `work_views` (scope MY_TASKS/PROJECT, name, `config_json`, position); `saved_views` (requests); `analytics_views` | Partial. Missing `layout` per view (layout lives in `projects.default_view` and tabs are fixed), `owner_user_id` NULL = shared, `is_default`, `icon`, the 50 cap, and `view_user_state`. |

### 3.2 Module "Proposed CMS schema" tables (12-modules)
| Module table | ARS-CMS | Status |
|---|---|---|
| **HOME:** `home_layout`, `home_widget`, `home_notepad` | — (fixed Home; `user_settings` k/v) | Missing |
| HOME: `recommendation_dismissal` | `user_flags` (generic) could hold it | Partial |
| HOME: `user_activity_daily` (rollup) | computed live in `server/work/*`, `server/analytics` | Missing (no rollup table) |
| **NAV:** `user_profile` | `users` (+ profile pages) | Partial |
| NAV: `user_email` | — | Missing |
| NAV: `user_preferences` | `user_settings` (k/v: theme, text scale, etc.) | Partial (k/v instead of columns; fine) |
| NAV: `navigation_config`, `sidebar_section`, `sidebar_item` | — | Missing |
| NAV: `favorite` | `work_favourites` (PROJECT/SEARCH) | Partial (no position; limited types) |
| NAV: `recent_item` | `work_recent_projects`, `recent_views` (requests) | Partial |
| NAV: `notification_preference` | `notification_preferences` (EMAIL/WHATSAPP × event_group) | Exists (channels differ) |
| NAV: `container_notification_default` | — | Missing |
| NAV: `dnd_schedule` | — | Missing |
| NAV: `ooo_entry` | `delegations` (date-ranged handover) | Partial |
| NAV: `authorized_app` | — | Missing |
| NAV: `user_session` | `user_sessions` (+ sign out everywhere) | Exists |
| **PORTFOLIOS:** `portfolio`, `portfolio_item`, `portfolio_member`, `project_access_link`, `item_rollup`, `access_request`, `portfolio_goal_link` | — | Missing (all 7) |
| PORTFOLIOS: `custom_field_setting` rollups, `custom_field_value` on projects | — | Missing |
| **PROJECTS:** `project` additions | `projects` | Partial (see E-06) |
| PROJECTS: `project_role_label`, `project_member_pref`, `project_field_restriction` | `projects.permissions_json` covers some restrictions | Missing / partial |
| PROJECTS: `saved_view` layout additions, `view_user_state` | `work_views` | Partial / missing |
| PROJECTS: `section.is_default` | `project_sections` | Partial |
| PROJECTS: `key_resource`, `project_brief` | — | Missing |
| PROJECTS: `project_public_link`, `calendar_feed` | — (`gcal_*` is Google sync, not an iCal feed) | Missing |
| PROJECTS: `export_job` / `import_job` | `export_jobs` (report exports), import via `app/admin/import` | Partial (not project-scoped) |
| PROJECTS: `duplicate_job` | — (templates are copied synchronously) | Missing |
| PROJECTS: `status_update` extensions, `status_update_recipient/collaborator`, `project_status_template` | `project_status_updates` | Partial / missing |
| PROJECTS: `dashboard_widget` | — (`analytics_views` saves analytics filters only) | Missing |
| **CUSTOMIZATION:** `custom_field` extended columns | `project_fields` | Partial (see E-16) |
| CUSTOMIZATION: `custom_field_option`, `custom_field_setting`, `custom_field_access` | — (JSON options) | Missing |
| CUSTOMIZATION: `timer_run` | — | Missing |
| CUSTOMIZATION: `task_type`, `task_type_status`, `project_task_type` | `module_types` (TASK kinds) + fixed `tasks.status` ENUM | Partial (no custom statuses) |
| CUSTOMIZATION: `project_email_address` | — | Missing |
| CUSTOMIZATION: `automation*` (8 tables) | — | Missing |
| **FORMS:** `form` … `form_recent` (11 tables) + `tasks.source_submission_id` | Form engine pattern in `module_types`/`module_type_versions`; `request_drafts`; `rate_limit_hits` (public rate limiting) | Missing as project forms. Reuse the versioning pattern. |

**Entity tally (36 core):** Exists **10**, Partial **20**, Missing **6**.
- **Exists (10):** E-01, E-07, E-08, E-09, E-10, E-11, E-12, E-13, E-20, E-22.
- **Missing (6):** E-17 CustomFieldSetting, E-25 Goal, E-26 GoalRelationship, E-27 Portfolio, E-28 PortfolioMembership, E-31 Webhook.
- **Partial (20):** the rest. E-29 counts as partial: notification rules exist, but project automations are missing.

**Module tables:** about 60 proposed. About 8 exist or are equivalent, about 15 are partial and about 37 are missing. The missing ones are mostly Portfolios, Forms, Automation, Home layout and Navigation config.

### 3.3 Cross-cutting differences
| Topic | Spec | ARS-CMS |
|---|---|---|
| Tenant | `workspace_id` leads every index | None (single org). Recommend keeping it that way. |
| IDs | UUIDv7 opaque strings | BIGINT auto-increment; human numbers (`task_no`) |
| Ordering | Fractional-index string (LexoRank) | DOUBLE fractional positions (needs renormalisation) |
| Soft delete | `deleted_at`, `deleted_by`, `purge_after` + daily purge job | `deleted_at` (+ `deleted_by`), a 30-day restore window in queries, **no purge** |
| Concurrency | `version` | `row_version` (tasks, projects) |
| Events | One `activity_event` outbox feeds stories, notifications, webhooks and sync | Per-module `*_events` + `notification_outbox` + `audit_logs` |
| Custom-field values | Typed EAV | VARCHAR(500) single column |
| Statuses | Completion + custom task-type statuses | Fixed ENUM OPEN/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED |
| Full text | tsvector / external search | None (LIKE queries) |

---

## 4. Gap infrastructure

| Capability | Present? | Evidence |
|---|---|---|
| Realtime (WebSocket/SSE) | **No** | No `EventSource`, `text/event-stream`, `WebSocket` or socket.io in `app/`, `server/`, `features/`, `lib/`. Freshness comes from polling with `router.refresh()`: `useAutoRefresh(30 s)` in `features/work/ProjectWorkspace.tsx:849`, `QuietRefresh(60 s)` in `features/home/HomeClient.tsx:186`, NotificationBell. Web push (`web-push`, `firebase`) handles notifications only. |
| Charting library | **No** (hand-rolled) | `features/analytics/Charts.tsx`: plain SVG and HTML server components with table fallbacks; `WorkloadChart` in HomeClient. No chart dependency in package.json. If one is needed, the policy allows Apache ECharts (Apache-2.0). |
| List virtualization | **No** | No virtualization dependency (spec wants TanStack Virtual, ADR-013). No virtual, IntersectionObserver or content-visibility use. Tables page instead (`PagedRows.tsx`, `Pagination`). |
| Drag and drop library | **No** (native HTML5 DnD) | `draggable`/`dataTransfer` in `ProjectWorkspace.tsx`, `TaskGrid.tsx`, `MyTasks.tsx`, `TaskCalendar.tsx`, `ColumnResizer.tsx`, `features/admin/FormFieldsEditor.tsx`, `WorkflowBuilder.tsx`, `features/requests/ReorderHeader.tsx`. Keyboard alternative is Alt+↑/↓ with an aria-live announcement. No touch DnD; the spec's Space-lift model is absent. |
| Scheduler / job runner | **Yes** (cron-driven) | `app/api/jobs/run/route.ts`: cPanel cron every 5 min POSTs with `x-job-secret` → `runAutomations` (`server/ops/automation.ts`). DB lock per run; `jobs` table (PENDING/RUNNING/DONE/FAILED, `run_after`, attempts), `job_runs`, `server/jobs/*` (sla, delegations, retry-deliveries), `notification_outbox` with claim tokens. Granularity is 5 min and there is no event-driven worker, which is enough for reminders and purge but not for low-latency automations. |
| Search | **Partial** | `features/shell/CommandPalette.tsx` + `server/search/filters.ts` + `app/users/work/search`, `work_saved_searches`. SQL `LIKE` queries; **no FULLTEXT index** in migrations and no external engine. |
| Rich text | Yes (custom) | `features/ui/RichEditor.tsx`: contentEditable with its own serialisation; no editor library. |
| Purge job for 30-day trash | **No** | Restore window only (`work.repository.ts:909-919`). |
| Exports | Yes | `export_jobs` (csv/xlsx/pdf), `pdf-lib`. |
| Email / WhatsApp / push | Yes | nodemailer, WhatsApp templates, web-push. |

**Infrastructure gaps to plan for, in priority order:**
1. List virtualization (large projects).
2. Realtime channel (SSE is simplest on Next 15 / cPanel; WebSockets may not be allowed on the host).
3. Full-text search (MySQL `FULLTEXT` on `tasks.title`/`description`, `projects.name` and comments).
4. Accessible drag-and-drop with the Space-lift keyboard model. A library such as dnd-kit (MIT) is an option, as is extending the native setup.
5. A purge job for trash after 30 days, if the owner wants Asana-style purge. ARS policy is "never deleted".
6. An event outbox for automations, beyond the 5-minute cron.
7. Optionally, a chart library for user-built dashboard widgets.
