import { describe, expect, it } from "vitest";
import { FILE_ROUTE } from "@/lib/security/file-routes";
import { likeEscape } from "@/server/search/filters";

// v1.71.2 QA hardening (D-389): the pure parts.
describe("file routes keep their own sandbox CSP (QA L-2)", () => {
  it("matches every route that sends a file", () => {
    for (const path of ["/api/attachments/12", "/api/files/7", "/api/forms/abcDEF_-123/cover", "/api/users/5/photo", "/api/requests/9/summary.pdf"]) {
      expect(FILE_ROUTE.test(path)).toBe(true);
    }
  });
  it("does not match pages or other API routes", () => {
    for (const path of ["/api/files", "/api/files/7/extra", "/api/forms/x/submit", "/api/users/5", "/users/requests/9", "/api/health"]) {
      expect(FILE_ROUTE.test(path)).toBe(false);
    }
  });
});

describe("LIKE searches escape wildcards (QA L-3)", () => {
  it("% and _ match themselves", () => {
    expect(likeEscape("%")).toBe("%\\%%");
    expect(likeEscape("a_b")).toBe("%a\\_b%");
  });
});
