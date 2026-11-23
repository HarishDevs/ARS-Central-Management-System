// v1.84.0 (D-411, owner's redesign): the console layout (after the Astryx
// incident-console template, MIT, structure only): a list of things to watch,
// the details of the chosen one, and a log or timeline underneath. Each part
// is a labelled region, so a screen reader can jump between them. On a phone
// the parts stack in reading order: list, details, log.
export function ConsoleLayout({
  list,
  listLabel,
  details,
  detailsLabel,
  log,
  logLabel,
  testId,
}: {
  list: React.ReactNode;
  listLabel: string;
  details?: React.ReactNode;
  detailsLabel?: string;
  log?: React.ReactNode;
  logLabel?: string;
  testId?: string;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid={testId}>
      <section aria-label={listLabel} className="min-w-0 space-y-6">
        {list}
      </section>
      {details && (
        <aside aria-label={detailsLabel ?? "Details"} className="min-w-0 space-y-6 xl:self-start">
          {details}
        </aside>
      )}
      {log && (
        <section aria-label={logLabel ?? "Log"} className="min-w-0 xl:col-span-2">
          {log}
        </section>
      )}
    </div>
  );
}
