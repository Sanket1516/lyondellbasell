// Golden Journey builder. Runs the whole nine-step story on a throw-away SANDBOX copy of the six source databases and the
// integration database, and returns one JSON document with the data for every screen.
//
// Why a sandbox and one document:
//   - The live demo data is never touched, so "Reset journey" is simply "build again" and always restores the exact starting state.
//   - The steps are computed in story order but each screen only reads its own slice, so Back and Next never depend on state.
//   - The same document, saved once, is the pre-computed fallback used if a live call fails.
// Everything is deterministic rules and stored records. No language model is called.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { fmtInr } from "../../lib/format";
import { loadCanonical, type CanonicalBundle } from "../canonical";
import { Connectors, SourceUnavailableError } from "../connectors";
import { PlantPayEngine, type PlantPayResult } from "../engine";
import { HERO_INVOICE } from "../history";
import { appendAudit, getSourceStates, openIntegrationDb, openTaskCounts, setOutage, tasksFor, readAudit } from "../integration";
import { buildPassport } from "../passport";
import { processTwin } from "../processService";
import { resolve } from "../resolver";
import { graphFor } from "../risk";
import { apply } from "../simulate";
import { SOURCE_IDS, SOURCE_META, type SourceId } from "../sources/schemas";
import { sourceFile } from "../sources/build";
import { verifyIntegrity, workflowEventsFor } from "../workflowEvents";
import { EXPECTED_PATH } from "../processMining";
import { createPredictor } from "../../predict/predictor";
import { loadSupplierFacts } from "../../predict/supplier";
import { predictionFor } from "../../predict/service";
import { PRIORITY_NOTE } from "../../predict/supplier";
import { buildChecklist } from "./checklist";
import type {
  EvidenceRow, InvoiceCard, JourneyData, RiskBlock, Snapshot, Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9, StoryKeyRow, SupplierRow, TamperRow,
} from "./types";

/** The records that play the story's parts. All exist in the seeded demo set. */
export const CAST = {
  hero: HERO_INVOICE,                                   // INV-2044 in the brief: Rs 412 / 398 / 412 price case, with unit, receipt and quality issues
  duplicateCopy: "INV-6120R", duplicateOriginal: "INV-6120",   // INV-1001A / INV-1001 in the brief
  splitting: ["IG20/26-27/0910", "IG20/26-27/0911", "IG20/26-27/0912"],   // INV-3001..3003 in the brief
  bankChange: "CB21/26-27/0908",                        // the pending bank-account change
  sharedAccount: "CM23/26-27/0909",                     // the account also held by an unrelated supplier
  unitNormalisation: "PPT08/26-27/0903",                // 5 MT billed against 5,000 kg ordered
  qualityReject: "AF14/26-27/0913",                     // part of the goods rejected at inspection
  outageSource: "logistics" as SourceId,
};
export const STORY_KEY: StoryKeyRow[] = [
  { story: "INV-2044 (hero)", actual: CAST.hero, supplier: "Vihar Chem Supplies", note: "Price 412 vs PO 398 vs contract 412, unit difference, receipt shortfall" },
  { story: "INV-1001 and INV-1001A (duplicate)", actual: `${CAST.duplicateOriginal} and ${CAST.duplicateCopy}`, supplier: "Deccan Valve & Fittings", note: "A paid invoice re-issued under a new number and date" },
  { story: "INV-3001 to INV-3003 (splitting)", actual: "IG20/26-27/0910 to 0912", supplier: "Indore Gaskets", note: "Three invoices, one PO, each just under Rs 1,00,000" },
  { story: "Bank-account change", actual: CAST.bankChange, supplier: "Chennai Bearings", note: "Remittance account differs from the verified account on file" },
  { story: "Account shared with XYZ Traders", actual: CAST.sharedAccount, supplier: "Coimbatore Motors", note: "Same account is on file for Kolhapur Castings" },
];

const STATUS_LABEL: Record<string, string> = { pass: "Pass", review: "Review", block: "Block", incomplete: "Incomplete" };
const inr = (n: number) => `₹${fmtInr(n, n % 1 === 0 ? 0 : 2)}`;

// ---------------------------------------------------------------- sandbox
interface Sandbox { dir: string; engine: PlantPayEngine; close(): void }

