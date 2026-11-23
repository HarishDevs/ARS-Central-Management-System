// v1.84.0 (D-411): a details list (label and value pairs) in place of the
// hand-made <dl>s of the panels. Two columns from the small breakpoint, one
// on a phone; an empty value shows a dash so the row is never blank.
export interface DetailItem {
  label: string;
  value: React.ReactNode;
  // A value that is long (an address, a list) spans the whole row.
  wide?: boolean;
}

export function DetailsList({ items, className = "", testId }: { items: DetailItem[]; className?: string; testId?: string }) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 text-label sm:grid-cols-2 ${className}`} data-testid={testId}>
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 ${item.wide ? "sm:col-span-2" : ""}`}>
          <dt className="text-caption font-medium text-ink-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words">{item.value === null || item.value === undefined || item.value === "" ? <span className="text-ink-faint">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
