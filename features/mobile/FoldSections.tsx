"use client";

import { FoldAllButtons } from "@/features/ui/GroupFold";

// v1.58.0 (D-354, owner: "expand or collapse individually and all option for
// all the tables group by"): Expand all / Collapse all for the phone's task
// sections (native <details>, each still opens on its own).
export function FoldSections({ selector }: { selector: string }) {
  return (
    <FoldAllButtons
      testId="m-fold-all"
      onAll={(open) => {
        for (const section of document.querySelectorAll<HTMLDetailsElement>(selector)) section.open = open;
      }}
    />
  );
}
