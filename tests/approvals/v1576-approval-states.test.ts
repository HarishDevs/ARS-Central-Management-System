import { beforeEach, describe, expect, it, vi } from "vitest";

// v1.57.6 (D-347, owner): "lock and check" for the work-step task mirror and
// "withdraw on close" for advice questions, with the database mocked.
const tasks = vi.hoisted(() => ({ findTask: vi.fn(), updateTask: vi.fn(), appendTaskEvent: vi.fn(), insertTask: vi.fn() }));
const consults = vi.hoisted(() => ({ findConsultation: vi.fn(), answerConsultationRow: vi.fn() }));
const approvals = vi.hoisted(() => ({ findRequest: vi.fn() }));
const logger = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("@/lib/db/repositories/tasks.repository", () => tasks);
vi.mock("@/lib/logging/logger", () => logger);
vi.mock("@/lib/db/repositories/work.repository", () => ({ addFollower: vi.fn(), generalTypeVersion: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDbPool: () => ({ query: vi.fn() }) }));
vi.mock("@/lib/db/repositories/approvals.repository", () => ({
  endOfIndiaDay: vi.fn(),
  findWorkflowVersion: vi.fn(async () => null),
  lockRequest: vi.fn(),
  nextRequestNumber: vi.fn(),
  findRequest: approvals.findRequest,
  isParticipant: vi.fn(),
  findRequestByNumber: vi.fn(),
  appendEvents: vi.fn(),
}));
vi.mock("@/lib/db/repositories/consult.repository", () => ({ ...consults, hasOpenConsultation: vi.fn(), insertConsultation: vi.fn(), insertLink: vi.fn(), listLinkedIds: vi.fn() }));
vi.mock("@/lib/db/repositories/users.repository", () => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db/repositories/collab.repository", () => ({ activeDelegatorsFor: vi.fn() }));
vi.mock("@/lib/db/repositories/audit.repository", () => ({ recordAudit: vi.fn() }));
vi.mock("@/server/notifications/notify", () => ({ notify: vi.fn() }));
vi.mock("@/server/approvals/messages", () => ({ requestLink: () => "http://x" }));
vi.mock("@/lib/http/app-url", () => ({ appBaseUrl: () => "http://x" }));

const { mirrorWorkTasks } = await import("@/server/approvals/work-mirror");
const { answerConsultation } = await import("@/server/approvals/consult");

const step = { task_key: "work-1", node_id: "work", node_label: "Fit the part", approver_id: 7, status: "APPROVED", due_at: null, decided_by: 7, title: "Fix", request_no: "RQ-1", requester_id: 3, deleted_at: null, workflow_version_id: 1 };
const mirrorRow = { id: 50, status: "OPEN", assignee_id: 7, due_at: null, row_version: 1, task_key: "work-1" };
const task = (status: string, rowVersion: number) => ({ id: 50, status, rowVersion, dueAt: null, assigneeId: 7, deletedAt: null });

function fakeDb(steps: object[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("approval_events")) return [[]];
      if (sql.includes("FROM approval_tasks")) return [steps];
      if (sql.includes("FROM tasks")) return [[mirrorRow]];
      return [[]];
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("work mirror: lock and check (Risk 4)", () => {
  it("locks the task, writes with its row_version and logs from the status read under the lock", async () => {
    tasks.findTask.mockResolvedValue(task("IN_PROGRESS", 4));
    tasks.updateTask.mockResolvedValue(true);
    await mirrorWorkTasks(9, fakeDb([step]) as never);
    expect(tasks.findTask).toHaveBeenCalledWith(50, expect.anything(), true);
    expect(tasks.updateTask).toHaveBeenCalledWith(50, 4, expect.objectContaining({ status: "COMPLETED", completed_by: 7 }), expect.anything());
    expect(tasks.appendTaskEvent).toHaveBeenCalledWith(50, expect.objectContaining({ type: "COMPLETE", from: "IN_PROGRESS", to: "COMPLETED" }), expect.anything());
  });

  it("re-reads and tries again when the row_version check fails", async () => {
    tasks.findTask.mockResolvedValueOnce(task("OPEN", 1)).mockResolvedValueOnce(task("BLOCKED", 2));
    tasks.updateTask.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await mirrorWorkTasks(9, fakeDb([{ ...step, status: "REJECTED", decided_by: null }]) as never);
    expect(tasks.findTask).toHaveBeenCalledTimes(2);
    expect(tasks.updateTask).toHaveBeenLastCalledWith(50, 2, expect.objectContaining({ status: "CANCELLED", cancelled_by: null }), expect.anything());
    expect(tasks.appendTaskEvent).toHaveBeenCalledTimes(1);
    expect(tasks.appendTaskEvent).toHaveBeenCalledWith(50, expect.objectContaining({ type: "CANCEL", from: "BLOCKED" }), expect.anything());
  });

  it("gives up after three tries, logs, and never throws into the decision", async () => {
    tasks.findTask.mockResolvedValue(task("OPEN", 1));
    tasks.updateTask.mockResolvedValue(false);
    await expect(mirrorWorkTasks(9, fakeDb([step]) as never)).resolves.toBeUndefined();
    expect(tasks.findTask).toHaveBeenCalledTimes(3);
    expect(tasks.appendTaskEvent).not.toHaveBeenCalled();
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  it("leaves a task finished meanwhile as it is", async () => {
    tasks.findTask.mockResolvedValue(task("COMPLETED", 3));
    await mirrorWorkTasks(9, fakeDb([step]) as never);
    expect(tasks.updateTask).not.toHaveBeenCalled();
    expect(tasks.appendTaskEvent).not.toHaveBeenCalled();
  });
});

describe("answering advice: withdraw on close (Risk 9)", () => {
  const me = { id: 11, roles: ["USER"] as never };
  const consultation = (status: string) => ({ id: 5, requestId: 9, consulteeId: 11, requestedBy: 2, consulteeName: "K", status });

  it("refuses a withdrawn consultation with a clear message", async () => {
    consults.findConsultation.mockResolvedValue(consultation("WITHDRAWN"));
    const result = await answerConsultation({ consultationId: 5, answer: "Fine" }, me);
    expect(result).toMatchObject({ ok: false, code: "WITHDRAWN" });
    expect(result.ok ? "" : result.message).toMatch(/closed/);
    expect(consults.answerConsultationRow).not.toHaveBeenCalled();
  });

  it("refuses when the request has closed, even if the row is still open", async () => {
    consults.findConsultation.mockResolvedValue(consultation("OPEN"));
    approvals.findRequest.mockResolvedValue({ id: 9, state: { status: "APPROVED" } });
    expect(await answerConsultation({ consultationId: 5, answer: "Fine" }, me)).toMatchObject({ ok: false, code: "CLOSED" });
    approvals.findRequest.mockResolvedValue(null); // deleted
    expect(await answerConsultation({ consultationId: 5, answer: "Fine" }, me)).toMatchObject({ ok: false, code: "CLOSED" });
    expect(consults.answerConsultationRow).not.toHaveBeenCalled();
  });

  it("says withdrawn when it loses the race to the request closing", async () => {
    consults.findConsultation.mockResolvedValueOnce(consultation("OPEN")).mockResolvedValueOnce(consultation("WITHDRAWN"));
    approvals.findRequest.mockResolvedValue({ id: 9, state: { status: "IN_PROGRESS" } });
    consults.answerConsultationRow.mockResolvedValue(false);
    expect(await answerConsultation({ consultationId: 5, answer: "Fine" }, me)).toMatchObject({ ok: false, code: "WITHDRAWN" });
  });
});
