"use client";
import Link from "next/link";
import { Badge, EmptyState, Table } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";

export interface InboxRow {
  id: string;
  vendor: string;
  total: number;
  needs: string;
  receivedOn: string;
  ageDays: number;
  rule: string;
}

export function InboxTable({ rows }: { rows: InboxRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing waiting for your approval">Clean invoices routed to your approval limit appear here with the evidence for each decision.</EmptyState>;
  }
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { header: "Invoice", render: (r) => <Link href={`/approver/invoices/${encodeURIComponent(r.id)}`} className="mono" style={{ whiteSpace: "nowrap" }}>{r.id}</Link> },
        { header: "Supplier", render: (r) => r.vendor },
        { header: "Amount (₹)", numeric: true, render: (r) => fmtInr(r.total) },
        { header: "Needs", render: (r) => r.needs },
        { header: "Why it is routed here", render: (r) => r.rule },
        { header: "Received", render: (r) => fmtDate(r.receivedOn) },
        { header: "Age", render: (r) => <Badge days={r.ageDays} /> },
      ]}
    />
  );
}
