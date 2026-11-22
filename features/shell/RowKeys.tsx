"use client";

import { useEffect } from "react";
import { isTyping } from "@/features/shell/shortcuts";
import { nextRowIndex } from "@/features/shell/motion-rules";

// v1.80.0 (D-407, motion review point 13): keyboard flow on every list.
// J / K move between the rows of the page's table (the row's first link takes
// focus, the row is highlighted), Enter opens it (the link itself). Never
// while typing in a field or an editor, nor with a dialog or menu open.
// Lists with their own keys (Waiting for me, task lists) handle J / K first.
export function RowKeys() {
  useEffect(() => {
    const rows = () =>
      [...document.querySelectorAll<HTMLTableRowElement>("main table tbody tr")].filter((row) => row.offsetParent !== null && row.querySelector("a[href]:not([download])"));
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true'], [role='menu']")) return;
      // After every other listener: a list with its own J / K (it calls
      // preventDefault) keeps them, whichever was mounted first.
      window.setTimeout(() => {
        if (!event.defaultPrevented) move(key);
      }, 0);
    };
    const move = (key: "j" | "k") => {
      const all = rows();
      const active = document.activeElement;
      const index = all.findIndex((row) => row.contains(active) || row.hasAttribute("data-row-current"));
      const next = nextRowIndex(all.length, index, key);
      if (next === null) return;
      all.forEach((row) => row.removeAttribute("data-row-current"));
      const row = all[next]!;
      row.setAttribute("data-row-current", "");
      const link = row.querySelector<HTMLAnchorElement>("th a[href], td a[href]:not([download])");
      link?.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
    };
    const onFocus = (event: FocusEvent) => {
      // Moving away with Tab or a click ends the highlight.
      const target = event.target as HTMLElement | null;
      document.querySelectorAll("main tr[data-row-current]").forEach((row) => {
        if (!row.contains(target)) row.removeAttribute("data-row-current");
      });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);
  return null;
}
