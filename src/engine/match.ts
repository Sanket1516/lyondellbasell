// Match and root-cause engine. Pure and deterministic: data in, findings out.
// No UI, no file or network access, no clock (the caller passes "today").
import { fmtDate, fmtInr } from "../lib/format";
import type {
  Contract, DeliveryNote, EvidenceRef, Finding, FindingKind, GoodsReceipt, Invoice, InvoiceLine,
  PoLine, PurchaseOrder, UomRule, Vendor, Verdict,
} from "../lib/types";
import { ENGINE_CONFIG, type EngineConfig } from "./config";

export interface MatchData {
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  contracts: Contract[];
  deliveryNotes: DeliveryNote[];
  uomRules: UomRule[];
  /** Every invoice on file, used for the duplicate check. */
  invoices: Invoice[];
}

export interface LineVerdict { lineNo: number; verdict: Verdict }

export interface MatchResult {
  invoiceId: string;
  verdict: Verdict;
  /** One sentence for the verdict banner. */
  summary: string;
  findings: Finding[];
  lineVerdicts: LineVerdict[];
}

const RANK: Record<Verdict, number> = { approve: 0, flag: 1, block: 2 };
const worst = (vs: Verdict[]): Verdict => vs.reduce<Verdict>((a, v) => (RANK[v] > RANK[a] ? v : a), "approve");
const EPS = 1e-9;

// ---------------------------------------------------------------- small helpers
const inr = (n: number) => `₹${fmtInr(n, 2)}`;
const qty = (n: number) => (Number.isInteger(n) ? fmtInr(n, 0) : fmtInr(Math.round(n * 1000) / 1000, 3).replace(/0+$/, "").replace(/\.$/, ""));
const day = (iso: string) => Date.parse(iso) / 86400000;
const addDays = (iso: string, n: number) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);

/** 3.5176 -> "3.5%", but 2.04 -> "2.04%" so a figure just outside a 2% tolerance never reads as "2.0%". */
function pct(n: number, tol: number): string {
  const a = Math.abs(n);
  const one = a.toFixed(1);
  return `${Number(one) <= tol && a > tol ? a.toFixed(2) : one}%`;
}

function ev(kind: EvidenceRef["kind"], ref: string, text: string): EvidenceRef {
  return { kind, ref, text };
}
const poEv = (po: PurchaseOrder, l: PoLine) =>
  ev("po", po.id, `PO ${po.id} (${fmtDate(po.issuedOn)}) line ${l.lineNo}: ${l.itemCode}, ${qty(l.qty)} ${l.uom} at ${inr(l.unitPrice)}, ${l.taxCode}`);

// ---------------------------------------------------------------- unit conversion
/** Multiply an amount in `from` by this to get `to`, or undefined if no rule covers it. */
function uomFactor(rules: UomRule[], itemCode: string, from: string, to: string): { factor: number; rule?: UomRule } | undefined {
  if (from.toLowerCase() === to.toLowerCase()) return { factor: 1 };
  const fwd = rules.find((r) => r.itemCode === itemCode && r.fromUom.toLowerCase() === from.toLowerCase() && r.toUom.toLowerCase() === to.toLowerCase());
  if (fwd) return { factor: fwd.factor, rule: fwd };
  const rev = rules.find((r) => r.itemCode === itemCode && r.fromUom.toLowerCase() === to.toLowerCase() && r.toUom.toLowerCase() === from.toLowerCase());
  if (rev) return { factor: 1 / rev.factor, rule: rev };
  return undefined;
}

// ---------------------------------------------------------------- contract lookup
/** The contract price for an item that was in force on `date`. */
export function contractPriceOn(contract: Contract, itemCode: string, date: string): { price: number; effectiveFrom: string } | undefined {
  const cur = contract.prices.find((p) => p.itemCode === itemCode);
  if (!cur) return undefined;
  const entries = [
    { price: cur.unitPrice, effectiveFrom: contract.effectiveFrom },
    ...(contract.history ?? []).filter((h) => h.itemCode === itemCode).map((h) => ({ price: h.unitPrice, effectiveFrom: h.effectiveFrom })),
  ].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)); // newest first
  return entries.find((e) => e.effectiveFrom <= date) ?? entries[entries.length - 1];
}

