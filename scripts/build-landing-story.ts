// Writes landing/src/data/story.json: every number the scroll-story landing page shows, taken from the demo data.
// Sources: the Golden Journey fallback (same records the live demo uses), the six source databases, the integration
// database (real audit-chain hashes) and the app store (impact figures). Run after `npm run setup`:
//   npm run landing:story
// The landing page never calls an API at run time, so it works offline; re-run this script when the demo data changes.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import journey from "../src/plantpay/journey/fallback.json";
import { DEMO_TODAY, THRESHOLDS } from "../src/lib/constants";
import { loadAll, openDb } from "../src/lib/db";
import { buildImpact, IMPACT_ASSUMPTIONS } from "../src/lib/impact";

const ROOT = process.cwd();
const SOURCES = process.env.PLANTPAY_SOURCES_DIR ?? path.join(ROOT, "data", "sources");
const INTEGRATION = process.env.PLANTPAY_INTEGRATION_DB ?? path.join(ROOT, "data", "plantpay-integration.db");
const ro = (f: string) => new Database(f, { readonly: true, fileMustExist: true });

const s = journey.steps;
const hero = s["2"].invoice;
const linesTotal = hero.lines.reduce((n, l) => n + l.amount, 0);

// ---- problem: measured from the finance and supplier databases
const fin = ro(path.join(SOURCES, "finance.db"));
const sup = ro(path.join(SOURCES, "supplier.db"));
const terms = new Map<string, number>();
for (const r of sup.prepare("SELECT supplier_code, payment_terms_days FROM suppliers").all() as { supplier_code: string; payment_terms_days: number }[])
  terms.set(r.supplier_code.replace(/^SUP-/, "V-"), r.payment_terms_days);
const inv = fin.prepare("SELECT i.invoice_no, i.supplier_id, i.invoice_date, p.paid_on FROM invoices i LEFT JOIN payments p ON p.invoice_no = i.invoice_no").all() as
  { invoice_no: string; supplier_id: string; invoice_date: string; paid_on: string | null }[];
const due = (r: (typeof inv)[number]) => Date.parse(r.invoice_date) + 86400000 * (terms.get(r.supplier_id.replace(/^SUP-/, "V-")) ?? 45);
const today = Date.parse(DEMO_TODAY);
const latePaid = inv.filter((r) => r.paid_on && Date.parse(r.paid_on) > due(r)).length;
const overdueOpen = inv.filter((r) => !r.paid_on && due(r) < today).length;
const staff = fin.prepare("SELECT name, title, role, approval_limit_inr FROM finance_staff ORDER BY approval_limit_inr").all() as
  { name: string; title: string; role: string; approval_limit_inr: number }[];

// ---- risk graph: real vendors and real bank accounts; the two shared accounts are highlighted
const vendors = sup.prepare("SELECT supplier_code, legal_name FROM suppliers ORDER BY supplier_code").all() as { supplier_code: string; legal_name: string }[];
const accounts = sup.prepare("SELECT supplier_code, account_no, status FROM bank_accounts WHERE status != 'closed'").all() as { supplier_code: string; account_no: string; status: string }[];
const byAcct = new Map<string, string[]>();
for (const a of accounts) byAcct.set(a.account_no, [...(byAcct.get(a.account_no) ?? []), a.supplier_code]);
const shared = [...byAcct.entries()].filter(([, v]) => new Set(v).size > 1).map(([account, v]) => ({ account, vendors: [...new Set(v)] }));
const name = (code: string) => vendors.find((v) => v.supplier_code === code)?.legal_name ?? code;
const graph = s["6"].graph;
const flagged = shared.find((x) => x.account === graph.account);
const legit = shared.find((x) => x.account !== graph.account);
const graphVendors = vendors.slice(0, 16).map((v) => v.supplier_code);
for (const x of shared) for (const v of x.vendors) if (!graphVendors.includes(v)) graphVendors.push(v);

