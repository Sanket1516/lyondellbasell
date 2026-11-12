import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { foundationDb, getInvoice, getResult } from "@/foundation/service";

export const dynamic = "force-dynamic";

/** The stored match result for one invoice. 404 with a clear message when it has not been matched yet. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role === "supplier") return NextResponse.json({ error: "This view is for AP clerks and approvers." }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const db = foundationDb();
  if (!getInvoice(db, id)) return NextResponse.json({ error: `Invoice ${id} was not found.` }, { status: 404 });
  const res = getResult(db, id);
  if (!res) return NextResponse.json({ error: `No match result for ${id} yet. POST to /match to create one.` }, { status: 404 });
  return NextResponse.json(res);
}
