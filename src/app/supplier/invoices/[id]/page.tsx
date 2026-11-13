import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate, fmtInr } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { buildSupplierView } from "@/lib/supplier-view";
import s from "../../Status.module.css";

export const dynamic = "force-dynamic";

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const user = (await getSessionUser())!;
  const v = buildSupplierView(getState(), decodeURIComponent(raw), user);
  if (!v) notFound();

  return (
    <>
      <p className={s.crumb}><Link href="/supplier">My invoices</Link> / <span className="mono">{v.id}</span></p>
      <div className={s.head}>
        <div>
          <h1 className="mono">{v.id}</h1>
          <p className={s.sub}>PO <span className="mono">{v.poId}</span> · invoice dated {fmtDate(v.invoiceDate)} · submitted {fmtDate(v.receivedOn)}</p>
        </div>
        <div className={s.total}><span className={s.totalLabel}>Invoice total</span><span className="mono">₹{fmtInr(v.total)}</span></div>
      </div>

      <p className={`${s.headline} ${v.actions.length ? s.headlineAct : ""}`} role="status">{v.headline}</p>

      {v.actions.length > 0 && (
        <section className={s.actions} aria-label="What to correct">
          <h2>What to correct</h2>
          <ul>
            {v.actions.map((a, i) => <li key={i}>{a.what}</li>)}
          </ul>
          <p className={s.hint}>
            Upload the corrected invoice with the same invoice number (<span className="mono">{v.id}</span>). It replaces this one and is checked again straight away.{" "}
            <Link href="/supplier#upload">Upload corrected invoice</Link>
          </p>
        </section>
      )}

      <section aria-label="Progress">
        <h2 className={s.h2}>Progress</h2>
        <ol className={s.steps}>
          {v.steps.map((st, i) => (
            <li key={i} className={`${s.step} ${s[st.state]}`}>
              <div className={s.when}>{st.when ?? (st.state === "upcoming" ? "Next" : st.state === "current" ? "Now" : "")}</div>
              <div className={s.title}>{st.title}</div>
              {st.detail && <div className={s.detail}>{st.detail}</div>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