// ---- trust: the real audit chain around the tampered record
const integ = ro(INTEGRATION);
const tamper = s["9"].tamper.find((t) => /edits the text/.test(t.label))!;
const pos = tamper.position!;
const chain = (integ.prepare("SELECT seq, hash, json_extract(data,'$.action') action FROM audit_events WHERE seq BETWEEN ? AND ? ORDER BY seq").all(pos - 4, pos + 4) as
  { seq: number; hash: string; action: string }[]).map((r) => ({ seq: r.seq, hash: r.hash.slice(0, 10), action: String(r.action).replace(/^wf_/, "").replace(/_/g, " ") }));

// ---- impact: measured over the 650 PlantPay evaluations (the dataset the Golden Journey uses). Hours use the labelled
// assumption IMPACT_ASSUMPTIONS.manualMinutesPerInvoice, exactly like the dashboard's impact panel.
type Eval = { status: string; checks: { check: string; passed: boolean }[]; discrepancies: { rootCause?: string; owner?: string }[]; meta?: { totalInr: number } };
const evals = (integ.prepare("SELECT result_json FROM evaluations").all() as { result_json: string }[]).map((r) => JSON.parse(r.result_json) as Eval);
const dups = evals.filter((e) => e.checks.some((c) => c.check === "duplicate" && !c.passed));
const exc = evals.filter((e) => e.status === "review" || e.status === "block");
const clean = evals.filter((e) => e.status === "pass").length;
const impact = {
  duplicateCount: dups.length, duplicateValue: Math.round(dups.reduce((n, e) => n + (e.meta?.totalInr ?? 0), 0)),
  autoClean: clean, hoursSaved: Math.round((clean * IMPACT_ASSUMPTIONS.manualMinutesPerInvoice) / 60),
  exceptionsTotal: exc.length,
  exceptionsWithCause: exc.filter((e) => e.discrepancies.length > 0 && e.discrepancies.every((d) => d.rootCause && d.owner)).length,
};
const appImpact = buildImpact(loadAll(openDb())); // the legacy 43-invoice app store, reported for reference only

const pA = s["7"].predictions.find((p) => p.key === "A")!;
const pC = s["7"].predictions.find((p) => p.key === "C")!;
const vihar = s["7"].suppliers.find((x) => x.vendorId === hero.vendorId)!;
const price = s["5"].resolutions.find((r) => r.check === "price")!;
const amendment = price.evidence.find((e) => /amendment/.test(e.ref))!;
const priceCheck = s["4"].checks.find((c) => c.check === "price")!;

