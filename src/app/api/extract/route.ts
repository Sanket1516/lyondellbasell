import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveSource, UPLOAD_DIR } from "@/lib/demo-docs";
import { ExtractError, extractDocument, sniff } from "@/lib/extract";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** POST multipart form: `file` (an upload) or `demo` (a demo document name). Returns the extraction. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "supplier") return fail("Please sign in as a supplier.", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("The upload could not be read. Please try again.");
  }

  let buf: Buffer;
  let fileName: string;
  let source: string;
  const demo = form.get("demo");
  const file = form.get("file");
  if (typeof demo === "string" && demo) {
    const p = resolveSource(`demo:${demo}`);
    if (!p) return fail("That demo document does not exist.");
    buf = fs.readFileSync(p);
    fileName = demo;
    source = `demo:${demo}`;
  } else if (file instanceof File) {
    if (file.size > MAX_BYTES) return fail("This file is larger than 10 MB. Upload a smaller PDF or image.");
    buf = Buffer.from(await file.arrayBuffer());
    fileName = file.name.slice(0, 120) || "upload";
    const kind = sniff(buf);
    if (buf.length > 0 && kind) {
      const ext = kind === "pdf" ? "pdf" : buf[0] === 0xff ? "jpg" : "png";
      const stored = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
      source = `upload:${stored}`;
    } else {
      source = ""; // rejected below with a clear message
    }
  } else {
    return fail("Choose a file or a demo document.");
  }

  try {
    const extraction = await extractDocument(buf, fileName, getState().vendors);
    return NextResponse.json({ ok: true, source, extraction });
  } catch (e) {
    if (e instanceof ExtractError) return fail(e.message);
    return fail("Something went wrong while reading this file. It has not been submitted.", 500);
  }
}
