import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser } from "./session";
import type { Role, User } from "./types";

/** Use in each role layout: sends anonymous users to /login and other roles to /no-access. */
export async function requireRole(role: Role): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect("/no-access");
  return user;
}

/** For screens shared by several roles, such as the audit trail. */
export async function requireAnyRole(roles: Role[]): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/no-access");
  return user;
}
