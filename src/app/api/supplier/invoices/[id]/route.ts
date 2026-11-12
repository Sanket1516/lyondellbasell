import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { buildSupplierView } from "@/lib/supplier-view";

export const dynamic = "force-dynamic";

/** The supplier's own view of one invoice. Other suppliers' invoices and other roles get 404 / 401. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "supplier") return NextResponse.json({ error: "Sign in as a supplier." }, { status: 401 });
  const { id } = await params;
  const view = buildSupplierView(getState(), decodeURIComponent(id), user);
  return view ? NextResponse.json(view) : NextResponse.json({ error: "Invoice not found." }, { status: 404 });
}
