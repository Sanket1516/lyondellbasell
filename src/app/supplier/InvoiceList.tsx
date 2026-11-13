"use client";
import Link from "next/link";
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
  /** A correction is waiting on the supplier (sent back by the clerk, or a finding they own). */
  actionNeeded?: boolean;
  /** Held as a possible copy of this earlier invoice. */
  heldAsCopyOf?: string;
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
        { header: "Invoice", render: (r) => <Link href={`/supplier/invoices/${encodeURIComponent(r.id)}`} className="mono" style={{ whiteSpace: "nowrap" }}>{r.id}</Link> },
        ...(showVendor ? [{ header: "Vendor", render: (r: InvoiceRow) => r.vendor }] : []),
        { header: "Invoice date", render: (r) => fmtDate(r.invoiceDate) },
        { header: "Submitted", render: (r) => fmtDate(r.receivedOn) },
        { header: "PO", render: (r) => <span className="mono">{r.poId}</span> },
        { header: "Total (₹)", numeric: true, render: (r) => fmtInr(r.total) },
        { header: "Status", render: (r) => (r.heldAsCopyOf
          ? <Link href={`/supplier/invoices/${encodeURIComponent(r.id)}`}><StatusChip kind="block" label={`On hold: copy of ${r.heldAsCopyOf}`} /></Link>
          : r.actionNeeded
            ? <Link href={`/supplier/invoices/${encodeURIComponent(r.id)}`}><StatusChip kind="flag" label="Action needed: correct and re-upload" /></Link>
            : <StatusChip kind={STATUS_VIEW[r.status].kind} label={STATUS_VIEW[r.status].label} />) },
      ]}
    />
  );
}
