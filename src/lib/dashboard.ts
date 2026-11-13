// Exceptions dashboard numbers, computed from state on every request. Nothing here is stored or hard-coded.
// An "open exception" is an invoice that is not yet approved or paid and whose latest match has a flag or block finding.
import { DEMO_TODAY } from "./constants";
import type { AppState, Finding, FindingKind, Invoice } from "./types";

export const TYPE_ORDER = ["price", "quantity", "missing_receipt", "duplicate", "tax", "uom", "off_contract", "other"] as const;
export type ExceptionType = (typeof TYPE_ORDER)[number];

export const TYPE_LABEL: Record<ExceptionType, string> = {
  price: "Price", quantity: "Quantity", missing_receipt: "Missing receipt", duplicate: "Duplicate", tax: "Tax",
  uom: "Unit of measure", off_contract: "Off-contract", other: "Other (no PO, unknown supplier, arithmetic)",
};

export function typeOf(kind: FindingKind): ExceptionType {
  switch (kind) {
    case "price": case "quantity": case "missing_receipt": case "duplicate": case "tax": case "uom": return kind;
    case "not_on_po": return "off_contract";
    default: return "other";
  }
}

export const AGE_BUCKETS = [
  { id: "0-2", label: "0–2 days", min: 0, max: 2 },
  { id: "3-7", label: "3–7 days", min: 3, max: 7 },
  { id: "8-14", label: "8–14 days", min: 8, max: 14 },
  { id: "15+", label: "15+ days", min: 15, max: Infinity },
] as const;
export type AgeBucketId = (typeof AGE_BUCKETS)[number]["id"];

export const ageBucketOf = (days: number): AgeBucketId => AGE_BUCKETS.find((b) => days >= b.min && days <= b.max)!.id;

export const ageInDays = (receivedOn: string, today = DEMO_TODAY) => Math.max(0, Math.round((Date.parse(today) - Date.parse(receivedOn)) / 86400000));

export interface DashboardFilter {
  supplier?: string; // vendor id
  from?: string; // received on or after (ISO date)
  to?: string; // received on or before
  /** The next three narrow only the table, not the charts. */
  type?: ExceptionType;
  age?: AgeBucketId;
  cause?: string;
}

export interface ExceptionRow {
  invoiceId: string;
  vendorId: string;
  vendor: string;
  poId: string;
  total: number;
  receivedOn: string;
  ageDays: number;
  verdict: "flag" | "block";
  status: Invoice["status"];
  findings: Finding[];
}

export interface CauseRow {
  cause: string;
  owner: string;
  cases: number;
  /** Distinct POs involved, each with the invoices that point at it. */
  pos: { poId: string; invoiceIds: string[] }[];
  fix: string;
}

const isOpen = (i: Invoice) => i.status !== "approved" && i.status !== "paid";

