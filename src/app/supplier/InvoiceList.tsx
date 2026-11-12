"use client";
import { EmptyState, StatusChip, Table } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import { STATUS_VIEW } from "@/lib/status";
import type { InvoiceStatus } from "@/lib/types";

export interface InvoiceRow {
  id: string;
  vendor: string;
  invoiceDate: string;
  receivedOn: string;
  poId: string;
  total: number;
  status: InvoiceStatus;
}

export function InvoiceList({ rows, showVendor }: { rows: InvoiceRow[]; showVendor: boolean }) {
  if (rows.length === 0) {
    return <EmptyState title="No invoices submitted yet">Invoices you upload will appear here with their status and any action we need from you.</EmptyState>;
  }
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { header: "Invoice", render: (r) => <span className="mono">{r.id}</span> },
        ...(showVendor ? [{ header: "Vendor", render: (r: InvoiceRow) => r.vendor }] : []),
        { header: "Invoice date", render: (r) => fmtDate(r.invoiceDate) },
        { header: "Submitted", render: (r) => fmtDate(r.receivedOn) },
        { header: "PO", render: (r) => <span className="mono">{r.poId}</span> },
        { header: "Total (₹)", numeric: true, render: (r) => fmtInr(r.total) },
        { header: "Status", render: (r) => <StatusChip kind={STATUS_VIEW[r.status].kind} label={STATUS_VIEW[r.status].label} /> },
      ]}
    />
  );
}
