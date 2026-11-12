// Stage 4A: contract-aware matching. Pure and deterministic: canonical bundle in, structured outcome out.
// For each invoice line it finds the contract terms that apply (supplier + material), checks the contract was in force on the
// delivery date, applies amendments, and compares the contract price with the PO price and the invoice price.
//
// Division of labour (so nothing is double-counted):
//   - Invoice differs from the PO price: the three-way price check already raises it. This module does NOT raise it again; it
//     records the contract terms for that line and exports them as additional evidence for the Root-Cause Resolver.
//   - Invoice and PO agree with each other but not with the contract (the PO is stale or was keyed wrongly and the invoice
//     followed it): three-way passes, and only this module notices. It raises a finding.
//   - The contract was not in force on the delivery date: raised here.
// Root causes are NOT decided here beyond the plain statement of what differs; resolver.ts owns the cause and the fix.
import { contractPriceOn, uomFactor } from "../engine/match";
import { ENGINE_CONFIG } from "../engine/config";
import { fmtDate, fmtInr } from "../lib/format";
import type { CanonicalBundle } from "./canonical";
import type { CrossFinding } from "./rules";

export type CheckState = "pass" | "review" | "block" | "skipped";
/** Why a stage was skipped. Only an unavailable source makes the invoice "incomplete"; missing records are labelled, never hidden. */
export type SkipKind = "source_unavailable" | "no_records" | "not_applicable";
export interface SkipInfo { kind: SkipKind; reason: string }

export interface ContractLineTerm {
  lineNo: number; itemCode: string;
  /** Unit of the PO line; every price below is per this unit. */
  uom: string;
  contractPrice?: number; contractEffectiveFrom?: string;
  poPrice: number; invoicePrice?: number;
  /** Amendment that applied on the reference date, if any. */
  amendment?: { effectiveFrom: string; signedOn: string; oldPrice: number; newPrice: number };
  /** Amendments dated after the delivery: noted, not applied. */
  laterAmendments: { effectiveFrom: string; newPrice: number }[];
  state: "ok" | "discrepancy" | "raised_by_price_check" | "skipped";
  note: string;
}
export interface ContractOutcome {
  evaluated: boolean;
  skip?: SkipInfo;
  contractId?: string; validFrom?: string; validTo?: string;
  /** Date the terms were applied on: first delivery or receipt, otherwise the invoice date. */
  referenceDate?: string;
  inForce?: boolean;
  terms: ContractLineTerm[];
  findings: CrossFinding[];
  note: string;
}

const inr = (n: number) => `₹${fmtInr(n)}`;
const pctGap = (a: number, b: number) => ((a - b) / b) * 100;
const within = (a: number, b: number) => Math.abs(pctGap(a, b)) <= ENGINE_CONFIG.pricePct + 1e-9;

/** First delivery or receipt date, the date the contract price is read on (same rule the price check uses). */
export function referenceDate(b: CanonicalBundle): string {
  return [...b.deliveryNotes.map((d) => d.deliveredOn), ...b.goodsReceipts.map((g) => g.receivedOn)].sort()[0] ?? b.invoice.invoiceDate;
}

