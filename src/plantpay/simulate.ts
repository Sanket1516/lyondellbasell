// Stage 3: re-run matching after a SIMULATED human correction and show the status change.
// The correction is applied to a throw-away sandbox copy of the six source databases and the integration state, using the same
// department-side writers and the same event-driven re-matching as the live system. The live demo data is never touched, so
// a presenter can simulate as often as they like.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { openIntegrationDb } from "./integration";
import { fmtDate, fmtInr } from "../lib/format";
import { loadCanonical } from "./canonical";
import { Connectors } from "./connectors";
import { PlantPayEngine, type PlantPayResult } from "./engine";
import { resolve, type Correction } from "./resolver";
import { SOURCE_IDS } from "./sources/schemas";
import { sourceFile } from "./sources/build";
import { addUnitConversion as _unused, amendPoPrice, confirmReweigh, correctInvoiceLine, postGoodsReceipt, recordDuplicateDecision, recordInspection, verifyBankDetails } from "./sources/writers";

void _unused;
export interface SimStep { correction: Correction; description: string }
export interface Snapshot { status: PlantPayResult["status"]; summary: string; issues: string[] }
export interface SimulationResult {
  invoiceId: string; steps: SimStep[]; before: Snapshot; after: Snapshot; statusChanged: boolean; clearedResolutionIds: string[]; remainingResolutionIds: string[];
  headline: string; notSimulatable?: string;
}
export const STATUS_LABEL: Record<string, string> = { pass: "Pass", review: "Review", block: "Block", incomplete: "Incomplete" };

export function describeCorrection(c: Correction): string {
  switch (c.kind) {
    case "amend_po_price": return `Procurement amends PO ${c.poId} line ${c.lineNo} price from ₹${fmtInr(c.from)} to ₹${fmtInr(c.to)}`;
    case "post_goods_receipt": return `Warehouse posts a goods receipt on PO ${c.poId}: ${c.lines.map((l) => `line ${l.lineNo} ${l.qty} ${l.uom}`).join(", ")}`;
    case "record_inspection": return "Quality records the inspection result with everything received accepted";
    case "supplier_corrects_invoice": return `Supplier issues a corrected invoice: line ${c.lineNo} ${Object.entries(c.set).map(([k, v]) => `${k} = ${v}`).join(", ")}`;
    case "confirm_reweigh": return `Logistics confirms a re-weigh of ${c.netKg.toLocaleString("en-IN")} kg on PO ${c.poId}`;
    case "duplicate_decision": return `AP clerk records that this is a different bill from ${c.matchedInvoiceId} (reason: ${c.reason})`;
    case "verify_bank_details": return `Supplier master data verifies account ${c.accountNo} by call-back to a known contact`;
  }
}

const snap = (r: PlantPayResult): Snapshot => ({ status: r.status, summary: r.summary, issues: [...r.discrepancies.map((d) => d.message), ...r.warnings.filter((w) => w.severity === "review").map((w) => w.message)] });

export function apply(sb: PlantPayEngine, dir: string, today: string, c: Correction) {
  const ctx = { integration: sb.integration, dir, now: () => `${today}T12:00:00.000Z` };
  switch (c.kind) {
    case "amend_po_price": return amendPoPrice(ctx, { poId: c.poId, lineNo: c.lineNo, newPrice: c.to, reason: c.reason, changedOn: today });
    case "post_goods_receipt": return void postGoodsReceipt(ctx, { poId: c.poId, receivedOn: today, lines: c.lines });
    case "record_inspection": {
      const b = loadCanonical(sb.connectors, c.invoiceId).bundle;
      if (!b?.po) return;
      for (const g of b.goodsReceipts.filter((x) => !b.inspections.some((i) => i.grId === x.id))) recordInspection(ctx, { poId: b.po.id, grnNo: `GRN-${g.id}`, inspectedOn: today, lines: g.lines.map((l) => ({ lineNo: l.lineNo, inspected: l.qtyReceived, accepted: l.qtyReceived, uom: l.uom })) });
      return;
    }
    case "supplier_corrects_invoice": return correctInvoiceLine(ctx, { invoiceId: c.invoiceId, lineNo: c.lineNo, set: c.set });
    case "confirm_reweigh": return confirmReweigh(ctx, { poId: c.poId, netKg: c.netKg });
    case "duplicate_decision": return recordDuplicateDecision(ctx, { invoiceId: c.invoiceId, matchedInvoiceId: c.matchedInvoiceId, decision: "not_duplicate", by: "priya.clerk", reason: c.reason });
    case "verify_bank_details": return verifyBankDetails(ctx, { vendorId: c.vendorId, accountNo: c.accountNo, verifiedOn: today, verifiedBy: "E-09" });
  }
}