// ---------------------------------------------------------------- duplicate fingerprint
/** "INV-6120R" and "inv 06120-A" both become "6120": letters at either end and leading zeros are dropped. */
export function normaliseInvoiceNo(no: string): string {
  const alnum = no.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const core = alnum.replace(/^[A-Z]+/, "").replace(/[A-Z]+$/, "").replace(/^0+/, "");
  return core || alnum;
}

const sameLines = (a: InvoiceLine[], b: InvoiceLine[]) =>
  a.length === b.length && a.every((l, i) => l.description.trim().toLowerCase() === b[i].description.trim().toLowerCase() && l.qty === b[i].qty);

// ---------------------------------------------------------------- the engine
export function matchInvoice(invoice: Invoice, data: MatchData, today: string, cfg: EngineConfig = ENGINE_CONFIG): MatchResult {
  type Draft = Omit<Finding, "id" | "invoiceId">;
  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);

  const vendor = data.vendors.find((v) => v.id === invoice.vendorId);
  const po = invoice.poId ? data.purchaseOrders.find((p) => p.id === invoice.poId) : undefined;
  const printed = invoice.printedVendor?.name ? `${invoice.printedVendor.name}${invoice.printedVendor.gstin ? ` (GSTIN ${invoice.printedVendor.gstin})` : ""}` : "The supplier on the invoice";

  // 1. Vendor and PO validity --------------------------------------------------
  let poOk = true;
  if (!vendor) {
    poOk = false;
    add({
      kind: "unknown_vendor", verdict: "block",
      message: `${printed} is not in the vendor master.`,
      rootCause: "Supplier not in vendor master", owner: "Buyer",
      smallestFix: "Passes if the Buyer confirms the supplier and adds it to the vendor master, or the supplier corrects the GSTIN on the invoice.",
      expected: "A supplier in the vendor master", actual: printed,
    });
  } else if (!vendor.active) {
    poOk = false;
    add({
      kind: "unknown_vendor", verdict: "block",
      message: `${vendor.name} is marked inactive in the vendor master.`,
      rootCause: "Supplier inactive", owner: "Buyer",
      smallestFix: "Passes if the Buyer reactivates the supplier in the vendor master.",
      expected: "An active supplier", actual: `${vendor.name} (inactive)`,
    });
  }
  if (!po) {
    poOk = false;
    add({
      kind: "missing_po", verdict: "block",
      message: invoice.poId ? `PO ${invoice.poId} does not exist.` : "The invoice does not quote a PO number.",
      rootCause: "No valid PO", owner: "Supplier",
      smallestFix: "Passes if the supplier quotes a valid PO number, or the Buyer raises the missing PO.",
      expected: "An existing PO", actual: invoice.poId ?? "No PO number",
    });
  } else if (vendor && po.vendorId !== invoice.vendorId) {
    poOk = false;
    const other = data.vendors.find((v) => v.id === po.vendorId)?.name ?? po.vendorId;
    add({
      kind: "missing_po", verdict: "block",
      message: `PO ${po.id} was raised on ${other}, not on ${vendor.name}.`,
      rootCause: "PO belongs to a different supplier", owner: "Supplier",
      smallestFix: "Passes if the supplier quotes the PO that was raised on them.",
      expected: `A PO raised on ${vendor.name}`, actual: `PO ${po.id} (${other})`,
      evidence: [ev("po", po.id, `PO ${po.id} is raised on ${other}`)],
    });
  }

  // 2. Duplicate fingerprint ---------------------------------------------------
  if (vendor) {
    const key = normaliseInvoiceNo(invoice.id);
    const hits = data.invoices
      .filter((o) => o.id !== invoice.id && o.vendorId === invoice.vendorId && normaliseInvoiceNo(o.id) === key)
      .filter((o) => Math.abs(o.total - invoice.total) <= cfg.duplicateAmountInr + EPS)
      .filter((o) => Math.abs(day(o.invoiceDate) - day(invoice.invoiceDate)) <= cfg.duplicateDays)
      .filter((o) => o.poId === invoice.poId || sameLines(o.lines, invoice.lines))
      .sort((a, b) => Math.abs(day(a.invoiceDate) - day(invoice.invoiceDate)) - Math.abs(day(b.invoiceDate) - day(invoice.invoiceDate)));
    const hit = hits[0];
    const dec = invoice.duplicateDecision;
    if (hit && !(dec && dec.decision === "not_duplicate" && dec.matchedInvoiceId === hit.id)) {
      const state = hit.status === "paid" ? `paid ${fmtDate(hit.resolvedOn)}`.trim() : `still open, ${hit.status.replace("_", " ")}`;
      const matched = [
        `same supplier`,
        `invoice number differs only by a prefix or suffix (${invoice.id} and ${hit.id})`,
        `total ${inr(invoice.total)} against ${inr(hit.total)}`,
        `dates ${Math.round(Math.abs(day(hit.invoiceDate) - day(invoice.invoiceDate)))} days apart`,
        ...(hit.poId === invoice.poId ? [`same PO ${invoice.poId}`] : []),
        ...(sameLines(hit.lines, invoice.lines) ? [`the same ${hit.lines.length} line${hit.lines.length === 1 ? "" : "s"}`] : []),
      ];
      const confirmed = dec?.decision === "duplicate" && dec.matchedInvoiceId === hit.id;
      add({
        kind: "duplicate", verdict: "block",
        message: `${confirmed ? "Confirmed duplicate" : "Possible duplicate"} of ${hit.id} (${state}): ${matched.join("; ")}.`,
        rootCause: confirmed ? "Confirmed duplicate of an earlier invoice" : "Possible duplicate of a paid invoice", owner: "AP Clerk",
        smallestFix: confirmed
          ? "No payment. The supplier is told this invoice duplicates " + hit.id + "."
          : `Passes if a clerk compares the two documents and records that this is a different bill (reason required).`,
        expected: `No earlier invoice with the same fingerprint`, actual: `${hit.id} (${hit.status})`,
        matchedInvoiceId: hit.id,
        evidence: [ev("invoice", hit.id, `${hit.id}: dated ${fmtDate(hit.invoiceDate)}, PO ${hit.poId ?? "none"}, total ${inr(hit.total)}, ${hit.status}`)],
      });
    }
  }

  // 3-5. Line checks -----------------------------------------------------------
  const lineVerdictOf = new Map<number, Verdict>();
  const taxMismatch: { line: InvoiceLine; po: PoLine }[] = [];

  if (po && poOk) {
    const grsForPo = data.goodsReceipts.filter((g) => g.poId === po.id);
    const dnsForPo = data.deliveryNotes.filter((d) => d.poId === po.id);
    const contract = (po.contractId && data.contracts.find((c) => c.id === po.contractId)) || data.contracts.find((c) => c.vendorId === po.vendorId && c.prices.some((p) => p.itemCode));

    for (const line of invoice.lines) {
      const poLine =
        po.lines.find((p) => line.itemCode && p.itemCode === line.itemCode) ??
        po.lines.find((p) => !line.itemCode && p.description.toLowerCase() === line.description.toLowerCase());
      const mine: Draft[] = [];
      const push = (d: Draft) => mine.push({ ...d, lineNo: line.lineNo });

      if (!poLine) {
        push({
          kind: "not_on_po", verdict: "flag",
          message: `${line.itemCode ?? line.description} is not on PO ${po.id}.`,
          rootCause: "Item not on the PO", owner: "Buyer",
          smallestFix: `Passes if the Buyer adds ${line.itemCode ?? "the item"} to PO ${po.id}, or the supplier removes the line.`,
          expected: `An item on PO ${po.id}`, actual: line.itemCode ?? line.description,
        });
      } else {
        // UoM normalisation: express the invoice line in the PO's unit.
        const conv = uomFactor(data.uomRules, poLine.itemCode, line.uom, poLine.uom);
        if (!conv) {
          push({
            kind: "uom", verdict: "flag",
            message: `Invoice bills in ${line.uom}; the PO is in ${poLine.uom} and there is no conversion rule.`,
            rootCause: "Unit of measure cannot be converted", owner: "Supplier",
            smallestFix: `Passes if the supplier bills in ${poLine.uom}, or a conversion from ${line.uom} to ${poLine.uom} is added to the unit table.`,
            expected: `${poLine.uom}`, actual: line.uom, evidence: [poEv(po, poLine)],
          });
        } else {
          const nQty = line.qty * conv.factor;
          const nPrice = line.unitPrice / conv.factor;
          const converted = conv.factor !== 1;
          const baseEv: EvidenceRef[] = [poEv(po, poLine)];
          if (conv.rule) baseEv.push(ev("uom_rule", `${conv.rule.itemCode}:${conv.rule.fromUom}`, `Unit table: 1 ${conv.rule.fromUom} = ${qty(conv.rule.factor)} ${conv.rule.toUom} for ${conv.rule.itemCode}`));
          const asBilled = converted ? ` Billed as ${qty(line.qty)} ${line.uom} at ${inr(line.unitPrice)} per ${line.uom}.` : "";

          // 4. Price vs PO, then vs contract
          const delta = ((nPrice - poLine.unitPrice) / poLine.unitPrice) * 100;
          if (Math.abs(delta) > cfg.pricePct + EPS) {
            const dir = delta > 0 ? "above" : "below";
            const head = `Price ${inr(nPrice)} is ${pct(delta, cfg.pricePct)} ${dir} PO ${inr(poLine.unitPrice)}`;
            const gr1 = grsForPo.length ? [...grsForPo].sort((a, b) => (a.receivedOn < b.receivedOn ? -1 : 1))[0] : undefined;
            const dn = dnsForPo.find((d) => d.lines.some((l) => l.itemCode === poLine.itemCode));
            const priceDate = dn?.deliveredOn ?? gr1?.receivedOn ?? invoice.invoiceDate;
            const atDelivery = contract ? contractPriceOn(contract, poLine.itemCode, priceDate) : undefined;
            const atPoDate = contract ? contractPriceOn(contract, poLine.itemCode, po.issuedOn) : undefined;
            const cEv = (cp: { price: number; effectiveFrom: string }) => ev("contract", contract!.id, `Contract ${contract!.id}: ${poLine.itemCode} at ${inr(cp.price)}, effective ${fmtDate(cp.effectiveFrom)}`);
            const price = { expected: inr(poLine.unitPrice), actual: inr(nPrice), deltaPct: Math.round(delta * 100) / 100 };
            if (atDelivery && Math.abs(atDelivery.price - nPrice) < 0.005) {
              push({
                kind: "price", verdict: "flag",
                message: `${head}. Contract ${contract!.id} (${fmtDate(atDelivery.effectiveFrom)}) sets ${inr(atDelivery.price)}, so the PO looks outdated.${asBilled}`,
                rootCause: "PO not updated after contract change", owner: "Buyer",
                smallestFix: `Passes if the PO price is amended to ${inr(atDelivery.price)} per ${contract!.id}.`,
                ...price, evidence: [...baseEv, cEv(atDelivery), ...(atPoDate && atPoDate.price !== atDelivery.price ? [cEv(atPoDate)] : [])],
              });
            } else if (atDelivery) {
              push({
                kind: "price", verdict: "flag",
                message: `${head}, and contract ${contract!.id} sets ${inr(atDelivery.price)}. The invoice matches neither.${asBilled}`,
                rootCause: "Price differs from both PO and contract", owner: "Supplier",
                smallestFix: `Passes if the supplier issues a credit note or a corrected invoice at ${inr(atDelivery.price)}.`,
                ...price, evidence: [...baseEv, cEv(atDelivery)],
              });
            } else {
              push({
                kind: "price", verdict: "flag",
                message: `${head}. No contract price is on file for ${poLine.itemCode}.${asBilled}`,
                rootCause: "Price differs from PO, no contract price on file", owner: "Buyer",
                smallestFix: `Passes if the Buyer confirms ${inr(nPrice)} and amends the PO, or the supplier corrects the invoice to ${inr(poLine.unitPrice)}.`,
                ...price, evidence: baseEv,
              });
            }
          }

          // 5. Quantity vs cumulative goods receipts
          const grRows = grsForPo.flatMap((g) => g.lines.filter((l) => l.lineNo === poLine.lineNo).map((l) => ({ g, l })));
          const received = grRows.reduce((a, r) => a + r.l.qtyReceived, 0);
          const grEv = grRows.map((r) => ev("goods_receipt", r.g.id, `Goods receipt ${r.g.id} (${fmtDate(r.g.receivedOn)}): ${qty(r.l.qtyReceived)} ${r.l.uom} against PO line ${poLine.lineNo}`));
          const dnRows = dnsForPo.flatMap((d) => d.lines.filter((l) => l.itemCode === poLine.itemCode).map((l) => ({ d, l })));
          const dnQty = dnRows.length ? dnRows.reduce((a, r) => a + r.l.qty * (uomFactor(data.uomRules, poLine.itemCode, r.l.uom, poLine.uom)?.factor ?? 1), 0) : undefined;
          const dnEv = dnRows.map((r) => ev("delivery_note", r.d.id, `Delivery note ${r.d.id} (${fmtDate(r.d.deliveredOn)}): ${qty(r.l.qty)} ${r.l.uom} of ${r.l.itemCode}`));
          const u = poLine.uom;

          if (grRows.length === 0) {
            const due = dnRows.length ? dnRows[0].d.deliveredOn : addDays(po.issuedOn, cfg.deliveryLeadDays);
            if (due > today) {
              push({
                kind: "missing_receipt", verdict: "block",
                message: `Invoice bills ${qty(nQty)} ${u} but nothing has been delivered or received yet (due ${fmtDate(due)}).`,
                rootCause: "Billed before delivery or receipt", owner: "Supplier",
                smallestFix: "Passes once the goods are delivered and the receipt is posted. Hold the invoice until then.",
                expected: `Receipt of ${qty(nQty)} ${u}`, actual: "No receipt", evidence: [...baseEv, ...dnEv],
              });
            } else {
              push({
                kind: "missing_receipt", verdict: "block",
                message: `No goods receipt is posted for ${poLine.itemCode} on PO ${po.id}. ${dnRows.length ? `The delivery note shows delivery on ${fmtDate(due)}.` : `Delivery was expected by ${fmtDate(due)} and there is no delivery note on file.`}`,
                rootCause: "Goods receipt not posted", owner: "Warehouse",
                smallestFix: `Passes if Warehouse posts the receipt of ${qty(nQty)} ${u} against PO ${po.id} line ${poLine.lineNo}, once the goods are confirmed.`,
                expected: `Receipt of ${qty(nQty)} ${u}`, actual: "No receipt", evidence: [...baseEv, ...dnEv],
              });
            }
          } else if (nQty > received * (1 + cfg.qtyPct / 100) + EPS) {
            const gap = Math.round((nQty - received) * 1000) / 1000;
            const dQty = Math.round((nQty / received - 1) * 10000) / 100;
            const qtyFields = { expected: `${qty(received)} ${u} received`, actual: `${qty(nQty)} ${u} billed`, deltaPct: dQty };
            if (dnQty !== undefined && nQty <= dnQty * (1 + cfg.qtyPct / 100) + EPS) {
              push({
                kind: "quantity", verdict: "flag",
                message: `Invoice quantity ${qty(nQty)} ${u} is above receipts of ${qty(received)} ${u}. Delivery note ${dnRows[0].d.id} shows ${qty(dnQty)} ${u} delivered.`,
                rootCause: "Goods receipt under-posted", owner: "Warehouse",
                smallestFix: `Passes if Warehouse posts the missing ${qty(gap)} ${u} receipt (${dnRows[0].d.id} shows ${qty(dnQty)} ${u} delivered).`,
                ...qtyFields, evidence: [...baseEv, ...grEv, ...dnEv],
              });
            } else {
              push({
                kind: "quantity", verdict: "flag",
                message: dnQty !== undefined
                  ? `Invoice quantity ${qty(nQty)} ${u} is above receipts of ${qty(received)} ${u} and above the ${qty(dnQty)} ${u} on delivery note ${dnRows[0].d.id}.`
                  : `Invoice quantity ${qty(nQty)} ${u} is above receipts of ${qty(received)} ${u}, and there is no delivery note for the difference.`,
                rootCause: "Billed for undelivered quantity", owner: "Supplier",
                smallestFix: `Passes if the supplier reduces the invoice to ${qty(received)} ${u} or less (a credit note or a corrected invoice), or proof of delivery of the extra ${qty(gap)} ${u} is provided.`,
                ...qtyFields, evidence: [...baseEv, ...grEv, ...dnEv],
              });
            }
          }

          // UoM pass note: only when the unit difference was the whole story for this line.
          if (converted && !mine.some((m) => m.verdict !== "approve")) {
            push({
              kind: "uom", verdict: "approve",
              message: `Billed ${qty(line.qty)} ${line.uom} at ${inr(line.unitPrice)}; that is ${qty(nQty)} ${poLine.uom} at ${inr(nPrice)}, the same as the PO and receipts.`,
              rootCause: "Unit of measure only", owner: "System",
              smallestFix: `No action. ${qty(line.qty)} ${line.uom} = ${qty(nQty)} ${poLine.uom} per the unit table.`,
              expected: `${qty(nQty)} ${poLine.uom} at ${inr(poLine.unitPrice)}`, actual: `${qty(line.qty)} ${line.uom} at ${inr(line.unitPrice)}`,
              evidence: [...baseEv, ...grEv],
            });
          }
        }

        // 6. Tax rate (collected, reported once per invoice)
        if (Math.abs(line.taxRatePct - poLine.taxRatePct) > EPS) taxMismatch.push({ line, po: poLine });
      }

      for (const d of mine) add(d);
      lineVerdictOf.set(line.lineNo, worst(mine.map((m) => m.verdict)));
    }

    if (taxMismatch.length) {
      const first = taxMismatch[0];
      const lines = taxMismatch.map((t) => t.line.lineNo);
      add({
        kind: "tax", verdict: "flag",
        lineNo: lines.length === 1 ? lines[0] : undefined,
        message: `Tax rate differs from PO (${first.line.taxRatePct}% on the invoice, ${first.po.taxRatePct}% on the PO, ${first.po.taxCode})${lines.length > 1 ? ` on lines ${lines.join(", ")}` : ""}.`,
        rootCause: "Invoice tax rate differs from PO tax code", owner: "Supplier",
        smallestFix: `Passes if the supplier reissues the invoice at ${first.po.taxRatePct}%, or the Buyer confirms the PO tax code is wrong.`,
        expected: `${first.po.taxRatePct}%`, actual: `${first.line.taxRatePct}%`,
        evidence: taxMismatch.map((t) => poEv(po, t.po)),
      });
      for (const t of taxMismatch) lineVerdictOf.set(t.line.lineNo, worst([lineVerdictOf.get(t.line.lineNo) ?? "approve", "flag"]));
    }
  }

  // 7. Arithmetic --------------------------------------------------------------
  const tolA = cfg.arithmeticInr + EPS;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const l of invoice.lines) {
    const calc = r2(l.qty * l.unitPrice);
    if (Math.abs(calc - l.amount) > tolA) {
      add({
        kind: "arithmetic", verdict: "flag", lineNo: l.lineNo,
        message: `Line ${l.lineNo}: ${qty(l.qty)} × ${inr(l.unitPrice)} is ${inr(calc)}, but the invoice shows ${inr(l.amount)}.`,
        rootCause: "Invoice arithmetic does not add up", owner: "Supplier",
        smallestFix: `Passes if the supplier corrects line ${l.lineNo} to ${inr(calc)}.`,
        expected: inr(calc), actual: inr(l.amount),
      });
      lineVerdictOf.set(l.lineNo, "flag");
    }
  }
  const sub = r2(invoice.lines.reduce((a, l) => a + l.amount, 0));
  const taxCalc = r2(invoice.lines.reduce((a, l) => a + (l.amount * l.taxRatePct) / 100, 0));
  const arith = (what: string, calc: number, shown: number) => {
    if (Math.abs(calc - shown) <= tolA) return;
    add({
      kind: "arithmetic", verdict: "flag",
      message: `${what} should be ${inr(calc)} from the lines, but the invoice shows ${inr(shown)}.`,
      rootCause: "Invoice arithmetic does not add up", owner: "Supplier",
      smallestFix: `Passes if the supplier corrects the ${what.toLowerCase()} to ${inr(calc)}.`,
      expected: inr(calc), actual: inr(shown),
    });
  };
  arith("Subtotal", sub, invoice.subtotal);
  arith("Tax", taxCalc, invoice.tax);
  arith("Total", r2(invoice.subtotal + invoice.tax), invoice.total);

  // Verdict ---------------------------------------------------------------------
  const findings: Finding[] = drafts.map((d, i) => ({ ...d, id: `F-${invoice.id}-${i + 1}`, invoiceId: invoice.id }));
  const verdict = worst(findings.map((f) => f.verdict));
  const lineVerdicts = invoice.lines.map((l) => ({ lineNo: l.lineNo, verdict: lineVerdictOf.get(l.lineNo) ?? "approve" }));
  return { invoiceId: invoice.id, verdict, summary: summarise(verdict, findings), findings, lineVerdicts };
}

