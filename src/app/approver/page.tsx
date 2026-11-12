import { DEMO_TODAY } from "@/lib/constants";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { bandFor, routeText } from "@/lib/routing";
import { InboxTable, type InboxRow } from "./InboxTable";

export const dynamic = "force-dynamic";
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

export default async function ApproverHome() {
  const user = await getSessionUser();
  const state = getState();
  const level = user?.approverLevel ?? "L1";
  const nameOf = (id: string, printed?: string) => state.vendors.find((v) => v.id === id)?.name ?? printed ?? "Unknown supplier";

  // Clean invoices with no open owner task. L1 sees its own band; L2 sees L1 and L2 (a higher approver can take either).
  const rows: InboxRow[] = state.invoices
    .filter((i) => i.status === "pending_approval" && i.verdict === "approve" && !state.tasks.some((t) => t.invoiceId === i.id && t.status === "requested"))
    .filter((i) => { const b = bandFor(i.total); return b === "L1" || (b === "L2" && level === "L2"); })
    .map((i) => ({
      id: i.id, vendor: nameOf(i.vendorId, i.printedVendor?.name), total: i.total, needs: `Approver ${bandFor(i.total)}`,
      receivedOn: i.receivedOn, ageDays: days(i.receivedOn, DEMO_TODAY), rule: routeText(i.total),
    }))
    .sort((a, b) => b.ageDays - a.ageDays || (a.id < b.id ? -1 : 1));

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Approvals</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 14 }}>
        {user?.title}. {rows.length} {rows.length === 1 ? "invoice" : "invoices"} waiting for you, oldest first. Open one to see the evidence and decide.
      </p>
      <InboxTable rows={rows} />
    </>
  );
}
