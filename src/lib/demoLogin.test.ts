import { describe, expect, it } from "vitest";
import { DEMO_USER, safeNext } from "./demoLogin";
import { findUser, ROLE_HOME } from "./users";

describe("landing demo sign-in", () => {
  it("maps each role button to an existing demo account of that role", () => {
    for (const [role, username] of Object.entries(DEMO_USER)) {
      const u = findUser(username);
      expect(u, username).toBeDefined();
      expect(u!.role).toBe(role);
      expect(ROLE_HOME[u!.role]).toMatch(/^\//);
    }
    expect(findUser(DEMO_USER.approver)!.approverLevel).toBe("L1");
  });
  it("accepts same-site paths only", () => {
    expect(safeNext("/plantpay/journey")).toBe("/plantpay/journey");
    expect(safeNext("/clerk?x=1")).toBe("/clerk?x=1");
    for (const bad of [null, undefined, "", "plantpay", "//evil.example", "https://evil.example", "/\\evil.example", "/a\nb", "javascript:alert(1)"]) expect(safeNext(bad)).toBeUndefined();
  });
});
