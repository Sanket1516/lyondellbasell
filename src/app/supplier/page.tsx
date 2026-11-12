import { EmptyState } from "@/components/ui";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SupplierHome() {
  const user = await getSessionUser();
  const vendor = getState().vendors.find((v) => v.id === user?.vendorId);
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>{vendor?.name ?? user?.displayName}: invoices</h1>
      <EmptyState title="No invoices submitted yet">
        Invoices you upload will appear here with their status and any action we need from you.
      </EmptyState>
    </>
  );
}
