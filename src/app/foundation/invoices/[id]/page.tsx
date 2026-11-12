import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { StatusChip, type ChipKind } from "@/components/ui";
import { DEMO_TODAY } from "@/lib/constants";
import { fmtDate, fmtInr } from "@/lib/format";
import { foundationDb, getInvoice, runMatch } from "@/foundation/service";
import s from "../../Foundation.module.css";

export const dynamic = "force-dynamic";
const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" },
};

export default async function FoundationInvoice({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const found = getInvoice(foundationDb(), id);
  if (!found) notFound();
  const { invoice: inv, lines, result, demoDocument } = found as {
    invoice: Record<string, string | number | null>; lines: Record<string, string | number | null>[];
    result: import("@/foundation/service").ThreeWayResult | null; demoDocument: { purpose: string } | null;
  };

  async function rematch() {
    "use server";
    runMatch(foundationDb(), id, DEMO_TODAY);
    revalidatePath(`/foundation/invoices/${encodeURIComponent(id)}`);
    revalidatePath("/foundation");
  }

  return (
    <>
      <Link href="/foundation" className={s.back}>Back to all invoices</Link>
      <h1 style={{ marginBottom: 6 }}>{String(inv.id)} {result && <StatusChip kind={CHIP[result.status].kind} label={CHIP[result.status].label} />}</h1>
      <div className={s.meta}>
        <span>Supplier <b>{String(inv.vendor_name)}</b></span><span>PO <b className="mono">{String(inv.po_id ?? "none")}</b></span>
        <span>Invoice date <b>{fmtDate(String(inv.invoice_date))}</b></span><span>Total <b>₹{fmtInr(Number(inv.total))}</b></span>
      </div>
      {demoDocument && <p className={s.lead}>Demo document: {demoDocument.purpose}</p>}

      <form action={rematch} className={s.actions}><button type="submit">{result ? "Run match again" : "Run match"}</button></form>

      {!result ? (
        <p className={s.lead}>This invoice has not been matched yet. Run the match to see each check.</p>
      ) : (
        <>
          <p className={s.lead}>{result.summary}</p>
          <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>Checks</h2>
          <ul className={s.checks}>
            {result.checks.map((c) => (
              <li key={c.check}>
                <span className={c.passed ? s.pass : s.fail} aria-label={c.passed ? "passed" : "failed"}>{c.passed ? "✓" : "✗"}</span>
                <span><strong>{c.label}.</strong> {c.detail}</span>
              </li>
            ))}
          </ul>
          {result.discrepancies.length > 0 && <h2 style={{ fontSize: "1.05rem", margin: "0 0 6px" }}>Discrepancies</h2>}
          {result.discrepancies.map((d, i) => (
            <div key={i} className={s.disc}>
              <h3>{d.lineNo ? `Line ${d.lineNo}: ` : ""}{d.message}</h3>
              <div>Likely cause: <strong>{d.rootCause}</strong>
                <span className={s.tag}>{d.rootCauseStatus === "supported_by_evidence" ? "supported by evidence" : "unverified prediction"}</span></div>
              {d.expected && <div>Expected {d.expected}; found {d.actual}{d.deltaPct !== undefined ? ` (${d.deltaPct}%)` : ""}.</div>}
              {d.evidence.length > 0 && <ul>{d.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>}
              <div>Smallest fix: {d.suggestedFix} Owner: {d.owner}.</div>
            </div>
          ))}
        </>
      )}

      <h2 style={{ fontSize: "1.05rem", margin: "18px 0 6px" }}>Invoice lines</h2>
      <table className={s.table}>
        <thead><tr><th>#</th><th>Item</th><th>Description</th><th className={s.num}>Qty</th><th>Unit</th><th className={s.num}>Rate (₹)</th><th className={s.num}>Amount (₹)</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={String(l.line_no)}>
              <td>{l.line_no}</td><td className="mono">{l.material_code ?? ""}</td><td>{l.description}</td><td className={s.num}>{fmtInr(Number(l.qty), Number.isInteger(l.qty) ? 0 : 3)}</td>
              <td>{l.uom}</td><td className={s.num}>{fmtInr(Number(l.unit_price))}</td><td className={s.num}>{fmtInr(Number(l.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
