// One-click demo sign-in for the landing page's role buttons: /demo/supplier, /demo/clerk, /demo/approver.
// Signs in the seeded demo account for that role (synthetic data; the same credentials are printed on the landing page and
// in DEMO.md) and redirects to the role's home, or to ?next= when it is a same-site path.
// Turn it off with DEMO_AUTOLOGIN=off: the buttons then fall back to the normal sign-in page.
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie } from "@/lib/session";
import { DEMO_USER, safeNext } from "@/lib/demoLogin";
import { ROLE_HOME, findUser } from "@/lib/users";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Relative Location: the browser stays on the host it used (localhost, 127.0.0.1 or a LAN address), so the cookie follows. */
function redirect(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path, "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (process.env.DEMO_AUTOLOGIN === "off") return redirect("/login");
  const username = DEMO_USER[role as Role];
  const user = username ? findUser(username) : undefined;
  if (!user) return redirect("/login");
  const res = redirect(safeNext(req.nextUrl.searchParams.get("next")) ?? ROLE_HOME[user.role]);
  const c = sessionCookie(user.username);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
