// Canonical data model: normalises native records from the six sources (IDs, units, currency, weights) into one shape,
// and assembles everything known about one invoice, noting which sources contributed and which were unavailable.
import type { Contract, DeliveryNote, GoodsReceipt, Invoice, PurchaseOrder, UomRule, Vendor } from "../lib/types";
import { Connectors, SourceUnavailableError } from "./connectors";
import { SOURCE_IDS, type SourceId } from "./sources/schemas";

// ---------------------------------------------------------------- pure normalisers (unit-tested)
/** "PO-4600009003" and "4600009003" both become "4600009003". */
export const normPoId = (s: string): string => String(s).trim().replace(/^PO[-\s]?/i, "");
/** "GRN-5100000001" becomes "5100000001". */
export const normGrnId = (s: string): string => String(s).trim().replace(/^GRN[-\s]?/i, "");
/** Supplier codes: the supplier DB uses "SUP-1007"; every other system uses "V-1007". */
export const normVendorId = (s: string): string => String(s).trim().replace(/^SUP[-\s]?/i, "V-");
/** Finance stores integer paise; the canonical model is rupees. */
export const paiseToInr = (p: number): number => Math.round(p) / 100;
/** The weighbridge reports tonnes; the canonical model is kilograms. */
export const tonnesToKg = (t: number): number => Math.round(t * 1000);
const UOM_SYNONYMS: Record<string, string> = {
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", mt: "MT", tonne: "MT", tonnes: "MT", ton: "MT", l: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  nos: "nos", no: "nos", pcs: "nos", piece: "nos", pieces: "nos", each: "nos",
};
/** One spelling per unit: "KGS" and "Kg" are kg, "tonnes" is MT, "Pcs" is nos. Unknown units are lower-cased. */
export const normUom = (u: string): string => { const k = String(u).trim().toLowerCase(); return UOM_SYNONYMS[k] ?? k; };
export const canonicalId = {
  invoice: (no: string) => `inv:${no}`, po: (id: string) => `po:${normPoId(id)}`, grn: (id: string) => `grn:${normGrnId(id)}`, vendor: (id: string) => `vendor:${normVendorId(id)}`,
};

// ---------------------------------------------------------------- canonical types
export interface CanonicalInspection { id: string; grId: string; poId: string; inspectedOn: string; inspector: string; lines: { poLineNo: number; qtyInspected: number; qtyAccepted: number; qtyRejected: number; uom: string; reason?: string }[] }
export interface CanonicalWeighbridge { id: string; entryId: string; poId: string; weighedOn: string; grossKg: number; tareKg: number; netKg: number }
export interface CanonicalGateEntry { id: string; poId: string; grId?: string; vehicleNo: string; enteredOn: string }
export interface CanonicalShipment { id: string; poId: string; dispatchedOn: string; deliveredOn?: string; status: string }
export interface CanonicalBankAccount { id: string; bankName: string; accountNo: string; ifsc: string; status: "verified" | "pending_verification" | "closed"; validFrom: string; validTo?: string; verifiedOn?: string; note?: string }
export interface CanonicalStockTxn { id: number; materialCode: string; type: "GR" | "RETURN" | "REVERSAL"; /** Positive quantity in the unit shown; the sign is carried by `type`. */ qty: number; uom: string; date: string; grId: string }
export interface CanonicalVendor extends Vendor { stateCode: string; addresses: { kind: string; line: string; city: string; pincode: string; validFrom?: string; validTo?: string }[]; contacts: { name: string; phone: string; email: string }[]; bankAccounts: CanonicalBankAccount[]; onboardedOn: string }

