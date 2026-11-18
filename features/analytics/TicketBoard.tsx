import { analyticsTickets, openTicketsInScope, ticketMonths, type AnalyticsTicket, type TicketAnalyticsScope } from "@/lib/db/repositories/ticket-analytics.repository";
import { peopleOfDepartments } from "@/lib/db/repositories/meeting-analytics.repository";
import { seesAllTickets } from "@/lib/db/repositories/tickets.repository";
import { teamOf } from "@/server/work/task-access";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/server/modules/settings";
import { TICKET_STATUSES, TICKET_STATUS_LABEL, isOverdue } from "@/server/tickets/rules";
import type { Scope, Viewer } from "@/server/analytics/scope";
import type { Period } from "@/server/analytics/periods";

// v1.56.0 (D-334, owner: "in the Analytics page ... it should also work as an
// access based"): the Tickets board of Analytics. The scope at the top decides
// which tickets count: Whole organisation (IT) = every ticket; otherwise the
// tickets raised by or assigned to the people in the scope (me; my reporting
// line, all levels; my departments), plus every ticket of the forms the
// viewer coordinates.
const IST = 330 * 60_000;
const istStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - IST);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);
const pctText = (value: number | null) => (value === null ? "—" : `${value}%`);
const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const hours = (from: Date | null, to: Date | null) => (from && to ? Math.max(0, (to.getTime() - from.getTime()) / 3_600_000) : null);
const hoursText = (value: number | null) => (value === null ? "—" : value < 24 ? `${Math.round(value)} h` : `${(value / 24).toFixed(1)} days`);

async function scopeFor(scope: Scope, viewer: Viewer): Promise<TicketAnalyticsScope> {
  // v1.57.0 (D-336): the IT team named in Admin → Ticket categories sees every ticket.
  if (scope.kind === "ORGANISATION" || (await seesAllTickets(viewer.id).catch(() => false))) return { all: true };
  if (scope.kind === "TEAM") return { all: false, peopleIds: [viewer.id, ...(await teamOf(viewer.id))], viewerId: viewer.id };
  if (scope.kind === "DEPARTMENT") return { all: false, peopleIds: [viewer.id, ...(await peopleOfDepartments(scope.departmentIds ?? []))], viewerId: viewer.id };
  return { all: false, peopleIds: [viewer.id], viewerId: viewer.id };
}

interface Figures {
  raised: number;
  closed: number;
  autoClosed: number;
  open: number;
  reopened: number;
  firstResponse: number | null;
  resolution: number | null;
  rating: number | null;
  rated: number;
}
function figuresOf(rows: readonly AnalyticsTicket[]): Figures {
  const ratings = rows.map((row) => row.rating).filter((value): value is number => value !== null);
  return {
    raised: rows.length,
    closed: rows.filter((row) => row.status === "CLOSED").length,
    autoClosed: rows.filter((row) => row.status === "CLOSED" && row.closeKind === "AUTO").length,
    open: rows.filter((row) => row.status !== "CLOSED").length,
    reopened: rows.filter((row) => row.reopenCount > 0).length,
    firstResponse: avg(rows.map((row) => hours(row.submittedAt, row.firstResponseAt)).filter((value): value is number => value !== null)),
    resolution: avg(rows.map((row) => hours(row.submittedAt, row.resolvedAt)).filter((value): value is number => value !== null)),
    rating: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null,
    rated: ratings.length,
  };
}
function groupBy(rows: readonly AnalyticsTicket[], key: (row: AnalyticsTicket) => string) {
  const groups = new Map<string, AnalyticsTicket[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups.entries()].map(([label, items]) => ({ label, figures: figuresOf(items) })).sort((a, b) => b.figures.raised - a.figures.raised);
}
const BREAKDOWN_HEAD = ["Raised", "Open", "Closed", "Auto closed", "Reopened", "First response", "Resolution", "Rating"];
const breakdownRow = (label: string, f: Figures): React.ReactNode[] => [label, f.raised, f.open, f.closed, f.autoClosed, f.reopened, hoursText(f.firstResponse), hoursText(f.resolution), f.rating === null ? "—" : `${f.rating} / 5`];

