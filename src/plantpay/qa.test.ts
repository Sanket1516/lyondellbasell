// Pre-demo QA regressions (see NOTES.md "QA and crash-free demo pass"). Each test pins a defect the smoke test found.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlantPayEngine } from "./engine";
import { getSourceStates, pendingEvents, setOutage } from "./integration";
import { announceInvoiceReceived } from "./sources/writers";
import { buildJourney } from "./journey/build";
import { journeyProblems } from "./journey/validate";
import { seedPlantPay } from "./runtime";
import { SOURCE_IDS } from "./sources/schemas";

let dir: string;
let eng: PlantPayEngine;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-qa-"));
  eng = seedPlantPay({ dir, integrationFile: ":memory:", today: "2026-11-12" });
}, 180_000);
afterAll(() => { try { eng.connectors.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly */ } });

const count = (sql: string) => (eng.integration.prepare(sql).get() as { n: number }).n;

describe("evaluating an invoice that cannot be read stores nothing", () => {
  it("an unknown invoice number explains itself but leaves no row, task, event or audit entry", () => {
    const before = [count("SELECT COUNT(*) n FROM evaluations"), count("SELECT COUNT(*) n FROM audit_events"), count("SELECT COUNT(*) n FROM workflow_events"), count("SELECT COUNT(*) n FROM workflow_tasks")];
    for (const id of ["NOPE-1", " ", "<script>alert(1)</script>"]) {
      const r = eng.evaluate(id, { actor: "qa" });
      expect(r.status).toBe("incomplete");
      expect(r.summary).toMatch(/^Incomplete: Invoice .* was not found/);
      expect(eng.stored(id)).toBeUndefined();
    }
    expect([count("SELECT COUNT(*) n FROM evaluations"), count("SELECT COUNT(*) n FROM audit_events"), count("SELECT COUNT(*) n FROM workflow_events"), count("SELECT COUNT(*) n FROM workflow_tasks")]).toEqual(before);
  });

  it("re-evaluating while Finance is offline keeps the last good result instead of overwriting it with an empty one", () => {
    const good = eng.stored("INV-7781")!;
    expect(good.status).toBe("review");
    setOutage(eng.integration, "finance", true);
    try {
      const r = eng.evaluate("INV-7781", { actor: "qa" });
      expect(r.status).toBe("incomplete");
      expect(r.unavailable).toContain("finance");
      expect(eng.stored("INV-7781")!.status).toBe("review");
      expect(eng.stored("INV-7781")!.checks.length).toBe(good.checks.length);
    } finally { setOutage(eng.integration, "finance", false); }
    expect(eng.evaluate("INV-7781", { actor: "qa" }).status).toBe("review");
  });

  it("an invoice event that arrives while Finance is offline stays queued and is re-matched when Finance is back", () => {
    eng.processEvents();
    announceInvoiceReceived({ integration: eng.integration, dir }, "INV-7782");
    setOutage(eng.integration, "finance", true);
    try {
      const r = eng.processEvents();
      expect(r.deferred).toBeGreaterThanOrEqual(1);
      expect(pendingEvents(eng.integration).length).toBeGreaterThanOrEqual(1);
      expect(eng.stored("INV-7782")!.status).toBe("pass");
    } finally { setOutage(eng.integration, "finance", false); }
    const r2 = eng.processEvents();
    expect(r2.reevaluated).toContain("INV-7782");
    expect(pendingEvents(eng.integration)).toHaveLength(0);
  });
});

describe("the Golden Journey builds even when a demo outage was left on", () => {
  it.each(SOURCE_IDS)("live %s offline: every screen still has live content, and the live switch is untouched", (src) => {
    setOutage(eng.integration, src, true);
    try {
      const j = buildJourney(eng);
      expect(journeyProblems(j)).toEqual([]);
      expect(j.mode).toBe("live");
      expect(j.steps[1].sources.every((s) => s.status === "up")).toBe(true);
      expect(getSourceStates(eng.integration).find((s) => s.source === src)?.outage).toBe(true);
    } finally { setOutage(eng.integration, src, false); }
  }, 60_000);
});
