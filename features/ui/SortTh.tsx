import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/server/lists/sorting";

// v1.58.0 (D-351): a sortable column title. Click: A→Z (ascending); again: Z→A.
// `href` is the address for the next direction (see sortHref / nextDir).
export function SortTh({
  label,
  column,
  sortBy,
  dir,
  href,
  className = "",
  srOnly = false,
  scope = "col",
}: {
  label: string;
  column: string;
  sortBy: string | null;
  dir: SortDir;
  href: string;
  className?: string;
  srOnly?: boolean;
  scope?: "col" | "row";
}) {
  const active = sortBy === column;
  return (
    <th scope={scope} className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} data-sort-column={column}>
      <SortLink label={label} active={active} dir={dir} href={href} srOnly={srOnly} />
    </th>
  );
}

// The link alone (for header cells another component owns, e.g. draggable ones).
export function SortLink({ label, active, dir, href, srOnly = false }: { label: string; active: boolean; dir: SortDir; href: string; srOnly?: boolean }) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const next = active && dir === "asc" ? "descending" : "ascending";
  return (
    <Link href={href} scroll={false} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`} title={`Sort by ${label}, ${next}`} data-testid="sort-link">
      {srOnly ? <span className="sr-only">{label}</span> : label}
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "opacity-40"}`} />
    </Link>
  );
}
