// Stage 3: ONE combined module for Root-Cause Resolution and Counterfactual Explanation.
// For every discrepancy or warning on an invoice it gathers evidence from the six sources (contract amendments, PO change history,
// delivery notes, receipts, inspections, weighbridge, shipments), applies transparent rules, and produces:
//   problem, root cause (rule id), evidence list, responsible department and role, recommended correction, and a counterfactual
//   sentence of the form "would pass the <check> if <correction>, per <evidence>, assuming all other checks pass".
// Deterministic rules decide. A root cause is labelled "supported by evidence" only when a record in a source system backs the
// deciding condition; otherwise it is an "unverified prediction". Unit-equivalent quantities (5 MT vs 5000 kg) are listed as
// normalisation, never as a mismatch. Simulating a correction lives in simulate.ts and runs on a sandbox copy.
import { contractPriceOn, uomFactor } from "../engine/match";
import { fmtDate, fmtInr } from "../lib/format";
import type { CanonicalBundle } from "./canonical";
import { contractEvidence, referenceDate } from "./contractCheck";
import { inventoryCheck } from "./inventory";
import type { PlantPayResult, PpDiscrepancy } from "./engine";
import { tokenize } from "./rag";
import type { SourceId } from "./sources/schemas";

export type RuleId =
  | "amendment_not_in_po" | "off_contract_price" | "price_no_contract"
  | "billed_before_delivery" | "goods_receipt_not_posted" | "goods_receipt_under_posted" | "billed_undelivered_quantity"
  | "unit_not_convertible" | "tax_rate_mismatch" | "wrong_material_mapping" | "item_not_on_po" | "duplicate_invoice" | "arithmetic_error"
  | "rejected_goods_billed" | "inspection_pending" | "weighbridge_mismatch"
  | "po_price_off_contract" | "contract_not_in_force" | "returned_goods_billed" | "quantity_over_allocated" | "duplicate_quantity_claim"
  | "bank_details_changed" | "threshold_splitting" | "shared_bank_account" | "address_changed" | "tax_id_conflict" | "unclassified";

export interface Evidence { source: SourceId; ref: string; text: string }
export type Correction =
  | { kind: "amend_po_price"; poId: string; lineNo: number; from: number; to: number; reason: string }
  | { kind: "post_goods_receipt"; poId: string; lines: { lineNo: number; qty: number; uom: string }[] }
  | { kind: "record_inspection"; invoiceId: string }
  | { kind: "supplier_corrects_invoice"; invoiceId: string; lineNo: number; set: { unitPrice?: number; qty?: number; taxRatePct?: number; materialCode?: string } }
  | { kind: "confirm_reweigh"; poId: string; netKg: number }
  | { kind: "duplicate_decision"; invoiceId: string; matchedInvoiceId: string; reason: string }
  | { kind: "verify_bank_details"; vendorId: string; accountNo: string };

export interface Resolution {
  id: string; invoiceId: string; lineNo?: number; check: string; severity: "flag" | "block" | "review";
  problem: string; rule: RuleId; rootCause: string;
  evidenceStatus: "supported_by_evidence" | "unverified_prediction";
  evidence: Evidence[];
  responsible: { department: string; role: string; person?: string };
  correction: string;
  counterfactual: string;
  /** What a simulated human correction would change in the source systems. Empty when a person must supply missing facts. */
  corrections: Correction[];
  notSimulatableReason?: string;
}
export interface Normalisation { lineNo: number; text: string; evidence: Evidence[] }
export interface ExceptionReport { invoiceId: string; status: PlantPayResult["status"]; resolutions: Resolution[]; normalisations: Normalisation[] }

const inr = (n: number) => `₹${fmtInr(n)}`;
const q = (n: number) => (Number.isInteger(n) ? fmtInr(n, 0) : fmtInr(Math.round(n * 1000) / 1000, 3).replace(/0+$/, "").replace(/\.$/, ""));
const ROLE: Record<string, string> = { Procurement: "Buyer", Warehouse: "Warehouse executive", Quality: "Quality inspector", Logistics: "Gate and weighbridge desk", Finance: "AP clerk", "Supplier master data": "Supplier master data team" };
const ASSUMING = "assuming all other checks pass";

/** Pick the rule from the check and the engine's classification. */
export function ruleOf(d: Pick<PpDiscrepancy, "check" | "rootCause">): RuleId {
  const c = d.rootCause;
  switch (d.check) {
    case "price": return c.startsWith("PO not updated") ? "amendment_not_in_po" : c.startsWith("Price differs from both") ? "off_contract_price" : "price_no_contract";
    case "quantity":
      return c.startsWith("Billed before delivery") ? "billed_before_delivery" : c.startsWith("Goods receipt not posted") ? "goods_receipt_not_posted" : c.startsWith("Goods receipt under-posted") ? "goods_receipt_under_posted" : "billed_undelivered_quantity";
    case "quality": return c.startsWith("Inspection not completed") ? "inspection_pending" : "rejected_goods_billed";
    case "weighbridge": return "weighbridge_mismatch";
    case "contract": return c.startsWith("Contract not in force") ? "contract_not_in_force" : "po_price_off_contract";
    case "inventory": return c.startsWith("Returned goods") ? "returned_goods_billed" : c.startsWith("Same quantity") ? "duplicate_quantity_claim" : "quantity_over_allocated";
    case "unit_of_measure": return "unit_not_convertible";
    case "tax": return "tax_rate_mismatch";
    case "purchase_order": return c.startsWith("Item not on the PO") ? "wrong_material_mapping" : "unclassified";
    case "duplicate": return "duplicate_invoice";
    case "arithmetic": return "arithmetic_error";
    default: return "unclassified";
  }
}