export function contractCheck(b: CanonicalBundle): ContractOutcome {
  const none = (kind: SkipKind, reason: string): ContractOutcome => ({ evaluated: false, skip: { kind, reason }, terms: [], findings: [], note: `Skipped: ${reason}` });
  if (!b.po) return none("not_applicable", "there is no PO to read contract terms for.");
  if (!b.po.contractId) return none("no_records", `PO ${b.po.id} is not linked to a contract, so contract terms were not checked.`);
  if (!b.contract || !b.contractValidity) return none("no_records", `contract ${b.po.contractId} named on PO ${b.po.id} is not in the Procurement DB, so contract terms were not checked.`);
  const c = b.contract, v = b.contractValidity;
  const ref = referenceDate(b);
  const inForce = ref >= v.validFrom && ref <= v.validTo;
  const findings: CrossFinding[] = [];
  const terms: ContractLineTerm[] = [];
  const window = `Contract ${c.id} is valid ${fmtDate(v.validFrom)} to ${fmtDate(v.validTo)}`;

  if (!inForce) {
    findings.push({
      check: "contract",
      message: `Goods were delivered on ${fmtDate(ref)}, ${ref < v.validFrom ? "before" : "after"} contract ${c.id} ${ref < v.validFrom ? "started" : "ended"} (valid ${fmtDate(v.validFrom)} to ${fmtDate(v.validTo)}), so the contract price does not govern this delivery.`,
      expected: `A contract valid on ${fmtDate(ref)}`, actual: `${c.id} valid ${fmtDate(v.validFrom)} to ${fmtDate(v.validTo)}`,
      rootCause: "Contract not in force on the delivery date", owner: "Buyer",
      smallestFix: `Passes once Procurement extends or replaces contract ${c.id} to cover ${fmtDate(ref)} (or confirms the price in writing as a spot purchase).`,
      evidence: [`${window}.`, `First delivery or receipt: ${fmtDate(ref)} (${[...b.goodsReceipts.map((g) => `GRN ${g.id}`), ...b.deliveryNotes.map((d) => `delivery note ${d.id}`)].join(", ") || "invoice date used, nothing received"}).`],
    });
  }

  for (const line of b.invoice.lines) {
    const pl = b.po.lines.find((p) => (line.itemCode ? p.itemCode === line.itemCode : p.description.toLowerCase() === line.description.toLowerCase()));
    if (!pl) continue; // the purchase-order check owns lines that are not on the PO
    const base: Omit<ContractLineTerm, "state" | "note"> = { lineNo: line.lineNo, itemCode: pl.itemCode, uom: pl.uom, poPrice: pl.unitPrice, laterAmendments: b.amendments.filter((a) => a.materialCode === pl.itemCode && a.effectiveFrom > ref).map((a) => ({ effectiveFrom: a.effectiveFrom, newPrice: a.newPrice })) };
    const conv = uomFactor(b.uomRules, pl.itemCode, line.uom, pl.uom);
    if (!conv) { terms.push({ ...base, state: "skipped", note: `Invoice unit ${line.uom} has no conversion to ${pl.uom}; the unit check owns this.` }); continue; }
    const invoicePrice = Math.round((line.unitPrice / conv.factor) * 10000) / 10000;
    const cp = contractPriceOn(c, pl.itemCode, ref);
    if (!cp) { terms.push({ ...base, invoicePrice, state: "skipped", note: `${c.id} has no price for ${pl.itemCode}.` }); continue; }
    const am = b.amendments.filter((a) => a.materialCode === pl.itemCode && a.effectiveFrom <= ref).sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0];
    const withAm = { ...base, invoicePrice, contractPrice: cp.price, contractEffectiveFrom: cp.effectiveFrom, ...(am ? { amendment: { effectiveFrom: am.effectiveFrom, signedOn: am.signedOn, oldPrice: am.oldPrice, newPrice: am.newPrice } } : {}) };
    const invOk = within(invoicePrice, cp.price), poOk = within(pl.unitPrice, cp.price), invMatchesPo = within(invoicePrice, pl.unitPrice);
    if (!inForce) { terms.push({ ...withAm, state: "skipped", note: `Contract not in force on ${fmtDate(ref)}; the price was not compared.` }); continue; }
    if (invOk && poOk) { terms.push({ ...withAm, state: "ok", note: `Invoice, PO and contract agree at ${inr(cp.price)} per ${pl.uom}${am ? ` (amended price in force since ${fmtDate(am.effectiveFrom)})` : ""}.` }); continue; }
    if (!invMatchesPo) {
      terms.push({ ...withAm, state: "raised_by_price_check", note: `Invoice ${inr(invoicePrice)}, PO ${inr(pl.unitPrice)}, contract ${inr(cp.price)} per ${pl.uom}. The price check already reports the difference; contract terms are attached to it as evidence.` });
      continue;
    }
    // Invoice and PO agree with each other, so the three-way price check passes, but the contract says otherwise.
    const gap = pctGap(invoicePrice, cp.price);
    if (gap < 0) {
      // Billed BELOW the contract: no overpayment, so it is noted for Procurement and not raised as a discrepancy.
      terms.push({ ...withAm, state: "ok", note: `Invoice and PO both say ${inr(invoicePrice)} per ${pl.uom}, ${Math.abs(gap).toFixed(1)}% below the contract price ${inr(cp.price)}. No overpayment; noted for Procurement (the PO may pre-date a contract revision).` });
      continue;
    }
    terms.push({ ...withAm, state: "discrepancy", note: `Invoice and PO both say ${inr(invoicePrice)} per ${pl.uom}; contract ${c.id} says ${inr(cp.price)} (${gap.toFixed(1)}% above).` });
    findings.push({
      check: "contract", lineNo: line.lineNo,
      message: `Line ${line.lineNo} (${pl.itemCode}): invoice and PO both price it at ${inr(invoicePrice)} per ${pl.uom}, but contract ${c.id} sets ${inr(cp.price)} (${gap.toFixed(1)}% above the contract) for goods delivered on ${fmtDate(ref)}.`,
      expected: `${inr(cp.price)} per ${pl.uom} (contract ${c.id})`, actual: `${inr(invoicePrice)} per ${pl.uom} (invoice and PO)`,
      rootCause: "PO and invoice price differ from the contract price", owner: "Buyer",
      smallestFix: `Passes if the Buyer corrects PO ${b.po.id} line ${pl.lineNo} to ${inr(cp.price)} and the supplier issues a credit note or corrected invoice at ${inr(cp.price)}, or Procurement documents an approved price exception.`,
      evidence: contractEvidence(b, pl.itemCode),
    });
  }
  const bad = findings.length;
  return {
    evaluated: true, contractId: c.id, validFrom: v.validFrom, validTo: v.validTo, referenceDate: ref, inForce, terms, findings,
    note: bad ? findings.map((f) => f.message).join(" ") : `${window} and was in force on ${fmtDate(ref)}; ${terms.filter((t) => t.state === "ok").length} of ${terms.length} line(s) agree with the contract${terms.some((t) => t.state === "raised_by_price_check") ? ", the rest are reported by the price check" : ""}.`,
  };
}

