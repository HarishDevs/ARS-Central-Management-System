"use client";

import { MoreVertical } from "lucide-react";
import { Menu } from "@/features/ui/Menu";

// D-256: a row's actions on the request lists. Only actions that exist for
// this request and this person are offered; anything that changes it (withdraw,
// resubmit) opens the request page, where it is checked and confirmed as before.
// v1.72.2 (D-394, QA visual A4/G6): the shared menu, placed against the window
// so the scrolling table never clips it, with the same look, layer and keys
// as every other menu.
export interface RowAction {
  label: string;
  href: string;
  tone?: "danger";
  download?: boolean;
}

export function RequestRowMenu({ title, actions }: { title: string; actions: RowAction[] }) {
  return (
    <Menu
      label={`Actions for ${title}`}
      trigger={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
      items={actions.map((action) => ({ label: action.label, href: action.href, download: action.download, tone: action.tone ?? "default" }))}
      menuClass="w-56"
      buttonClass="grid h-9 w-9 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
      testId="row-menu"
    />
  );
}
