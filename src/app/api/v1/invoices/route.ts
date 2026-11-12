import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Invoice list for other systems (ERP, BI). Signed-in session required.
 * A supplier sees only its own invoices; AP clerks and approvers see all.
 * Query: ?status=pending_owner&vendor=V-1001&limit=50
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const vendor = q.get("vendor");
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 100) || 100, 1), 500);

  const s = getState();
  const rows = s.invoices
    .filter((i) => user.role !== "supplier" || i.vendorId === user.vendorId || i.submittedBy === user.username)
    .filter((i) => !status || i.status === status)
    .filter((i) => !vendor || i.vendorId === vendor);

  return NextResponse.json({
    total: rows.length,
    invoices: rows.slice(0, limit).map((i) => ({
      id: i.id, vendorId: i.vendorId, poId: i.poId ?? null, invoiceDate: i.invoiceDate, receivedOn: i.receivedOn,
      currency: i.currency, total: i.total, status: i.status, verdict: i.verdict ?? null,
      findings: user.role === "supplier" ? undefined : s.findings.filter((f) => f.invoiceId === i.id).length,
    })),
  });
}
