import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { approverValue, beforeAfter, buildImpact, clerkValue, IMPACT_ASSUMPTIONS, supplierValue } from "./impact";

describe("impact figures", async () => {
  const { loadSeed } = await import("./store");
  const s = loadSeed();

  it("counts are consistent with the records", () => {
    const m = buildImpact(s);
    expect(m.totalInvoices).toBe(s.invoices.length);
    expect(m.exceptionsWithCause).toBeLessThanOrEqual(m.exceptionsTotal);
    expect(m.autoClean).toBeGreaterThanOrEqual(0);
    expect(m.hoursSaved).toBeCloseTo((m.autoClean * IMPACT_ASSUMPTIONS.manualMinutesPerInvoice) / 60, 0);
    expect(m.duplicateValue).toBeGreaterThanOrEqual(0);
  });

  it("every role gets its own message and the before/after table marks assumptions", () => {
    expect(clerkValue(s).lines.length).toBe(2);
    expect(approverValue(s, "L1").lines[0]).toMatch(/await/);
    expect(supplierValue(s, "V-1001", "vihar.supplier").lines[0]).toMatch(/open invoice/);
    const rows = beforeAfter(buildImpact(s));
    expect(rows.some((r) => r.assumed)).toBe(true);
    expect(rows.some((r) => !r.assumed)).toBe(true);
  });
});
