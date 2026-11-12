import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";
import { ROLE_HOME } from "@/lib/users";
import { logoutAction, resetDemoAction } from "@/app/actions";
import s from "./AppShell.module.css";

const NAV: Record<User["role"], { href: string; label: string }[]> = {
  supplier: [{ href: "/supplier", label: "My invoices" }],
  clerk: [{ href: "/clerk", label: "Invoice queue" }, { href: "/audit", label: "Audit trail" }],
  approver: [{ href: "/approver", label: "Approvals" }, { href: "/audit", label: "Audit trail" }],
};

export default function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const canReset = user.role !== "supplier";
  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <div className={s.brand}>Plant X <span>Payables Desk</span></div>
        <div className={s.who}>
          <span className={s.role}>{user.title}</span>
          <span>{user.displayName}</span>
          <form action={logoutAction}><button className={s.link} type="submit">Log out</button></form>
        </div>
      </header>
      <nav className={s.rail} aria-label="Main">
        <ul>
          {NAV[user.role].map((n) => (
            <li key={n.href}><Link href={n.href}>{n.label}</Link></li>
          ))}
        </ul>
        {canReset && (
          <details className={s.footer}>
            <summary>Demo controls</summary>
            <form action={resetDemoAction}>
              <button className={s.link} type="submit">Reset demo data</button>
            </form>
          </details>
        )}
      </nav>
      <main className={s.main} data-home={ROLE_HOME[user.role]}>{children}</main>
    </div>
  );
}
