// Helpers for the landing page's one-click demo sign-in (src/app/demo/[role]/route.ts). No server-only import: unit-tested.
import type { Role } from "./types";

export const DEMO_USER: Record<Role, string> = { supplier: "vihar.supplier", clerk: "priya.clerk", approver: "neha.approver" };

/** Only same-site absolute paths: "/plantpay/journey" yes; "//evil.example", "https://…", "/\evil" and control characters no. */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return undefined;
  return next;
}