export function summarise(verdict: Verdict, findings: Finding[]): string {
  const issues = findings.filter((f) => f.verdict !== "approve");
  if (issues.length === 0) {
    const note = findings.some((f) => f.kind === "uom") ? " A unit-of-measure difference was cleared automatically." : "";
    return `Approve: price, quantity, tax and totals all match the PO and receipts.${note}`;
  }
  // One clause per root cause, with the lines it affects.
  const groups = new Map<string, number[]>();
  for (const f of issues) groups.set(f.rootCause, [...(groups.get(f.rootCause) ?? []), ...(f.lineNo ? [f.lineNo] : [])]);
  const clause = ([cause, lines]: [string, number[]]) => (lines.length ? `${cause} (line${lines.length > 1 ? "s" : ""} ${lines.join(", ")})` : cause);
  const owners = [...new Set(issues.map((f) => f.owner))];
  const head = verdict === "block" ? "Block" : "Flag";
  return `${head}: ${issues.length} issue${issues.length === 1 ? "" : "s"}. ${[...groups].map(clause).join("; ")}. Owner${owners.length === 1 ? "" : "s"}: ${owners.join(", ")}.`;
}

export const FINDING_KIND_LABEL: Record<FindingKind, string> = {
  price: "Price", quantity: "Quantity", missing_receipt: "Receipt", missing_po: "PO", unknown_vendor: "Supplier",
  duplicate: "Duplicate", tax: "Tax", uom: "Unit", arithmetic: "Arithmetic", not_on_po: "Item",
};