export interface CanonicalBundle {
  ids: { invoice: string; po?: string; vendor: string };
  invoice: Invoice;
  remit?: { accountNo: string; ifsc: string };
  /** GSTIN as printed on the invoice (Finance keeps it with the invoice); compared with the supplier master. */
  invoiceGstin?: string;
  approvals: { approver: string; level: string; approvedOn: string }[];
  payment?: { paidOn: string; amount: number; utr: string };
  vendor?: CanonicalVendor;
  po?: PurchaseOrder;
  poChanges: { lineNo: number; field: string; oldValue: string; newValue: string; changedOn: string; reason: string }[];
  contract?: Contract;
  /** The contract's own validity window (the Contract type carries only the newest price date). */
  contractValidity?: { validFrom: string; validTo: string };
  amendments: { materialCode: string; oldPrice: number; newPrice: number; effectiveFrom: string; signedOn: string; note?: string }[];
  uomRules: UomRule[];
  goodsReceipts: GoodsReceipt[];
  deliveryNotes: DeliveryNote[];
  inspections: CanonicalInspection[];
  /** Warehouse stock ledger rows for this PO's goods receipts: receipts, returns to supplier, reversals. */
  stockLedger: CanonicalStockTxn[];
  weighbridge: CanonicalWeighbridge[];
  gateEntries: CanonicalGateEntry[];
  shipments: CanonicalShipment[];
  /** Other invoices from the same supplier (duplicate and splitting checks). */
  relatedInvoices: Invoice[];
  /** Other suppliers holding the remittance account (a shared account can be legitimate). */
  accountHolders: { vendorId: string; name: string; status: string; note?: string }[];
}

export interface SourceUse { source: SourceId; status: "ok" | "unavailable"; contributed: string[]; reason?: string }
export interface CanonicalResult { bundle?: CanonicalBundle; sources: SourceUse[]; unavailable: SourceId[]; error?: string }

const num = (v: unknown) => Number(v);
const str = (v: unknown) => String(v);
const optStr = (v: unknown) => (v == null ? undefined : String(v));

type RawInvoice = { header: Record<string, unknown>; lines: Record<string, unknown>[] };
/** Finance's native invoice record (paise, V- ids) to the canonical Invoice (rupees). */
export function invoiceFromFinance(raw: RawInvoice): Invoice {
  const h = raw.header;
  return {
    id: str(h.invoice_no), vendorId: normVendorId(str(h.supplier_id)), poId: h.po_ref ? normPoId(str(h.po_ref)) : undefined, invoiceDate: str(h.invoice_date), receivedOn: str(h.received_on),
    currency: "INR", subtotal: paiseToInr(num(h.subtotal_paise)), tax: paiseToInr(num(h.tax_paise)), total: paiseToInr(num(h.total_paise)), status: str(h.status) as Invoice["status"],
    sourceFile: optStr(h.source_file), resolvedOn: optStr(h.resolved_on),
    lines: raw.lines.map((l) => ({ lineNo: num(l.line_no), itemCode: optStr(l.material_code), description: str(l.description), qty: num(l.qty), uom: normUom(str(l.uom)), unitPrice: paiseToInr(num(l.unit_price_paise)), taxRatePct: num(l.tax_rate_pct), amount: paiseToInr(num(l.amount_paise)) })),
  };
}

