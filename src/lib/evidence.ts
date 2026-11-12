// The approver's evidence card: invoice against PO and receipts, what was resolved, history, duplicate check, SoD result.
import { ENGINE_CONFIG } from "../engine/config";
import { uomFactor } from "../engine/match";
import { fmtDate, fmtDateTime, fmtInr } from "./format";
import { routeText } from "./routing";
import type { AppState, Invoice } from "./types";
import { approvalChecks, type Actor, type SodCheck } from "./workflow";

export interface EvidenceLine {
  lineNo: number;
  item: string;
  billed: string;
  po: string;
  received: string;
  note: string;
  ok: boolean;
}
export interface EvidenceCard {
  route: string;
  lines: EvidenceLine[];
  resolved: { title: string; owner: string; how: string; when: string }[];
  autoCleared: string[];
  history: { when: string; actor: string; action: string; detail: string; reason?: string }[];
  duplicate: string;
  sod: SodCheck[];
  lastDecision?: string;
}

const q = (n: number) => (Number.isInteger(n) ? fmtInr(n, 0) : fmtInr(Math.round(n * 1000) / 1000, 3).replace(/0+$/, "").replace(/\.$/, ""));
const inr = (n: number) => `₹${fmtInr(n, 2)}`;

export function buildEvidence(s: AppState, inv: Invoice, actor: Actor): EvidenceCard {
  const po = s.purchaseOrders.find((p) => p.id === inv.poId);
  const lines: EvidenceLine[] = inv.lines.map((l) => {
    const pl = po?.lines.find((p) => (l.itemCode ? p.itemCode === l.itemCode : p.description.toLowerCase() === l.description.toLowerCase()));
    const item = `${l.itemCode ?? ""} ${l.description}`.trim();
    const billed = `${q(l.qty)} ${l.uom} × ${inr(l.unitPrice)}`;
    if (!po || !pl) return { lineNo: l.lineNo, item, billed, po: "Not on the PO", received: "-", note: "Item not on the PO", ok: false };
    const conv = uomFactor(s.uomRules, pl.itemCode, l.uom, pl.uom);
    const gr = s.goodsReceipts.filter((g) => g.poId === po.id).flatMap((g) => g.lines).filter((x) => x.lineNo === pl.lineNo).reduce((a, x) => a + x.qtyReceived, 0);
    const poText = `${q(pl.qty)} ${pl.uom} × ${inr(pl.unitPrice)}`;
    const recText = `${q(gr)} ${pl.uom}`;
    if (!conv) return { lineNo: l.lineNo, item, billed, po: poText, received: recText, note: "Unit cannot be converted", ok: false };
    const nQty = l.qty * conv.factor;
    const nPrice = l.unitPrice / conv.factor;
    const pricePct = ((nPrice - pl.unitPrice) / pl.unitPrice) * 100;
    const priceOk = Math.abs(pricePct) <= ENGINE_CONFIG.pricePct + 1e-9;
    const qtyOk = nQty <= gr * (1 + ENGINE_CONFIG.qtyPct / 100) + 1e-9;
    const note = [
      conv.factor !== 1 ? `${q(l.qty)} ${l.uom} = ${q(nQty)} ${pl.uom}` : "",
      priceOk ? (nPrice === pl.unitPrice ? "Price equals PO" : `Price ${Math.abs(pricePct).toFixed(1)}% from PO, within tolerance`) : `Price ${pricePct.toFixed(1)}% from PO`,
      qtyOk ? "Quantity covered by receipts" : "Quantity above receipts",
    ].filter(Boolean).join(". ");
    return { lineNo: l.lineNo, item, billed, po: poText, received: recText, note, ok: priceOk && qtyOk };
  });

  const resolved = s.tasks
    .filter((t) => t.invoiceId === inv.id && t.status === "done")
    .map((t) => ({ title: `${t.rootCause}${t.lineNo ? ` (line ${t.lineNo})` : ""}`, owner: t.owner, how: t.resolution ?? "Done.", when: t.completedAt ? fmtDateTime(t.completedAt) : "" }));

  const autoCleared = s.findings.filter((f) => f.invoiceId === inv.id && f.verdict === "approve").map((f) => `Line ${f.lineNo ?? ""}: ${f.rootCause}. ${f.message}`.replace("Line : ", ""));

  const history = s.auditEvents
    .filter((e) => e.invoiceId === inv.id)
    .map((e) => ({ when: fmtDateTime(e.at), actor: e.actor, action: e.action.replace(/_/g, " "), detail: e.detail, reason: e.reason }));

  const dec = inv.duplicateDecision;
  const dupFinding = s.findings.find((f) => f.invoiceId === inv.id && f.kind === "duplicate");
  const duplicate = dec
    ? `A possible duplicate of ${dec.matchedInvoiceId} was reviewed by ${dec.by} on ${fmtDate(dec.at.slice(0, 10))} and recorded as ${dec.decision === "duplicate" ? "a duplicate" : "not a duplicate"}. Reason: ${dec.reason}`
    : dupFinding
      ? `Possible duplicate of ${dupFinding.matchedInvoiceId}. Not yet decided.`
      : "No earlier invoice from this supplier has the same number, amount, date and lines.";

  const last = inv.decision;
  const lastDecision = last && (last.outcome === "rejected" || last.outcome === "sent_back")
    ? `${last.outcome === "rejected" ? "Rejected" : "Sent back"} by ${last.by} on ${fmtDate(last.at.slice(0, 10))}. Reason: ${last.reason ?? "none recorded"}`
    : undefined;

  return { route: routeText(inv.total), lines, resolved, autoCleared, history, duplicate, sod: approvalChecks(s, actor, inv), lastDecision };
}
