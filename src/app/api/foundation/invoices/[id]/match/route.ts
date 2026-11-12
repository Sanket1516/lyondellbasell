import { NextResponse } from "next/server";
import { DEMO_TODAY } from "@/lib/constants";
import { getSessionUser } from "@/lib/session";
import { foundationDb, runMatch } from "@/foundation/service";

export const dynamic = "force-dynamic";

/** Run the three-way match for one invoice, store the result and return it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role === "supplier") return NextResponse.json({ error: "Only AP clerks and approvers can run a match." }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const res = runMatch(foundationDb(), id, DEMO_TODAY);
  if (!res) return NextResponse.json({ error: `Invoice ${id} was not found.` }, { status: 404 });
  return NextResponse.json(res);
}
