// Retrieval over contracts, amendments and company payment/approval policies. Fully deterministic (BM25 keyword retrieval,
// extractive answers): no language model sits in the decision path, and nothing is invented. Every passage carries a citation;
// if nothing relevant is retrieved the answer says so instead of guessing.
// The policies below are SYNTHETIC examples for the hackathon, written to agree with the engine's configured tolerances.
import { ENGINE_CONFIG } from "../engine/config";
import { THRESHOLDS } from "../lib/constants";
import { fmtInr } from "../lib/format";
import { Connectors, SourceUnavailableError } from "./connectors";
import { PLANTPAY_CONFIG } from "./rules";

export interface Passage { id: string; kind: "policy" | "contract" | "amendment"; title: string; ref: string; text: string }
export interface Citation { id: string; kind: Passage["kind"] | "evaluation"; title: string; ref: string; text: string; score?: number }
export interface RagAnswer { answer: string; grounded: boolean; citations: Citation[]; notes: string[] }

const inr0 = (n: number) => `₹${fmtInr(n, 0)}`;

export const POLICY_PASSAGES: Passage[] = [
  { id: "POL-AP-01", ref: "§1", kind: "policy", title: "Three-way match policy", text: `An invoice is paid only when it agrees with the purchase order and the goods receipt. Unit prices may differ from the PO price by at most ${ENGINE_CONFIG.pricePct} percent. The invoiced quantity may exceed the cumulative goods received by at most ${ENGINE_CONFIG.qtyPct} percent. Quantities billed in another unit (for example MT instead of kg) are converted using the material unit table before comparison.` },
  { id: "POL-AP-01", ref: "§2", kind: "policy", title: "Three-way match policy", text: "When the supplier bills a price that matches the current contract but the purchase order still carries the older price, the buyer must amend the purchase order to the contract price. The invoice is not rejected for this reason; it is held until the purchase order is amended." },
  { id: "POL-AP-02", ref: "§1", kind: "policy", title: "Quality acceptance policy", text: `Goods are payable only for the quantity accepted at inspection. If part of a delivery is rejected, the supplier must issue a credit note or corrected invoice for the rejected quantity, or Quality must record a documented concession. The invoiced quantity may not exceed the accepted quantity by more than ${ENGINE_CONFIG.qtyPct} percent. Goods received but not yet inspected are held until inspection is recorded.` },
  { id: "POL-AP-03", ref: "§1", kind: "policy", title: "Weighbridge verification policy", text: `For materials bought by weight, the weighbridge net weight must agree with the goods receipt weight within ${PLANTPAY_CONFIG.weighbridgePct} percent. If the weighbridge shows less than the goods receipt or the invoice, Logistics confirms a re-weigh and the goods receipt or invoice is corrected before payment.` },
  { id: "POL-AP-04", ref: "§1", kind: "policy", title: "Approval matrix", text: `Invoices up to ${inr0(THRESHOLDS.clerkMax)} may be approved by an AP clerk. Invoices above ${inr0(THRESHOLDS.clerkMax)} and up to ${inr0(THRESHOLDS.l1Max)} need Approver L1 (Finance Manager). Invoices above ${inr0(THRESHOLDS.l1Max)} need Approver L2 (Finance Controller). The person who prepared, released or raised tasks on an invoice may not also approve it.` },
  { id: "POL-AP-04", ref: "§2", kind: "policy", title: "Approval matrix", text: `Related invoices raised close together against the same purchase order are totalled for the approval limit. Several invoices that are each under ${inr0(THRESHOLDS.clerkMax)} but together exceed it are reviewed as one by a person. This is a prompt for review, not a finding of wrongdoing: staged deliveries are common.` },
  { id: "POL-AP-05", ref: "§1", kind: "policy", title: "Supplier bank detail changes", text: "Any change to a supplier's bank details must be verified independently before payment: call a contact already on the supplier master using a known telephone number, never the number or e-mail given in the change request or on the invoice. Until verified, the new account is marked pending verification and invoices naming it are held for review." },
  { id: "POL-AP-05", ref: "§2", kind: "policy", title: "Shared bank accounts", text: "Two suppliers sharing one bank account is not by itself a problem; group companies often share an account. A shared account is flagged for a person to confirm the relationship and record it on the supplier master. It is never treated as an accusation." },
  { id: "POL-AP-06", ref: "§1", kind: "policy", title: "Duplicate invoices", text: "An invoice that repeats an earlier invoice of the same supplier (the same purchase order, lines and amount, or the same number apart from a prefix or suffix) is blocked until an AP clerk compares the two documents and records a reason. Two bills for the two halves of a staged delivery are not duplicates." },
  { id: "POL-AP-07", ref: "§1", kind: "policy", title: "Payment terms", text: "Suppliers are paid within the payment terms on the supplier master, counted from the invoice date (45 days where none is recorded). Invoices held for an exception continue to age from the invoice date, so exceptions should be resolved quickly." },
  { id: "POL-AP-08", ref: "§1", kind: "policy", title: "Source system outage", text: "If a source system (Procurement, Warehouse, Quality, Finance, Logistics or Supplier master) cannot be reached, the checks that depend on it are shown as not evaluated and the invoice is marked incomplete. An invoice is never passed on partial evidence; it is evaluated again when the source returns." },
  { id: "POL-AP-09", ref: "§1", kind: "policy", title: "Goods and services tax", text: "The tax rate on the invoice must equal the tax code on the purchase order. A different rate is returned to the supplier for a corrected invoice, or the buyer confirms that the purchase order tax code is wrong." },
];

