"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

/** J and K move the selection, Enter opens the invoice. Ignored while typing in a field or holding a modifier key. */
function useRowKeys(rows: QueueRow[]) {
  const router = useRouter();
  const [sel, setSel] = useState(-1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, select, textarea, button, a, summary, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k" && !(k === "enter" && sel >= 0)) return;
      e.preventDefault();
      if (k === "enter") router.push(`/clerk/invoices/${encodeURIComponent(rows[sel].id)}`);
      else setSel((n) => Math.min(rows.length - 1, Math.max(0, k === "j" ? n + 1 : n - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, router]);
  useEffect(() => {
    if (sel >= 0 && rows[sel]) document.querySelector(`[data-row="${CSS.escape(rows[sel].id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, rows]);
  return rows[sel]?.id;
}

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  const selected = useRowKeys(rows);
  if (rows.length === 0) return <EmptyState title="Nothing in this list">Invoices that need matching or a decision will be listed here, oldest first.</EmptyState>;
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      selectedKey={selected}
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
