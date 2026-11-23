// v1.86.0 (header and motion audit, gap 14): an unsent comment in a pane is
// not thrown away by Escape, ×, a click on the dimmed page or a link that
// leaves the pane. Pure helpers (unit-tested); PaneControl asks the
// existing "Discard draft?" question (Dialog.tsx, D-407). v1.87.0: PaneControl.

// The forms whose text is a new piece of writing (a comment or a reply), not
// an edit of something already saved.
export const DRAFT_FORMS = 'form[aria-label="New comment"], form[aria-label="Reply"]';

export const PANE_SELECTOR = "[data-task-pane], [data-record-pane]";

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

// v1.89.0 (NAV-06, D-419): does a Back/Forward from `from` to `to` close the
// pane? A pane is the ?task= (task pane) or ?open= (record pane) of the
// address; the move closes it when that value changes or the page changes.
// Unknown `from`: treated as leaving (the draft is asked about, never lost).
const PANE_PARAMS = ["task", "open"] as const;
export function leavesPane(from: string | null, to: string): boolean {
  if (!from) return true;
  try {
    const a = new URL(from, "https://same.origin.invalid");
    const b = new URL(to, "https://same.origin.invalid");
    if (a.pathname !== b.pathname) return true;
    return PANE_PARAMS.some((name) => a.searchParams.get(name) !== b.searchParams.get(name));
  } catch {
    return true;
  }
}
