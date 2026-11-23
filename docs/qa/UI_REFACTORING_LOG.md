# UI refactoring log (v1.89.0 stage 3, UI unification)

**Started:** 24 Nov 2026, branch `release-189`. One release v1.89.0 (owner); no version bump until the last stage. Defect rows are in [BUG_FIX_LOG.md](BUG_FIX_LOG.md); the adopted tokens in [GLOBAL_DESIGN_SYSTEM.md](GLOBAL_DESIGN_SYSTEM.md); the shell in [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md).

## Stage 3a: batch 0 (P1 hotfix) and batch 1 (shell and tokens), D-421

**Decision:** the owner's reference dimensions are adopted as tokens ("go ahead with your recommendations"), answering Q-UI-1, Q-UI-2, Q-UI-4 and Q-UI-6 of the design-system proposal. Q-UI-3 (Classic): keep as it is for now. Q-UI-5 (motion) was D-420.

### Tokens (one place)

`styles/globals.css` `:root` holds the values; a `@media (max-width: 767.98px)` block switches the phone ones; `tailwind.config.ts` maps every one to a class (no shell number in a component).

| Token | Value | Tailwind | Was |
|---|---|---|---|
| `--header-h` / `--header-h-mobile` | 64 / 56 (below 768, every area) | `h-topbar`, `min-h-topbar` | 64 (`spacing.topbar: 64px`); users phone 56 by its own class, panels on phones 64 |
| `--sidebar-w` / `--sidebar-w-rail` | 250 / 72 | `w-sidebar`, `w-rail` | 220 / 80 (`w-20`) |
| `--page-px` | 24 (16 below 768) | `px-page` | content 32 from 640, header 24 from 640; 16 / 12 on phones |
| `--page-pt` | 24 (16 below 768) | `pt-page` | 40 from 640, 24 panels on phones, 16 users phone |
| `--section-gap` | 24 (16 below 768) | `mb-section`, `gap-section` | PageHeader `mb-6` |
| `--content-max` / `-reading` / `-form` | 1600 / 896 / 960 | `max-w-content`, `max-w-reading`, `max-w-form` | `max-w-7xl` (1280) centred |
| `--control-h-sm / -md / -lg` | 32 / 40 / 48 | `h-control-sm/-md/-lg` | buttons 28 / 36 / 46 |
| `--input-h` / `--input-h-sm` | 42 / 32 | `h-input`, `h-input-sm` | 44 / 36 |
| `--touch-min` | 44 | `min-h-touch` | 44 (2 classes only) |
| `--text-page-title` / `--text-section` / `--text-body` | 24 / 18 / 14 | `text-page-title`, `text-section` (`text-body` as before) | title 20 |
| `--radius-control / -card / -popover / -modal / -pill` | 8 / 12 / 12 / 16 / 9999 | `rounded-md/-lg/-xl` read them; `rounded-control/-card/-popover/-modal` | same values, now tokens |
| `--space-1 … --space-12` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | Tailwind's `1 2 3 4 5 6 8 10 12` | (the scale written down; enforcement: batch 2) |

### Applied in this batch

| Area | Change | Files |
|---|---|---|
| PageHeader (P1) | `min-w-0` path, wrapping title row, `overflow-wrap:anywhere`; title `text-page-title` (24); margin `mb-section` | `features/shell/PageHeader.tsx` |
| Long words | `main { overflow-wrap: anywhere }`, tables keep `break-word` | `styles/globals.css` |
| Custom h1s on `text-title` (23 h1s in 19 files: not-found / error / no-access / switched-off pages, people card, overview header, My Tasks, project and portfolio headers and wizards, form fill) | → `text-page-title` (24), so every page title using the shared size is 24. The Classic screens' title keeps its Classic style. Other h1 styles (`greeting` 28, `display` 32, `.mob-screen-title` 22 / 800, sr-only) are batch 2 (PageHeader everywhere). | 19 files under `app/` and `features/` |
| Header | `h-topbar` (64 / 56) and `px-page` in both the desktop header and the users phone bar (12 → 16) | `features/shell/AppShell.tsx` |
| Sidebar | `w-sidebar` 250 / `w-rail` 72; icons centred in the rail (nav `items-center`, items full width); tooltips and labels unchanged; tablet rail by default (below) | `features/shell/SidebarFrame.tsx`, `features/shell/sidebar-cookie.ts`, `features/shell/AppShell.tsx` |
| Content | `w-full max-w-content px-page pt-page`, left-aligned (no `mx-auto`); Classic keeps `mx-auto max-w-7xl px-4 pt-6 sm:px-8 sm:pt-10` | `features/shell/AppShell.tsx` |
| Banners (maintenance, try-as, demo) | `px-page` (were 16 / 32), on the header's line | `features/shell/AppShell.tsx` |
| Offsets that assumed 56 / 64 | `var(--header-h)`: phone task bar, bell panel on phones, phone skeleton, `.request-sticky`, toasts | `TaskDetail.tsx`, `NotificationBell.tsx`, `NavigationProgress.tsx`, `globals.css`, `Toast.tsx` |
| Controls | `btn-primary/-secondary/-danger/-danger-quiet` 46 → 40; `btn-compact`, `btn-ghost`, `tb-btn`, `tb-split` → 32; `pill-select` 32; `field-input` 44 → 42; `field-compact` 36 → 32; new `btn-lg` 48; size modifiers after the variants; touch rule for every named class | `styles/globals.css` |
| Button primitive | `size` = `sm` / `md` / `lg` (`btn-compact` / default / `btn-lg`) | `features/ui/Button.tsx` |
| Public pages | header `h-topbar` + `px-page`; text `max-w-reading` (896), top `pt-page` | `features/public/PublicPage.tsx` |
| Help | reading width `max-w-reading` | `app/users/help/page.tsx` |

