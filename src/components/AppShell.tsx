import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";
import { ROLE_HOME } from "@/lib/users";
import { logoutAction, resetDemoAction } from "@/app/actions";
import NavLinks from "./NavLinks";
import s from "./AppShell.module.css";

const NAV: Record<User["role"], { href: string; label: string }[]> = {
  supplier: [{ href: "/supplier", label: "My invoices" }, { href: "/supplier/passport", label: "Payment readiness" }],
  clerk: [{ href: "/clerk", label: "Invoice queue" }, { href: "/plantpay", label: "PlantPay engine" }, { href: "/plantpay/journey", label: "Golden Journey" }, { href: "/plantpay/predictions", label: "Predictions" }, { href: "/plantpay/suppliers", label: "Supplier scores" }, { href: "/plantpay/process", label: "Process twin" }, { href: "/dashboard", label: "Exceptions dashboard" }, { href: "/audit", label: "Audit trail" }, { href: "/audit/report", label: "Controls report" }, { href: "/foundation", label: "Match foundation" }, { href: "/plantpay/innovations", label: "Innovations" }, { href: "/plantpay/architecture", label: "Architecture" }, { href: "/plantpay/responsible-ai", label: "Responsible AI" }],
  approver: [{ href: "/approver", label: "Approvals" }, { href: "/plantpay", label: "PlantPay engine" }, { href: "/plantpay/journey", label: "Golden Journey" }, { href: "/plantpay/predictions", label: "Predictions" }, { href: "/plantpay/suppliers", label: "Supplier scores" }, { href: "/plantpay/process", label: "Process twin" }, { href: "/dashboard", label: "Exceptions dashboard" }, { href: "/audit", label: "Audit trail" }, { href: "/audit/report", label: "Controls report" }, { href: "/foundation", label: "Match foundation" }, { href: "/plantpay/innovations", label: "Innovations" }, { href: "/plantpay/architecture", label: "Architecture" }, { href: "/plantpay/responsible-ai", label: "Responsible AI" }],
};

export default function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const canReset = user.role !== "supplier";
  return (
    <div className={s.shell}>
      <nav className={s.rail} aria-label="Main">
        <div className={s.brand}>
          <span className={s.bands} aria-hidden="true" />
          <strong>Plant X</strong>
          <span>Payables Desk</span>
        </div>
        <NavLinks items={NAV[user.role]} />
        <div className={s.foot}>
          <div className={s.who}>
            <span className={s.role}>{user.title}</span>
            <span>{user.displayName}</span>
            <form action={logoutAction}>
              <button className={s.logout} type="submit">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H3v12h3M10 5l3 3-3 3M13 8H6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Log out
              </button>
            </form>
          </div>
          {canReset && (
            <details className={s.footer}>
              <summary>Demo controls</summary>
              <form action={resetDemoAction}>
                <button className={s.link} type="submit">Reset demo data</button>
              </form>
            </details>
          )}
        </div>
      </nav>
      <main className={s.main} data-home={ROLE_HOME[user.role]}>{children}</main>
    </div>
  );
}
