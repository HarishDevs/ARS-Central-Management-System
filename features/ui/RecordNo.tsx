import Link from "next/link";

// v1.89.0 (D-423, UIQA-CON-10): one way to show a record's number (request,
// task, information, ticket, meeting) in lists: monospace with even digits.
// Under a title that is already the link, it is quiet text; as a column of
// its own (Tickets, Meetings, the coordinator board) it is the row's link.
export function RecordNo({ no, href, className = "" }: { no: string; href?: string; className?: string }) {
  const look = `font-mono tabular-nums ${className}`;
  if (href)
    return (
      <Link href={href} className={`link text-label ${look}`} data-record-no>
        {no}
      </Link>
    );
  return (
    <span className={`text-caption text-ink-muted ${look}`} data-record-no>
      {no}
    </span>
  );
}
