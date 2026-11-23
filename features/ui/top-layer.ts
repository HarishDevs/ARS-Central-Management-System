// v1.80.0 (D-407, motion review point 1): closing a top-layer element
// (<dialog>) with its exit animation. Chrome and Edge animate the close in CSS
// (`overlay` + discrete `display` transitions), so close() at once. Firefox and
// Safari can't: there the element gets data-closing (CSS plays the exit while
// it is still in the top layer), we wait for its animations, then close().
// Pattern from the modern-web-guidance "animate-to-from-top-layer" guide.
// A safety cap for an exit that never reports its end (not a motion duration).
const EXIT_CAP_MS = 2000;
let supportsDisplayTransition: boolean | undefined;

export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === "undefined" || !window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) return false;
  const probe = document.createElement("div");
  // The shorthand is deliberate: a browser that can't parse allow-discrete
  // drops it, display:none applies at once and the probe says false.
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

export function supportsTopLayerExit(): boolean {
  return Boolean(typeof window !== "undefined" && window.CSS?.supports?.("overlay", "auto")) && canTransitionDisplay();
}

// Resolves once the element is closed. Waits at most 2 s for animations.
export async function closeTopLayer(element: HTMLDialogElement, returnValue?: string): Promise<void> {
  if (!element.open) return;
  if (!supportsTopLayerExit()) {
    if (element.hasAttribute("data-closing")) return;
    element.setAttribute("data-closing", "");
    const animations = typeof element.getAnimations === "function" ? element.getAnimations({ subtree: true }) : [];
    if (animations.length > 0) {
      await Promise.race([Promise.allSettled(animations.map((animation) => animation.finished)), new Promise((resolve) => setTimeout(resolve, EXIT_CAP_MS))]);
    }
    if (!element.hasAttribute("data-closing")) return;
    element.removeAttribute("data-closing");
  }
  element.close(returnValue);
}