const jaccard = (a: string, b: string) => { const x = new Set(tokenize(a)), y = new Set(tokenize(b)); const i = [...x].filter((t) => y.has(t)).length; return i / Math.max(1, x.size + y.size - i); };

export function resolve(b: CanonicalBundle, result: PlantPayResult): ExceptionReport {
  const resolutions: Resolution[] = [];
  const po = b.po;
  const poLineFor = (lineNo?: number) => { const l = b.invoice.lines.find((x) => x.lineNo === lineNo); return l && po ? { l, pl: po.lines.find((p) => p.itemCode === l.itemCode) } : { l, pl: undefined }; };
  const grnEv = (): Evidence[] => b.goodsReceipts.map((g) => ({ source: "warehouse" as SourceId, ref: `GRN ${g.id}`, text: `Goods receipt ${g.id} on ${fmtDate(g.receivedOn)}: ${g.lines.map((l) => `line ${l.lineNo} ${q(l.qtyReceived)} ${l.uom}`).join(", ")}` }));
  const poEv = (lineNo?: number): Evidence => { const pl = po?.lines.find((p) => p.lineNo === lineNo); return { source: "procurement", ref: `PO ${po?.id}`, text: po && pl ? `PO ${po.id} line ${pl.lineNo} (issued ${fmtDate(po.issuedOn)}): ${pl.itemCode}, ${q(pl.qty)} ${pl.uom} at ${inr(pl.unitPrice)}, tax ${pl.taxRatePct}%` : "PO not found" }; };
  const invEv = (lineNo: number, extra = ""): Evidence => { const l = b.invoice.lines.find((x) => x.lineNo === lineNo)!; return { source: "finance", ref: `Invoice ${b.invoice.id}`, text: `Invoice ${b.invoice.id} line ${lineNo}: ${l.itemCode ?? l.description}, ${q(l.qty)} ${l.uom} at ${inr(l.unitPrice)}${extra}` }; };
  const dept = (d: string, owner?: string) => ({ department: d, role: ROLE[d] ?? "Owner", ...(owner ? { person: owner } : {}) });
  const supplierResp = { department: "Finance", role: "AP clerk, who contacts the supplier" };
  /** Stage 4A contract terms as extra evidence (validity window, applicable amendments). Contract-check text, tagged to Procurement. */
  const contractEv = (itemCode: string, parts: ("validity" | "price" | "amendments")[]): Evidence[] =>
    contractEvidence(b, itemCode, parts).map((text) => ({ source: "procurement" as SourceId, ref: `Contract ${b.contract?.id ?? ""} terms`, text }));

  for (const d of result.discrepancies) {
    const rule = ruleOf(d);
    const { l, pl } = poLineFor(d.lineNo);
    const R: Resolution = {
      id: `${d.check}:${d.lineNo ?? 0}:${rule}`, invoiceId: b.invoice.id, lineNo: d.lineNo, check: d.check, severity: d.severity === "block" ? "block" : "flag",
      problem: d.message, rule, rootCause: d.rootCause, evidenceStatus: d.rootCauseStatus, evidence: d.evidence.map((t) => ({ source: (d.sources[0] ?? "procurement") as SourceId, ref: "engine evidence", text: t })),
      responsible: dept(d.department), correction: d.suggestedFix, counterfactual: `This invoice would pass the ${d.check.replace(/_/g, " ")} check if ${d.suggestedFix.replace(/^Passes (if|once) /, "").replace(/\.$/, "")}, ${ASSUMING}.`, corrections: [],
    };

    if (rule === "amendment_not_in_po" && l && pl && po && b.contract) {
      const conv = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      const billed = l.unitPrice / conv;
      const first = [...b.deliveryNotes].map((x) => x.deliveredOn).concat(b.goodsReceipts.map((g) => g.receivedOn)).sort()[0] ?? b.invoice.invoiceDate;
      const atDelivery = contractPriceOn(b.contract, pl.itemCode, first);
      const am = b.amendments.filter((a) => a.materialCode === pl.itemCode && a.effectiveFrom <= first).sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0];
      const target = atDelivery?.price ?? billed;
      const pct = d.deltaPct !== undefined ? `${Math.abs(d.deltaPct).toFixed(1)}%` : "";
      R.problem = `Line ${l.lineNo} (${pl.itemCode}, ${pl.description}): invoice price ${inr(billed)} per ${pl.uom} is ${pct} ${billed > pl.unitPrice ? "above" : "below"} the PO price ${inr(pl.unitPrice)}.`;
      R.rootCause = "Contract amendment not reflected in the PO";
      const changes = b.poChanges.filter((c) => c.lineNo === pl.lineNo && c.field === "unit_price");
      R.evidence = [
        ...(am ? [{ source: "procurement" as SourceId, ref: `Contract ${b.contract.id} amendment`, text: `Contract ${b.contract.id} amendment effective ${fmtDate(am.effectiveFrom)}: ${pl.itemCode} price changed from ${inr(am.oldPrice)} to ${inr(am.newPrice)} (signed ${fmtDate(am.signedOn)})` }]
          : atDelivery ? [{ source: "procurement" as SourceId, ref: `Contract ${b.contract.id}`, text: `Contract ${b.contract.id} sets ${pl.itemCode} at ${inr(atDelivery.price)} from ${fmtDate(atDelivery.effectiveFrom)}` }] : []),
        poEv(pl.lineNo),
        { source: "procurement", ref: `PO ${po.id} history`, text: changes.length ? `PO price changes on record: ${changes.map((c) => `${inr(Number(c.oldValue))} to ${inr(Number(c.newValue))} on ${fmtDate(c.changedOn)}`).join("; ")}, none matching the amendment` : `No price change is recorded on PO ${po.id} line ${pl.lineNo} since it was issued${am ? `, so it still pre-dates the amendment of ${fmtDate(am.effectiveFrom)}` : ""}` },
        ...(b.goodsReceipts.length ? [{ source: "warehouse" as SourceId, ref: "receipts", text: `Goods were received from ${fmtDate(first)}${am ? `, on or after the amendment date ${fmtDate(am.effectiveFrom)}` : ""} (${b.goodsReceipts.map((g) => g.id).join(", ")})` }] : []),
        invEv(l.lineNo, conv !== 1 ? ` (that is ${inr(billed)} per ${pl.uom})` : `, equal to the ${am ? "amended " : ""}contract price`),
      ];
      R.evidenceStatus = am || atDelivery ? "supported_by_evidence" : "unverified_prediction";
      R.evidence.push(...contractEv(pl.itemCode, ["validity"]));
      R.responsible = dept("Procurement", po.buyer);
      R.correction = `Buyer amends PO ${po.id} line ${pl.lineNo} unit price from ${inr(pl.unitPrice)} to ${inr(target)}.`;
      R.counterfactual = `This invoice line would pass the price check if PO ${po.id} line ${pl.lineNo} price were updated to ${inr(target)}, per amendment of contract ${b.contract.id} effective ${fmtDate(am?.effectiveFrom ?? atDelivery?.effectiveFrom)}, ${ASSUMING}.`;
      R.corrections = [{ kind: "amend_po_price", poId: po.id, lineNo: pl.lineNo, from: pl.unitPrice, to: target, reason: `Aligned to contract ${b.contract.id} amendment effective ${am?.effectiveFrom ?? atDelivery?.effectiveFrom}` }];
    } else if (rule === "off_contract_price" && l && pl && po) {
      const conv = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      const first = b.goodsReceipts.map((g) => g.receivedOn).sort()[0] ?? b.invoice.invoiceDate;
      const cp = b.contract ? contractPriceOn(b.contract, pl.itemCode, first) : undefined;
      R.rootCause = "Supplier billed a price that matches neither the PO nor the contract";
      R.evidence = [poEv(pl.lineNo), ...(cp && b.contract ? [{ source: "procurement" as SourceId, ref: `Contract ${b.contract.id}`, text: `Contract ${b.contract.id} sets ${pl.itemCode} at ${inr(cp.price)} from ${fmtDate(cp.effectiveFrom)}` }] : []), invEv(l.lineNo)];
      R.evidenceStatus = cp ? "supported_by_evidence" : "unverified_prediction";
      R.evidence.push(...contractEv(pl.itemCode, ["validity", "amendments"]));
      R.responsible = { ...supplierResp };
      if (cp) {
        R.correction = `Supplier issues a credit note or corrected invoice at the contract price ${inr(cp.price)} per ${pl.uom}.`;
        R.counterfactual = `This invoice line would pass the price check if the supplier's billed price were corrected to ${inr(cp.price)} per ${pl.uom}, per contract ${b.contract!.id} effective ${fmtDate(cp.effectiveFrom)}, ${ASSUMING}.`;
        R.corrections = [{ kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { unitPrice: Math.round(cp.price * conv * 100) / 100 } }];
      }
    } else if (rule === "price_no_contract" && l && pl && po) {
      R.rootCause = "Price differs from the PO and no contract price is on file";
      R.evidenceStatus = "unverified_prediction";
      R.evidence = [poEv(pl.lineNo), invEv(l.lineNo), { source: "procurement", ref: "contracts", text: `No contract price on file for ${pl.itemCode}` }];
      R.responsible = dept("Procurement", po.buyer);
      const conv = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      const to = Math.round((l.unitPrice / conv) * 100) / 100;
      R.correction = `Buyer confirms ${inr(to)} with the supplier and amends the PO, or the supplier corrects the invoice to ${inr(pl.unitPrice)}.`;
      R.counterfactual = `This invoice line would pass the price check if PO ${po.id} line ${pl.lineNo} price were updated to ${inr(to)} after the Buyer confirms it, ${ASSUMING}. The cause is an unverified prediction because no contract record supports it.`;
      R.corrections = [{ kind: "amend_po_price", poId: po.id, lineNo: pl.lineNo, from: pl.unitPrice, to, reason: "Buyer confirmed the billed price" }];
    } else if ((rule === "goods_receipt_not_posted" || rule === "billed_before_delivery") && po) {
      const ship = b.shipments[0];
      const gate = b.gateEntries[0];
      const dn = b.deliveryNotes[0];
      const inTransit = ship?.status === "in_transit";
      const gaps = b.invoice.lines.map((x) => { const p = po.lines.find((y) => y.itemCode === x.itemCode); return p ? { lineNo: p.lineNo, qty: x.qty * (uomFactor(b.uomRules, p.itemCode, x.uom, p.uom)?.factor ?? 1), uom: p.uom } : undefined; }).filter(Boolean) as { lineNo: number; qty: number; uom: string }[];
      R.evidence = [{ source: "warehouse", ref: "receipts", text: `No goods receipt is posted against PO ${po.id}` }];
      if (ship) R.evidence.push({ source: "logistics", ref: `Shipment ${ship.id}`, text: `Shipment ${ship.id}: ${ship.status.replace("_", " ")}, dispatched ${fmtDate(ship.dispatchedOn)}${ship.deliveredOn ? `, delivered ${fmtDate(ship.deliveredOn)}` : ""}` });
      if (gate) R.evidence.push({ source: "logistics", ref: `Gate entry ${gate.id}`, text: `Gate entry ${gate.id}: vehicle ${gate.vehicleNo} on ${fmtDate(gate.enteredOn)}` });
      if (dn) R.evidence.push({ source: "warehouse", ref: `Delivery note ${dn.id}`, text: `Delivery note ${dn.id} on ${fmtDate(dn.deliveredOn)}: ${dn.lines.map((x) => `${x.itemCode} ${q(x.qty)} ${x.uom}`).join(", ")}` });
      R.evidence.push(poEv(gaps[0]?.lineNo));
      if (inTransit) {
        R.rule = "billed_before_delivery"; R.rootCause = "Supplier billed before the goods arrived"; R.evidenceStatus = "supported_by_evidence";
        R.responsible = { ...supplierResp };
        R.correction = "Hold the invoice until the goods arrive and Warehouse posts the receipt.";
      } else if (gate || dn) {
        R.rule = "goods_receipt_not_posted"; R.rootCause = "Goods arrived but the receipt was not posted"; R.evidenceStatus = "supported_by_evidence";
        R.responsible = dept("Warehouse");
        R.correction = `Warehouse posts the goods receipt against PO ${po.id} for the quantity actually received.`;
      } else {
        R.rule = "goods_receipt_not_posted"; R.rootCause = "Goods receipt not posted (no arrival record found)"; R.evidenceStatus = "unverified_prediction";
        R.responsible = dept("Warehouse");
        R.correction = `Warehouse confirms whether the goods arrived and posts the receipt against PO ${po.id}.`;
      }
      R.counterfactual = `This invoice would pass the quantity check if ${inTransit ? "the goods were delivered and " : ""}a goods receipt of ${gaps.map((x) => `${q(x.qty)} ${x.uom} on PO line ${x.lineNo}`).join(" and ")} were posted against PO ${po.id}${R.evidence.find((e) => e.ref.startsWith("Delivery note")) ? ", per the delivery note" : ""}, ${ASSUMING}.`;
      R.corrections = gaps.length ? [{ kind: "post_goods_receipt", poId: po.id, lines: gaps }] : [];
    } else if (rule === "goods_receipt_under_posted" && l && pl && po) {
      const rec = b.goodsReceipts.flatMap((g) => g.lines.filter((x) => x.lineNo === pl.lineNo)).reduce((a, x) => a + x.qtyReceived, 0);
      const dnQty = b.deliveryNotes.flatMap((x) => x.lines.filter((y) => y.itemCode === pl.itemCode)).reduce((a, y) => a + y.qty, 0);
      const billed = l.qty * (uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1);
      const gap = Math.round((billed - rec) * 1000) / 1000;
      R.rootCause = "Goods receipt under-posted: the delivery note shows more than was receipted"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [...grnEv(), ...b.deliveryNotes.map((x) => ({ source: "warehouse" as SourceId, ref: `Delivery note ${x.id}`, text: `Delivery note ${x.id} on ${fmtDate(x.deliveredOn)}: ${x.lines.map((y) => `${y.itemCode} ${q(y.qty)} ${y.uom}`).join(", ")}` })), invEv(l.lineNo)];
      R.responsible = dept("Warehouse");
      R.correction = `Warehouse posts the missing ${q(gap)} ${pl.uom} receipt for PO line ${pl.lineNo}.`;
      R.counterfactual = `This invoice line would pass the quantity check if the goods receipt for PO ${po.id} line ${pl.lineNo} were increased by ${q(gap)} ${pl.uom} to ${q(rec + gap)} ${pl.uom}, per the delivery note (${q(dnQty)} ${pl.uom} delivered), ${ASSUMING}.`;
      R.corrections = [{ kind: "post_goods_receipt", poId: po.id, lines: [{ lineNo: pl.lineNo, qty: gap, uom: pl.uom }] }];
    } else if (rule === "billed_undelivered_quantity" && l && pl && po) {
      const rec = b.goodsReceipts.flatMap((g) => g.lines.filter((x) => x.lineNo === pl.lineNo)).reduce((a, x) => a + x.qtyReceived, 0);
      const f = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      R.rootCause = "Supplier billed for more than was delivered"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [...grnEv(), invEv(l.lineNo)]; R.responsible = { ...supplierResp };
      R.correction = `Supplier reduces the invoice to ${q(rec)} ${pl.uom} (corrected invoice or credit note), or provides proof of delivery for the rest.`;
      R.counterfactual = `This invoice line would pass the quantity check if the billed quantity were reduced to ${q(rec / f)} ${l.uom} (${q(rec)} ${pl.uom}, the quantity received), ${ASSUMING}.`;
      R.corrections = [{ kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { qty: rec / f } }];
    } else if (rule === "rejected_goods_billed" && l && pl) {
      const insp = b.inspections.flatMap((i) => i.lines.filter((x) => x.poLineNo === pl.lineNo).map((x) => ({ i, x })));
      const acc = insp.reduce((a, y) => a + y.x.qtyAccepted, 0), rej = insp.reduce((a, y) => a + y.x.qtyRejected, 0);
      const f = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      R.rootCause = "Goods rejected at inspection were included in the invoice"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [...insp.map((y) => ({ source: "quality" as SourceId, ref: `Inspection ${y.i.id}`, text: `Inspection ${y.i.id} on ${fmtDate(y.i.inspectedOn)}: ${q(y.x.qtyAccepted)} accepted, ${q(y.x.qtyRejected)} rejected of ${q(y.x.qtyInspected)} ${y.x.uom}${y.x.reason ? `, ${y.x.reason}` : ""}` })), ...grnEv(), invEv(l.lineNo)];
      R.responsible = dept("Quality");
      R.correction = `Supplier credits the ${q(rej)} ${pl.uom} rejected (corrected invoice or credit note), or Quality records a documented concession.`;
      R.counterfactual = `This invoice line would pass the quality check if the billed quantity were reduced to ${q(acc / f)} ${l.uom} (the ${q(acc)} ${pl.uom} accepted at inspection), per inspection ${insp[0]?.i.id}, ${ASSUMING}.`;
      R.corrections = [{ kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { qty: acc / f } }];
    } else if (rule === "inspection_pending") {
      const pend = b.goodsReceipts.filter((g) => !b.inspections.some((i) => i.grId === g.id));
      R.rootCause = "Goods received but not yet inspected"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [...grnEv(), { source: "quality", ref: "inspections", text: `No inspection report on file for ${pend.map((g) => `GRN ${g.id}`).join(", ") || "this PO"}` }];
      R.responsible = dept("Quality");
      R.correction = "Quality records the inspection result for the receipt.";
      R.counterfactual = `This invoice would pass the quality check if Quality recorded the inspection result for ${pend.map((g) => `GRN ${g.id}`).join(" and ")} with the billed quantity accepted, ${ASSUMING}.`;
      R.corrections = [{ kind: "record_inspection", invoiceId: b.invoice.id }];
    } else if (rule === "weighbridge_mismatch" && po) {
      const wb = b.weighbridge;
      const grnKg = b.goodsReceipts.reduce((a, g) => a + g.lines.reduce((x, y) => x + y.qtyReceived, 0), 0);
      R.rootCause = "Weight received or billed exceeds the weight that crossed the weighbridge"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [...wb.map((w) => ({ source: "logistics" as SourceId, ref: `Weighbridge ${w.id}`, text: `Weighbridge ${w.id} on ${fmtDate(w.weighedOn)}: gross ${q(w.grossKg)} kg, tare ${q(w.tareKg)} kg, net ${q(w.netKg)} kg` })), ...grnEv()];
      R.responsible = dept("Logistics");
      R.correction = `Logistics confirms a re-weigh. If the weight stands, the goods receipt and invoice are corrected to about ${q(wb.reduce((a, w) => a + w.netKg, 0))} kg.`;
      R.counterfactual = `This invoice would pass the weighbridge check if the weighbridge net weight were confirmed at ${q(grnKg)} kg after a re-weigh, per goods receipt ${b.goodsReceipts[0]?.id}, ${ASSUMING}. If the weighbridge figure is right, correcting the receipt and invoice to ${q(wb.reduce((a, w) => a + w.netKg, 0))} kg would clear it instead.`;
      R.corrections = [{ kind: "confirm_reweigh", poId: po.id, netKg: grnKg }];
    } else if (rule === "tax_rate_mismatch" && po && b.invoice.lines.some((x) => po.lines.some((p) => p.itemCode === x.itemCode && p.taxRatePct !== x.taxRatePct))) {
      const l = b.invoice.lines.find((x) => po.lines.some((p) => p.itemCode === x.itemCode && p.taxRatePct !== x.taxRatePct))!;
      const pl = po.lines.find((p) => p.itemCode === l.itemCode)!;
      R.rootCause = "Invoice tax rate differs from the PO tax code"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [poEv(pl.lineNo), invEv(l.lineNo, ` with tax ${l.taxRatePct}%`)];
      R.responsible = { ...supplierResp };
      R.correction = `Supplier reissues the invoice at ${pl.taxRatePct}%, or the Buyer confirms the PO tax code is wrong.`;
      R.counterfactual = `This invoice would pass the tax check if the tax rate on the invoice were ${pl.taxRatePct}% (tax code ${pl.taxCode} on PO ${po.id}), ${ASSUMING}.`;
      R.corrections = b.invoice.lines.filter((x) => x.taxRatePct !== pl.taxRatePct).map((x) => ({ kind: "supplier_corrects_invoice" as const, invoiceId: b.invoice.id, lineNo: x.lineNo, set: { taxRatePct: pl.taxRatePct } }));
    } else if (rule === "unit_not_convertible" && l && pl) {
      R.rootCause = "Invoice unit has no conversion to the PO unit"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [poEv(pl.lineNo), invEv(l.lineNo), { source: "procurement", ref: "unit table", text: `The material unit table has no conversion from ${l.uom} to ${pl.uom} for ${pl.itemCode}` }];
      R.responsible = dept("Procurement", po?.buyer);
      R.correction = `Procurement adds a conversion from ${l.uom} to ${pl.uom} for ${pl.itemCode}, or the supplier bills in ${pl.uom}.`;
      R.counterfactual = `This invoice line would pass the unit check if a conversion from ${l.uom} to ${pl.uom} were added to the unit table for ${pl.itemCode}, ${ASSUMING}.`;
      R.notSimulatableReason = "Needs the conversion factor from Procurement, which is not in any record.";
    } else if (rule === "wrong_material_mapping" && l && po) {
      const used = new Set(b.invoice.lines.map((x) => x.itemCode));
      const cands = po.lines.filter((p) => !used.has(p.itemCode)).map((p) => ({ p, exact: p.description.trim().toLowerCase() === l.description.trim().toLowerCase(), sim: jaccard(p.description, l.description) })).sort((x, y) => y.sim - x.sim);
      const best = cands[0];
      if (best && (best.exact || best.sim >= 0.5)) {
        R.rule = "wrong_material_mapping"; R.rootCause = "Invoice item code does not match the PO item code, but the description matches a PO line";
        R.evidenceStatus = best.exact ? "supported_by_evidence" : "unverified_prediction";
        R.evidence = [invEv(l.lineNo), poEv(best.p.lineNo), { source: "procurement", ref: "descriptions", text: best.exact ? `The invoice description "${l.description}" is identical to the description of PO line ${best.p.lineNo} (${best.p.itemCode})` : `The invoice description is ${Math.round(best.sim * 100)}% similar to PO line ${best.p.lineNo} (${best.p.itemCode}): a guess, not a record` }];
        R.responsible = { department: "Finance", role: "AP clerk, with the Buyer to confirm the material" };
        R.correction = `Map invoice line ${l.lineNo} to material ${best.p.itemCode} (PO line ${best.p.lineNo}) after the Buyer confirms.`;
        R.counterfactual = `This invoice line would pass the purchase-order check if its item code ${l.itemCode ?? "(none)"} were mapped to ${best.p.itemCode}, per PO ${po.id} line ${best.p.lineNo}${best.exact ? "" : " (to be confirmed by the Buyer)"}, ${ASSUMING}.`;
        R.corrections = [{ kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { materialCode: best.p.itemCode } }];
      } else {
        R.rule = "item_not_on_po"; R.rootCause = "Item billed that is not on the PO"; R.evidenceStatus = "supported_by_evidence";
        R.evidence = [invEv(l.lineNo), { source: "procurement", ref: `PO ${po.id}`, text: `PO ${po.id} has ${po.lines.length} line(s) and none is ${l.itemCode ?? l.description}` }];
        R.responsible = dept("Procurement", po.buyer);
        R.correction = `Buyer adds ${l.itemCode ?? "the item"} to PO ${po.id}, or the supplier removes the line.`;
        R.counterfactual = `This invoice line would pass the purchase-order check if ${l.itemCode ?? "the item"} were added to PO ${po.id}, ${ASSUMING}.`;
        R.notSimulatableReason = "Adding a PO line needs a Buyer decision on quantity and price.";
      }
    } else if (rule === "duplicate_invoice") {
      const hit = /of ([^\s(]+) \(/.exec(d.message)?.[1] ?? "";
      const other = b.relatedInvoices.find((x) => x.id === hit);
      R.rootCause = "Possible duplicate of an earlier invoice"; R.evidenceStatus = other ? "supported_by_evidence" : "unverified_prediction";
      R.evidence = [...(other ? [{ source: "finance" as SourceId, ref: `Invoice ${other.id}`, text: `Earlier invoice ${other.id}: ${fmtDate(other.invoiceDate)}, PO ${other.poId ?? "none"}, ${inr(other.total)}, ${other.status}` }] : []), { source: "finance", ref: `Invoice ${b.invoice.id}`, text: `This invoice: ${fmtDate(b.invoice.invoiceDate)}, PO ${b.invoice.poId ?? "none"}, ${inr(b.invoice.total)}` }];
      R.responsible = dept("Finance");
      R.correction = "An AP clerk compares the two documents with the supplier and records whether this is a different bill (a reason is required).";
      R.counterfactual = `This invoice would pass the duplicate check if a clerk recorded, with a reason, that it is a different bill from ${hit || "the earlier invoice"}, ${ASSUMING}. This is a prompt for a person to compare the two, not a finding of wrongdoing.`;
      R.corrections = hit ? [{ kind: "duplicate_decision", invoiceId: b.invoice.id, matchedInvoiceId: hit, reason: "Clerk compared both documents and confirmed this is a separate supply" }] : [];
    } else if (rule === "contract_not_in_force") {
      R.rootCause = "Contract not in force on the delivery date"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = d.evidence.map((t) => ({ source: "procurement" as SourceId, ref: `Contract ${b.contract?.id ?? ""}`, text: t }));
      R.responsible = dept("Procurement", po?.buyer);
      R.counterfactual = `This invoice would pass the contract check if contract ${b.contract?.id} were extended or replaced to cover ${fmtDate(referenceDate(b))}, or Procurement confirmed the price in writing as a spot purchase, ${ASSUMING}.`;
      R.notSimulatableReason = "Extending a contract is a commercial decision for Procurement, not a data fix.";
    } else if (rule === "po_price_off_contract" && l && pl && po && b.contract) {
      const conv = uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1;
      const cp = contractPriceOn(b.contract, pl.itemCode, referenceDate(b));
      R.rootCause = "PO and invoice carry a price that differs from the contract price"; R.evidenceStatus = cp ? "supported_by_evidence" : "unverified_prediction";
      R.evidence = [...contractEv(pl.itemCode, ["validity", "price", "amendments"]), poEv(pl.lineNo), invEv(l.lineNo, `, the same as the PO`)];
      R.responsible = dept("Procurement", po.buyer);
      if (cp) {
        R.counterfactual = `This invoice line would pass the contract check if PO ${po.id} line ${pl.lineNo} and the supplier's billed price were both corrected to ${inr(cp.price)} per ${pl.uom}, per contract ${b.contract.id} effective ${fmtDate(cp.effectiveFrom)}, ${ASSUMING}.`;
        R.corrections = [
          { kind: "amend_po_price", poId: po.id, lineNo: pl.lineNo, from: pl.unitPrice, to: cp.price, reason: `Aligned to contract ${b.contract.id} price effective ${cp.effectiveFrom}` },
          { kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { unitPrice: Math.round(cp.price * conv * 100) / 100 } },
        ];
      }
    } else if (rule === "returned_goods_billed" || rule === "quantity_over_allocated" || rule === "duplicate_quantity_claim") {
      const row = inventoryCheck(b).rows.find((x) => x.lineNo === d.lineNo);
      const conv = l && pl ? uomFactor(b.uomRules, pl.itemCode, l.uom, pl.uom)?.factor ?? 1 : 1;
      R.evidenceStatus = "supported_by_evidence";
      R.evidence = d.evidence.map((t) => ({ source: (/^Earlier invoice/.test(t) ? "finance" : "warehouse") as SourceId, ref: /^Earlier invoice/.test(t) ? "earlier invoices" : /^Stock ledger/.test(t) ? "stock ledger" : "goods receipt", text: t }));
      if (l) R.evidence.push(invEv(l.lineNo));
      R.responsible = rule === "returned_goods_billed" ? { ...supplierResp } : dept("Finance");
      const allowed = row ? Math.round((row.remaining / conv) * 1000) / 1000 : 0;
      const what = rule === "returned_goods_billed" ? "the returned quantity were credited" : rule === "duplicate_quantity_claim" ? "the duplicated quantity were removed" : "the quantity already claimed by earlier invoices were removed";
      R.counterfactual = row && allowed > 0 && l
        ? `This invoice line would pass the inventory check if ${what}, reducing the billed quantity to ${q(allowed)} ${l.uom} (${q(row.remaining)} ${row.uom} still unclaimed of ${q(row.net)} ${row.uom} net received), ${ASSUMING}.`
        : `This invoice line would pass the inventory check if ${what} or a further goods receipt covered it, ${ASSUMING}.`;
      if (row && l && allowed > 0) R.corrections = [{ kind: "supplier_corrects_invoice", invoiceId: b.invoice.id, lineNo: l.lineNo, set: { qty: allowed } }];
      else R.notSimulatableReason = "Nothing is left to bill on this line; the supplier must withdraw it or Warehouse must post a further receipt.";
    } else if (rule === "arithmetic_error") {
      R.rootCause = "Invoice arithmetic does not add up"; R.evidenceStatus = "supported_by_evidence";
      R.evidence = [{ source: "finance", ref: `Invoice ${b.invoice.id}`, text: d.message }];
      R.responsible = { ...supplierResp };
      R.notSimulatableReason = "The supplier has to reissue the document.";
    }
    resolutions.push(R);
  }

  // Warnings for human review
  for (const w of result.warnings.filter((x) => x.severity === "review")) {
    const base = { invoiceId: b.invoice.id, check: "bank_and_account_risk", severity: "review" as const, problem: w.message, evidence: w.evidence.map((t) => ({ source: "supplier" as SourceId, ref: "supplier master", text: t })), evidenceStatus: "supported_by_evidence" as const, responsible: dept(w.department), corrections: [] as Correction[] };
    if (w.kind === "bank_change" && b.remit && b.vendor) {
      resolutions.push({ ...base, id: "bank:0:bank_details_changed", rule: "bank_details_changed", rootCause: "Supplier bank details changed and are not yet verified", correction: "Supplier master data verifies the change by calling a contact already on file (not the number or e-mail in the change request), then records the verification.",
        counterfactual: `This invoice would clear the bank-detail warning if the new account ${b.remit.accountNo} were verified independently by call-back to a contact already on file, ${ASSUMING}.`,
        corrections: [{ kind: "verify_bank_details", vendorId: b.vendor.id, accountNo: b.remit.accountNo }] });
    } else if (w.kind === "threshold_splitting") {
      resolutions.push({ ...base, id: "split:0:threshold_splitting", rule: "threshold_splitting", rootCause: "Related invoices together exceed an approval limit that each is under (can be a normal staged delivery)", correction: "A person reviews the related invoices and approves them at the combined amount's approval level.",
        counterfactual: `This invoice would clear the splitting warning if a person confirmed the related invoices as one staged delivery and routed them to the approval level for the combined amount, ${ASSUMING}.`, notSimulatableReason: "A human review decision, not a data fix." });
    } else if (w.kind === "address_change") {
      resolutions.push({ ...base, id: "address:0:address_changed", rule: "address_changed", rootCause: "Supplier registered address changed recently (suppliers do move; this is a prompt to confirm)", correction: "Supplier master data confirms the move with a contact already on file and records the confirmation.",
        counterfactual: `This invoice would clear the address warning if Supplier master data confirmed the new registered address by call-back to a contact already on file, ${ASSUMING}.`, notSimulatableReason: "A human confirmation, not a data fix." });
    } else if (w.kind === "tax_id_conflict") {
      resolutions.push({ ...base, id: "taxid:0:tax_id_conflict", rule: "tax_id_conflict", rootCause: "GSTIN on the invoice does not agree with the supplier master (typing error or a different legal entity: unverified)", correction: "Supplier confirms its GSTIN in writing; Supplier master data checks it on the GST portal and either corrects the master or asks for a corrected invoice.",
        counterfactual: `This invoice would clear the tax-ID warning if the GSTIN on the invoice and on the supplier master were confirmed to be the same registration, ${ASSUMING}.`, notSimulatableReason: "A human confirmation, not a data fix." });
    } else {
      resolutions.push({ ...base, id: `${w.kind}:0:${w.kind}`, rule: w.kind === "shared_bank_account" ? "shared_bank_account" : "unclassified", rootCause: "Remittance account shared with another supplier (can be legitimate)", correction: "Supplier master data confirms the relationship and records it on the supplier master.",
        counterfactual: `This invoice would clear the shared-account warning if Supplier master data recorded the relationship between the suppliers sharing the account, ${ASSUMING}.`, notSimulatableReason: "A human review decision, not a data fix." });
    }
  }

  // Normalisation, not a mismatch
  const normalisations: Normalisation[] = [];
  if (po) for (const l of b.invoice.lines) {
    const p = po.lines.find((x) => x.itemCode === l.itemCode);
    if (!p || l.uom.toLowerCase() === p.uom.toLowerCase()) continue;
    const c = uomFactor(b.uomRules, p.itemCode, l.uom, p.uom);
    if (!c) continue;
    normalisations.push({
      lineNo: l.lineNo, text: `Line ${l.lineNo} is billed as ${q(l.qty)} ${l.uom} at ${inr(l.unitPrice)} per ${l.uom}. That is ${q(l.qty * c.factor)} ${p.uom} at ${inr(l.unitPrice / c.factor)} per ${p.uom}, the same quantity and price as PO ${po.id} (${q(p.qty)} ${p.uom} at ${inr(p.unitPrice)}). Unit-equivalent quantities are normalised, not treated as a mismatch.`,
      evidence: [{ source: "procurement", ref: "unit table", text: `Unit table: 1 ${l.uom} = ${q(c.factor)} ${p.uom} for ${p.itemCode}` }, poEv(p.lineNo), invEv(l.lineNo)],
    });
  }
  return { invoiceId: b.invoice.id, status: result.status, resolutions, normalisations };
}
