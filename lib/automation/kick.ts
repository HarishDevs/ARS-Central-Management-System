import "server-only";
import { after } from "next/server";
import { automationContext } from "@/lib/automation/context";
import { logError } from "@/lib/logging/logger";

// v1.68.0 (D-380): after a request that wrote an automation event commits and
// answers, the engine looks at the waiting events straight away (so a rule
// acts within a second or two). Outside a request (the job runner, scripts,
// tests) nothing is started here: the job runner's "Project automations" step
// handles waiting events every 5 minutes, and tests call the engine directly.
// Never run inside the transaction that wrote the event. Inside a running
// rule the engine's own loop picks up the events its steps make.
export function kickAutomations(): void {
  if (automationContext()) return;
  try {
    after(async () => {
      try {
        const { processAutomationEvents } = await import("@/server/work/automation-engine");
        await processAutomationEvents();
      } catch (error) {
        logError("automations: processing after the request failed", error);
      }
    });
  } catch {
    // Not in a request: the job runner will pick the event up.
  }
}
