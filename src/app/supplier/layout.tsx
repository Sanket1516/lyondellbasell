import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SupplierLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("supplier");
  return <AppShell user={user}>{children}</AppShell>;
}
