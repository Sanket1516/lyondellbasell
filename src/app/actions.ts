"use server";
import { redirect } from "next/navigation";
import { clearSession, getSessionUser, setSession } from "@/lib/session";
import { findUser, ROLE_HOME } from "@/lib/users";
import { resetState } from "@/lib/store";

export interface LoginState { error?: string }

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const user = findUser(username);
  if (!user || user.password !== password) return { error: "Username or password is not correct." };
  await setSession(user.username);
  redirect(ROLE_HOME[user.role]);
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function resetDemoAction() {
  const user = await getSessionUser();
  if (!user || user.role === "supplier") redirect("/no-access");
  resetState();
  redirect(ROLE_HOME[user.role]);
}
