"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/features/ui/Dialog";
import { Progress } from "@/features/ui/Display";
import { LiveNumber } from "@/features/ui/LiveNumber";
import { useToast } from "@/features/ui/Toast";
import { MOTION_DELAY, MOTION_DURATION, MOTION_EASE, MOTION_ROLE, type MotionEase, type MotionToken } from "@/features/ui/motion";

// v1.89.0 (D-420): the Motion Playground (/superadmin/dev/motion, Super Admin
// only, not linked). Every value comes from the one source: the CSS variables
// (drawn here) and their TS mirror features/ui/motion.ts (listed here), and
// each row shows both, so a drift is visible at a glance (a unit test fails
// on it too). "Reduce motion" applies the app's reduced-motion rule to this
// page only; "Slow motion" multiplies every token by 5 on this page only (it
// redefines the CSS variables on the wrapper: proof that nothing is hard-coded).

const TOKENS = Object.keys(MOTION_DURATION) as MotionToken[];
const EASES = (Object.keys(MOTION_EASE) as MotionEase[]).filter((name) => name !== "linear");

function cssValue(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function MotionPlayground() {
  const [reduce, setReduce] = useState(false);
  const [slow, setSlow] = useState(false);
  const [moved, setMoved] = useState(false);
  const [round, setRound] = useState(0);
  const [css, setCss] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<"dialog" | "drawer" | null>(null);
  const [menu, setMenu] = useState(false);
  const [count, setCount] = useState(12);
  const [progress, setProgress] = useState(30);
  const [loaded, setLoaded] = useState(true);
  const [folded, setFolded] = useState(true);
  const toast = useToast();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read: Record<string, string> = {};
    for (const token of TOKENS) read[`--motion-${token}`] = cssValue(`--motion-${token}`);
    for (const ease of EASES) read[`--ease-${ease}`] = cssValue(`--ease-${ease}`);
    setCss(read);
  }, []);

  // Slow motion: the same tokens, five times longer, on this page only.
  const style = slow ? (Object.fromEntries(TOKENS.map((token) => [`--motion-${token}`, `${MOTION_DURATION[token] * 5}ms`])) as React.CSSProperties) : undefined;
  const play = () => {
    setMoved((value) => !value);
    setRound((value) => value + 1);
  };

  return (
    <div ref={wrapper} className="motion-lab space-y-8" style={style} data-reduce-motion={reduce ? "" : undefined} data-testid="motion-playground">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-3" role="group" aria-label="Playground controls">
        <button type="button" className="btn-primary btn-compact" onClick={play} data-testid="lab-play">
          Play all
        </button>
        <label className="flex items-center gap-2 text-label">
          <input type="checkbox" checked={reduce} onChange={(event) => setReduce(event.target.checked)} data-testid="lab-reduce" /> Reduce motion (this page)
        </label>
        <label className="flex items-center gap-2 text-label">
          <input type="checkbox" checked={slow} onChange={(event) => setSlow(event.target.checked)} data-testid="lab-slow" /> Slow motion × 5
        </label>
        <span className="text-caption text-ink-muted">The browser setting “reduce motion” applies everywhere, whatever this box says.</span>
      </div>

      <section aria-labelledby="lab-durations">
        <h2 id="lab-durations" className="mb-3 text-section font-semibold">Durations</h2>
        <table className="w-full text-label" data-testid="lab-durations">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 pr-3">Token</th>
              <th className="py-1 pr-3">CSS</th>
              <th className="py-1 pr-3">TS mirror</th>
              <th className="w-1/2 py-1">Live (standard easing)</th>
            </tr>
          </thead>
          <tbody>
            {TOKENS.map((token) => (
              <tr key={token} className="border-t border-line">
                <td className="py-2 pr-3 font-mono">--motion-{token}</td>
                <td className="py-2 pr-3 font-mono" data-testid={`lab-css-${token}`}>
                  {css[`--motion-${token}`] ?? ""}
                </td>
                <td className="py-2 pr-3 font-mono" data-testid={`lab-ts-${token}`}>
                  {MOTION_DURATION[token]}ms
                </td>
                <td className="py-2">
                  <Track duration={`var(--motion-${token})`} ease="var(--ease-standard)" moved={moved} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="lab-easings">
        <h2 id="lab-easings" className="mb-3 text-section font-semibold">Easings (emphasis 300 ms)</h2>
        <ul className="space-y-3">
          {EASES.map((ease) => (
            <li key={ease} className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center">
              <span className="font-mono text-label">
                --ease-{ease} <span className="text-ink-muted">{css[`--ease-${ease}`] || MOTION_EASE[ease]}</span>
              </span>
              <Track duration="var(--motion-emphasis)" ease={`var(--ease-${ease})`} moved={moved} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="lab-roles">
        <h2 id="lab-roles" className="mb-3 text-section font-semibold">Roles</h2>
        <ul className="grid gap-x-6 gap-y-1 text-label sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(MOTION_ROLE).map(([role, token]) => (
            <li key={role} className="flex justify-between gap-3 border-b border-line py-1">
              <span>{role}</span>
              <span className="font-mono text-ink-muted">
                {token} · {MOTION_DURATION[token]} ms
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-ink-muted">
          Delays: tooltip {MOTION_DELAY.tooltip} ms · loader {MOTION_DELAY.loader} ms · slow page (no transition) {MOTION_DELAY.slowPage} ms · stagger step {MOTION_DELAY.staggerStep} ms · row highlight {MOTION_DELAY.highlight} ms.
        </p>
      </section>

      <section aria-labelledby="lab-patterns">
        <h2 id="lab-patterns" className="mb-3 text-section font-semibold">Patterns</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Modal (smooth in, fast out)">
            <button type="button" className="btn-secondary btn-compact" onClick={() => setDialog("dialog")} data-testid="lab-open-dialog">
              Open dialog
            </button>
          </Card>
          <Card title="Drawer (smooth in, fast out)">
            <button type="button" className="btn-secondary btn-compact" onClick={() => setDialog("drawer")}>
              Open drawer
            </button>
          </Card>
          <Card title="Dropdown (fast, enter easing)">
            <div className="relative">
              <button type="button" className="btn-secondary btn-compact" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
                Menu
              </button>
              {menu && (
                <ul key={round} className="menu-pop absolute left-0 top-full z-popover mt-1 w-40 rounded-lg border border-line bg-raised p-1 shadow-overlay">
                  {["First", "Second", "Third"].map((item) => (
                    <li key={item} className="rounded px-2 py-1 hover:bg-surface-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card title="Toast (standard in, fast out)">
            <button type="button" className="btn-secondary btn-compact" onClick={() => toast({ tone: "info", title: "A toast", body: "It leaves by itself after 5 seconds.", durationMs: 5000 })}>
              Show toast
            </button>
          </Card>
          <Card title="Changed figure (emphasis)">
            <div className="flex items-center gap-3">
              <LiveNumber value={count} className="text-title font-bold tabular-nums" testId="lab-number" />
              <button type="button" className="btn-secondary btn-compact" onClick={() => setCount((value) => value + 1)}>
                +1
              </button>
            </div>
          </Card>
          <Card title="Progress (transform, emphasis)">
            <Progress value={progress} max={100} label="Playground progress" />
            <button type="button" className="btn-ghost btn-compact mt-2" onClick={() => setProgress((value) => (value + 35) % 100)}>
              Change
            </button>
          </Card>
          <Card title="Page transition (standard, enter: fade + 4 px rise)">
            <div key={round} className="lab-page-in rounded-md border border-line bg-surface p-3 text-label">
              The new page fades in and rises 4 px; the old one fades out (fast, exit).
            </div>
          </Card>
          <Card title="Popover (pop-in, fast)">
            <div key={round} className="pop-in rounded-md border border-line bg-raised p-3 text-label shadow-overlay">
              A popover panel
            </div>
          </Card>
          <Card title="New items (stagger, 30 ms steps)">
            <ul key={round} className="motion-stagger space-y-1 text-label">
              {["One", "Two", "Three", "Four"].map((item) => (
                <li key={item} className="rounded border border-line px-2 py-1">
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Fold reveal (fast, rows only; never a height)">
            <button type="button" className="btn-ghost btn-compact" aria-expanded={!folded} onClick={() => setFolded((value) => !value)}>
              {folded ? "Open the group" : "Fold the group"}
            </button>
            {!folded && (
              <div data-revealed="">
                <ul className="mt-1 space-y-1 text-label">
                  {["Row 1", "Row 2", "Row 3"].map((row) => (
                    <li key={row} className="rounded border border-line px-2 py-1">
                      {row}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <Card title="Skeleton → content (fast fade)">
            <button type="button" className="btn-ghost btn-compact" onClick={() => setLoaded((value) => !value)}>
              {loaded ? "Show the skeleton" : "Show the content"}
            </button>
            {loaded ? (
              <p className="motion-fade-in mt-2 text-label">The content, faded in.</p>
            ) : (
              <span className="skeleton mt-2 block h-5 w-2/3 rounded" />
            )}
          </Card>
          <Card title="Hover and press (instant)">
            <div className="flex gap-2">
              <button type="button" className="btn-primary btn-compact">
                Press me
              </button>
              <button type="button" className="btn-ghost btn-compact">
                Hover me
              </button>
            </div>
          </Card>
        </div>
      </section>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog === "drawer" ? "A drawer" : "A dialog"} variant={dialog ?? "dialog"} testId="lab-dialog">
        <p className="text-body">Opacity and transform only. Escape closes it.</p>
      </Dialog>
    </div>
  );
}

function Track({ duration, ease, moved }: { duration: string; ease: string; moved: boolean }) {
  return (
    <span className="relative block h-3 rounded-full bg-surface-muted" aria-hidden="true">
      <span
        className="lab-dot absolute left-0 top-0 h-3 w-3 rounded-full bg-primary-600"
        style={{ transitionProperty: "transform", transitionDuration: duration, transitionTimingFunction: ease, transform: moved ? "translateX(calc(var(--lab-run, 16rem)))" : "none" }}
      />
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised p-4">
      <h3 className="mb-2 text-label font-semibold">{title}</h3>
      {children}
    </div>
  );
}
