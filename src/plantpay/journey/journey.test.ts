// Golden Journey: headless end-to-end test. Runs the whole nine-step story (the same builder the API route calls) against a freshly
// seeded copy of the demo data, three times in a row, and checks that every screen has real content, that the story facts hold,
// that the live data is never touched, that the fallback copy is complete and current, and that the script fits the time budget.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSourceStates, verifyAudit } from "../integration";
import type { PlantPayEngine } from "../engine";
import { seedPlantPay } from "../runtime";
import { buildJourney, CAST } from "./build";
import { COPY } from "./copy";
import { FEATURE_NAMES } from "./checklist";
import fallback from "./fallback.json";
import { NOTES, TOTAL_TARGET_SECONDS, estimateSeconds, wordCount } from "./notes";
import { JOURNEY_STEPS, JOURNEY_TITLES, type JourneyData } from "./types";
import { journeyProblems, stepProblems } from "./validate";

let dir: string;
let live: PlantPayEngine;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-journey-test-"));
  live = seedPlantPay({ dir, integrationFile: ":memory:", today: "2026-11-12" });
}, 180_000);
afterAll(() => { try { live.connectors.close(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly */ } });

/** A fingerprint of the live data: if the journey touched it, this changes. */
const liveFingerprint = () => JSON.stringify({
  eval: live.integration.prepare("SELECT invoice_id, status, result_json FROM evaluations ORDER BY invoice_id").all(),
  audit: live.integration.prepare("SELECT COUNT(*) n, MAX(seq) m FROM audit_events").get(),
  wf: live.integration.prepare("SELECT COUNT(*) n, MAX(id) m FROM workflow_events").get(),
  outbox: live.integration.prepare("SELECT COUNT(*) n FROM outbox").get(),
  tasks: live.integration.prepare("SELECT COUNT(*) n, SUM(status = 'open') o FROM workflow_tasks").get(),
  sources: getSourceStates(live.integration),
  grn: live.connectors.warehouse.health().records, po: live.connectors.procurement.health().records, quality: live.connectors.quality.health().records,
});

/** Everything a person would see on a screen, as one string, for the "no raw error text" check. */
const screenText = (j: JourneyData, n: number) => JSON.stringify(j.steps[n as 1]);

describe("golden journey: three consecutive headless runs", () => {
  const runs: JourneyData[] = [];
  const before = { fp: "" };

  it("runs the full journey three times in a row without error and without touching the live data", () => {
    before.fp = liveFingerprint();
    for (let i = 0; i < 3; i++) {
      const j = buildJourney(live);
      runs.push(j);
      // "Pressing Next 9 times": every step, in order, has content
      for (let n = 1; n <= JOURNEY_STEPS; n++) expect(stepProblems(n, j), `run ${i + 1}, step ${n} (${JOURNEY_TITLES[n - 1]})`).toEqual([]);
    }
    expect(runs).toHaveLength(3);
    expect(liveFingerprint()).toBe(before.fp);
  }, 120_000);

  it("Reset restores the exact starting state: all three runs are identical", () => {
    const strip = (j: JourneyData) => JSON.stringify({ ...j, builtAt: "", ms: 0 });
    expect(strip(runs[1])).toBe(strip(runs[0]));
    expect(strip(runs[2])).toBe(strip(runs[0]));
  });

  it("each run finishes in a couple of seconds, far inside the nine-minute budget", () => {
    for (const r of runs) expect(r.ms ?? 0).toBeLessThan(30_000);
  });

  it("step 1: control tower has six healthy sources, counts and a verified audit chain", () => {
    const s = runs[0].steps[1];
    expect(s.sources).toHaveLength(6);
    expect(s.sources.every((x) => x.status === "up")).toBe(true);
    expect(s.counts.total).toBeGreaterThan(600);
    expect(s.counts.demo).toBeGreaterThanOrEqual(15);
    expect(s.integrity.ok).toBe(true);
    expect(s.story.map((r) => r.actual).join(" ")).toContain(CAST.hero);
  });

  it("step 2: the hero invoice and a restricted passport with seven milestones and no internal fields", () => {
    const s = runs[0].steps[2];
    expect(s.invoice.id).toBe(CAST.hero);
    expect(s.passport.milestones).toHaveLength(7);
    const text = JSON.stringify(s.passport);
    expect(text).not.toMatch(/root cause|prediction|duplicate|Anand|amendment|score|shared account|bank/i);
  });

  it("step 3: evidence from all six sources; a Logistics outage is 'not evaluated' (never a guess) and restoring brings the result back", () => {
    const s = runs[0].steps[3];
    expect(s.evidence.every((e) => e.status === "ok" && e.facts.length > 0)).toBe(true);
    expect(s.outage.source).toBe("logistics");
    expect(s.outage.offline.notEvaluated).toContain("weighbridge");
    expect(s.outage.offline.unavailable).toContain("Logistics DB");
    expect(s.outage.online.notEvaluated).toEqual([]);
    expect(s.outage.restored).toEqual(s.outage.online);
    // the outage did not turn a finding into a pass or invent a new one
    expect(s.outage.offline.status).toBe(s.outage.online.status);
  });

  it("step 4: price 412 vs PO 398 vs contract 412; contract and inventory checks; 5 MT normalised; quality rejection found", () => {
    const s = runs[0].steps[4];
    expect(s.priceTrio).toMatchObject({ invoice: 412, po: 398, contract: 412 });
    expect(s.validation.threeWay.state).not.toBe("pass");
    expect(s.validation.contract.headline).toMatch(/C-22/);
    expect(s.validation.inventory.rows.length).toBeGreaterThan(0);
    expect(s.normalisations[0].text).toMatch(/5 MT.*5,000 kg/s);
    expect(s.qualityCase?.statement).toMatch(/rejected/i);
  });

  it("step 5: cause is evidence-supported, counterfactual is exact, RAG cites passages, tasks reach the buyer, the fix re-matches to Pass and is logged", () => {
    const s = runs[0].steps[5];
    const price = s.resolutions.find((r) => r.check === "price")!;
    expect(price.rootCause).toBe("Contract amendment not reflected in the PO");
    expect(price.evidenceStatus).toBe("supported_by_evidence");
    expect(price.counterfactual).toMatch(/would pass the price check if PO 4500001234 line 1 price were updated to ₹412\.00.*assuming all other checks pass\.$/);
    for (const r of s.rag) { expect(r.grounded).toBe(true); expect(r.citations.length).toBeGreaterThan(0); }
    expect(s.rag[1].answer).toMatch(/412/);
    expect(s.tasks.some((t) => t.department === "Procurement" && /Anand Deshpande/.test(t.owner))).toBe(true);
    expect(s.fix.before.status).toBe("review");
    expect(s.fix.after.status).toBe("pass");
    expect(s.fix.passes).toBe(true);
    expect(s.fix.steps[0]).toMatch(/amends PO 4500001234 line 1 from ₹398 to ₹412/);
    expect(s.fix.events.length).toBeGreaterThan(0);
    expect(s.fix.auditEntriesAdded).toBeGreaterThan(0);
    // an unverified prediction is never shown as fact: every cause carries one of the two labels
    for (const r of s.resolutions) expect(["supported_by_evidence", "unverified_prediction"]).toContain(r.evidenceStatus);
  });

  it("step 6: all four signals present, each labelled 'warning, not proof'; combined splitting amount; bank change needs independent verification and creates a task", () => {
    const s = runs[0].steps[6];
    for (const k of ["duplicate", "splitting", "bank", "graph"] as const) { expect(s[k].label).toBe("warning, not proof"); expect(s[k].reasons.length).toBeGreaterThan(0); expect(s[k].flag).toBe(true); }
    expect(s.duplicate.score).toBeGreaterThanOrEqual(70);
    expect(s.splitting.invoices).toHaveLength(3);
    expect(s.splitting.invoices.every((x) => x.totalInr < 100000)).toBe(true);
    expect(s.splitting.combinedInr).toBeGreaterThan(280000);
    expect(s.splitting.combinedInr).toBeLessThan(300000);
    expect(s.bank.requiresIndependentVerification).toBe(true);
    expect(s.bank.task).toMatch(/independently/i);
    expect(s.graph.vendorA).not.toBe(s.graph.vendorB);
    expect(s.graph.edges).toHaveLength(2);
    expect(JSON.stringify(s)).not.toMatch(/fraud|guilty|stole|criminal/i);
  });

  it("step 7: three suppliers with three separate scores, four model outputs with factors, causes labelled by evidence", () => {
    const s = runs[0].steps[7];
    expect(s.suppliers).toHaveLength(3);
    expect(new Set(s.suppliers.map((x) => x.vendorId)).size).toBe(3);
    for (const x of s.suppliers) for (const k of ["relationship", "criticality", "risk"] as const) expect(x[k].score).toBeGreaterThanOrEqual(0);
    expect(s.predictions.map((p) => p.key)).toEqual(["A", "B", "C", "D"]);
    for (const p of s.predictions) { expect(p.probability).toBeGreaterThan(0); expect(p.probability).toBeLessThanOrEqual(1); expect(p.model).toBeTruthy(); expect(p.factors.length).toBeGreaterThan(0); }
    expect(s.causes.every((c) => ["evidence_supported", "unverified_prediction"].includes(c.evidenceStatus))).toBe(true);
    expect(s.priorityNote).toMatch(/payment order/);
  });

  it("step 8: hero path leaves the expected path and returns (rework loop); bottlenecks listed", () => {
    const s = runs[0].steps[8];
    expect(s.expected).toEqual(["Intake", "AP review", "Approval", "Payment"]);
    expect(s.actual!.loops.length).toBeGreaterThanOrEqual(1);
    expect(s.actual!.stations.filter((x) => x === "AP review").length).toBeGreaterThanOrEqual(2);
    expect(s.bottlenecks.length).toBeGreaterThan(0);
    expect(s.totals.invoices).toBeGreaterThan(600);
  });

  it("step 9: audit verifies, all tampering is detected, the passport reads ready for payment, the checklist covers every feature", () => {
    const s = runs[0].steps[9];
    expect(s.integrity.ok).toBe(true);
    expect(s.tamper[0].ok).toBe(true);
    for (const t of s.tamper.slice(1)) { expect(t.ok).toBe(false); expect(t.position).toBeGreaterThan(0); }
    expect(s.readyForPayment).toBe(true);
    expect(s.passport.headline).toMatch(/Approved\. Payment is scheduled/);
    expect(s.checklist.map((c) => c.feature)).toEqual([...FEATURE_NAMES]);
    for (const c of s.checklist) { expect(c.evidence.trim().length).toBeGreaterThan(5); expect(c.step).toBeGreaterThanOrEqual(1); expect(c.step).toBeLessThanOrEqual(9); }
  });

  it("no screen shows raw errors, placeholders or stack traces", () => {
    for (let n = 1; n <= 9; n++) expect(screenText(runs[0], n)).not.toMatch(/undefined|NaN|\[object|Traceback|ENOENT|SQLITE_/);
  });

  it("the live audit chain is still intact after three journeys", () => {
    expect(verifyAudit(live.integration).ok).toBe(true);
  });
});

describe("fallback: pre-computed results exist for every step and are current", () => {
  const fb = fallback as unknown as JourneyData;
  it("has all nine steps with content", () => {
    expect(journeyProblems(fb)).toEqual([]);
  });
  it("tells the same story as a live run (hero, statuses, counts of features)", () => {
    const live1 = buildJourney(live);
    expect(fb.hero).toBe(live1.hero);
    expect(fb.steps[5].fix.after.status).toBe(live1.steps[5].fix.after.status);
    expect(fb.steps[9].checklist.map((c) => c.feature)).toEqual(live1.steps[9].checklist.map((c) => c.feature));
    expect(fb.steps[6].splitting.invoices.map((x) => x.id)).toEqual(live1.steps[6].splitting.invoices.map((x) => x.id));
    expect(fb.steps[4].priceTrio).toEqual(live1.steps[4].priceTrio);
  });
  it("a missing piece of live data is reported as a problem, so the page would use the fallback for that screen", () => {
    const broken = JSON.parse(JSON.stringify(fb)) as JourneyData;
    broken.steps[5].resolutions = [];
    expect(stepProblems(5, broken).length).toBeGreaterThan(0);
    delete (broken.steps as Partial<JourneyData["steps"]>)[7];
    expect(stepProblems(7, broken)).toEqual(["step 7: no data"]);
    const raw = JSON.parse(JSON.stringify(fb)) as JourneyData;
    raw.steps[2].supplierNote = "Error: undefined";
    expect(stepProblems(2, raw).length).toBeGreaterThan(0);
  });
});

describe("presenter notes and timing", () => {
  it("has a script, a caption, notice points and badges for each of the nine steps", () => {
    expect(NOTES).toHaveLength(9);
    expect(COPY).toHaveLength(9);
    for (let i = 0; i < 9; i++) { expect(NOTES[i].length).toBeGreaterThan(200); expect(COPY[i].caption).toBeTruthy(); expect(COPY[i].notice.length).toBe(3); expect(COPY[i].badges.length).toBeGreaterThan(0); }
  });
  it("each script takes 55 to 70 seconds to say, and the whole journey fits in 9 minutes (8 to 9 minutes)", () => {
    let total = 0;
    NOTES.forEach((n, i) => { const s = estimateSeconds(n); total += s; expect(s, `step ${i + 1} (${wordCount(n)} words)`).toBeGreaterThanOrEqual(55); expect(s).toBeLessThanOrEqual(70); });
    expect(total).toBeLessThanOrEqual(TOTAL_TARGET_SECONDS);
    expect(total).toBeGreaterThanOrEqual(8 * 60);
  });
  it("the facts quoted in the script match the journey data", () => {
    const j = buildJourney(live);
    expect(j.steps[6].duplicate.score).toBe(95);
    expect(NOTES[5]).toContain("ninety-five out of a hundred");       // the duplicate score the narrator reads out
    expect(NOTES[7]).toMatch(/AP review, then to Procurement, back to AP review, and on to Warehouse/);
    expect(j.steps[8].actual!.stations).toEqual(["Intake", "AP review", "Procurement", "AP review", "Warehouse"]);
    expect(j.steps[6].splitting.combinedInr / 100000).toBeCloseTo(2.9, 1);  // "about two point nine lakh"
    expect(j.steps[4].priceTrio).toMatchObject({ invoice: 412, po: 398 });
    expect(j.steps[2].invoice.totalInr).toBeGreaterThan(1000000);            // "about ten and a half lakh"
    expect(j.steps[2].invoice.lines).toHaveLength(3);
  });
});
