"use client";

import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { homeNoteAction } from "@/app/users/home-actions";
import { RichEditor } from "@/features/ui/RichEditor";
import { NOTE_MAX } from "@/server/home/widgets";

// v1.63.0 (D-369, spec HOME_MODULE §3.4, BR-HOME-007): the private notepad.
// Only its owner sees it; it saves by itself a moment after typing stops (and
// when the box loses focus). Formatting is the app's own (bold, lists, links…),
// kept as text, never HTML.
export function HomeNotepad({ initialText, version }: { initialText: string; version: number }) {
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [message, setMessage] = useState("");
  const text = useRef(initialText);
  const savedText = useRef(initialText);
  const at = useRef(version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (busy.current || text.current === savedText.current) return;
    busy.current = true;
    const body = text.current;
    setStatus("saving");
    const result = await homeNoteAction(body, at.current);
    busy.current = false;
    if (result.ok && result.version !== undefined) {
      at.current = result.version;
      savedText.current = body;
      setStatus(text.current === body ? "saved" : "unsaved");
      setMessage("");
      if (text.current !== body) timer.current = setTimeout(() => void flush(), 1200);
    } else {
      setStatus("error");
      setMessage(result.message);
    }
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="home-notepad" data-testid="home-notepad">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="home-notepad" className="flex items-center gap-2 text-[calc(17px*var(--text-scale,1))] font-semibold">
          Private notepad <Lock aria-hidden="true" className="h-4 w-4 text-ink-faint" />
        </h2>
        <span className={`text-caption ${status === "error" ? "text-danger-600" : "text-ink-muted"}`} role="status" aria-live="polite" data-testid="note-status">
          {status === "saving" ? "Saving…" : status === "unsaved" ? "Not saved yet" : status === "error" ? message : savedText.current ? "Saved" : ""}
        </span>
      </div>
      <p className="mb-2 text-caption text-ink-muted">Only you can see this note.</p>
      <div
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void flush();
        }}
      >
        <RichEditor
          name="note"
          id="home-note-editor"
          label="Private notepad"
          placeholder="Jot down a quick note or add a link…"
          initialText={initialText}
          maxLength={NOTE_MAX}
          minHeight={140}
          onText={(value) => {
            text.current = value;
            if (value === savedText.current) return;
            setStatus("unsaved");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), 1200);
          }}
          testId="note-editor"
        />
      </div>
    </section>
  );
}
