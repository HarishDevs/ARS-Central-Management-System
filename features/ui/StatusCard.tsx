import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from "lucide-react";

// v1.84.0 (D-411, owner's Admin and Super Admin redesign): one status card
// for a provider, job, backup or delivery. The state is never told by colour
// alone: an icon and a word ("OK", "Warning", "Failed", "Not set up") come
// with it, then when it was last checked and a Test (or Open) action.
// Structure after the Astryx incident-console status tiles (MIT, reference
// only; our own markup and ARS tokens).
export type Health = "OK" | "WARNING" | "FAILED" | "OFF";

export const HEALTH_WORD: Record<Health, string> = { OK: "OK", WARNING: "Warning", FAILED: "Failed", OFF: "Not set up" };
const HEALTH_CLASS: Record<Health, string> = {
  OK: "bg-success-50 text-success-600",
  WARNING: "bg-warning-50 text-warning-600",
  FAILED: "bg-danger-50 text-danger-600",
  OFF: "bg-surface-muted text-ink-muted",
};
const EDGE: Record<Health, string> = { OK: "border-l-success-600", WARNING: "border-l-warning-600", FAILED: "border-l-danger-600", OFF: "border-l-line" };

export function HealthIcon({ health, className = "h-4 w-4" }: { health: Health; className?: string }) {
  const Icon = health === "OK" ? CheckCircle2 : health === "WARNING" ? AlertTriangle : health === "FAILED" ? XCircle : CircleSlash;
  return <Icon aria-hidden="true" className={`shrink-0 ${className}`} />;
}

export function HealthBadge({ health, label }: { health: Health; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${HEALTH_CLASS[health]}`} data-health={health}>
      <HealthIcon health={health} className="h-3.5 w-3.5" />
      {label ?? HEALTH_WORD[health]}
    </span>
  );
}

export interface StatusCardProps {
  title: string;
  health: Health;
  // One plain sentence: what the state means.
  detail: string;
  // "Checked 23 Nov, 10:15" or "Live check"; null = never checked.
  checked?: string | null;
  href?: string;
  hrefLabel?: string;
  // A Test button (client component) or any other action.
  test?: React.ReactNode;
  testId?: string;
}

export function StatusCard({ title, health, detail, checked, href, hrefLabel = "Open", test, testId }: StatusCardProps) {
  return (
    <section className={`card flex h-full flex-col border-l-4 ${EDGE[health]}`} aria-labelledby={testId ? `${testId}-title` : undefined} data-testid={testId} data-health={health}>
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <h3 id={testId ? `${testId}-title` : undefined} className="font-semibold">
          {title}
        </h3>
        <HealthBadge health={health} />
      </div>
      <p className="flex-1 px-4 pt-2 text-label text-ink-muted">{detail}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-3 text-caption text-ink-muted">
        <span>{checked === undefined ? null : checked ? `Last check: ${checked}` : "Not checked yet"}</span>
        <span className="flex flex-wrap items-center gap-2">
          {test}
          {href && (
            <Link href={href} className="link text-label">
              {hrefLabel}
              <span className="sr-only">: {title}</span>
            </Link>
          )}
        </span>
      </div>
    </section>
  );
}