const story = {
  generatedFrom: "src/plantpay/journey/fallback.json + data/sources/*.db + data/plantpay-integration.db + data/plantx.db",
  builtAt: journey.builtAt,
  today: journey.today,
  hero: {
    id: hero.id, supplier: hero.supplier, vendorId: hero.vendorId, po: hero.po, invoiceDate: hero.invoiceDate, receivedOn: hero.receivedOn,
    totalInr: hero.totalInr, subtotalInr: linesTotal, taxInr: hero.totalInr - linesTotal, taxPct: Math.round(((hero.totalInr - linesTotal) / linesTotal) * 100),
    lines: hero.lines, gstin: "27FICTV1001A1Z0",
  },
  problem: {
    total: s["1"].counts.total, review: s["1"].counts.review, block: s["1"].counts.block,
    exceptions: s["1"].counts.review + s["1"].counts.block,
    reworkPct: Math.round(s["8"].totals.reworkPct), reworkInvoices: s["8"].totals.reworkInvoices, avgCycleDays: s["8"].totals.avgCycleDays,
    latePaid, overdueOpen, late: latePaid + overdueOpen,
    openTasks: s["1"].openWork.reduce((n, w) => n + w.open, 0), departments: s["1"].openWork.length,
  },
  sources: s["1"].sources.map((x) => ({ id: x.id, label: x.label.replace(/ DB$/, ""), holds: x.holds, records: x.records })),
  match: {
    summary: s["4"].summary, priceDetail: priceCheck.detail, trio: s["4"].priceTrio, tolerancePct: 2,
    checksPassed: s["4"].checks.filter((c) => c.passed).length, checksTotal: s["4"].checks.length,
    grn: "5000009001 + 5000009002", grnQty: { ax40: 1000, c12: 5000, dr200: 32 },
  },
  rootCause: {
    cause: price.rootCause, evidenceStatus: price.evidenceStatus, amendment: amendment.text,
    responsible: price.responsible, correction: price.correction, counterfactual: price.counterfactual,
    evidenceCount: price.evidence.length,
  },
  risk: {
    label: s["6"].label,
    duplicate: { original: s["6"].duplicate.original, copy: s["6"].duplicate.copy, score: s["6"].duplicate.score, total: "₹1,24,254.00" },
    shared: { a: graph.vendorA, b: graph.vendorB, account: graph.account, note: graph.supplierNote },
    legitimate: legit ? { vendors: legit.vendors.map(name), account: legit.account } : null,
    graph: {
      vendors: graphVendors.map((c) => ({ id: c, name: name(c) })),
      links: accounts.filter((a) => graphVendors.includes(a.supplier_code)).map((a) => ({ vendor: a.supplier_code, account: a.account_no })),
      flaggedAccount: flagged?.account ?? graph.account, legitAccount: legit?.account ?? null,
    },
    splitting: { count: s["6"].splitting.invoices.length, combinedInr: s["6"].splitting.combinedInr },
  },
  approval: {
    clerkMax: THRESHOLDS.clerkMax, l1Max: THRESHOLDS.l1Max,
    staff: staff.map((x) => ({ name: x.name, title: x.title, role: x.role, limit: x.approval_limit_inr })),
    approvedOn: s["9"].passport.milestones.find((m) => m.id === "approval")?.date ?? journey.today,
    note: s["9"].approvalNote,
  },
  intelligence: {
    criticality: vihar.criticality, risk: vihar.risk, relationship: vihar.relationship, materials: vihar.materials,
    exception: { p: pA.probability, level: pA.level, model: pA.model, auc: pA.auc, trainedOn: pA.trainedOn, factors: pA.factors },
    delay: { p: pC.probability, level: pC.level, model: pC.model, auc: pC.auc, trainedOn: pC.trainedOn, factors: pC.factors },
    disclaimer: s["7"].disclaimer,
  },
  trust: { auditEntries: s["9"].integrity.auditEntries, workflowEvents: s["9"].integrity.workflowEvents, tamperedSeq: pos, reason: tamper.reason, chain },
  paid: {
    milestones: s["9"].passport.milestones.map((m) => ({ id: m.id, label: m.label })),
    headline: s["9"].passport.headline, dueDate: s["9"].passport.dueDate, termsDays: s["9"].passport.paymentTermsDays, ready: s["9"].readyForPayment,
  },
  impact: {
    duplicateCount: impact.duplicateCount, duplicateValue: impact.duplicateValue,
    hoursSaved: impact.hoursSaved, autoClean: impact.autoClean, minutesPerInvoice: IMPACT_ASSUMPTIONS.manualMinutesPerInvoice,
    exceptionsWithCause: impact.exceptionsWithCause, exceptionsTotal: impact.exceptionsTotal, manualDays: IMPACT_ASSUMPTIONS.manualDaysToFindRootCause,
    evaluated: evals.length, appStoreDuplicates: appImpact.duplicateCount,
  },
};

const out = path.join(ROOT, "landing", "src", "data", "story.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(story, null, 1));
console.log(`Wrote ${out}: hero ${story.hero.id}, ${story.problem.exceptions} exceptions, ${story.problem.late} late, chain ${chain.length} blocks, impact ${JSON.stringify(story.impact)}`);