function sqlPath(p: string) { return p.replace(/\\/g, "/").replace(/'/g, "''"); }

/** Copy the six source files and the integration database into a temp folder and open an engine on the copy. */
export function makeSandbox(live: PlantPayEngine): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-journey-"));
  for (const id of SOURCE_IDS) fs.copyFileSync(sourceFile(id, live.connectors.dir), sourceFile(id, dir));
  const file = path.join(dir, "integration.db");
  live.integration.exec(`VACUUM INTO '${sqlPath(file)}'`);
  const integration = openIntegrationDb(file);
  // The story starts with every system online (step 3 takes one offline itself). A demo toggle left on in the live dashboard must
  // not push the whole journey onto the pre-computed fallback. Only the sandbox copy is changed.
  for (const id of SOURCE_IDS) setOutage(integration, id, false);
  const conns = new Connectors(integration, dir);
  let tick = 0;
  const base = Date.parse(`${live.today}T10:00:00.000Z`);
  const clock = () => new Date(base + 1000 * tick++).toISOString();
  const engine = new PlantPayEngine(integration, conns, { today: live.today, predictor: createPredictor(conns, live.today), now: clock });
  return {
    dir, engine,
    close() {
      try { conns.close(); integration.close(); } catch { /* ignore */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a handle briefly; the OS temp folder is cleaned later */ }
    },
  };
}

// ---------------------------------------------------------------- small helpers
const snap = (r: PlantPayResult): Snapshot => ({
  status: r.status, summary: r.summary,
  notEvaluated: [...new Set(r.notEvaluated.map((n) => n.check))],
  unavailable: r.unavailable.map((u) => SOURCE_META[u].label),
});
const must = <T>(v: T | undefined | null, what: string): T => { if (v == null) throw new Error(`Journey data missing: ${what}`); return v; };
function bundleOf(e: PlantPayEngine, id: string): CanonicalBundle { return must(loadCanonical(e.connectors, id).bundle, `invoice ${id}`); }
const supplierName = (e: PlantPayEngine, id: string) => e.stored(id)?.meta?.vendorName ?? bundleOf(e, id).vendor?.name ?? "";

function invoiceCard(e: PlantPayEngine, id: string): InvoiceCard {
  const b = bundleOf(e, id); const r = must(e.stored(id), `evaluation ${id}`);
  return {
    id, supplier: r.meta?.vendorName ?? "", vendorId: b.invoice.vendorId, po: b.invoice.poId, invoiceDate: b.invoice.invoiceDate, receivedOn: b.invoice.receivedOn,
    totalInr: b.invoice.total, file: r.meta?.sourceFile,
    lines: b.invoice.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, amount: l.amount })),
  };
}

// ---------------------------------------------------------------- step builders
function step1(e: PlantPayEngine): Step1 {
  const rows = (e.integration.prepare("SELECT status, COUNT(*) n FROM evaluations GROUP BY status").all() as { status: string; n: number }[]);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const total = rows.reduce((a, r) => a + r.n, 0);
  const demo = (e.integration.prepare("SELECT COUNT(*) n FROM demo_invoices").get() as { n: number }).n;
  const states = new Map(getSourceStates(e.integration).map((s) => [s.source, s]));
  const hero = must(e.stored(CAST.hero), "hero evaluation");
  const sources = e.connectors.health().map((h) => ({
    id: h.id, label: h.label, holds: h.holds, status: h.status, records: h.records, lastSync: h.status === "up" ? `${e.today}T09:00:00.000Z` : (states.get(h.id)?.lastSync ?? null),   // the journey opens Monday 09:00 on the demo clock, so every run starts identically
    contributed: hero.sources.find((s) => s.source === h.id)?.contributed ?? [],
  }));
  const tasks = openTaskCounts(e.integration);
  const integ = verifyIntegrity(e.integration);
  return {
    counts: { total, demo, pass: by.pass ?? 0, review: by.review ?? 0, block: by.block ?? 0, incomplete: by.incomplete ?? 0 },
    sources, openWork: Object.entries(tasks).sort((a, b) => b[1] - a[1]).map(([department, open]) => ({ department, open })),
    integrity: { ok: integ.ok, auditEntries: integ.auditEntries, workflowEvents: integ.workflowEvents },
    story: STORY_KEY,
  };
}

