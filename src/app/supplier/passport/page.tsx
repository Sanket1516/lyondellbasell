import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { fmtDate, fmtRupees } from "@/lib/format";
import { supplierPassports } from "@/plantpay/passport";
import { plantpay } from "@/plantpay/runtime";
import s from "./Passport.module.css";

export const dynamic = "force-dynamic";

export default async function PassportList() {
  const user = await getSessionUser(); // the supplier layout has already checked the role
  if (!user?.vendorId) return <p>Your account is not linked to a supplier.</p>;
  const rows = supplierPassports(plantpay(), user.vendorId);
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Payment readiness</h1>
      <p className={s.lead}>Where each of your invoices is on the way to payment, what is holding it up, and whether the due date is at risk.</p>
      {rows.length === 0 ? <p className={s.empty}>There are no invoices to show yet. Upload an invoice from <Link href="/supplier">My invoices</Link>.</p> : (
        <div className={s.scroll}>
          <table className={s.table}>
            <thead><tr><th>Invoice</th><th>Date</th><th className={s.num}>Amount</th><th>Where it stands</th><th>Due</th><th>Due-date risk</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.invoiceNumber}>
                  <td><Link className="mono" href={`/supplier/passport/${encodeURIComponent(p.invoiceNumber)}`}>{p.invoiceNumber}</Link></td>
                  <td>{fmtDate(p.invoiceDate)}</td>
                  <td className={s.num}>{p.amountInr !== undefined ? fmtRupees(p.amountInr) : ""}</td>
                  <td>{p.headline}</td>
                  <td>{p.paidOn ? "Paid" : p.dueDate ? fmtDate(p.dueDate) : "Not available"}</td>
                  <td>{p.atRisk.flag ? <span className={s.flag}>At risk</span> : p.paidOn ? "Paid" : "On track"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
