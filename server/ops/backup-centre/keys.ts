import "server-only";

// D-408: package keys derived from a typed passphrase live only in this
// process's memory, for at most an hour, so the next step of a run doesn't
// pay the scrypt cost again. Never written to disk, the database or a log.
// After a restart the browser sends the passphrase again (it keeps it in
// memory while the page is open).
const keys = new Map<string, { key: Buffer; expires: number }>();
const TTL_MS = 60 * 60_000;

export function rememberKey(runId: number, slot: "package" | "snapshot", key: Buffer): void {
  keys.set(`${runId}:${slot}`, { key, expires: Date.now() + TTL_MS });
}

export function cachedKey(runId: number, slot: "package" | "snapshot"): Buffer | null {
  const hit = keys.get(`${runId}:${slot}`);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    keys.delete(`${runId}:${slot}`);
    return null;
  }
  return hit.key;
}

export function forgetKeys(runId: number): void {
  for (const slot of ["package", "snapshot"] as const) {
    const hit = keys.get(`${runId}:${slot}`);
    if (hit) hit.key.fill(0);
    keys.delete(`${runId}:${slot}`);
  }
}
