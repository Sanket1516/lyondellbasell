import { EmptyState } from "@/components/ui";

export default function ClerkHome() {
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>Invoice queue</h1>
      <EmptyState title="The queue is empty">
        Invoices that need matching or a decision will be listed here, oldest first.
      </EmptyState>
    </>
  );
}