export async function TicketBoard({ scope, viewer, period, previous }: { scope: Scope; viewer: Viewer; period: Period; previous: Period }) {
  const ticketScope = await scopeFor(scope, viewer);
  const end = (day: string) => new Date(istStart(day).getTime() + 86_400_000);
  const yearAgo = new Date(istStart(period.to).getTime() - 365 * 86_400_000);
  const [rows, before, open, months] = await Promise.all([
    analyticsTickets(ticketScope, istStart(period.from), end(period.to)),
    analyticsTickets(ticketScope, istStart(previous.from), end(previous.to)),
    openTicketsInScope(ticketScope),
    ticketMonths(ticketScope, yearAgo),
  ]);
  const now = figuresOf(rows);
  const then = figuresOf(before);
  const at = new Date();
  const overdueNow = open.filter((row) => isOverdue(row, at));
  const assignees = new Map<string, { name: string; open: number; overdue: number; awaiting: number }>();
  for (const row of open) {
    const key = row.assigneeName ?? "Not assigned";
    const entry = assignees.get(key) ?? { name: key, open: 0, overdue: 0, awaiting: 0 };
    if (row.status === "AWAITING_CONFIRMATION") entry.awaiting += 1;
    else entry.open += 1;
    if (isOverdue(row, at)) entry.overdue += 1;
    assignees.set(key, entry);
  }
  const assigneeRows = [...assignees.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open).slice(0, 25);
  const statusNow = TICKET_STATUSES.filter((status) => status !== "CLOSED").map((status) => [TICKET_STATUS_LABEL[status], open.filter((row) => row.status === status).length] as const);
  const byPriority = TICKET_PRIORITIES.map((priority) => ({ label: TICKET_PRIORITY_LABEL[priority], figures: figuresOf(rows.filter((row) => row.priority === priority)) })).filter((row) => row.figures.raised > 0);

  return (
    <div data-testid="ticket-analytics">
      <p className="mb-4 text-label text-ink-muted">
        {ticketScope.all
          ? "Every ticket in the organisation."
          : scope.kind === "TEAM"
            ? "Tickets raised by or assigned to you or anyone below you in the reporting line (all levels), and every ticket of the forms you coordinate."
            : scope.kind === "DEPARTMENT"
              ? "Tickets raised by or assigned to the people of the departments you head, and every ticket of the forms you coordinate."
              : "Tickets you raised or were assigned, and every ticket of the forms you coordinate."}{" "}
        Period figures count tickets raised in the period; “now” figures ignore the period.
      </p>

      <Section title="Volume">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Tickets raised" value={String(now.raised)} change={<Change now={now.raised} before={then.raised} />} />
          <Kpi label="Closed" value={String(now.closed)} note={`${now.autoClosed} auto closed · ${pctText(pct(now.closed, now.raised))} of those raised`} change={<Change now={now.closed} before={then.closed} />} />
          <Kpi label="Open now" value={String(open.length)} note={`${overdueNow.length} overdue`} />
          <Kpi label="Reopened" value={String(now.reopened)} note="Raised in the period and reopened at least once" change={<Change now={now.reopened} before={then.reopened} lowerIsBetter />} />
        </div>
      </Section>

      <Section title="Speed and satisfaction">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="First response (average)" value={hoursText(now.firstResponse)} note="Raised → first assigned" />
          <Kpi label="Resolution (average)" value={hoursText(now.resolution)} note="Raised → work completed" />
          <Kpi label="Rating (average)" value={now.rating === null ? "—" : `${now.rating} / 5`} note={`${now.rated} rated`} />
        </div>
      </Section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Where the open tickets are (now)">
          <Table caption="Open tickets by status" head={["Status", "Tickets"]} rows={statusNow.map(([label, count]) => [label, count])} testid="ticket-status-now" />
        </Section>
        <Section title="Assignees (now)">
          <Table caption="Open tickets by assignee" head={["Assignee", "Open", "Overdue", "Awaiting confirmation"]} rows={assigneeRows.map((row) => [row.name, row.open, row.overdue, row.awaiting])} testid="ticket-assignees" />
        </Section>
      </div>

      <Section title="By category">
        <Table caption="Tickets by category" head={["Category", ...BREAKDOWN_HEAD]} rows={groupBy(rows, (row) => row.categoryName).map((row) => breakdownRow(row.label, row.figures))} testid="ticket-by-category" />
      </Section>
      <Section title="By ticket form">
        <Table caption="Tickets by form" head={["Form", ...BREAKDOWN_HEAD]} rows={groupBy(rows, (row) => `${row.categoryName} · ${row.typeName}`).map((row) => breakdownRow(row.label, row.figures))} />
      </Section>
      <Section title="By requester's department">
        <Table caption="Tickets by department" head={["Department", ...BREAKDOWN_HEAD]} rows={groupBy(rows, (row) => row.departmentName ?? "No department").map((row) => breakdownRow(row.label, row.figures))} />
      </Section>
      <Section title="By priority">
        <Table caption="Tickets by priority" head={["Priority", ...BREAKDOWN_HEAD]} rows={byPriority.map((row) => breakdownRow(row.label, row.figures))} />
      </Section>

      <Section title="Twelve months">
        <Table
          caption="Tickets by month"
          head={["Month", "Raised", "Closed", "Auto closed"]}
          rows={months.map((row) => [new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }), row.raised, row.closed, row.autoClosed])}
        />
      </Section>

      <Section title="Overdue now">
        <Table
          caption="Overdue tickets"
          head={["Ticket", "Category", "Priority", "Assignee", "Target date"]}
          rows={overdueNow.slice(0, 20).map((row) => [
            <a key={row.id} href={`/users/tickets/${row.id}`} className="link">
              {row.ticketNo} {row.title}
            </a>,
            row.categoryName,
            TICKET_PRIORITY_LABEL[row.priority],
            row.assigneeName ?? "—",
            row.dueAt ? row.dueAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—",
          ])}
        />
      </Section>
    </div>
  );
}

function Change({ now, before, lowerIsBetter = false }: { now: number | null; before: number | null; lowerIsBetter?: boolean }) {
  if (now === null || before === null) return <span className="text-caption text-ink-muted">No earlier figure to compare</span>;
  const diff = now - before;
  if (diff === 0) return <span className="text-caption text-ink-muted">Same as the previous period</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`text-caption ${good ? "text-success-600" : "text-danger-600"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} vs previous period
    </span>
  );
}

function Kpi({ label, value, note, change }: { label: string; value: string; note?: string; change?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-caption text-ink-muted">{note}</p>}
      {change}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mb-8">
      <h2 className="mb-3 text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ caption, head, rows, testid }: { caption: string; head: string[]; rows: React.ReactNode[][]; testid?: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[480px] text-label" data-testid={testid}>
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-caption text-ink-muted">
          <tr>
            {head.map((cell, index) => (
              <th key={cell} scope="col" className={`px-3 py-2 ${index > 0 ? "text-right" : ""}`}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-3 text-ink-muted">
                Nothing for this selection.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) =>
                  column === 0 ? (
                    <th key={column} scope="row" className="px-3 py-2 text-left font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={column} className="px-3 py-2 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
