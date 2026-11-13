// Shown for an unknown address or a record that does not exist (for example a mistyped invoice number).
import Link from "next/link";
import s from "./status.module.css";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <p className={s.kicker}>Not found</p>
        <h1>We could not find that page or record</h1>
        <p>The invoice, supplier or page may not exist in the demo data, or the address has a typo. Invoice numbers that contain a slash, such as IG20/26-27/0910, are opened from the lists.</p>
        <div className={s.actions}>
          <Link href="/start" className={s.primary}>Back to start</Link>
          <Link href="/plantpay" className={s.secondary}>PlantPay dashboard</Link>
        </div>
      </div>
    </div>
  );
}
