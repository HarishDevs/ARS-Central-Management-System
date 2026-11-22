"use client";

import { useEffect, useState } from "react";
import { commentAction } from "@/app/users/collab-actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { Hint } from "@/features/ui/Hint";
import { RichEditor } from "@/features/ui/RichEditor";
import { plainText } from "@/features/requests/comment-text";

// F-15: the discussion on a request. v1.60.0 (D-365): comments can be edited or deleted by their author and IT; every earlier text is kept.
export function CommentForm({ requestId, people = [] }: { requestId: number; people?: { loginId: string; name: string; departmentName?: string | null }[] }) {
  const { result, pending, formRef, onSubmit } = useActionForm(commentAction, { resetOnSuccess: true });
  // v1.80.0 (D-407, motion review point 9): the comment shows at once as
  // "Posting…" while it is sent; the page then shows it for real. If the
  // server refuses it, it goes away again and the words stay in the box.
  const [posting, setPosting] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) setPosting(null);
  }, [pending]);
  // #9: a mention is "@UserID" in the text; v1.52.2 (owner): the box formats
  // like an email body, and @ followed by a name picks the person.
  const mentionable = people.map((person, index) => ({ id: index + 1, label: `${person.name} - ${person.loginId}`, name: person.name, detail: person.departmentName ?? undefined, token: `@${person.loginId}` }));
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        const text = plainText(String(new FormData(event.currentTarget).get("body") ?? ""));
        if (text) setPosting(text);
        onSubmit(event);
      }}
      className="space-y-2"
    >
      {posting && pending && (
        <div className="rounded-md border border-dashed border-line px-3 py-2 text-label opacity-70" aria-live="polite" data-testid="comment-optimistic">
          <p className="text-caption text-ink-muted">You · Posting…</p>
          <p className="whitespace-pre-wrap">{posting}</p>
        </div>
      )}
      <input type="hidden" name="requestId" value={requestId} />
      <RichEditor name="body" label="Add a comment" placeholder="Add a comment or @mention someone on this request" people={mentionable} maxLength={2000} />
      <FieldError result={result} name="body" />
      <div className="flex items-center gap-3">
        <SubmitButton pending={pending} variant="secondary" className="btn-compact">
          Post comment
        </SubmitButton>
        <Hint text="Type @ and a name to notify someone. Only people who can already see this request are told." align="start" />
        {result && (result.ok || !result.fieldErrors) && <ResultMessage result={result} />}
      </div>
    </form>
  );
}