### Tablet sidebar (768-1279)

- **Saved choice wins.** `ars_sidebar` = `rail` / `open` is written only by ☰ (as since D-229).
- **No choice:** the frame follows the window (`matchMedia` 768-1279.98 → rail, else open) and writes `ars_vw` = `tablet` / `wide` so the server's next page starts the same (no jump). On a device's very first page the server can't know the width yet: the frame then draws both the rail and the open sidebar and CSS shows the right one at the first paint (rail below 1280, open from 1280), so nothing moves; the effect then keeps one. (A first version folded on hydration and the sweep measured a layout shift of 0.16-0.49 on the first page at 1024; fixed before commit, e2e guard.) Named in the privacy policy (cookies paragraph; effective date 24 Nov 2026).

### One shell for /users, /admin, /superadmin

All three render `features/shell/AppShell.tsx` (`area` prop) with the same `SidebarFrame`, header and `main`. The remaining differences were the phone header (56 users phone layout vs 64 panels) and the phone padding / top (16 / 16 vs 16 / 24); both now come from the phone tokens. Differences kept on purpose: the users phone layout's own top bar (mark, search link, bell, account) and tab bar (v1.43.0); the panels' MobileNav sheet, Settings search and "Back to the app"; the users area's larger bottom padding for its bottom navigation.

### Not changed in this batch (by decision)

- **Classic view:** untouched (owner): its centred box, title bar and Tally overrides stay; its field height override (36) stays. It inherits only the shared button heights (40) and the touch rule.
- **No element hidden, no feature removed, no business logic changed.**
- **Full-width `btn-primary` default (CON-13):** the token is defined (`btn-lg`, sizes) but making `w-auto` the default changes 30+ forms; it goes with the batch 2 control sweep.

### Measured geometry

See [SCREEN_LAYOUT_STANDARD.md §2](SCREEN_LAYOUT_STANDARD.md) (before and after per viewport) and the sweep notes there.

### For batch 2 (shared components sweep)

1. Remove the page-level `h-*` overrides beside `field-input` (48 files) and `btn-compact` (19 files) so every control measures the named sizes (CON-05, CON-06); lint against `h-*` next to those classes.
2. `btn-*` `w-auto` by default, `btn-block` opt-in (CON-13).
3. PageHeader on every page (custom h1s: phone `.mob-screen-title` 22 / 800, task phone title `greeting` 28, New project wizard `display` 32, AI assistant sr-only, phone Home without h1; CON-03, CON-04, RESP-04, A11Y-02); a phone title token (22 / 700).
4. `text-section` (18) for page section h2s (CON-02: 14 / 16 / 17 / 19 / 20 today).
5. Touch: TaskGrid inline selects / inputs and round task checks under 44 (RESP-05 rest).
6. Narrow forms: give long single-column forms `max-w-form` (960) where they now stretch to the fluid width (they had 1280 before); data pages keep the full width.
7. ListPage / DataTable / Dialog / Popover / Avatar / StatePage, per the defect report's batch 2.
8. Spacing scale lint (no 6 / 10 px outside controls, no arbitrary `-[Npx]`).
9. Retire `text-title` (20; 29 non-h1 uses left), `card-title`, `greeting` after the sweep.