// ---------------------------------------------------------------- index
const STOP = new Set("a an the of to and or in on at for is are was were be been it this that with by from as why what when how which who does do did not no than then".split(" "));
export const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9₹.\-\s]/g, " ").split(/\s+/).map((t) => t.replace(/^[.\-]+|[.\-]+$/g, "")).filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));

export class RagIndex {
  private docs: { p: Passage; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 1;
  constructor(passages: Passage[]) {
    for (const p of passages) {
      const toks = tokenize(`${p.title} ${p.text}`);
      const tf = new Map<string, number>();
      toks.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      this.docs.push({ p, tf, len: toks.length });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }
  get size() { return this.docs.length; }
  /** BM25 scores. Passages must share at least two distinct query terms (or one, for one-word queries) to count as relevant. */
  search(query: string, k = 3, minScore = 2.2): { p: Passage; score: number }[] {
    const qs = [...new Set(tokenize(query))];
    if (qs.length === 0) return [];
    const N = this.docs.length;
    const need = qs.length === 1 ? 1 : 2;
    return this.docs.map((d) => {
      let score = 0, hit = 0;
      for (const t of qs) {
        const f = d.tf.get(t);
        if (!f) continue;
        hit++;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / this.avg))));
      }
      return { p: d.p, score: hit >= need ? score : 0 };
    }).filter((x) => x.score >= minScore).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** Contract and amendment passages built from the Procurement DB through its read-only connector. */
