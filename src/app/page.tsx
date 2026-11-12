import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { ROLE_HOME } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function Index() {
  const user = await getSessionUser();
  redirect(user ? ROLE_HOME[user.role] : "/login");
}
