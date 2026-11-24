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
    // page and open are dropped from the current address; a change that names one keeps
    // it (v1.89.0, D-423: the Tickets and Meetings rows asked for ?open= and lost it,
    // so a click on their rows did not open the record pane).
    if (
      ((key === "page" || key === "open") && !(key in change)) ||
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