/** Plain-text contract evidence for one material, used by the findings above and by the Root-Cause Resolver as additional evidence. */
export function contractEvidence(b: CanonicalBundle, itemCode: string, parts: ("validity" | "price" | "amendments")[] = ["validity", "price", "amendments"]): string[] {
  if (!b.contract || !b.contractValidity) return [];
  const c = b.contract, v = b.contractValidity, ref = referenceDate(b);
  const out: string[] = [];
  if (parts.includes("validity")) out.push(`Contract ${c.id} is valid ${fmtDate(v.validFrom)} to ${fmtDate(v.validTo)}; ${ref >= v.validFrom && ref <= v.validTo ? `it was in force on the delivery date ${fmtDate(ref)}` : `it was NOT in force on the delivery date ${fmtDate(ref)}`}.`);
  const cp = contractPriceOn(c, itemCode, ref);
  if (parts.includes("price") && cp) out.push(`Contract ${c.id} price for ${itemCode} on ${fmtDate(ref)}: ${inr(cp.price)}, effective ${fmtDate(cp.effectiveFrom)}.`);
  if (parts.includes("amendments")) for (const a of b.amendments.filter((x) => x.materialCode === itemCode).sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? -1 : 1))) {
    out.push(a.effectiveFrom <= ref
      ? `Amendment effective ${fmtDate(a.effectiveFrom)} (signed ${fmtDate(a.signedOn)}) moved ${itemCode} from ${inr(a.oldPrice)} to ${inr(a.newPrice)}; it applies to this delivery.`
      : `Amendment effective ${fmtDate(a.effectiveFrom)} moves ${itemCode} to ${inr(a.newPrice)}; it starts after this delivery and is not applied.`);
  }
  return out;
}
