# Global motion tokens (v1.89.0, D-420)

**Source of truth:** `styles/globals.css`, `:root` ("motion scale" block). **TS mirror:** `features/ui/motion.ts` (`MOTION_DURATION`, `MOTION_EASE`, `MOTION_DELAY`, `MOTION_ROLE`, `motionMs`, `afterMotion`, `prefersReducedMotion`, `scrollBehavior`). `features/shell/motion-rules.ts` re-exports the same objects for older imports.
**Guard:** `tests/ui/motion-tokens-v189.test.ts` fails when CSS and TS differ, when a retired name or a literal duration / easing appears in interface code, when width / height / top / left are animated, or when smooth scrolling ignores reduced motion.
**Live view:** the Motion Playground, `/superadmin/dev/motion` (Super Admin only, not linked).

D-420 supersedes the D-417 (v1.87.0) values.

## Durations

| Token | CSS variable | Tailwind | Value | Used for |
|---|---|---|---|---|
| instant | `--motion-instant` | `duration-instant` | **100 ms** | hover, press, colour changes, the reduced-motion fade |
| fast | `--motion-fast` | `duration-fast` (also the bare `transition` DEFAULT) | **150 ms** | dropdowns, menus, popovers, tooltips, every exit, the old page fading out |
| standard | `--motion-standard` | `duration-standard` | **200 ms** | page transition (new page), toasts in, new items, sidebar labels, the nav indicator |
| smooth | `--motion-smooth` | `duration-smooth` | **250 ms** | modals and drawers in, the task / record pane, bottom sheets, Pico Bot's panel, the title morph |
| emphasis | `--motion-emphasis` | `duration-emphasis` | **300 ms** | a changed figure (LiveNumber), progress bars, the sign-in screen, the "next" highlight |

## Easings

| Token | CSS variable | Tailwind | Value | Used for |
|---|---|---|---|---|
| standard | `--ease-standard` | `ease-standard` (also the DEFAULT) | `cubic-bezier(0.2, 0, 0, 1)` | moves within the screen, colour changes |
| enter | `--ease-enter` | `ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | things appearing |
| exit | `--ease-exit` | `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | things leaving |
| linear | `--ease-linear` | `ease-linear` | `linear` | opacity-only fades (backdrops) |

`--ease-out` stays as an alias of `--ease-enter` (v1.80 name); app CSS no longer uses it.

## Roles (CSS role variables = `MOTION_ROLE`)

| Role | CSS | Token | ms |
|---|---|---|---|
| hover / press | `--motion-hover` | instant | 100 |
| dropdown / menu | `--motion-menu` | fast | 150 |
| modal in | `--motion-dialog-in` | smooth | 250 |
| modal / drawer out | `--motion-dialog-out` | fast | 150 |
| drawer / pane / sheet in | `--motion-drawer` | smooth | 250 |
| page (new) | `--motion-page` | standard | 200 |
| page (old) | `--motion-page-out` | fast | 150 |
| toast in / out | — | standard / fast | 200 / 150 |
| emphasis, hero | — | emphasis | 300 |
| reduced motion (the longest fade) | `--motion-reduced` | instant | 100 |

## Delays (not durations)

| Name | CSS | TS | Value |
|---|---|---|---|
| tooltip | `--motion-delay-tooltip` | `MOTION_DELAY.tooltip` | 300 ms |
| loader / skeleton / progress bar | `--motion-delay-loader` | `MOTION_DELAY.loader` | 150 ms |
| slow page (no page transition) | — | `MOTION_DELAY.slowPage` | 300 ms |
| stagger step | `--motion-stagger-step` | `MOTION_DELAY.staggerStep` | 30 ms |
| row highlight | — | `MOTION_DELAY.highlight` | 1600 ms |

## Distances

`--motion-distance-1…6` = 2 / 4 / 8 / 16 / 24 / 32 px (`MOTION_DISTANCE`). The page rise and menus use 4 px; drawers and panes 16 px; toasts 8 px in, 4 px out.

## Retired (D-420)

| v1.87 name | Was | Now |
|---|---|---|
| `--motion-base` / `duration-base` | 220 ms | `--motion-standard` 200 (or the role: dialog in → smooth 250) |
| `--motion-moderate` / `duration-moderate` | 280 ms | `--motion-smooth` 250 |
| `--motion-slow` / `duration-slow` | 350 ms | `--motion-emphasis` 300 |
| `--motion-slower` / `duration-slower` | 450 ms | `--motion-emphasis` 300 |
| `--t-check` / `--t-fill` / `--t-pop` | 160 / 120 / 200 ms (private) | aliases of fast / instant / standard |
| PicBot overshoot `cubic-bezier(0.2,0.9,0.3,1.05)` + radius animation | — | smooth + enter in, fast + exit out; radius not animated |

**Why the old names were removed and not kept as aliases:** 37 uses in 14 files, all mechanical to replace; keeping aliases would have kept two sets of names and the guard test could not tell a new use from an old one. Nothing outside this repository reads them.

## Documented exceptions (own timings, not interface motion)

- **Loops:** the brand loaders (`brand-*`, 1–1.6 s), `.loader-bar` (1.1 s), the skeleton shimmer (1.6 s), `animate-spin`. They are loops, not transitions; reduced motion stops them.
- **The approval journey** (owner feature D-273, `features/journey`, `jr-*`): a scene animation with its own pacing (0.35–3 s). Since v1.89.0 its vans and green fill move by transform (they moved by `left` / `width`). Reduced motion stops it.
- **The celebration burst** (`celebrate.tsx`): WAAPI, durations from the tokens (2 × emphasis + jitter), enter easing; off with reduced motion.
- **Debounces and blur delays** (search 250 ms, blur 150 ms): input timing, not motion.
- **Safety caps** (`top-layer.ts` 2 s, `pane-close.ts` emphasis): the longest wait for an exit that never reports its end.

## Reduced motion

1. The global rule (top of globals.css): every CSS animation and transition is 0.01 ms.
2. Each shared class and overlay has its own `prefers-reduced-motion: reduce` block: nothing moves; dialogs keep a fade of `--motion-reduced` (100 ms).
3. Code: `prefersReducedMotion()`, `motionMs(role, reduced)` (0 ms), `afterMotion()` (runs at once), `scrollBehavior()` ("auto"). Page transitions don't start at all.
