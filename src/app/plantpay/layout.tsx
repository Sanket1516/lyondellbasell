import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { requireAnyRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PlantPayLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole(["clerk", "approver"]);
  return <AppShell user={user}>{children}</AppShell>;
}
