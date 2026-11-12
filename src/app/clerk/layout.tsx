import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ClerkLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("clerk");
  return <AppShell user={user}>{children}</AppShell>;
}
