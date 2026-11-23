// v1.87.0 (D-417, race guard): the app router now and then drops a soft move
// started while another one is settling: the server answers, the address
// stays. Seen on Admin → Records (closing the record pane: the audit's
// "Escape after Back ignored"; Apply in the filter panel: the v1850 failure
// that also happened on v1.85.3). This asks once more if the address hasn't
// moved, then puts the address in place and redraws it. It never runs when
// the person has moved somewhere else in the meantime.
type Router = { push: (href: string, options?: { scroll?: boolean }) => void; replace: (href: string, options?: { scroll?: boolean }) => void; refresh: () => void };

const here = () => `${window.location.pathname}${window.location.search}`;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function makeSureMoved(router: Router, from: string, to: string, how: "push" | "replace", stillWanted: () => boolean = () => true): Promise<void> {
  await wait(1200);
  if (here() !== from || !stillWanted()) return;
  router[how](to, { scroll: false });
  await wait(1200);
  if (here() !== from || !stillWanted()) return;
  if (how === "push") window.history.pushState(window.history.state, "", to);
  else window.history.replaceState(window.history.state, "", to);
  router.refresh();
}

export function navigateSurely(router: Router, to: string, how: "push" | "replace" = "push") {
  const from = here();
  router[how](to, { scroll: false });
  void makeSureMoved(router, from, to, how);
}