function step2(e: PlantPayEngine): Step2 {
  const passport = must(buildPassport(e, CAST.hero), "hero passport");
  return {
    invoice: invoiceCard(e, CAST.hero), passport,
    supplierNote: "This is the only view a supplier gets: milestones, what is holding the invoice, which team has to act and the due date. Internal findings, risk signals and scores are never shown.",
  };
}

function evidenceRows(e: PlantPayEngine, id: string): EvidenceRow[] {
  const b = bundleOf(e, id); const r = must(e.stored(id), `evaluation ${id}`);
  const f: Record<SourceId, string[]> = { procurement: [], warehouse: [], quality: [], finance: [], logistics: [], supplier: [] };
  if (b.po) {
    f.procurement.push(`PO ${b.po.id} to ${b.vendor?.name ?? b.po.vendorId}, buyer ${b.po.buyer}`);
    for (const l of b.po.lines) f.procurement.push(`PO line ${l.lineNo}: ${l.description}, ${l.qty} ${l.uom} at ${inr(l.unitPrice)}`);
  }
  if (b.contract) {
    const p = b.contract.prices[0];
    f.procurement.push(`Contract ${b.contract.id}${p ? `: ${p.itemCode} at ${inr(p.unitPrice)} per ${p.uom}` : ""}${b.contractValidity ? `, valid ${b.contractValidity.validFrom} to ${b.contractValidity.validTo}` : ""}`);
  }
  for (const a of b.amendments.slice(0, 2)) f.procurement.push(`Amendment: ${a.materialCode} ${inr(a.oldPrice)} to ${inr(a.newPrice)}, effective ${a.effectiveFrom}, signed ${a.signedOn}`);
  for (const g of b.goodsReceipts) f.warehouse.push(`GRN ${g.id} on ${g.receivedOn}: ${g.lines.map((l) => `line ${l.lineNo} ${l.qtyReceived} ${l.uom}`).join(", ")}`);
  for (const d of b.deliveryNotes) f.warehouse.push(`Delivery note ${d.id}: ${d.lines.map((l) => `${l.qty} ${l.uom} ${l.itemCode}`).join(", ")}`);
  for (const q of b.inspections) f.quality.push(`Inspection ${q.id} on ${q.inspectedOn}: ${q.lines.map((l) => `line ${l.poLineNo} accepted ${l.qtyAccepted} of ${l.qtyInspected}${l.qtyRejected ? `, rejected ${l.qtyRejected}${l.reason ? ` (${l.reason})` : ""}` : ""}`).join("; ")}`);
  f.finance.push(`Invoice ${b.invoice.id} dated ${b.invoice.invoiceDate}, total ${inr(b.invoice.total)}${b.invoice.lines[0] ? `, first line ${b.invoice.lines[0].qty} ${b.invoice.lines[0].uom} at ${inr(b.invoice.lines[0].unitPrice)}` : ""}`);
  for (const a of b.approvals.slice(0, 1)) f.finance.push(`Approval ${a.level} by ${a.approver} on ${a.approvedOn}`);
  for (const s of b.shipments) f.logistics.push(`Shipment ${s.id}: ${s.status}${s.deliveredOn ? `, delivered ${s.deliveredOn}` : ""}`);
  for (const g of b.gateEntries) f.logistics.push(`Gate entry ${g.id}, vehicle ${g.vehicleNo}, ${g.enteredOn}`);
  for (const w of b.weighbridge) f.logistics.push(`Weighbridge ${w.id}: net ${w.netKg.toLocaleString("en-IN")} kg (gross ${w.grossKg.toLocaleString("en-IN")}, tare ${w.tareKg.toLocaleString("en-IN")})`);
  if (b.vendor) {
    f.supplier.push(`${b.vendor.name}, GSTIN ${b.vendor.gstin}`);
    const bank = b.vendor.bankAccounts?.find((x) => x.status === "verified") ?? b.vendor.bankAccounts?.[0];
    if (bank) f.supplier.push(`Bank account ${bank.accountNo} (${bank.status}) at ${bank.bankName}`);
  }
  return SOURCE_IDS.map((sid) => {
    const use = r.sources.find((s) => s.source === sid);
    return { source: sid, label: SOURCE_META[sid].label, status: use?.status === "ok" ? "ok" : "unavailable", facts: f[sid].length ? f[sid] : (use?.contributed ?? []) };
  });
}

