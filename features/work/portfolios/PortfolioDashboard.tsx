"use client";

import { Table2 } from "lucide-react";
import { useState } from "react";
import { ChartView } from "@/features/work/reporting/ChartView";
import type { ChartData } from "@/server/work/reporting";

// v1.69.0 (D-382, spec PORTFOLIOS §3.18): the portfolio's Dashboard, drawn
// with the project dashboard's charts (D-375): totals, projects by status,
// incomplete tasks by project, completion over time and sub-portfolios by
// status, over the projects the person can see (every level, each task
// once). Fixed widgets (no builder for portfolios yet); each has View as table.
export function PortfolioDashboard({ widgets }: { widgets: { key: string; title: string; size: "QUARTER" | "HALF"; note: string; data: ChartData }[] }) {
  return (
    <section aria-label="Dashboard" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="portfolio-dashboard">
      {widgets.map((widget) => (
        <Widget key={widget.key} widget={widget} />
      ))}
    </section>
  );
}

function Widget({ widget }: { widget: { key: string; title: string; size: "QUARTER" | "HALF"; note: string; data: ChartData } }) {
  const [table, setTable] = useState(false);
  const number = widget.data.style === "number";
  return (
    <article className={`card flex min-w-0 flex-col px-4 py-3 ${number ? "col-span-1" : "sm:col-span-2"}`} aria-labelledby={`pw-${widget.key}`} data-testid="dashboard-widget">
      <div className="flex items-start gap-2">
        <h3 id={`pw-${widget.key}`} className="flex-1 text-label font-semibold">
          {widget.title}
        </h3>
        {!number && (
          <button type="button" aria-pressed={table} onClick={() => setTable((value) => !value)} className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink aria-pressed:bg-primary-50 aria-pressed:text-primary-700" aria-label={`View ${widget.title} as table`} title="View as table" data-testid="widget-table-toggle">
            <Table2 aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <ChartView data={widget.data} title={widget.title} table={table} />
      </div>
      <p className="mt-1 text-caption text-ink-muted">{widget.note}</p>
    </article>
  );
}
