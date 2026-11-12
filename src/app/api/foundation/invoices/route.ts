import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { foundationDb, listInvoices, statusCounts } from "@/foundation/service";

export const dynamic = "force-dynamic";

/**
 * List invoices with their latest match status (AP clerks and approvers).
 * Query: ?status=pass|review|block &vendor=V-1007 &q=text &demo=1 &limit=100 &offset=0
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role === "supplier") return NextResponse.json({ error: "This view is for AP clerks and approvers." }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const status = q.get("status") ?? undefined;
  if (status && !["pass", "review", "block"].includes(status)) return NextResponse.json({ error: "status must be pass, review or block." }, { status: 400 });
  const db = foundationDb();
  const out = listInvoices(db, { status, vendor: q.get("vendor") ?? undefined, q: q.get("q") ?? undefined, demoOnly: q.get("demo") === "1", limit: Number(q.get("limit") ?? 100) || 100, offset: Number(q.get("offset") ?? 0) || 0 });
  return NextResponse.json({ ...out, counts: statusCounts(db) });
}
