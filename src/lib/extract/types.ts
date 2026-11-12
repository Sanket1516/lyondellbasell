// Types for invoice extraction. Pure data, safe to import from client and server code.

/** One run of text from a document. Coordinates are in page units with the origin at the TOP-left. */
export interface TextItem {
  str: string;
  x: number;
  y: number; // top of the box
  w: number;
  h: number;
  base: number; // y of the text baseline (or line centre for OCR); used to group items into rows
  page: number; // 0-based
}

export interface PageSize { w: number; h: number }

/** Highlight region as fractions of the page (0..1), top-left origin. */
export interface BBox { page: number; x: number; y: number; w: number; h: number }

export type Confidence = "high" | "medium" | "low";

export interface Field<T> {
  value: T | null;
  confidence: Confidence;
  bbox?: BBox;
  /** Text exactly as printed on the document. */
  raw?: string;
}

export interface ExtractedLine {
  lineNo: number;
  itemCode: Field<string>;
  description: Field<string>;
  qty: Field<number>;
  unit: Field<string>;
  unitPrice: Field<number>;
  amount: Field<number>;
}

export interface Check { id: string; label: string; ok: boolean; detail: string }

export interface ExtractedInvoice {
  kind: "pdf" | "image";
  fileName: string;
  pages: PageSize[];
  vendorName: Field<string>;
  vendorGstin: Field<string>;
  invoiceNumber: Field<string>;
  invoiceDate: Field<string>; // ISO yyyy-mm-dd
  poNumber: Field<string>;
  lines: ExtractedLine[];
  subtotal: Field<number>;
  taxRatePct: Field<number>;
  taxAmount: Field<number>;
  total: Field<number>;
  checks: Check[];
  /** Shown to the user. Never hidden: tells them how the values were obtained. */
  notes: string[];
  fixture?: boolean;
  elapsedMs?: number;
}
