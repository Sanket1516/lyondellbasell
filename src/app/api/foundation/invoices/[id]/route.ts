import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { foundationDb, getInvoice } from "@/foundation/service";

export const dynamic = "force-dynamic";

/** One invoice with its lines and its latest stored match result (null until matched). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role === "supplier") return NextResponse.json({ error: "This view is for AP clerks and approvers." }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const found = getInvoice(foundationDb(), id);
  if (!found) return NextResponse.json({ error: `Invoice ${id} was not found.` }, { status: 404 });
  return NextResponse.json(found);
}
