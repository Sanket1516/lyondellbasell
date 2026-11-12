import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

describe("session token", () => {
  it("accepts a signed token and rejects a tampered one", async () => {
    const { makeToken, verifyToken } = await import("./session");
    const t = makeToken("priya.clerk");
    expect(verifyToken(t)?.role).toBe("clerk");
    expect(verifyToken(t.replace("priya.clerk", "neha.approver"))).toBeUndefined();
    expect(verifyToken("garbage")).toBeUndefined();
    expect(verifyToken(undefined)).toBeUndefined();
  });
});
