import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DEMO_DIR, resolveSource } from "./demo-docs";
import { extractDocument } from "./extract";
import type { BBox, ExtractedInvoice, PageSize } from "./extract/types";
import type { Finding, Vendor } from "./types";

export interface ReviewDoc { src: string; kind: "pdf" | "image"; pages: PageSize[]; ex: ExtractedInvoice }

const cache = new Map<string, ReviewDoc | null>();

/**
 * Page sizes and field positions for the document behind an invoice, so findings can point at it.
 * PDFs are read from their text layer (fast). The one demo JPG uses its stored result; other images
 * are shown without highlights because live OCR is too slow for a page load.
 */
export async function loadReviewDoc(src: string | undefined, vendors: Vendor[]): Promise<ReviewDoc | null> {
  if (!src) return null;
  if (cache.has(src)) return cache.get(src)!;
  let doc: ReviewDoc | null = null;
  try {
    const file = resolveSource(src);
    if (file && file.endsWith(".pdf")) {
      const ex = await extractDocument(fs.readFileSync(file), path.basename(file), vendors);
      doc = { src, kind: "pdf", pages: ex.pages, ex };
    } else if (src === "demo:INV-7785.jpg") {
      const ex = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, "INV-7785.extracted.json"), "utf8")) as ExtractedInvoice;
      ex.fixture = true;
      doc = { src, kind: "image", pages: ex.pages, ex };
    }
  } catch {
    doc = null;
  }
  cache.set(src, doc);
  return doc;
}

type Boxed = { bbox?: BBox } | undefined;

/** Where on the document a finding should point. */
export function boxFor(ex: ExtractedInvoice, f: Finding): BBox | null {
  const line = f.lineNo ? ex.lines[f.lineNo - 1] : undefined;
  const pick = (...fields: Boxed[]) => fields.find((x) => x?.bbox)?.bbox ?? null;
  switch (f.kind) {
    case "price": return pick(line?.unitPrice, line?.amount);
    case "quantity": case "missing_receipt": case "uom": case "not_on_po": return pick(line?.qty, line?.amount);
    case "tax": return pick(ex.taxRatePct, ex.taxAmount);
    case "arithmetic": return pick(line?.amount, ex.total, ex.subtotal);
    case "duplicate": return pick(ex.invoiceNumber);
    case "missing_po": return pick(ex.poNumber);
    case "unknown_vendor": return pick(ex.vendorName, ex.vendorGstin);
    default: return null;
  }
}
