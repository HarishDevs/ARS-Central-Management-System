import Link from "next/link";
import type { RunRecord } from "@/lib/db/repositories/automations.repository";
import { indiaDateTimeText } from "@/server/modules/settings";

// v1.68.0 (D-380): a rule's run log (its last 200 runs: time, trigger, task,
// steps done, result or error) and its webhook calls, for the project's
// owners and editors. A plain table: readable by screen readers and at phone
// width (it scrolls inside its card).
const RESULT_TEXT: Record<RunRecord["status"], string> = { RUNNING: "Running", SUCCEEDED: "Done", FAILED: "Failed", SKIPPED: "Not run" };
const RESULT_TONE: Record<RunRecord["status"], string> = { RUNNING: "text-ink-muted", SUCCEEDED: "text-success-600", FAILED: "text-danger-600", SKIPPED: "text-warning-600" };

export function RunLog({ runs }: { runs: RunRecord[] }) {
  return (
    <section className="card px-5 py-4" aria-labelledby="run-log-heading" data-testid="run-log">
      <h2 id="run-log-heading" className="mb-1 font-semibold">
        Run log
      </h2>
      <p className="mb-3 text-caption text-ink-muted">The last 200 runs, newest first. Changes are made by ARS-CMS Automation for this rule, with its owner&apos;s rights.</p>
      {runs.length === 0 ? (
        <p className="text-label text-ink-muted">It hasn&apos;t run yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-label">
            <caption className="sr-only">Runs of this automation</caption>
            <thead className="text-caption text-ink-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">When</th>
                <th scope="col" className="py-1 pr-3 font-medium">Trigger</th>
                <th scope="col" className="py-1 pr-3 font-medium">Task</th>
                <th scope="col" className="py-1 pr-3 font-medium">Steps</th>
                <th scope="col" className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {runs.map((run) => (
                <tr key={run.id} data-testid="run-row">
                  <td className="whitespace-nowrap py-2 pr-3">{indiaDateTimeText(run.startedAt)}</td>
                  <td className="py-2 pr-3">
                    {run.triggerLabel}
                    {run.depth > 1 && <span className="block text-caption text-ink-muted">Started by another automation (chain step {run.depth})</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">{run.taskId ? <Link href={`/users/tasks/${run.taskId}`} className="link">{run.taskNo ?? `#${run.taskId}`}</Link> : "—"}</td>
                  <td className="py-2 pr-3">
                    {run.steps.length ? (
                      <ol className="list-decimal space-y-0.5 pl-4">
                        {run.steps.map((step, index) => (
                          <li key={index} className={step.ok ? "" : "text-danger-600"}>
                            {step.label}
                            {step.message ? <span className="text-ink-muted">: {step.message}</span> : null}
                            {!step.ok && <span className="sr-only"> (failed)</span>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`py-2 ${RESULT_TONE[run.status]}`}>
                    <span className="font-semibold">{RESULT_TEXT[run.status]}</span>
                    {run.error && <span className="block text-caption">{run.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function WebhookCalls({ calls }: { calls: { id: number; receivedAt: Date; status: string; httpStatus: number; taskId: number | null; error: string | null }[] }) {
  return (
    <section className="card px-5 py-4" aria-labelledby="webhook-calls-heading" data-testid="webhook-calls">
      <h2 id="webhook-calls-heading" className="mb-1 font-semibold">
        Webhook calls
      </h2>
      <p className="mb-3 text-caption text-ink-muted">The last 20 calls to this rule&apos;s address. Bodies of accepted calls are kept for 30 days.</p>
      {calls.length === 0 ? (
        <p className="text-label text-ink-muted">No calls yet.</p>
      ) : (
        <ul className="divide-y divide-line text-label">
          {calls.map((call) => (
            <li key={call.id} className="flex flex-wrap gap-x-3 py-1.5">
              <span className="whitespace-nowrap">{indiaDateTimeText(call.receivedAt)}</span>
              <span className={call.status === "ACCEPTED" ? "text-success-600" : "text-danger-600"}>
                {call.status === "ACCEPTED" ? "Accepted" : call.status === "REFUSED" ? "Refused" : "Not done"} ({call.httpStatus})
              </span>
              {call.taskId && (
                <Link href={`/users/tasks/${call.taskId}`} className="link">
                  task
                </Link>
              )}
              {call.error && <span className="text-ink-muted">{call.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
