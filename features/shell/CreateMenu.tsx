"use client";

import { Briefcase, CheckSquare, FileCheck2, FolderKanban, Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { CREATE_TASK_EVENT } from "@/features/work/client";
import { Menu, type MenuItem } from "@/features/ui/Menu";

// D-221 (owner: "the new button should be at the top; on clicking it asks
// create Approval, Task, Project"): the sidebar's + Create, as in Asana.
// Approval opens New request; Task opens the Draft task panel; Project opens
// the new-project steps; Information (when the person has it) opens its form.
// D-229: `compact` is the collapsed sidebar's round + (the menu opens beside it).
// v1.69.0 (D-382): Portfolio (Projects module and the "pm_portfolios" switch) opens the new-portfolio steps.
// v1.73.0 (D-396, spec NAV §3.6 / O-01): the shared dropdown menu (↓/↑,
// Home/End, a letter jumps, Escape gives focus back to + Create, Tab closes),
// in the spec's order (Task · Project · Portfolio) after Approval request,
// with Information after a line. The menu is placed against the window, so
// the folded sidebar never clips it.
export function CreateMenu({ approval, task, project = task, portfolio = false, information, compact = false }: { approval: boolean; task: boolean; project?: boolean; portfolio?: boolean; information: boolean; compact?: boolean }) {
  const router = useRouter();
  const icon = (Icon: typeof Plus) => <Icon aria-hidden="true" className="h-5 w-5 text-primary-700" />;
  const items: MenuItem[] = [
    ...(approval ? [{ label: "Approval request", hint: "Ask people to approve, at any levels", icon: icon(FileCheck2), onSelect: () => router.push("/users/custom") }] : []),
    ...(task ? [{ label: "Task", hint: "Ad hoc or periodic", icon: icon(CheckSquare), onSelect: () => window.dispatchEvent(new CustomEvent(CREATE_TASK_EVENT, { detail: { projectId: null } })) }] : []),
    ...(project ? [{ label: "Project", hint: "Blank or from a template", icon: icon(FolderKanban), onSelect: () => router.push("/users/work/projects/new") }] : []),
    ...(portfolio ? [{ label: "Portfolio", hint: "Follow several projects together", icon: icon(Briefcase), onSelect: () => router.push("/users/work/portfolios/new") }] : []),
    ...(information ? [{ kind: "separator" as const, label: "" }, { label: "Information", hint: "Tell people something", icon: icon(Megaphone), onSelect: () => router.push("/users/information/new") }] : []),
  ];
  if (!items.some((item) => item.kind !== "separator")) return null;
  // A lone separator (only Information) is not drawn.
  const shown = items[0]?.kind === "separator" ? items.slice(1) : items;
  return (
    <div className={compact ? "relative mb-2" : "relative px-3 pt-3"} data-testid="create-menu">
      <Menu
        label="Create"
        title={compact ? "Create" : undefined}
        align="left"
        className={compact ? "relative inline-flex" : "relative flex w-full"}
        buttonClass={compact ? "inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary-solid text-on-solid shadow-button hover:bg-primary-solid-hover" : "btn-primary inline-flex w-full items-center justify-center gap-1.5"}
        menuClass="w-64"
        trigger={
          compact ? (
            <Plus aria-hidden="true" className="h-5 w-5" />
          ) : (
            <>
              <Plus aria-hidden="true" className="h-4 w-4" /> Create
            </>
          )
        }
        items={shown}
      />
    </div>
  );
}