function step3(e: PlantPayEngine): Step3 {
  const id = CAST.hero, src = CAST.outageSource;
  const online = e.compute(id).result;
  // Real outage on the sandbox: the same switch the dashboard uses. Nothing is guessed while the source is down.
  setOutage(e.integration, src, true);
  appendAudit(e.integration, { actor: "journey", role: "system", action: "outage_simulated", detail: `${src} source taken offline (Golden Journey demo)` });
  const off = e.compute(id).result;
  setOutage(e.integration, src, false);
  appendAudit(e.integration, { actor: "journey", role: "system", action: "outage_cleared", detail: `${src} source brought back online (Golden Journey demo)` });
  const back = e.compute(id).result;
  const affected = [...new Set(off.notEvaluated.filter((n) => n.because === src).map((n) => n.check))];
  return {
    invoiceId: id, evidence: evidenceRows(e, id),
    outage: {
      source: src, label: SOURCE_META[src].label, online: snap(online), offline: snap(off), restored: snap(back), affectedChecks: affected,
      explanation: `While ${SOURCE_META[src].label} is down, the checks that need it show "not evaluated", no false finding is raised and the invoice is never passed on partial evidence. When it returns, the same checks run again and the original result comes back.`,
    },
  };
}

function step4(e: PlantPayEngine): Step4 {
  const id = CAST.hero; const r = must(e.stored(id), "hero evaluation"); const v = must(r.validation, "validation panel");
  const price = v.contract.terms.find((t) => t.invoicePrice !== undefined && (t.invoicePrice !== t.poPrice || t.invoicePrice !== t.contractPrice)) ?? v.contract.terms[0];
  const unitCase = must(e.stored(CAST.unitNormalisation), "unit demo evaluation");
  const unitBundle = bundleOf(e, CAST.unitNormalisation);
  const norm = resolve(unitBundle, unitCase).normalisations;
  const qCase = must(e.stored(CAST.qualityReject), "quality demo evaluation");
  const qBundle = bundleOf(e, CAST.qualityReject);
  const qRes = resolve(qBundle, qCase).resolutions.find((x) => x.check === "quality");
  return {
    invoiceId: id, status: r.status, summary: r.summary,
    checks: r.checks.map((c) => ({ check: c.check, label: c.label, passed: c.passed, detail: c.detail })),
    validation: {
      threeWay: { state: v.threeWay.state, headline: v.threeWay.headline, issues: v.threeWay.issues },
      contract: { state: v.contract.state, headline: v.contract.headline, issues: v.contract.issues, terms: v.contract.terms.map((t) => `Line ${t.lineNo} ${t.itemCode}: invoice ${t.invoicePrice !== undefined ? inr(t.invoicePrice) : "n/a"}, PO ${inr(t.poPrice)}, contract ${t.contractPrice !== undefined ? inr(t.contractPrice) : "n/a"} per ${t.uom}${t.amendment ? `, amendment ${inr(t.amendment.oldPrice)} to ${inr(t.amendment.newPrice)} effective ${t.amendment.effectiveFrom}` : ""}`) },
      inventory: { state: v.inventory.state, headline: v.inventory.headline, issues: v.inventory.issues, rows: v.inventory.rows.map((x) => `Line ${x.lineNo} ${x.itemCode}: received ${x.received}, returned ${x.returned}, net ${x.net}, billed earlier ${x.previouslyBilled}, this invoice ${x.thisInvoice}, still billable ${x.remaining} ${x.uom}`) },
    },
    priceTrio: price && price.invoicePrice !== undefined && price.contractPrice !== undefined ? { invoice: price.invoicePrice, po: price.poPrice, contract: price.contractPrice, unit: price.uom, description: `Line ${price.lineNo}, ${price.itemCode}` } : null,
    normalisations: norm.map((n) => ({ invoiceId: CAST.unitNormalisation, supplier: supplierName(e, CAST.unitNormalisation), text: n.text, evidence: n.evidence.map((x) => x.text), purpose: "Billed in tonnes, ordered and received in kilograms: normalised, so it is not an exception." })),
    qualityCase: qRes ? { invoiceId: CAST.qualityReject, supplier: supplierName(e, CAST.qualityReject), statement: qRes.problem, evidence: qRes.evidence.map((x) => x.text) } : null,
  };
}

