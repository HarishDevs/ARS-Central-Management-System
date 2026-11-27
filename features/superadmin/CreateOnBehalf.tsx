"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { PersonSelect, type PersonChoice } from "@/features/ui/PersonSelect";

// v1.94.0 (D-458, owner: Create = "On behalf of"): pick the person, then open
// the usual New request / Create task / Raise ticket form for them. The form
// says who it is for; the server checks again that you are the Super Admin and
// that the person is active and has the module, and the item becomes theirs.
export function CreateOnBehalf({ people }: { people: PersonChoice[] }) {
  const [personId, setPersonId] = useState<number | null>(null);
  const id = useId();
  const href = (path: string) => (personId ? `${path}?onBehalfOf=${personId}` : "#");
  const link = (path: string, label: string, testId: string) =>
    personId ? (
      <Link href={href(path)} className="btn-secondary btn-compact" data-testid={testId}>
        {label}
      </Link>
    ) : (
      <span aria-disabled="true" className="btn-secondary btn-compact cursor-not-allowed opacity-60">
        {label}
      </span>
    );
  return (
    <div className="space-y-3" data-testid="create-on-behalf">
      <div className="max-w-md">
        <label id={`${id}-label`} className="field-label">
          Create for
        </label>
        <PersonSelect options={people} value={personId} onChange={setPersonId} ariaLabel="Create for" placeholder="Choose the person it is for…" testId="on-behalf-person" />
      </div>
      <div className="flex flex-wrap gap-2">
        {link("/users/custom", "New approval request", "on-behalf-request")}
        {link("/users/tasks/new", "New task", "on-behalf-task")}
        {link("/users/tickets/new", "New ticket", "on-behalf-ticket")}
      </div>
      <p className="text-caption text-ink-muted">
        The item is theirs: they are its requester or creator and every usual rule applies (for example, nobody approves their own request). It shows &ldquo;Created by Super Admin on behalf of&rdquo;
        them.
      </p>
    </div>
  );
}
