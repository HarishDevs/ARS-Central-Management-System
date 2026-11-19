import { beforeEach, describe, expect, it, vi } from "vitest";

// v1.57.6 (D-348, owner): background job state machines. The database parts
// are in tests/integration/v1576-job-states.int.test.ts; these cover the pure
// rules and the run lock with a fake connection.
const connection = { query: vi.fn(), release: vi.fn(), destroy: vi.fn() };
vi.mock("@/lib/db/client", () => ({ getDbPool: () => ({ getConnection: async () => connection, query: vi.fn() }) }));

const { exportAfterFailure, EXPORT_MAX_ATTEMPTS } = await import("@/server/reports/background");
const { acquireAutomationLock, runAutomations } = await import("@/server/ops/automation");

describe("export tries (risk 5)", () => {
  it("goes back to the queue until the third try, then fails for good", () => {
    expect(EXPORT_MAX_ATTEMPTS).toBe(3);
    expect(exportAfterFailure(1)).toBe("QUEUED");
    expect(exportAfterFailure(2)).toBe("QUEUED");
    expect(exportAfterFailure(3)).toBe("FAILED");
    expect(exportAfterFailure(4)).toBe("FAILED");
  });
});

describe("one automation run at a time (risk 5)", () => {
  beforeEach(() => {
    connection.query.mockReset();
    connection.release.mockReset();
    connection.destroy.mockReset();
  });

  it("takes the named lock without waiting and releases it on the same connection", async () => {
    connection.query.mockResolvedValueOnce([[{ got: 1 }]]).mockResolvedValueOnce([[{ released: 1 }]]);
    const lock = await acquireAutomationLock();
    expect(lock).not.toBeNull();
    expect(String(connection.query.mock.calls[0]![0])).toMatch(/GET_LOCK\(.*'ars_automation:'.*, 0\)/);
    await lock!.release();
    await lock!.release(); // twice is harmless
    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(String(connection.query.mock.calls[1]![0])).toContain("RELEASE_LOCK");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("returns null while another run holds it (GET_LOCK 0 or NULL)", async () => {
    connection.query.mockResolvedValueOnce([[{ got: 0 }]]);
    expect(await acquireAutomationLock()).toBeNull();
    connection.query.mockResolvedValueOnce([[{ got: null }]]);
    expect(await acquireAutomationLock()).toBeNull();
    expect(connection.release).toHaveBeenCalledTimes(2);
  });

  it("a second run is skipped without running any step", async () => {
    connection.query.mockResolvedValueOnce([[{ got: 0 }]]);
    const report = await runAutomations({ runRef: "unit", trigger: "MANUAL" });
    expect(report).toEqual({ runRef: "unit", steps: {}, failed: [], skipped: "already running" });
    expect(connection.query).toHaveBeenCalledTimes(1);
  });
});