const ASKS: { q: string; invoice: boolean }[] = [{ q: "Why is invoice INV-7781 on hold?", invoice: true }, { q: "What does contract C-22 say about the price of process additive AX-40?", invoice: false }];
function step5(e: PlantPayEngine): Step5 {
  const id = CAST.hero;
  const before = must(e.stored(id), "hero evaluation");
  const resolutions = resolve(bundleOf(e, id), before).resolutions;
  const rag = ASKS.map(({ q, invoice }) => {
    const a = e.ask(q, invoice ? id : undefined);
    return { question: q, answer: a.answer, grounded: a.grounded, citations: a.citations.slice(0, 3).map((c) => ({ id: c.id, kind: c.kind, title: c.title, ref: c.ref, text: c.text })), notes: a.notes };
  });
  const tasks = tasksFor(e.integration, id).filter((t) => t.status === "open").map((t) => {
    const res = resolutions.find((x) => x.check === t.checkId || t.title.includes(x.check));
    return { department: t.department, title: t.title, status: t.status, owner: res?.responsible.person ?? `${res?.responsible.role ?? "Team"}` };
  });
  // The fix: the same writers and event-driven re-matching a department would trigger. Applied to the sandbox, so it is logged.
  const auditBefore = readAudit(e.integration).length;
  const wfBefore = Math.max(0, ...workflowEventsFor(e.integration, id).map((x) => x.id));
  const steps: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const cur = e.compute(id);
    if (!cur.bundle || cur.result.status === "pass") break;
    const cs = resolve(cur.bundle, cur.result).resolutions.flatMap((x) => x.corrections).filter((c) => { const k = JSON.stringify(c); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!cs.length) break;
    for (const c of cs) { apply(e, e.connectors.dir, e.today, c); steps.push(describeStep(c)); }
    e.processEvents();
    e.evaluate(id, { actor: "journey", role: "system" });
  }
  const after = e.evaluate(id, { actor: "journey", role: "system" });
  const wf = workflowEventsFor(e.integration, id);
  const remaining = after.discrepancies.map((d) => d.message);
  return {
    invoiceId: id, resolutions, rag, tasks,
    fix: {
      steps, before: { status: before.status, summary: before.summary }, after: { status: after.status, summary: after.summary }, passes: after.status === "pass",
      events: wf.filter((x) => x.id > wfBefore).sort((a, b) => a.id - b.id).map((x) => ({ at: x.at, type: x.type, department: x.department, note: eventNote(x.type, x.payload) })),
      auditEntriesAdded: readAudit(e.integration).length - auditBefore, remaining,
    },
  };
}
const EVENT_TEXT: Record<string, string> = { exception_resolved: "Exception resolved", exception_raised: "Exception raised", department_assigned: "Routed to the department", review_started: "Automated review started", review_completed: "Automated review completed", approval_requested: "Approval requested", approval_granted: "Approval granted", invoice_received: "Invoice received", payment_status_changed: "Payment status changed" };
function eventNote(type: string, payload: Record<string, unknown>): string {
  const check = payload.check ? ` (${String(payload.check).replace(/_/g, " ")} check)` : payload.status ? ` (${String(payload.status)})` : "";
  return `${EVENT_TEXT[type] ?? type}${check}`;
}
function describeStep(c: Parameters<typeof apply>[3]): string {
  switch (c.kind) {
    case "amend_po_price": return `Buyer amends PO ${c.poId} line ${c.lineNo} from ${inr(c.from)} to ${inr(c.to)}, citing the signed contract amendment`;
    case "post_goods_receipt": return `Warehouse posts the missing goods receipt against PO ${c.poId}`;
    case "record_inspection": return "Quality records the inspection result for the new receipt";
    case "supplier_corrects_invoice": return `Supplier issues a corrected invoice line ${c.lineNo}`;
    case "confirm_reweigh": return `Logistics confirms the re-weigh (${c.netKg} kg)`;
    case "duplicate_decision": return "Clerk records a documented 'different bill' decision";
    case "verify_bank_details": return "Finance verifies the bank details by call-back";
  }
}

