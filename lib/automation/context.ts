import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// v1.68.0 (D-380): while a project automation runs its steps, the work it
// does through the ordinary task services is recorded as the system user
// "ARS-CMS Automation" on behalf of the rule (activity stories read
// "<rule name> (automation) …", the audit log names the system user acting on
// behalf of the rule's owner), and the changes it makes carry the chain (the
// rules that led to them) so the engine can stop loops.
export interface AutomationContext {
  ruleId: number;
  ruleName: string;
  ownerId: number;
  systemId: number;
  depth: number; // this rule's place in the chain (1 = started by a person's change)
  chain: number[]; // rule ids that led here, this rule last
}

const store = new AsyncLocalStorage<AutomationContext>();

export function runAsAutomation<T>(context: AutomationContext, work: () => Promise<T>): Promise<T> {
  return store.run(context, work);
}
export function automationContext(): AutomationContext | undefined {
  return store.getStore();
}
