import { EmptyState } from "@/components/ui";

export default function ApproverHome() {
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>Approvals</h1>
      <EmptyState title="Nothing waiting for your approval">
        Invoices routed to your approval limit will appear here with the evidence for each decision.
      </EmptyState>
    </>
  );
}
