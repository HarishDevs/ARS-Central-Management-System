import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { PeriodPicker } from "@/features/home/HomeClient";
import type { Period } from "@/server/work/period";

// v1.79.0 (D-406, owner: "Match all 3 Overview Screens, it should be
// identically featured"): the parts every Home overview shares: the header,
// the four summary cards (with the change against the previous period), the
// Needs attention list, the insight figures and the section heading.

// The same period choices and address keys (?period=, ?from=, ?to=) on all three.
export const OVERVIEW_PERIODS: [string, string][] = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["custom", "Custom period"],
];

// The address keys that keep the chosen period (left out when it is the overview's default).
export function periodKeep(period: Period, fallback: string): Record<string, string> {
  return {
    ...(period.key !== fallback ? { period: period.key } : {}),
    ...(period.key === "custom" ? { from: period.fromDay, to: period.toDay } : {}),
  };
}

export function OverviewHeader({
  // v1.80.0 (D-407): `icon` no longer drawn (the header icon tile is gone in every overview).
  title,
  role,
  description,
  greeting,
  switcher,
  period,
  periodBase,
  tour = false,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  role: string;
  description: string;
  greeting?: React.ReactNode;
  switcher: React.ReactNode;
  period: Period;
  periodBase: Record<string, string>;
  tour?: boolean; // the tour points at this header (data-tour="page-header")
  testId?: string;
}) {
  return (
    <>
      {greeting && <div className="mb-4">{greeting}</div>}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4" data-tour={tour ? "page-header" : undefined} data-testid={testId}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight">{title}</h1>
            {role && (
              <p className="text-label text-ink-muted" data-testid="overview-role">
                {role}
              </p>
            )}
            <p className="text-label text-ink-muted">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {switcher}
          <PeriodPicker value={period.key} from={period.fromDay} to={period.toDay} base={periodBase} options={OVERVIEW_PERIODS} />
        </div>
      </header>
    </>
  );
}

export interface SummaryCard {
  key: string;
  label: string;
  note: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  href: string;
  change?: { value: number | null; label: string }; // against the previous period
  alert?: boolean; // the value needs the person (coloured)
  danger?: boolean;
}

export function SummaryCards({ cards, testId, cardTestId, tour = false }: { cards: SummaryCard[]; testId: string; cardTestId: string; tour?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid={testId} data-tour={tour ? "overview-tiles" : undefined}>
      {cards.map((card) => (
        <Link key={card.key} href={card.href} className="card-link status-card flex items-center gap-3 px-4 py-3" data-testid={`${cardTestId}-${card.key}`}>
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${card.tone}`} aria-hidden="true">
            <card.icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-card-title font-bold tabular-nums leading-tight ${card.alert ? (card.danger ? "text-danger-600" : "text-primary-700") : ""}`}>{card.value}</span>
            <span className="block text-label font-medium">{card.label}</span>
            <span className="block truncate text-caption text-ink-muted">{card.note}</span>
            {/* v1.74.1 (D-397): the change sits under the note; beside it, it squeezed the label into two lines on a tablet. */}
            {card.change && (
              <span className="mt-0.5 block">
                <Change value={card.change.value} label={card.change.label} />
              </span>
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function Change({ value, label }: { value: number | null; label: string }) {
  if (value === null)
    return (
      <span className="hidden items-center gap-1 text-caption text-ink-faint sm:flex" data-testid="card-change">
        <Minus aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  const up = value >= 0;
  return (
    <span className="hidden flex-wrap items-center gap-1 sm:flex" data-testid="card-change">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-caption font-semibold ${up ? "bg-success-50 text-success-600" : "bg-danger-50 text-danger-600"}`}>
        {up ? <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5" />}
        {up ? "+" : ""}
        {value}%
      </span>
      <span className="text-caption text-ink-muted">{label}</span>
    </span>
  );
}

export function SectionHead({ id, title, href, count = 0, linkText = "View all", children }: { id: string; title: string; href?: string; count?: number; linkText?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-[calc(17px*var(--text-scale,1))] font-semibold">
        {title}
      </h2>
      {children}
      {href && count > 0 && (
        <Link href={href} className="link inline-flex items-center gap-1 text-label">
          {linkText} <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export interface AttentionItem {
  key: string;
  text: string;
  detail: string;
  href: string;
  danger: boolean;
}

// Needs attention: what is late or about to be, most urgent first.
export function AttentionWidget({ id, items, empty, testId }: { id: string; items: AttentionItem[]; empty: string; testId: string }) {
  const sorted = [...items].sort((a, b) => Number(b.danger) - Number(a.danger));
  return (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby={id} data-testid={testId}>
      <SectionHead id={id} title="Needs attention" />
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-label text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.slice(0, 10).map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="flex items-start gap-3 py-2.5 hover:text-primary-700">
                <AlertTriangle aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${item.danger ? "text-danger-600" : "text-warning-600"}`} />
                <span className="min-w-0">
                  <span className="block text-label font-semibold">{item.text}</span>
                  <span className="block truncate text-caption text-ink-muted">{item.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Quick insights: three figures in a row, then one line of what they mean.
export function InsightFigures({ figures }: { figures: { icon: React.ReactNode; tone: string; label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
      {figures.map((figure) => (
        <div key={figure.label} className="min-w-0 px-3 py-3">
          <dt className="text-caption text-ink-muted">
            <span className={`mb-1 block ${figure.tone}`} aria-hidden="true">
              {figure.icon}
            </span>
            {figure.label}
          </dt>
          <dd className="text-title font-bold tabular-nums">{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}
