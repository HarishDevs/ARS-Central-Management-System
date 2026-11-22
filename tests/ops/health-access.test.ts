import { beforeEach, describe, expect, it, vi } from "vitest";

// D-389 (QA security L-4): who sees the health checks' details.
const session = vi.hoisted(() => ({ current: null as null | { user: { active: boolean; roles: string[] } } }));
const limit = vi.hoisted(() => ({ over: false, buckets: [] as string[] }));
vi.mock("@/server/auth/session", () => ({ getCurrentSession: async () => session.current }));
vi.mock("@/server/security/limits", () => ({
  overLimit: async (bucket: string) => {
    limit.buckets.push(bucket);
    return limit.over;
  },
}));
vi.mock("@/config/environment", () => ({ getEnv: () => ({ HEALTH_SECRET: "monitor-secret-for-tests-0123456789" }) }));

const { healthAccess, healthSecretMatches } = await import("@/server/ops/health-access");
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/health", { headers });

beforeEach(() => {
  session.current = null;
  limit.over = false;
  limit.buckets = [];
});

describe("health check access", () => {
  it("the monitor secret gets every field (constant-time compare)", async () => {
    expect(await healthAccess(request({ "x-health-secret": "monitor-secret-for-tests-0123456789" }))).toBe("FULL");
    expect(healthSecretMatches("wrong", "monitor-secret-for-tests-0123456789")).toBe(false);
    expect(healthSecretMatches("anything", undefined)).toBe(false);
    expect(healthSecretMatches(null, "x")).toBe(false);
  });

  it("a signed-in Super Admin gets every field; anyone else signed in only the basics, not counted per address", async () => {
    session.current = { user: { active: true, roles: ["USER", "IT_ADMIN", "SUPER_ADMIN"] } };
    expect(await healthAccess(request())).toBe("FULL");
    session.current = { user: { active: true, roles: ["USER", "IT_ADMIN"] } };
    expect(await healthAccess(request())).toBe("BASIC");
    expect(limit.buckets).toEqual([]);
  });

  it("anonymous callers get the basics and are limited per address", async () => {
    expect(await healthAccess(request({ "cf-connecting-ip": "203.0.113.9", "x-health-secret": "wrong" }))).toBe("BASIC");
    expect(limit.buckets).toEqual(["health:203.0.113.9"]);
    limit.over = true;
    expect(await healthAccess(request({ "cf-connecting-ip": "203.0.113.9" }))).toBe("LIMITED");
  });
});
