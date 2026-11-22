// v1.80.0 (D-407, motion review point 13): where "Next waiting for you"
// lands after a decision: the next request waiting for the person, marked so
// the page shows the short highlight and a way back to the one just decided.
// Opening a request from Waiting for me starts the flow (this browser tab only).
export const QUEUE_FLOW_KEY = "ars.flow.queue";

export function rememberQueueOpen(requestId: string | number) {
  try {
    window.sessionStorage.setItem(QUEUE_FLOW_KEY, String(requestId));
  } catch {
    // storage off: the decided page shows "Next waiting for you →" as before
  }
}

export function openedFromQueue(requestId: number): boolean {
  try {
    return window.sessionStorage.getItem(QUEUE_FLOW_KEY) === String(requestId);
  } catch {
    return false;
  }
}

export function nextWaitingHref(nextRequestId: number, decidedRequestId: number): string {
  return `/users/requests/${nextRequestId}?${new URLSearchParams({ nextwaiting: "1", after: String(decidedRequestId) }).toString()}`;
}
