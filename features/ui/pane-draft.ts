// v1.86.0 (header and motion audit, gap 14): an unsent comment in a pane is
// not thrown away by Escape, ×, a click on the dimmed page or a link that
// leaves the pane. Pure helpers (unit-tested); PaneDraftGuard asks the
// existing "Discard draft?" question (Dialog.tsx, D-407).

// The forms whose text is a new piece of writing (a comment or a reply), not
// an edit of something already saved.
export const DRAFT_FORMS = 'form[aria-label="New comment"], form[aria-label="Reply"]';

export const PANE_SELECTOR = "[data-task-pane], [data-record-pane]";

// Raised on the pane element by code that wants to close it (Escape keys):
// the guard answers by asking, or by calling detail.close at once.
export const PANE_CLOSE_REQUEST = "ars:pane-close-request";

type FormLike = { getAttribute(name: string): string | null; querySelector(selector: string): { value?: string; textContent?: string | null } | null };
type PaneLike = { querySelectorAll(selector: string): ArrayLike<FormLike> };

// True when the pane holds typed text that hasn't been sent. A form that is
// being sent (aria-busy, set by useActionForm) is not a draft.
export function paneHasUnsentDraft(pane: PaneLike | null | undefined): boolean {
  if (!pane) return false;
  const forms = Array.from(pane.querySelectorAll(DRAFT_FORMS));
  return forms.some((form) => {
    if (form.getAttribute("aria-busy") === "true") return false;
    const field = form.querySelector('input[type="hidden"][name="body"], textarea[name="body"]');
    return Boolean(field && typeof field.value === "string" && field.value.trim().length > 0);
  });
}

// True when the pane has a form being sent now (gap 15: "still saving").
export function paneIsSaving(pane: { querySelector(selector: string): unknown } | null | undefined): boolean {
  return Boolean(pane?.querySelector('form[aria-busy="true"]'));
}

// Closing a pane through the guard: asks first when there is an unsent
// draft (the guard listens for PANE_CLOSE_REQUEST), else closes at once.
export function requestPaneClose(pane: HTMLElement, close: () => void) {
  if (!paneHasUnsentDraft(pane) || !pane.querySelector("[data-pane-draft-guard]")) {
    close();
    return;
  }
  pane.dispatchEvent(new CustomEvent(PANE_CLOSE_REQUEST, { detail: { close } }));
}