/** The plain-language upstream fix for a number of cases of one root cause. */
export function upstreamFix(cause: string, n: number): string {
  const s = (w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  switch (cause) {
    case "PO not updated after contract change": return `Upstream fix: update ${s("PO")}`;
    case "Goods receipt under-posted": return `Upstream fix: post ${n} missing receipt ${n === 1 ? "quantity" : "quantities"}`;
    case "Goods receipt not posted": return `Upstream fix: post ${s("goods receipt")}`;
    case "Invoice tax rate differs from PO tax code": return `Upstream fix: supplier reissues ${s("invoice")} at the PO tax rate`;
    case "Price differs from both PO and contract": return `Upstream fix: ${s("credit note")} or corrected invoice from the supplier`;
    case "Possible duplicate of a paid invoice": return `Upstream fix: clerk decides ${s("possible duplicate")}`;
    case "Re-keyed copy of an earlier invoice": return `Upstream fix: clerk closes ${s("re-keyed copy")}`;
    default: return `Upstream fix: resolve ${s("case")}`;
  }
}

export interface Dashboard {
  /** Rows after supplier and date filters (what every chart is drawn from). */
  rows: ExceptionRow[];
  /** Rows after the type, age and cause filters too (the table). */
  tableRows: ExceptionRow[];
  kpi: { open: number; avgAgeDays: number; firstPassPct: number | null; firstPassOf: number; firstPassClean: number; blockedValue: number; blockedCount: number };
  byType: { type: ExceptionType; label: string; findings: number; invoices: number }[];
  bySupplier: { vendorId: string; vendor: string; open: number; value: number; oldestDays: number }[];
  byAge: { id: AgeBucketId; label: string; count: number }[];
  causes: CauseRow[];
  /** Invoices received in the filter window that had an exception at some point and are now approved or paid. */
  resolvedCount: number;
}

export function buildDashboard(s: AppState, f: DashboardFilter = {}): Dashboard {
  const vendorName = (i: Invoice) => s.vendors.find((v) => v.id === i.vendorId)?.name ?? i.printedVendor?.name ?? "Unknown supplier";
  const inWindow = (i: Invoice) =>
    (!f.supplier || i.vendorId === f.supplier) && (!f.from || i.receivedOn >= f.from) && (!f.to || i.receivedOn <= f.to);

  const scoped = s.invoices.filter(inWindow);
  const rows: ExceptionRow[] = scoped
    .filter((i) => isOpen(i) && (i.verdict === "flag" || i.verdict === "block"))
    .map((i) => ({
      invoiceId: i.id, vendorId: i.vendorId, vendor: vendorName(i), poId: i.poId ?? "", total: i.total, receivedOn: i.receivedOn,
      ageDays: ageInDays(i.receivedOn), verdict: i.verdict as "flag" | "block", status: i.status,
      findings: s.findings.filter((x) => x.invoiceId === i.id && x.verdict !== "approve"),
    }));

  // By type: findings counted (an invoice can have two), plus the invoices they sit on.
  const byType = TYPE_ORDER.map((type) => {
    const hit = rows.filter((r) => r.findings.some((x) => typeOf(x.kind) === type));
    return { type, label: TYPE_LABEL[type], findings: rows.reduce((n, r) => n + r.findings.filter((x) => typeOf(x.kind) === type).length, 0), invoices: hit.length };
  }).filter((t) => t.type !== "other" || t.findings > 0);

  const bySupplier = [...new Map(rows.map((r) => [r.vendorId, r.vendor])).entries()]
    .map(([vendorId, vendor]) => {
      const mine = rows.filter((r) => r.vendorId === vendorId);
      return { vendorId, vendor, open: mine.length, value: mine.reduce((n, r) => n + r.total, 0), oldestDays: Math.max(...mine.map((r) => r.ageDays)) };
    })
    .sort((a, b) => b.open - a.open || b.value - a.value || a.vendor.localeCompare(b.vendor));

  const byAge = AGE_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: rows.filter((r) => ageBucketOf(r.ageDays) === b.id).length }));

  // Root causes: cases are findings on open exception invoices. Auto-cleared findings (verdict approve) are not exceptions.
  const causeMap = new Map<string, { owner: string; cases: number; pos: Map<string, string[]> }>();
  for (const r of rows) {
    for (const x of r.findings) {
      const c = causeMap.get(x.rootCause) ?? { owner: x.owner, cases: 0, pos: new Map() };
      c.cases += 1;
      const key = r.poId || "No PO";
      const list = c.pos.get(key) ?? [];
      if (!list.includes(r.invoiceId)) list.push(r.invoiceId);
      c.pos.set(key, list);
      causeMap.set(x.rootCause, c);
    }
  }
  const causes: CauseRow[] = [...causeMap.entries()]
    .map(([cause, c]) => ({
      cause, owner: c.owner, cases: c.cases, fix: upstreamFix(cause, c.cases),
      pos: [...c.pos.entries()].map(([poId, invoiceIds]) => ({ poId, invoiceIds })).sort((a, b) => a.poId.localeCompare(b.poId)),
    }))
    .sort((a, b) => b.cases - a.cases || a.cause.localeCompare(b.cause));

  // First-pass match: of the matched invoices, how many never needed an owner task, a fix or a duplicate decision.
  const matched = scoped.filter((i) => i.verdict);
  const firstPass = matched.filter((i) =>
    i.verdict === "approve" && !s.tasks.some((t) => t.invoiceId === i.id) && !i.duplicateDecision,
  );
  // Historic invoices that were flagged and later approved keep a flag verdict, so they are not counted as first pass.

  const blocked = rows.filter((r) => r.verdict === "block");
  const tableRows = rows.filter((r) =>
    (!f.type || r.findings.some((x) => typeOf(x.kind) === f.type)) &&
    (!f.age || ageBucketOf(r.ageDays) === f.age) &&
    (!f.cause || r.findings.some((x) => x.rootCause === f.cause)),
  ).sort((a, b) => b.ageDays - a.ageDays || (a.invoiceId < b.invoiceId ? -1 : 1));

  const resolvedCount = scoped.filter((i) => !isOpen(i) && (i.verdict === "flag" || i.verdict === "block" || s.tasks.some((t) => t.invoiceId === i.id))).length;

  return {
    rows, tableRows,
    kpi: {
      open: rows.length,
      avgAgeDays: rows.length ? Math.round((rows.reduce((n, r) => n + r.ageDays, 0) / rows.length) * 10) / 10 : 0,
      firstPassPct: matched.length ? Math.round((firstPass.length / matched.length) * 1000) / 10 : null,
      firstPassOf: matched.length, firstPassClean: firstPass.length,
      blockedValue: blocked.reduce((n, r) => n + r.total, 0), blockedCount: blocked.length,
    },
    byType, bySupplier, byAge, causes, resolvedCount,
  };
}