function riskOf(e: PlantPayEngine, id: string, detector: "duplicate" | "splitting" | "vendor" | "graph", pick?: (k: string) => boolean): RiskBlock {
  const r = must(e.stored(id), `evaluation ${id}`);
  const d = must(r.risk?.detectors[detector], `risk detector ${detector} for ${id}`);
  const sig = d.signals.find((s) => s.flag && (!pick || pick(s.kind))) ?? d.signals[0];
  const task = tasksFor(e.integration, id).find((t) => t.status === "open" && /bank|verif|account|supplier/i.test(t.title));
  if (!sig) throw new Error(`Journey data missing: no ${detector} signal on ${id}`);
  return {
    detector, title: d.title, subject: id, flag: sig.flag, score: sig.score, label: sig.label, reasons: sig.reasons, recommendedAction: sig.recommendedAction,
    requiresIndependentVerification: !!sig.requiresIndependentVerification, supporting: sig.supportingRecords.map((x) => `${x.source}, ${x.ref}: ${x.text}`),
    ...(detector === "vendor" && task ? { task: task.title } : {}),
  };
}

function step6(e: PlantPayEngine): Step6 {
  const dup = riskOf(e, CAST.duplicateCopy, "duplicate");
  const spl = riskOf(e, CAST.splitting[0], "splitting");
  const invs = CAST.splitting.map((id) => { const m = must(e.stored(id)?.meta, `meta ${id}`); return { id, totalInr: m.totalInr, date: m.invoiceDate }; });
  const bank = riskOf(e, CAST.bankChange, "vendor", (k) => /bank/i.test(k));
  const gr = riskOf(e, CAST.sharedAccount, "graph");
  const g = must(graphFor(e.connectors), "relationship graph");
  const finding = must(g.findings.find((f) => f.kind === "shared_bank_account" && f.vendorIds.includes(must(e.stored(CAST.sharedAccount)?.meta, "meta").vendorId)), "shared-account finding");
  const [va, vb] = finding.vendorIds;
  const acct = finding.nodeIds.find((n) => n.startsWith("bank:")) ?? "";
  const name = (v: string) => g.nodes.get(`vendor:${v}`)?.label ?? v;
  return {
    duplicate: { ...dup, original: CAST.duplicateOriginal, copy: CAST.duplicateCopy },
    splitting: { ...spl, invoices: invs, combinedInr: invs.reduce((a, x) => a + x.totalInr, 0) },
    bank: { ...bank, supplier: supplierName(e, CAST.bankChange) },
    graph: {
      ...gr, vendorA: name(va), vendorB: name(vb), account: acct.replace("bank:", ""), confirmedLegitimate: finding.confirmedLegitimate,
      edges: finding.nodeIds.filter((n) => n.startsWith("vendor:")).map((n) => ({ from: name(n.replace("vendor:", "")), to: `account ${acct.replace("bank:", "")}`, kind: "holds account" })),
      supplierNote: "A shared account can be legitimate (a group company, a trading arm). This is a prompt for a person to look, never an accusation.",
    },
    label: "warning, not proof",
  };
}

