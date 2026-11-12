import Link from "next/link";
import { StatusChip, type ChipKind } from "@/components/ui";
import { fmtDate, fmtInr } from "@/lib/format";
import { foundationDb, listInvoices, statusCounts } from "@/foundation/service";
import s from "./Foundation.module.css";

export const dynamic = "force-dynamic";
const PAGE = 50;
const CHIP: Record<string, { kind: ChipKind; label: string }> = {
  pass: { kind: "approve", label: "Pass" }, review: { kind: "flag", label: "Review" }, block: { kind: "block", label: "Block" },
};

export default async function FoundationHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; demo?: string; page?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && ["pass", "review", "block"].includes(sp.status) ? sp.status : undefined;
  const demo = sp.demo === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = foundationDb();
  const counts = statusCounts(db);
  const { total, rows } = listInvoices(db, { status, q: sp.q?.trim() || undefined, demoOnly: demo, limit: PAGE, offset: (page - 1) * PAGE });
  const all = counts.pass + counts.review + counts.block + counts.unmatched;
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, q: sp.q, demo: demo ? "1" : undefined, ...o })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/foundation?${qs}` : "/foundation";
  };

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Invoices and match status</h1>
      <p className={s.lead}>
        Synthetic Plant X data. Every invoice is matched against its PO and goods receipts by fixed rules, with unit conversion and tolerances.
        Review and Block are warnings for a person to look at, not accusations.
      </p>
      <div className={s.tiles}>
        <Link href={href({ status: undefined, page: undefined })} className={`${s.tile} ${!status ? s.tileOn : ""}`}><strong>{all}</strong><span>All invoices</span></Link>
        <Link href={href({ status: "pass", page: undefined })} className={`${s.tile} ${status === "pass" ? s.tileOn : ""}`}><strong>{counts.pass}</strong><span>Pass</span></Link>
        <Link href={href({ status: "review", page: undefined })} className={`${s.tile} ${status === "review" ? s.tileOn : ""}`}><strong>{counts.review}</strong><span>Review</span></Link>
        <Link href={href({ status: "block", page: undefined })} className={`${s.tile} ${status === "block" ? s.tileOn : ""}`}><strong>{counts.block}</strong><span>Block</span></Link>
      </div>
      <form className={s.search} action="/foundation" method="get">
        {status && <input type="hidden" name="status" value={status} />}
        <label>Search invoice, supplier or PO<input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="e.g. Thane, 4600009003" /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="demo" value="1" defaultChecked={demo} /> Demo documents only</label>
        <button type="submit">Apply</button>
      </form>

      {rows.length === 0 ? (
        <p className={s.lead}>No invoices match these filters. <Link href="/foundation">Clear filters</Link></p>
      ) : (
        <table className={s.table}>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>PO</th><th>Received</th><th className={s.num}>Total (₹)</th><th>Match</th><th>Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="mono" href={`/foundation/invoices/${encodeURIComponent(r.id)}`} style={{ whiteSpace: "nowrap" }}>{r.id}</Link>{r.demoFile && <span className={s.tag}>demo</span>}</td>
                <td>{r.vendorName}</td>
                <td className="mono">{r.poId ?? "none"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.receivedOn)}</td>
                <td className={s.num}>{fmtInr(r.total)}</td>
                <td>{r.matchStatus ? <StatusChip kind={CHIP[r.matchStatus].kind} label={CHIP[r.matchStatus].label} /> : <StatusChip kind="pending" label="Not matched" />}</td>
                <td className={s.summary}>{r.summary ?? "Open the invoice and run the match."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={s.pager}>
        <span>{total} invoice{total === 1 ? "" : "s"}, showing {rows.length === 0 ? 0 : (page - 1) * PAGE + 1} to {(page - 1) * PAGE + rows.length}</span>
        {page > 1 && <Link href={href({ page: String(page - 1) })}>Previous</Link>}
        {page * PAGE < total && <Link href={href({ page: String(page + 1) })}>Next</Link>}
      </div>
    </>
  );
}
