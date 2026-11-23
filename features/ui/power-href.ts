// v1.85.2 (D-414): powerHref lives here, outside the PowerSearch client module,
// because the Admin Records pages (server components) build their sort, page
// and open-row links with it. A function exported from a "use client" file
// can't be called on the server (Tickets and Meetings crashed on live).
// The address with one parameter set (or removed), the page reset.
export function powerHref(
  base: string,
  params: Record<string, string | undefined>,
  change: Record<string, string | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...change })) {
    if (
      key === "page" ||
      key === "open" ||
      value === null ||
      value === undefined ||
      value === ""
    )
      continue;
    query.set(key, value);
  }
  const text = query.toString();
  return `${base}${text ? `?${text}` : ""}`;
}