// ---------------------------------------------------------------- assembly
/** Gather everything about one invoice. A failing source never throws: it is recorded as unavailable and its data is left empty. */
export function loadCanonical(c: Connectors, invoiceNo: string): CanonicalResult {
  const use = Object.fromEntries(SOURCE_IDS.map((s) => [s, { source: s, status: "ok", contributed: [] } as SourceUse])) as Record<SourceId, SourceUse>;
  const down = (s: SourceId, e: unknown) => { use[s].status = "unavailable"; use[s].reason = e instanceof SourceUnavailableError ? e.reason : "unavailable"; };
  const attempt = <T,>(s: SourceId, fn: () => T, fallback: T): T => { try { return fn(); } catch (e) { if (e instanceof SourceUnavailableError) { down(s, e); return fallback; } throw e; } };
  const done = (): CanonicalResult => ({ sources: SOURCE_IDS.map((s) => use[s]), unavailable: SOURCE_IDS.filter((s) => use[s].status === "unavailable") });

  // Finance owns the invoice. Without it nothing can be evaluated.
  let raw: ReturnType<Connectors["finance"]["invoice"]>;
  try { raw = c.finance.invoice(invoiceNo); } catch (e) { if (e instanceof SourceUnavailableError) { down("finance", e); return { ...done(), error: "Finance DB is unavailable, so the invoice itself cannot be read." }; } throw e; }
  if (!raw) return { ...done(), error: `Invoice ${invoiceNo} was not found in the Finance DB.` };
  const invoice = invoiceFromFinance(raw);
  use.finance.contributed.push(`Invoice ${invoice.id}: ${invoice.lines.length} line(s), total ₹${invoice.total.toLocaleString("en-IN")}`);
  const remit = raw.header.remit_account_no ? { accountNo: str(raw.header.remit_account_no), ifsc: str(raw.header.remit_ifsc) } : undefined;
  const approvals = raw.approvals.map((a) => ({ approver: str(a.approver_name ?? a.approver_id), level: str(a.level), approvedOn: str(a.approved_on) }));
  const payment = raw.payment ? { paidOn: str(raw.payment.paid_on), amount: paiseToInr(num(raw.payment.amount_paise)), utr: str(raw.payment.utr) } : undefined;
  if (payment) use.finance.contributed.push(`Payment ${payment.utr} on ${payment.paidOn}`);
  if (approvals.length) use.finance.contributed.push(`${approvals.length} approval record(s)`);
  const relatedInvoices = attempt("finance", () => c.finance.invoicesForSupplier(str(raw!.header.supplier_id)).filter((r) => str(r.header.invoice_no) !== invoice.id).map(invoiceFromFinance), [] as Invoice[]);

  const vendorId = invoice.vendorId;
  const poId = invoice.poId;
  const bundle: CanonicalBundle = {
    ids: { invoice: canonicalId.invoice(invoice.id), po: poId ? canonicalId.po(poId) : undefined, vendor: canonicalId.vendor(vendorId) },
    invoice, remit, invoiceGstin: raw.header.gstin_on_invoice ? str(raw.header.gstin_on_invoice) : undefined, approvals, payment, poChanges: [], amendments: [], uomRules: [], goodsReceipts: [], deliveryNotes: [], inspections: [], stockLedger: [], weighbridge: [], gateEntries: [], shipments: [], relatedInvoices, accountHolders: [],
  };

  // Procurement: PO, contract, amendments, unit rules
  const rawPo = poId ? attempt("procurement", () => c.procurement.purchaseOrder(poId), undefined) : undefined;
  if (rawPo) {
    const h = rawPo.header;
    bundle.po = {
      id: str(h.po_number), vendorId: normVendorId(str(h.supplier_id)), buyer: str(h.buyer_name ?? h.buyer_id), issuedOn: str(h.issued_on), contractId: optStr(h.contract_no),
      lines: rawPo.lines.map((l) => ({ lineNo: num(l.line_no), itemCode: str(l.material_code), description: str(l.description), qty: num(l.qty), uom: normUom(str(l.uom)), unitPrice: num(l.unit_price), taxCode: str(l.tax_code), taxRatePct: num(l.tax_rate_pct) })),
    };
    bundle.poChanges = rawPo.changes.map((x) => ({ lineNo: num(x.line_no), field: str(x.field), oldValue: str(x.old_value), newValue: str(x.new_value), changedOn: str(x.changed_on), reason: str(x.reason) }));
    use.procurement.contributed.push(`PO ${bundle.po.id}: ${bundle.po.lines.length} line(s), issued ${bundle.po.issuedOn}`);
    if (bundle.poChanges.length) use.procurement.contributed.push(`${bundle.poChanges.length} PO change(s) on record`);
    const rawC = h.contract_no ? attempt("procurement", () => c.procurement.contract(str(h.contract_no)), undefined) : undefined;
    if (rawC) {
      const seen = new Set<string>(); const prices: Contract["prices"] = []; const history: NonNullable<Contract["history"]> = [];
      let newest = str(rawC.header.valid_from);
      for (const r of rawC.prices) {
        const code = str(r.material_code);
        if (!seen.has(code)) { seen.add(code); prices.push({ itemCode: code, unitPrice: num(r.unit_price), uom: normUom(str(r.uom)) }); if (str(r.effective_from) > newest) newest = str(r.effective_from); }
        else history.push({ itemCode: code, unitPrice: num(r.unit_price), uom: normUom(str(r.uom)), effectiveFrom: str(r.effective_from) });
      }
      bundle.contractValidity = { validFrom: str(rawC.header.valid_from), validTo: str(rawC.header.valid_to) };
      bundle.contract = { id: str(rawC.header.contract_no), vendorId: normVendorId(str(rawC.header.supplier_id)), effectiveFrom: newest, prices, history };
      bundle.amendments = rawC.amendments.map((a) => ({ materialCode: str(a.material_code), oldPrice: num(a.old_price), newPrice: num(a.new_price), effectiveFrom: str(a.effective_from), signedOn: str(a.signed_on), note: optStr(a.note) }));
      use.procurement.contributed.push(`Contract ${bundle.contract.id}${bundle.amendments.length ? ` with ${bundle.amendments.length} amendment(s)` : ""}`);
    }
    bundle.uomRules = attempt("procurement", () => c.procurement.uomRules([...new Set(bundle.po!.lines.map((l) => l.itemCode))]), []).map((r) => ({ itemCode: str(r.material_code), fromUom: normUom(str(r.from_uom)), toUom: normUom(str(r.to_uom)), factor: num(r.factor) }));
  }

  // Warehouse: goods receipts and delivery notes
  if (poId) {
    const grns = attempt("warehouse", () => c.warehouse.receiptsForPo(`PO-${poId}`), []);
    bundle.goodsReceipts = grns.map((g) => ({ id: normGrnId(str(g.header.grn_no)), poId: normPoId(str(g.header.po_ref)), receivedOn: str(g.header.received_on), receivedBy: str(g.header.received_by_name ?? g.header.received_by), lines: g.lines.map((l) => ({ lineNo: num(l.po_line_no), qtyReceived: num(l.qty_received), uom: normUom(str(l.uom)) })) }));
    const dns = attempt("warehouse", () => c.warehouse.deliveryNotesForPo(`PO-${poId}`), []);
    bundle.deliveryNotes = dns.map((d) => ({ id: str(d.header.dn_no), poId, vendorId, deliveredOn: str(d.header.delivered_on), lines: d.lines.map((l) => ({ itemCode: str(l.material_code), qty: num(l.qty), uom: normUom(str(l.uom)) })) }));
    bundle.stockLedger = attempt("warehouse", () => c.warehouse.ledgerForGrns(grns.map((g) => str(g.header.grn_no))), []).map((t) => ({ id: num(t.id), materialCode: str(t.material_code), type: str(t.ref_type) as CanonicalStockTxn["type"], qty: Math.abs(num(t.qty)), uom: normUom(str(t.uom)), date: str(t.txn_date), grId: normGrnId(str(t.ref_id)) }));
    if (use.warehouse.status === "ok") use.warehouse.contributed.push(bundle.goodsReceipts.length ? `${bundle.goodsReceipts.length} goods receipt(s): ${bundle.goodsReceipts.map((g) => g.id).join(", ")}` : "No goods receipt posted for this PO");
    if (bundle.deliveryNotes.length) use.warehouse.contributed.push(`${bundle.deliveryNotes.length} delivery note(s)`);
    if (bundle.stockLedger.length) use.warehouse.contributed.push(`${bundle.stockLedger.length} stock ledger entr${bundle.stockLedger.length === 1 ? "y" : "ies"}`);

    // Quality
    const insp = attempt("quality", () => c.quality.inspectionsForPo(`PO-${poId}`), []);
    bundle.inspections = insp.map((i) => ({ id: str(i.header.inspection_no), grId: normGrnId(str(i.header.grn_ref)), poId, inspectedOn: str(i.header.inspected_on), inspector: str(i.header.inspector), lines: i.lines.map((l) => ({ poLineNo: num(l.po_line_no), qtyInspected: num(l.qty_inspected), qtyAccepted: num(l.qty_accepted), qtyRejected: num(l.qty_rejected), uom: normUom(str(l.uom)), reason: optStr(l.reject_reason) })) }));
    if (use.quality.status === "ok") use.quality.contributed.push(bundle.inspections.length ? bundle.inspections.map((i) => `${i.id}: ${i.lines.reduce((a, l) => a + l.qtyAccepted, 0)} accepted, ${i.lines.reduce((a, l) => a + l.qtyRejected, 0)} rejected`).join("; ") : "No inspection report on file for this PO");

    // Logistics
    bundle.shipments = attempt("logistics", () => c.logistics.shipmentsForPo(poId), []).map((s) => ({ id: str(s.shipment_no), poId, dispatchedOn: str(s.dispatched_on), deliveredOn: optStr(s.delivered_on), status: str(s.status) }));
    bundle.gateEntries = attempt("logistics", () => c.logistics.gateEntriesForPo(poId), []).map((g) => ({ id: str(g.entry_no), poId, grId: g.grn_ref ? normGrnId(str(g.grn_ref)) : undefined, vehicleNo: str(g.vehicle_no), enteredOn: str(g.entered_on) }));
    bundle.weighbridge = attempt("logistics", () => c.logistics.weighbridgeForPo(poId), []).map((w) => ({ id: str(w.record_no), entryId: str(w.entry_no), poId, weighedOn: str(w.weighed_on), grossKg: tonnesToKg(num(w.gross_t)), tareKg: tonnesToKg(num(w.tare_t)), netKg: tonnesToKg(num(w.net_t)) }));
    if (use.logistics.status === "ok") {
      use.logistics.contributed.push(bundle.shipments.length ? `Shipment ${bundle.shipments[0].id}: ${bundle.shipments[0].status}` : "No shipment record");
      if (bundle.gateEntries.length) use.logistics.contributed.push(`${bundle.gateEntries.length} gate entr${bundle.gateEntries.length === 1 ? "y" : "ies"}`);
      if (bundle.weighbridge.length) use.logistics.contributed.push(`Weighbridge net ${bundle.weighbridge.reduce((a, w) => a + w.netKg, 0).toLocaleString("en-IN")} kg`);
    }
  }

  // Supplier master: identity and verified bank details
  const code = `SUP-${vendorId.slice(2)}`;
  const supplierPack = attempt("supplier", () => {
    const sup = c.supplier.supplier(code);
    return sup ? { sup, accounts: c.supplier.bankAccounts(code), addresses: c.supplier.addresses(code), contacts: c.supplier.contacts(code), holders: remit ? c.supplier.holdersOfAccount(remit.accountNo) : [] } : undefined;
  }, undefined);
  if (supplierPack) {
    const { sup, accounts } = supplierPack;
    bundle.vendor = {
      id: normVendorId(str(sup.supplier_code)), name: str(sup.legal_name), gstin: str(sup.gstin), active: !!sup.active, paymentTermsDays: num(sup.payment_terms_days), stateCode: str(sup.state_code), onboardedOn: str(sup.onboarded_on),
      addresses: supplierPack.addresses.map((a) => ({ kind: str(a.kind), line: str(a.line), city: str(a.city), pincode: str(a.pincode), validFrom: optStr(a.valid_from), validTo: optStr(a.valid_to) })),
      contacts: supplierPack.contacts.map((x) => ({ name: str(x.name), phone: str(x.phone), email: str(x.email) })),
      bankAccounts: accounts.map((b) => ({ id: str(b.id), bankName: str(b.bank_name), accountNo: str(b.account_no), ifsc: str(b.ifsc), status: str(b.status) as CanonicalBankAccount["status"], validFrom: str(b.valid_from), validTo: optStr(b.valid_to), verifiedOn: optStr(b.verified_on), note: optStr(b.note) })),
    };
    if (remit) bundle.accountHolders = supplierPack.holders.filter((h) => normVendorId(str(h.supplier_code)) !== vendorId).map((h) => ({ vendorId: normVendorId(str(h.supplier_code)), name: str(h.legal_name), status: str(h.status), note: optStr(h.note) }));
    use.supplier.contributed.push(`${bundle.vendor.name} (${bundle.vendor.gstin}), ${accounts.length} bank account(s) on file`);
  }

  // Procurement's own supplier reference (used when the Supplier DB is down so the vendor is still identifiable)
  if (!bundle.vendor && use.supplier.status === "unavailable") {
    const ref = attempt("procurement", () => c.procurement.supplierRef(vendorId), undefined);
    if (ref) { bundle.vendor = { id: vendorId, name: str(ref.name), gstin: str(ref.gstin), active: !!ref.active, stateCode: str(ref.gstin).slice(0, 2), addresses: [], contacts: [], bankAccounts: [], onboardedOn: "" }; }
  }
  return { ...done(), bundle };
}
