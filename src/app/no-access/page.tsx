import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { ROLE_HOME } from "@/lib/users";
import AppShell from "@/components/AppShell";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NoAccess() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <EmptyState title="You do not have access to that page">
        Your account is signed in as {user.title}. <Link href={ROLE_HOME[user.role]}>Go to your home page</Link>.
      </EmptyState>
    </AppShell>
  );
}
