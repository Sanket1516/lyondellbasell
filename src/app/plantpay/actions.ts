"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/guard";
import { loadCanonical } from "@/plantpay/canonical";
import { appendAudit, setOutage } from "@/plantpay/integration";
import { plantpay } from "@/plantpay/runtime";
import { SOURCE_IDS, type SourceId } from "@/plantpay/sources/schemas";
import { postGoodsReceipt, recordInspection } from "@/plantpay/sources/writers";
import { DEMO_TODAY } from "@/lib/constants";

const who = () => requireAnyRole(["clerk", "approver"]);

/** Demo toggle: take a source offline or bring it back. */
export async function toggleOutage(form: FormData) {
  const user = await who();
  const id = String(form.get("source")) as SourceId;
  if (!SOURCE_IDS.includes(id)) return;
  const on = form.get("outage") === "1";
  const e = plantpay();
  setOutage(e.integration, id, on);
  appendAudit(e.integration, { actor: user.username, role: user.role, action: on ? "outage_simulated" : "outage_cleared", detail: `${id} source ${on ? "taken offline (demo toggle)" : "brought back online"}` });
  revalidatePath("/plantpay", "layout");
}

/** Consume queued events and re-match the invoices they affect. */
export async function processQueue() {
  await who();
  plantpay().processEvents();
  revalidatePath("/plantpay", "layout");
}

export async function reevaluate(form: FormData) {
  const user = await who();
  plantpay().evaluate(String(form.get("invoice")), { actor: user.username, role: user.role });
  revalidatePath("/plantpay", "layout");
}

/** Demo: Warehouse posts the goods receipt that was missing (a department's own system would do this). Re-matching follows from the event. */
export async function simulateGoodsReceipt(form: FormData) {
  const user = await who();
  const e = plantpay();
  const b = loadCanonical(e.connectors, String(form.get("invoice"))).bundle;
  if (!b?.po) return;
  const at = `${DEMO_TODAY}T${new Date().toISOString().slice(11, 19)}.000Z`;
  postGoodsReceipt({ integration: e.integration, now: () => at }, { poId: b.po.id, receivedOn: DEMO_TODAY, lines: b.po.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty, uom: l.uom })) });
  appendAudit(e.integration, { actor: user.username, role: user.role, action: "demo_simulation", invoiceId: b.invoice.id, detail: "Simulated: Warehouse posted the goods receipt" });
  e.processEvents();
  revalidatePath("/plantpay", "layout");
}

/** Demo: Quality records that everything received passed inspection. */
export async function simulateInspection(form: FormData) {
  const user = await who();
  const e = plantpay();
  const b = loadCanonical(e.connectors, String(form.get("invoice"))).bundle;
  if (!b?.po) return;
  const at = `${DEMO_TODAY}T${new Date().toISOString().slice(11, 19)}.000Z`;
  for (const g of b.goodsReceipts.filter((x) => !b.inspections.some((i) => i.grId === x.id))) {
    recordInspection({ integration: e.integration, now: () => at }, { poId: b.po.id, grnNo: `GRN-${g.id}`, inspectedOn: DEMO_TODAY, lines: g.lines.map((l) => ({ lineNo: l.lineNo, inspected: l.qtyReceived, accepted: l.qtyReceived, uom: l.uom })) });
  }
  appendAudit(e.integration, { actor: user.username, role: user.role, action: "demo_simulation", invoiceId: b.invoice.id, detail: "Simulated: Quality recorded that the received goods passed inspection" });
  e.processEvents();
  revalidatePath("/plantpay", "layout");
}
