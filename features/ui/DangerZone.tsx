"use client";

import { AlertOctagon } from "lucide-react";
import { useId, useState } from "react";

// v1.84.0 (D-411, owner's redesign): a danger zone box. A red edge and a
// warning icon (never colour alone), what the action does in plain words, and
// a typed confirmation: the button stays off until the exact word is typed.
// The server checks the word again (the action's own check); this only stops
// a slip of the hand. After the Astryx "destructive action" pattern (MIT,
// structure only).
export function DangerZone({ title, what, children, testId }: { title: string; what: React.ReactNode; children: React.ReactNode; testId?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="card border-l-4 border-l-danger-600" data-testid={testId} data-danger-zone>
      <div className="flex items-start gap-2 border-b border-line px-5 py-4">
        <AlertOctagon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />
        <div className="min-w-0">
          <h2 id={id} className="font-semibold">
            <span className="sr-only">Danger zone: </span>
            {title}
          </h2>
          <div className="mt-1 text-label text-ink-muted">{what}</div>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// The typed confirmation: a field named `name` (sent with the form, so the
// server can check it too) and whether the word matches.
export function useTypedConfirm(word: string, name = "confirmText") {
  const [typed, setTyped] = useState("");
  const id = useId();
  const ready = typed.trim() === word;
  const field = (
    <div>
      <label htmlFor={id} className="block text-label font-semibold">
        Type {word} to confirm
      </label>
      <input
        id={id}
        name={name}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="field-input mt-1 max-w-xs"
        placeholder={word}
        aria-describedby={`${id}-hint`}
        data-testid="typed-confirm"
      />
      <p id={`${id}-hint`} className="mt-1 text-caption text-ink-muted">
        {ready ? "Confirmed. The button is on." : "The button stays off until the word matches exactly."}
      </p>
    </div>
  );
  return { field, ready, reset: () => setTyped("") };
}
