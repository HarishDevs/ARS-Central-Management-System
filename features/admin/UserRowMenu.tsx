"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { userCommandAction } from "@/app/admin/users/actions";
import { guardAction } from "@/features/ui/form";
import { ConfirmDialog } from "@/features/ui/Dialog";
import { useToast } from "@/features/ui/Toast";
import { Menu, type MenuItem } from "@/features/ui/Menu";

// v1.49.3 (owner: "actions in a three-dot menu in the last column: Re-invite,
// Send set-password link, Deactivate / Activate user"): the user page's
// account actions on the users list. Each one runs the same server command
// (checked again there) after a confirmation naming the person, and the
// answer shows as a toast. People this admin can't change get "Open user".
type Command = "invite" | "set-password-link" | "reset-password" | "deactivate" | "reactivate";

interface Item {
  command: Command;
  label: string;
  confirm: string;
  confirmLabel: string;
  danger?: boolean;
}

const run = guardAction(userCommandAction);

export function UserRowMenu({
  id,
  name,
  active,
  signInMethod,
  hasPassword,
  canEdit,
}: {
  id: number;
  name: string;
  active: boolean;
  signInMethod: "GOOGLE" | "PASSWORD" | "BOTH";
  hasPassword: boolean;
  canEdit: boolean;
}) {
  const [asking, setAsking] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const items: Item[] = !canEdit
    ? []
    : [
        ...(active
          ? [
              {
                command: "invite" as const,
                label: "Re-invite",
                confirm: signInMethod !== "GOOGLE" ? `Email ${name} a welcome with their User ID and a link (valid 12 hours) to set their password? Older links stop working.` : `Email ${name} a welcome telling them to sign in with Google?`,
                confirmLabel: "Yes, send",
              },
            ]
          : []),
        ...(active && signInMethod !== "GOOGLE"
          ? [
              hasPassword
                ? { command: "reset-password" as const, label: "Send reset-password link", confirm: `Email ${name} a link (valid 12 hours) to choose a new password? Their current password keeps working until then.`, confirmLabel: "Yes, send" }
                : { command: "set-password-link" as const, label: "Send set-password link", confirm: `Email ${name} a link (valid 12 hours) to set a password, confirmed by a WhatsApp code? Older links stop working.`, confirmLabel: "Yes, send" },
            ]
          : []),
        active
          ? { command: "deactivate" as const, label: "Deactivate user", confirm: `Deactivate ${name}? They will be signed out everywhere and can't sign in. History is kept; you can activate them again.`, confirmLabel: "Yes, deactivate", danger: true }
          : { command: "reactivate" as const, label: "Activate user", confirm: `Activate ${name}? They can sign in again.`, confirmLabel: "Yes, activate" },
      ];

  async function confirmed() {
    if (!asking) return;
    const formData = new FormData();
    formData.set("id", String(id));
    formData.set("command", asking.command);
    setBusy(true);
    const result = await run(null, formData);
    setBusy(false);
    setAsking(null);
    toast({ tone: result.ok ? "success" : "error", title: result.ok ? `${name}: ${asking.label.toLowerCase()} done.` : `${name}: ${asking.label.toLowerCase()} didn't work.`, body: result.message });
    if (result.ok) router.refresh();
  }

  // v1.72.2 (D-394, QA visual A4/G6): the shared menu (look, layer, keys).
  const menuItems: MenuItem[] = [
    ...items.map((item): MenuItem => ({ label: item.label, tone: item.danger ? "danger" : "default", onSelect: () => setAsking(item) })),
    ...(canEdit ? [] : [{ kind: "heading" as const, label: "Only the Super Admin can change this account." }]),
    ...(items.length ? [{ kind: "separator" as const, label: "open" }] : []),
    { label: "Open user", href: `/admin/users/${id}` },
  ];
  return (
    <div className="inline-block">
      <Menu
        label={`Actions for ${name}`}
        trigger={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
        items={menuItems}
        menuClass="w-60"
        buttonClass="grid h-9 w-9 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
        testId="user-row-menu"
      />
      <ConfirmDialog
        open={asking !== null}
        title={asking ? `${asking.label}?` : ""}
        body={asking?.confirm ?? ""}
        confirmLabel={asking?.confirmLabel ?? "Yes"}
        busy={busy}
        busyLabel="Working…"
        tone={asking?.danger ? "danger" : "primary"}
        onCancel={() => !busy && setAsking(null)}
        onConfirm={() => void confirmed()}
      />
    </div>
  );
}
