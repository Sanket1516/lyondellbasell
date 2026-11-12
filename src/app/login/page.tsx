import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { ROLE_HOME, USERS } from "@/lib/users";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(ROLE_HOME[user.role]);
  const accounts = USERS.map(({ username, password, displayName, title }) => ({ username, password, displayName, title }));
  return <LoginForm accounts={accounts} />;
}
