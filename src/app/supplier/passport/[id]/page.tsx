import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { loadSupplierPassport } from "@/plantpay/passport";
import { plantpay } from "@/plantpay/runtime";
import PassportView from "../PassportView";
import s from "../Passport.module.css";

export const dynamic = "force-dynamic";

export default async function SupplierPassportPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const user = await getSessionUser();
  if (!user) notFound();
  const p = loadSupplierPassport(plantpay(), user, id); // undefined when the invoice is not this supplier's
  if (!p) notFound();
  return (
    <>
      <Link href="/supplier/passport" className={s.back}>All payment readiness</Link>
      <h1 style={{ marginBottom: 6 }}>Payment readiness passport</h1>
      <PassportView p={p} />
    </>
  );
}
