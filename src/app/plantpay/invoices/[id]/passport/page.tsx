import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPassport } from "@/plantpay/passport";
import { plantpay } from "@/plantpay/runtime";
import PassportView from "@/app/supplier/passport/PassportView";
import s from "@/app/supplier/passport/Passport.module.css";

export const dynamic = "force-dynamic";

/** Staff preview of exactly what the supplier sees. Same builder, same component: nothing extra is added for staff. */
export default async function PassportPreview({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const e = plantpay();
  const p = buildPassport(e, id);
  if (!p) notFound();
  return (
    <>
      <Link href={`/plantpay/invoices/${encodeURIComponent(id)}`} className={s.back}>Back to the invoice</Link>
      <h1 style={{ marginBottom: 6 }}>Payment readiness passport</h1>
      <p className={s.previewBar}><strong>Supplier view preview.</strong> This is exactly what the supplier sees. It leaves out internal notes, risk flags, scores, root causes and other suppliers&apos; data by construction.</p>
      <PassportView p={p} />
    </>
  );
}