function step7(e: PlantPayEngine): Step7 {
  const facts = [...loadSupplierFacts(e.connectors, e.today).values()];
  const heroId = must(e.stored(CAST.hero)?.meta?.vendorId, "hero vendor");
  const byRisk = [...facts].sort((a, b) => b.scores.supplierRisk.score - a.scores.supplierRisk.score);
  const chosen = [facts.find((f) => f.vendorId === heroId)!, byRisk.find((f) => f.vendorId !== heroId)!, [...facts].sort((a, b) => a.scores.supplierRisk.score - b.scores.supplierRisk.score).find((f) => f.vendorId !== heroId && f.vendorId !== byRisk[0].vendorId)!];
  const o = predictionFor(e, CAST.hero, { factors: true });
  if (!o.ok) throw new Error(`Journey data missing: prediction (${o.message})`);
  const p = o.prediction;
  const row = (f: (typeof facts)[number]): SupplierRow => ({
    vendorId: f.vendorId, name: f.name,
    relationship: { score: f.scores.relationshipStrength.score, band: f.scores.relationshipStrength.band, summary: f.scores.relationshipStrength.summary },
    criticality: { score: f.scores.supplyCriticality.score, band: f.scores.supplyCriticality.band, summary: f.scores.supplyCriticality.summary },
    risk: { score: f.scores.supplierRisk.score, band: f.scores.supplierRisk.band, summary: f.scores.supplierRisk.summary },
    materials: f.materials.slice(0, 2).map((m) => `${m.description}${m.otherSuppliers === 0 ? " (sole source)" : ""}`).join("; "),
  });
  const fac = (x: { label: string; value: string; effectPoints: number; direction: string }[]) => x.slice(0, 5).map((y) => ({ label: y.label, value: y.value, effectPoints: Math.round(y.effectPoints * 10) / 10, direction: y.direction }));
  const suppliers = chosen.map(row);
  // Investigation priority per supplier: the highest-priority open invoice of that supplier, when there is one
  for (const s of suppliers) {
    const inv = (e.integration.prepare("SELECT e.invoice_id id FROM evaluations e WHERE e.status IN ('review','block')").all() as { id: string }[]).map((r) => r.id).filter((id) => e.stored(id)?.meta?.vendorId === s.vendorId).slice(0, 3);
    let best: { score: number; band: string; explanation: string } | undefined;
    for (const id of inv) { const pr = predictionFor(e, id, { factors: false }); if (pr.ok && (!best || pr.prediction.priority.priority > best.score)) best = { score: pr.prediction.priority.priority, band: pr.prediction.priority.band, explanation: pr.prediction.priority.explanation }; }
    if (s.vendorId === heroId) best = { score: p.priority.priority, band: p.priority.band, explanation: p.priority.explanation };
    if (best) s.priority = best;
  }
  return {
    suppliers, priorityNote: PRIORITY_NOTE, invoiceId: CAST.hero, disclaimer: p.disclaimer,
    predictions: [
      { key: "A", title: "Exception probability", question: "Will a person need to resolve something on this invoice?", probability: p.exception.probability, level: p.exception.level, model: p.exception.model.algorithm, auc: p.exception.model.auc, trainedOn: p.exception.model.trainedOn, factors: fac(p.exception.factors) },
      { key: "B", title: "Likely root cause", question: "If an exception occurs, what is the most likely cause?", probability: p.causes[0]?.probabilityIfException ?? 0, level: p.causes[0]?.label ?? "", model: p.causeModel.algorithm, auc: undefined, trainedOn: p.causeModel.trainedOn, factors: fac(p.causes[0]?.factors ?? []) },
      { key: "C", title: "Payment delay risk", question: "Will payment go past the due date?", probability: p.delay.probability, level: p.delay.level, model: p.delay.model.algorithm, auc: p.delay.model.auc, trainedOn: p.delay.model.trainedOn, factors: fac(p.delay.factors) },
      { key: "D", title: "Supplier disruption risk", question: `Will ${p.supplierName} disrupt supply within 90 days?`, probability: p.supplier.probability, level: p.supplier.level, model: p.supplier.model.algorithm, auc: p.supplier.model.auc, trainedOn: p.supplier.model.trainedOn, factors: fac(p.supplier.factors) },
    ],
    causes: p.causes.slice(0, 4).map((c) => ({ label: c.label, probabilityIfException: c.probabilityIfException, evidenceStatus: c.evidenceStatus, evidence: c.evidence })),
    priority: { score: p.priority.priority, band: p.priority.band, explanation: p.priority.explanation, contributions: p.priority.contributions.slice(0, 6) },
    history: p.exception.history.slice(0, 3),
  };
}

function step8(e: PlantPayEngine): Step8 {
  const a = processTwin(e);
  const path = a.paths.get(CAST.hero) ?? null;
  return {
    invoiceId: CAST.hero, asOf: a.asOf, expected: [...EXPECTED_PATH], actual: path, stations: a.stations, edges: a.edges, bottlenecks: a.bottlenecks.slice(0, 3), loops: a.loops.slice(0, 4), variants: a.variants.slice(0, 5),
    totals: { invoices: a.invoices, reworkPct: a.reworkPct, reworkInvoices: a.reworkInvoices, avgCycleDays: a.avgCycleDays, conformingPct: a.conformingPct },
  };
}

