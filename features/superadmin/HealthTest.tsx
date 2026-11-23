"use client";

import { testDriveBackupAction, testSendAction } from "@/app/superadmin/settings/actions";
import { ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";

// v1.84.0 (D-411): the Test button on a Health console card. The same audited
// Super Admin actions as the Connections pages: a test email or WhatsApp to
// the Super Admin's own address and number, or the Drive folder check (reads
// the folder's details; uploads nothing).
export function HealthTestButton({ test, title }: { test: "EMAIL" | "WHATSAPP" | "DRIVE"; title: string }) {
  const { result, pending, onSubmit } = useActionForm(test === "DRIVE" ? testDriveBackupAction : testSendAction);
  return (
    <form onSubmit={onSubmit} className="inline-flex flex-col items-end gap-1">
      {test !== "DRIVE" && <input type="hidden" name="channel" value={test} />}
      <SubmitButton pending={pending} variant="secondary" className="btn-compact">
        Test<span className="sr-only"> {title}</span>
      </SubmitButton>
      <ResultMessage result={result} inline />
    </form>
  );
}