export function contractPassages(c: Connectors): { passages: Passage[]; unavailable: boolean } {
  const out: Passage[] = [];
  try {
    for (const no of c.procurement.allContracts()) {
      const ct = c.procurement.contract(no)!;
      const sup = c.procurement.supplierRef(String(ct.header.supplier_id));
      const name = sup ? String(sup.name) : String(ct.header.supplier_id);
      const byMat = new Map<string, { unit_price: number; uom: string; effective_from: string }[]>();
      for (const r of ct.prices) (byMat.get(String(r.material_code)) ?? byMat.set(String(r.material_code), []).get(String(r.material_code))!).push({ unit_price: Number(r.unit_price), uom: String(r.uom), effective_from: String(r.effective_from) });
      const lines = [...byMat.entries()].map(([m, ps]) => `${m}: ${ps.map((p, i) => `${i === 0 ? "current price " : "earlier price "}₹${fmtInr(p.unit_price)} per ${p.uom} from ${p.effective_from}`).join(", ")}`);
      out.push({ id: `Contract ${no}`, ref: "price schedule", kind: "contract", title: `Contract ${no} with ${name}`, text: `Contract ${no} with supplier ${name}, valid ${ct.header.valid_from} to ${ct.header.valid_to}. Agreed prices: ${lines.join("; ")}.` });
      for (const a of ct.amendments) out.push({
        id: `Contract ${no}`, ref: `amendment effective ${a.effective_from}`, kind: "amendment", title: `Contract ${no} amendment, ${name}`,
        text: `Amendment to contract ${no} with ${name}: price of ${a.material_code} changed from ₹${fmtInr(Number(a.old_price))} to ₹${fmtInr(Number(a.new_price))}, effective ${a.effective_from}, signed ${a.signed_on}. ${a.note ?? ""} Purchase orders raised before ${a.effective_from} keep the old price until the buyer amends them.`,
      });
    }
    return { passages: out, unavailable: false };
  } catch (e) {
    if (e instanceof SourceUnavailableError) return { passages: out, unavailable: true };
    throw e;
  }
}

export interface EvaluationFacts { invoiceId: string; status: string; discrepancies: { check: string; message: string; rootCause: string; rootCauseStatus: string; suggestedFix: string; sources: string[] }[]; warnings: { kind: string; message: string }[] }

/** Answer a "why" question with cited passages. `facts` is the stored evaluation of an invoice, when the question is about one. */
export function answerQuestion(question: string, index: RagIndex, facts: EvaluationFacts | undefined, opts: { contractsUnavailable?: boolean } = {}): RagAnswer {
  const notes: string[] = [];
  if (opts.contractsUnavailable) notes.push("Procurement DB is unavailable, so contracts and amendments could not be searched.");
  const cites: Citation[] = [];
  const parts: string[] = [];
  let query = question;
  if (facts) {
    const items = [...facts.discrepancies.map((d) => ({ k: d.check, t: d.message, extra: `Likely cause: ${d.rootCause} (${d.rootCauseStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"}). Smallest fix: ${d.suggestedFix}` })), ...facts.warnings.map((w) => ({ k: w.kind, t: w.message, extra: "This is a warning for human review." }))];
    if (items.length === 0) parts.push(`${facts.invoiceId} passed every evaluated check; nothing is holding it for a reason other than the normal approval step.`);
    items.forEach((d, i) => {
      parts.push(`${i + 1}. ${d.t} ${d.extra}`);
      cites.push({ id: `Evaluation of ${facts.invoiceId}`, kind: "evaluation", title: `Evaluation of ${facts.invoiceId}`, ref: `check: ${d.k}`, text: d.t });
    });
    query += " " + items.map((d) => `${d.k.replace(/_/g, " ")} ${d.t}`).join(" ");
  }
  const hits = index.search(query, 3);
  hits.forEach((h) => cites.push({ id: h.p.id, kind: h.p.kind, title: h.p.title, ref: h.p.ref, text: h.p.text, score: Math.round(h.score * 100) / 100 }));
  if (hits.length) parts.push(`What the documents say: ${hits.map((h) => `${h.p.text} [${h.p.id}, ${h.p.ref}]`).join(" ")}`);
  const grounded = cites.length > 0;
  if (!grounded) return { answer: "I could not find anything about that in the indexed contracts, amendments or payment and approval policies, so I will not guess. Try naming an invoice, a contract number, or a topic such as price, quantity, inspection, weighbridge, approval limit or bank details.", grounded: false, citations: [], notes };
  if (facts && hits.length === 0) notes.push("No policy or contract passage matched this invoice's issues; the answer above comes from the invoice evaluation only.");
  return { answer: parts.join("\n"), grounded: true, citations: cites, notes };
}
