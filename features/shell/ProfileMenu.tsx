"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Email } from "@/features/ui/SafeText";
import { useViewChoice } from "@/features/shell/ViewSwitch";
import { TEXT_SCALE, TEXT_SIZE_LABEL, TEXT_SIZES, VIEW_LABEL, WORKSPACE_VIEWS, type TextSize, type WorkspaceView } from "@/server/ui/workspace-view";
import { defaultAvatar } from "@/features/ui/Avatar";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { useToast } from "@/features/ui/Toast";

// One user menu at the top right (S9-01..03): who you are, which space
// you're in, switching space, Profile, Notifications, Sign-in and Help
// (v1.7.1: Profile and Help live here, not in the sidebar), and signing out.
// v1.72.2 (D-394, QA visual S4/G6): built on the shared menu (the same look,
// layer and keys as every other menu); the View and Text size choices are
// radio items of the menu.
export interface SpaceLink {
  href: string;
  label: string;
}

export function ProfileMenu({
  name,
  email,
  initials,
  photo = null,
  approver = false,
  spaceLabel,
  otherSpaces,
  unread,
  view = null,
  textSize = "M",
}: {
  name: string;
  email: string;
  initials: string;
  photo?: string | null; // D-230: the person's photo
  approver?: boolean; // v1.49.0: the default picture (blue for approvers, white for users)
  spaceLabel: string;
  otherSpaces: SpaceLink[];
  unread: number;
  view?: WorkspaceView | null; // D-210: Compact or Classic (My approvals space)
  textSize?: TextSize; // D-211: the Classic view's text size
}) {
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const choice = useViewChoice(view ?? "COMPACT", textSize);

  useEffect(() => {
    if (choice.message) toast({ tone: "error", title: "Your view wasn't saved.", body: choice.message });
  }, [choice.message, toast]);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  const entries: MenuItem[] = [
    ...(otherSpaces.length > 0 ? [{ kind: "heading" as const, label: "Switch space" }, ...otherSpaces.map((space) => ({ label: space.label, href: space.href }))] : []),
    ...(view
      ? [
          { kind: "separator" as const, label: "view" },
          { kind: "heading" as const, label: "View" },
          ...WORKSPACE_VIEWS.map((option) => ({ kind: "radio" as const, label: VIEW_LABEL[option], checked: choice.view === option, disabled: choice.pending, onSelect: () => choice.choose(option), testId: `view-${option.toLowerCase()}` })),
          ...(choice.view === "CLASSIC"
            ? [
                { kind: "heading" as const, label: "Text size" },
                ...TEXT_SIZES.map((option) => ({ kind: "radio" as const, label: TEXT_SIZE_LABEL[option], hint: `${Math.round(TEXT_SCALE[option] * 100)}%`, checked: choice.text === option, onSelect: () => choice.chooseText(option), testId: `text-size-${option}` })),
              ]
            : []),
        ]
      : []),
    { kind: "separator", label: "pages" },
    { label: "Profile", href: "/users/profile" },
    { label: "Inbox", href: "/users/inbox", badge: unread > 0 ? (unread > 99 ? "99+" : String(unread)) : undefined },
    { label: "Sign-in & devices", href: "/users/security" },
    { label: "Help", href: "/users/help" },
    // v1.14.0 (D-167): the onboarding tour, from any space.
    { label: "Take the tour", href: "/users?tour=1" },
    { kind: "separator", label: "end" },
    { label: busy ? "Signing out…" : "Sign out", tone: "danger", disabled: busy, onSelect: () => void signOut() },
  ];
  // No separator straight under the header (when there is nothing to switch to).
  const items = entries[0]?.kind === "separator" ? entries.slice(1) : entries;

  return (
    <Menu
      key={pathname} // a page change closes it
      label={`Account menu for ${name}`}
      menuLabel="Account"
      align="right"
      menuClass="w-72"
      buttonClass="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 hover:bg-surface-muted sm:rounded-lg sm:pl-2"
      header={
        <div className="border-b border-line px-3 pb-3 pt-2">
          <p className="font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 break-all text-caption text-ink-muted">
            <Email address={email} />
          </p>
          <p className="mt-2 text-caption text-ink-muted">
            Space: <span className="rounded-full bg-primary-50 px-2 py-px font-semibold text-primary-700">{spaceLabel}</span>
          </p>
        </div>
      }
      items={items}
      trigger={
        <>
          <span className="hidden text-right sm:block">
            <span className="block text-label font-semibold leading-tight text-ink">{name}</span>
            <span className="mt-0.5 inline-block rounded-full bg-primary-50 px-2 py-px text-[length:calc(11px*var(--text-scale,1))] font-semibold leading-4 text-primary-700">{spaceLabel}</span>
          </span>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the person's own small photo
            <img src={photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" data-testid="menu-photo" />
          ) : (
            // v1.49.0 (owner): the brand's circular icon until a photo is uploaded.
            // eslint-disable-next-line @next/next/no-img-element -- static brand image
            <img src={defaultAvatar(approver)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-line" data-testid="menu-photo-default" data-initials={initials} />
          )}
          <svg viewBox="0 0 20 20" className="hidden h-4 w-4 text-ink-faint sm:block" fill="currentColor" aria-hidden="true">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
          </svg>
        </>
      }
    />
  );
}
