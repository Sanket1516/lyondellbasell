"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./AppShell.module.css";

export default function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  // Longest matching href wins so /audit/report does not also light up /audit.
  const best = items.filter((n) => path === n.href || path.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <ul>
      {items.map((n) => (
        <li key={n.href}>
          <Link href={n.href} className={n.href === best ? s.on : undefined} aria-current={n.href === best ? "page" : undefined}>{n.label}</Link>
        </li>
      ))}
    </ul>
  );
}