/** Tamper demo on COPIES of the sandbox's audit database; the sandbox itself is never edited. */
function tamperRows(e: PlantPayEngine, dir: string): TamperRow[] {
  const out: TamperRow[] = [];
  const total = (e.integration.prepare("SELECT MAX(seq) m FROM audit_events").get() as { m: number }).m;
  const target = Math.floor(total / 2);
  const scenarios: { label: string; tamper: (db: Database.Database) => void }[] = [
    { label: "Untouched audit trail", tamper: () => undefined },
    { label: `Someone edits the text of audit record ${target}`, tamper: (db) => { const row = db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(target) as { data: string }; const j = JSON.parse(row.data); j.detail = "Edited after the fact"; db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(JSON.stringify(j), target); } },
    { label: `Someone deletes audit record ${target}`, tamper: (db) => { db.prepare("DELETE FROM audit_events WHERE seq = ?").run(target); } },
    { label: "Someone edits a workflow event (changes who approved)", tamper: (db) => { const row = db.prepare("SELECT id FROM workflow_events WHERE event_type = 'approval_granted' ORDER BY id LIMIT 1").get() as { id: number }; db.prepare("UPDATE workflow_events SET actor = 'someone.else' WHERE id = ?").run(row.id); } },
  ];
  scenarios.forEach((s, i) => {
    const file = path.join(dir, `tamper-${i}.db`);
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    e.integration.exec(`VACUUM INTO '${sqlPath(file)}'`);
    const db = openIntegrationDb(file);
    try {
      if (i > 0) { db.exec("DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;"); s.tamper(db); } // an attacker with file access would do the same
      const v = verifyIntegrity(db);
      out.push(v.ok ? { label: s.label, ok: true, reason: `Chain intact: ${v.auditEntries} audit entries and ${v.workflowEvents} workflow events verified.` } : { label: s.label, ok: false, position: v.position, reason: v.reason });
    } finally { db.close(); }
  });
  return out;
}

function step9(e: PlantPayEngine, dir: string, sb: Omit<JourneyData["steps"], 9>): Step9 {
  const id = CAST.hero;
  const r = must(e.stored(id), "hero evaluation");
  let approvalNote = "";
  if (r.status === "pass") {
    const amount = must(r.meta, "meta").totalInr;
    e.requestApproval(id, "priya.clerk", amount);
    // The lowest approver level whose limit covers the amount (never the AP clerk, whose limit is ₹1,00,000).
    const staff = e.connectors.finance.approverNames() as { name: string; role: string; approval_limit_inr: number }[];
    const fit = staff.filter((x) => /^approver_l/.test(x.role) && x.approval_limit_inr >= amount).sort((a, b) => a.approval_limit_inr - b.approval_limit_inr)[0];
    const approver = fit?.name ?? "Approver";
    e.grantApproval(id, approver, fit?.role === "approver_l1" ? "L1" : "L2");
    approvalNote = `${approver} approved ${inr(amount)} after the checks cleared. Approval is a person's decision, recorded in the audit trail.`;
  } else approvalNote = "The invoice is not clear yet, so it has not gone for approval.";
  const passport = must(buildPassport(e, id), "hero passport");
  const integ = verifyIntegrity(e.integration);
  const ready = r.status === "pass" && passport.milestones.find((m) => m.id === "approval")?.state === "done" && passport.milestones.find((m) => m.id === "payment")?.state === "current";
  const tamper = tamperRows(e, dir);
  const partial = { ...sb, 9: { integrity: { ok: integ.ok, auditEntries: integ.auditEntries, workflowEvents: integ.workflowEvents }, tamper, passport, readyForPayment: ready, approvalNote, checklist: [] } } as JourneyData["steps"];
  return { ...partial[9], checklist: buildChecklist(partial) };
}

// ---------------------------------------------------------------- the journey
/** Build all nine screens on a fresh sandbox. Pass the live engine (read only). Throws if any piece of the story data is missing. */
export function buildJourney(live: PlantPayEngine): JourneyData {
  const t0 = Date.now();
  const sb = makeSandbox(live);
  try {
    const e = sb.engine;
    // Baseline reads first (the state at the start of the week), then the changes: outage and restore, the fix, approval, tamper copies.
    const s1 = step1(e), s2 = step2(e), s4 = step4(e), s6 = step6(e), s7 = step7(e), s8 = step8(e);
    const s3 = step3(e);
    const s5 = step5(e);
    const base = { 1: s1, 2: s2, 3: s3, 4: s4, 5: s5, 6: s6, 7: s7, 8: s8 };
    const s9 = step9(e, sb.dir, base);
    return { version: 1, mode: "live", builtAt: new Date().toISOString(), today: live.today, hero: CAST.hero, heroSupplier: s2.invoice.supplier, steps: { ...base, 9: s9 }, ms: Date.now() - t0 };
  } finally { sb.close(); }
}

export { SourceUnavailableError, STATUS_LABEL };
