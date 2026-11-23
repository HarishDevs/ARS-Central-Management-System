import { describe, expect, it } from "vitest";
import { DRAFT_FORMS, paneHasUnsentDraft, paneIsSaving } from "@/features/ui/pane-draft";

// v1.86.0 (header and motion audit, gap 14): what counts as an unsent draft in a pane.
type Field = { value?: string };
const form = (body: string | null, busy = false) => ({
  getAttribute: (name: string) => (name === "aria-busy" && busy ? "true" : null),
  querySelector: (): Field | null => (body === null ? null : { value: body }),
});
const pane = (...forms: ReturnType<typeof form>[]) => ({
  querySelectorAll: (selector: string) => {
    expect(selector).toBe(DRAFT_FORMS);
    return forms;
  },
});

describe("paneHasUnsentDraft", () => {
  it("is false with no pane, no comment box or an empty one", () => {
    expect(paneHasUnsentDraft(null)).toBe(false);
    expect(paneHasUnsentDraft(pane())).toBe(false);
    expect(paneHasUnsentDraft(pane(form(null)))).toBe(false);
    expect(paneHasUnsentDraft(pane(form("   \n")))).toBe(false);
  });
  it("is true when a comment or reply holds typed text", () => {
    expect(paneHasUnsentDraft(pane(form(""), form("Hello")))).toBe(true);
  });
  it("is false while that text is being sent (aria-busy)", () => {
    expect(paneHasUnsentDraft(pane(form("Hello", true)))).toBe(false);
  });
});

describe("paneIsSaving", () => {
  it("looks for a busy form", () => {
    expect(paneIsSaving(null)).toBe(false);
    expect(paneIsSaving({ querySelector: (selector: string) => (selector === 'form[aria-busy="true"]' ? {} : null) })).toBe(true);
    expect(paneIsSaving({ querySelector: () => null })).toBe(false);
  });
});
