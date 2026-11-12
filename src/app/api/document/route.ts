import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { MIME, resolveSource } from "@/lib/demo-docs";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?src=demo:<file> or upload:<file>. Serves the original document to a signed-in user. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  const src = new URL(req.url).searchParams.get("src") ?? "";
  const file = resolveSource(src);
  if (!file || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  const body = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${path.basename(file)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
    },
  });
}
