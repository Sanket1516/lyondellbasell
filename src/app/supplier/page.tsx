import { Panel } from "@/components/ui";
import { listDemoDocs } from "@/lib/demo-docs";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { InvoiceList, type InvoiceRow } from "./InvoiceList";
import { PaymentChat } from "./PaymentChat";
import { UploadFlow } from "./UploadFlow";

export const dynamic = "force-dynamic";

export default async function SupplierHome() {
  const user = await getSessionUser();
  const state = getState();
  const vendor = state.vendors.find((v) => v.id === user?.vendorId);
  const nameOf = (id: string, printed?: string) => state.vendors.find((v) => v.id === id)?.name ?? printed ?? "Unknown vendor";

  // Own invoices, plus any this login submitted for a vendor printed on a demo document.
  const mine = state.invoices
    .filter((i) => i.vendorId === user?.vendorId || i.submittedBy === user?.username)
    .sort((a, b) => (a.receivedOn === b.receivedOn ? (a.id < b.id ? 1 : -1) : a.receivedOn < b.receivedOn ? 1 : -1));
  const rows: InvoiceRow[] = mine.map((i) => ({
    id: i.id, vendor: nameOf(i.vendorId, i.printedVendor?.name), invoiceDate: i.invoiceDate, receivedOn: i.receivedOn,
    poId: i.poId ?? "", total: i.total, status: i.status,
  }));
  const showVendor = rows.some((r) => r.vendor !== vendor?.name);

  return (
    <>
      <h1 style={{ marginBottom: 16 }}>{vendor?.name ?? user?.displayName}: invoices</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <UploadFlow demos={listDemoDocs()} />
        <Panel title={`Your invoices (${rows.length})`}>
          <InvoiceList rows={rows} showVendor={showVendor} />
        </Panel>
        <PaymentChat invoiceIds={rows.map((r) => r.id)} />
      </div>
    </>
  );
}