/**
 * Simulate one recommended correction ({resolutionId}) or all of them in turn ("all"), on a sandbox copy.
 * "all" repeats (a fix can reveal the next step, e.g. a posted receipt then waits for inspection) up to four rounds.
 */
export function simulate(engine: PlantPayEngine, invoiceId: string, mode: "all" | { resolutionId: string }): SimulationResult {
  const live = engine.compute(invoiceId);
  const beforeSnap = snap(live.result);
  const empty = (why: string): SimulationResult => ({ invoiceId, steps: [], before: beforeSnap, after: beforeSnap, statusChanged: false, clearedResolutionIds: [], remainingResolutionIds: [], headline: why, notSimulatable: why });
  if (!live.bundle) return empty("The invoice could not be read from its sources, so nothing can be simulated.");
  const liveReport = resolve(live.bundle, live.result);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-sim-"));
  let sbInteg: Database.Database | undefined; let sbConn: Connectors | undefined;
  try {
    for (const id of SOURCE_IDS) fs.copyFileSync(sourceFile(id, engine.connectors.dir), sourceFile(id, tmp));
    // A fresh in-memory integration DB (cloning the live one fails when it is in WAL mode); carry over recorded duplicate decisions.
    sbInteg = openIntegrationDb(":memory:");
    const ins = sbInteg.prepare("INSERT INTO duplicate_decisions VALUES (?,?,?,?,?,?)");
    for (const r of engine.integration.prepare("SELECT * FROM duplicate_decisions").all() as Record<string, string>[]) ins.run(r.invoice_id, r.matched_invoice_id, r.decision, r.decided_by, r.reason, r.decided_at);
    sbConn = new Connectors(sbInteg, tmp);
    const sb = new PlantPayEngine(sbInteg, sbConn, { today: engine.today });
    const steps: SimStep[] = [];
    const seen = new Set<string>();
    const run = (cs: Correction[]) => { let n = 0; for (const c of cs) { const key = JSON.stringify(c); if (seen.has(key)) continue; seen.add(key); apply(sb, tmp, engine.today, c); steps.push({ correction: c, description: describeCorrection(c) }); n++; } if (n) sb.processEvents(); return n; };

    if (mode === "all") {
      for (let round = 0; round < 4; round++) {
        const cur = sb.compute(invoiceId);
        if (!cur.bundle || cur.result.status === "pass") break;
        if (run(resolve(cur.bundle, cur.result).resolutions.flatMap((r) => r.corrections)) === 0) break;
      }
    } else {
      const res = liveReport.resolutions.find((r) => r.id === mode.resolutionId);
      if (!res) return empty("That exception is no longer present on this invoice.");
      if (res.corrections.length === 0) return empty(res.notSimulatableReason ?? "This exception needs a person to supply information, so it cannot be simulated.");
      run(res.corrections);
    }
    const after = sb.compute(invoiceId);
    const afterSnap = snap(after.result);
    const afterIds = new Set((after.bundle ? resolve(after.bundle, after.result).resolutions : []).map((r) => r.id));
    const cleared = liveReport.resolutions.filter((r) => !afterIds.has(r.id)).map((r) => r.id);
    const remaining = liveReport.resolutions.filter((r) => afterIds.has(r.id)).map((r) => r.id);
    const changed = beforeSnap.status !== afterSnap.status;
    const left = afterSnap.issues.length;
    const headline = changed
      ? `Status changes from ${STATUS_LABEL[beforeSnap.status]} to ${STATUS_LABEL[afterSnap.status]}${left ? `; ${left} other issue${left === 1 ? "" : "s"} remain${left === 1 ? "s" : ""} for their owners` : "."}`
      : `Status stays ${STATUS_LABEL[afterSnap.status]}: ${cleared.length} exception${cleared.length === 1 ? "" : "s"} cleared, ${left} issue${left === 1 ? "" : "s"} remain${left === 1 ? "s" : ""}${afterSnap.issues[0] ? ` (next: ${afterSnap.issues[0].slice(0, 110)})` : ""}.`;
    void fmtDate;
    return { invoiceId, steps, before: beforeSnap, after: afterSnap, statusChanged: changed, clearedResolutionIds: cleared, remainingResolutionIds: remaining, headline };
  } finally {
    try { sbConn?.close(); sbInteg?.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly; temp is cleaned later */ }
  }
}
