"use client";
import Link from "next/link";
import { Badge, EmptyState, StatusChip, Table, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import type { Verdict } from "@/lib/types";

export interface QueueRow {
  id: string;
  vendor: string;
  total: number;
  verdict?: Verdict;
  cause: string;
  owner: string;
  ageDays: number;
  receivedOn: string;
  status: { kind: ChipKind; label: string };
}

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return <EmptyState title="Nothing in this list">Invoices that need matching or a decision will be listed here, oldest first.</EmptyState>;
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { header: "Invoice", render: (r) => <Link href={`/clerk/invoices/${encodeURIComponent(r.id)}`} className="mono" style={{ whiteSpace: "nowrap" }}>{r.id}</Link> },
        { header: "Supplier", render: (r) => r.vendor },
        { header: "Amount (₹)", numeric: true, render: (r) => fmtInr(r.total) },
        { header: "Verdict", render: (r) => (r.verdict ? <StatusChip kind={r.verdict} /> : <StatusChip kind="pending" label="Not matched" />) },
        { header: "Top root cause", render: (r) => r.cause },
        { header: "Owner", render: (r) => r.owner },
        { header: "Received", render: (r) => fmtDate(r.receivedOn) },
        { header: "Age", render: (r) => <Badge days={r.ageDays} /> },
        { header: "Status", render: (r) => <StatusChip kind={r.status.kind} label={r.status.label} /> },
      ]}
    />
  );
}
