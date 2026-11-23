// v1.87.0 (D-417, gap 18): folded groups and sections are kept per page in
// this browser tab (sessionStorage), so a full page and Back, or a pane
// opened and closed, finds them as the person left them. Only open/closed
// flags and group names are kept; nothing goes to the server.
export const FOLD_KEY = "ars.fold";
export const FOLD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_GROUPS = 200;

export interface FoldState {
  closed: boolean; // the default for every group (Collapse all / Expand all)
  toggled: string[]; // groups opened or closed one by one against `closed`
}

export const foldKey = (pathname: string, id: string) => `${FOLD_KEY}:${pathname}:${id}`;

export function parseFold(raw: string | null, now: number): FoldState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { closed?: unknown; toggled?: unknown; at?: unknown };
    if (typeof value.closed !== "boolean" || !Array.isArray(value.toggled) || typeof value.at !== "number" || now - value.at > FOLD_TTL_MS) return null;
    return { closed: value.closed, toggled: value.toggled.filter((item): item is string => typeof item === "string").slice(0, MAX_GROUPS) };
  } catch {
    return null;
  }
}

export function readFold(key: string): FoldState | null {
  try {
    return parseFold(window.sessionStorage.getItem(key), Date.now());
  } catch {
    return null;
  }
}

export function writeFold(key: string, state: FoldState) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ closed: state.closed, toggled: state.toggled.slice(0, MAX_GROUPS), at: Date.now() }));
  } catch {
    // storage off: folds start as the page draws them
  }
}
