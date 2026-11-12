// Orchestrates extraction for an uploaded file. Node only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PLANT } from "../constants";
import { parseInvoice, type ParseOptions } from "./parse";
import type { ExtractedInvoice } from "./types";

export const DEMO_DIR = path.join(process.cwd(), "data", "demo-docs");

/** An error whose message is safe to show to the user. */
export class ExtractError extends Error {}

export type FileKind = "pdf" | "image";

export function sniff(buf: Buffer): FileKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image"; // JPEG
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image"; // PNG
  return null;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function usable(x: ExtractedInvoice): boolean {
  return !!(x.invoiceNumber.value && x.invoiceDate.value && x.poNumber.value && x.total.value !== null && x.lines.length > 0 && x.checks.every((c) => c.ok));
}

function loadFixture(buf: Buffer): ExtractedInvoice | null {
  try {
    const jpg = path.join(DEMO_DIR, "INV-7785.jpg");
    const fx = path.join(DEMO_DIR, "INV-7785.extracted.json");
    if (!fs.existsSync(jpg) || !fs.existsSync(fx)) return null;
    if (sha(fs.readFileSync(jpg)) !== sha(buf)) return null; // the stored result only applies to that exact image
    return JSON.parse(fs.readFileSync(fx, "utf8")) as ExtractedInvoice;
  } catch {
    return null;
  }
}

export async function extractDocument(
  buf: Buffer,
  fileName: string,
  vendors: ParseOptions["vendors"],
): Promise<ExtractedInvoice> {
  if (buf.length === 0) throw new ExtractError("The file is empty (0 bytes). Choose a PDF or an image of an invoice.");
  const kind = sniff(buf);
  if (!kind) throw new ExtractError("This file type is not supported. Upload a PDF, JPG or PNG invoice.");
  const t0 = Date.now();
  const base: ParseOptions = { vendors, buyerGstin: PLANT.gstin };

  if (kind === "pdf") {
    let read;
    try {
      const { readPdfItems } = await import("./pdf");
      read = await readPdfItems(new Uint8Array(buf));
    } catch {
      throw new ExtractError("This PDF could not be read. It may be damaged or password protected.");
    }
    if (read.items.length === 0) {
      throw new ExtractError("This PDF has no text layer (it is probably a scan). Upload it as a JPG or PNG instead.");
    }
    const x = parseInvoice(read.items, read.pages, { kind, fileName }, { ...base, mergeGap: 0.3 });
    x.notes.push("Read from the PDF text layer.");
    x.elapsedMs = Date.now() - t0;
    return x;
  }

  // image
  let ocr: ExtractedInvoice | null = null;
  let failure = "";
  try {
    const { readImageItems } = await import("./ocr");
    const read = await readImageItems(buf, 15000);
    ocr = parseInvoice(read.items, read.pages, { kind, fileName }, { ...base, mergeGap: 0.5, cap: "medium" });
  } catch (e) {
    failure = e instanceof Error && /timed out/i.test(e.message) ? "it took too long" : "";
  }
  if (ocr && usable(ocr)) {
    ocr.notes.push("Read from a scanned image with OCR. Values are never shown as high confidence; check each one.");
    ocr.elapsedMs = Date.now() - t0;
    return ocr;
  }
  const fx = loadFixture(buf);
  if (fx) {
    fx.fixture = true;
    fx.fileName = fileName;
    fx.notes = ["Fixture result: scanned image. Live OCR was not usable on this image, so the stored result is shown."];
    fx.elapsedMs = Date.now() - t0;
    return fx;
  }
  if (ocr) {
    ocr.notes.push("Read from a scanned image with OCR. Several checks failed, so please correct the fields marked Check.");
    ocr.elapsedMs = Date.now() - t0;
    return ocr;
  }
  throw new ExtractError(`This image could not be read${failure ? ` (${failure})` : ""}. Try a clearer scan or a PDF.`);
}
