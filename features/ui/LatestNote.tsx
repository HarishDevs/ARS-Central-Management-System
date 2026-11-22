import Link from "next/link";

// v1.72.1 (D-395, QA F-07): a list that loads only the latest rows says so,
// with a way to load more (?limit=, up to a ceiling). Shown only when the
// list is full (there may be more).
export function LatestNote({ shown, limit, step, max, path, query, what, param = "limit" }: { shown: number; limit: number; step: number; max: number; path: string; query: Record<string, string | string[] | undefined>; what: string; param?: string }) {
  if (shown < limit) return null;
  const next = Math.min(max, limit + step);
  const keep = Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== param);
  const href = `${path}?${new URLSearchParams([...keep, [param, String(next)]]).toString()}`;
  return (
    <p className="mt-3 text-label text-ink-muted" role="note" data-testid="latest-note">
      Showing the latest {limit.toLocaleString("en-IN")} {what}.{" "}
      {next > limit ? (
        <Link href={href} className="link" scroll={false}>
          Show {(next - limit).toLocaleString("en-IN")} more
        </Link>
      ) : (
        "That is the most this page shows at once."
      )}
    </p>
  );
}
