import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "./types";
import { findUser } from "./users";

const COOKIE = "plantx_session";
// Demo secret: fictional data only. Override with SESSION_SECRET in .env.
const SECRET = process.env.SESSION_SECRET ?? "plant-x-demo-secret-not-for-production";

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function makeToken(username: string): string {
  return `${username}.${sign(username)}`;
}

export function verifyToken(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const i = token.lastIndexOf(".");
  if (i < 0) return undefined;
  const username = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(username));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  return findUser(username);
}

export async function getSessionUser(): Promise<User | undefined> {
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value);
}

export async function setSession(username: string) {
  const jar = await cookies();
  jar.set(COOKIE, makeToken(username), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
