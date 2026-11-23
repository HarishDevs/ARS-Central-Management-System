"use client";

import { testSendAction } from "@/app/superadmin/settings/actions";
import { ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { SafeText } from "@/features/ui/SafeText";
import { Hint } from "@/features/ui/Hint";

// F-52 test send: to the Super Admin's own email and number only.
function TestButton({ channel, label, target }: { channel: "EMAIL" | "WHATSAPP"; label: string; target: string }) {
  const { result, pending, onSubmit } = useActionForm(testSendAction);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="channel" value={channel} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} variant="secondary" className="btn-compact">
          {label}
        </SubmitButton>
        <span className="text-label text-ink-muted">to <SafeText text={target} /></span>
      </div>
      <ResultMessage result={result} inline />
    </form>
  );
}

// v1.84.0 (D-411): each Connections page shows its own channel's test (`only`).
export function TestSendPanel({ email, whatsapp, only }: { email: string; whatsapp: string | null; only?: "EMAIL" | "WHATSAPP" }) {
  const title = only === "EMAIL" ? "Test email" : only === "WHATSAPP" ? "Test WhatsApp" : "Test the providers";
  const hint = only === "EMAIL" ? "Sends a test to your own email. Save any new keys first." : only === "WHATSAPP" ? "Sends a test to your own WhatsApp number. Save any new keys first." : "Sends a test to your own email and WhatsApp number. Save any new keys first.";
  return (
    <section className="card">
      <div className="flex items-center gap-1.5 border-b border-line px-5 py-4">
        <h2 className="font-semibold">{title}</h2>
        <Hint text={hint} align="start" />
      </div>
      <div className="space-y-4 px-5 py-5">
        {only !== "WHATSAPP" && <TestButton channel="EMAIL" label="Send test email" target={email} />}
        {only !== "EMAIL" && <TestButton channel="WHATSAPP" label="Send test WhatsApp" target={whatsapp ? `+${whatsapp}` : "no number on your account"} />}
      </div>
    </section>
  );
}
