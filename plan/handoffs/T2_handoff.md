# T2 handoff: Demo data, documents and extraction

## What exists
- **Seed** (`npm run seed`, generator `scripts/generate-seed.ts`, shared master data in `scripts/lib/spec.ts`): fictional Plant X, 6 vendors (V-1001..V-1006), 46 POs, 43 goods receipts (cumulative per line), 6 contracts with price history, delivery notes, 3 UoM rules, **42 invoices** (last 60 days, statuses approved/paid/pending_owner/blocked/pending_approval) and 21 findings. "Today" is fixed at `DEMO_TODAY` = 2026-11-12 (`src/lib/constants.ts`). Output is byte-identical on a second run; all totals are asserted.
- Seed covers: **7 open "PO not updated after contract change" cases** across 4 suppliers in all four age buckets (0-2, 3-7, 8-14, 15+); **INV-6120** (Deccan, paid) for the duplicate demo. Tasks and audit events are empty (T4 owns them).
- **Six demo documents** in `data/demo-docs/` (`npm run docs:generate`, byte-identical on rerun), each with `.expected.json`; layouts differ per vendor. INV-7785 is a scanned-looking JPG plus `INV-7785.extracted.json` (stored fallback).
- **Extraction** (`src/lib/extract/`): `parse.ts` is a pure rule-based parser over positioned text items (labels, positional, pattern fallback; CGST/SGST/IGST; per-field confidence and bbox; four sanity checks). `pdf.ts` uses pdf.js, `ocr.ts` uses Tesseract.js (English model bundled from node_modules), `index.ts` orchestrates, sniffs file type by magic bytes, and applies the fixture fallback.
- **API**: `POST /api/extract` (supplier only; `file` or `demo`), `GET /api/document?src=demo:<file>|upload:<id>` (signed in; whitelisted names). Uploads are stored in git-ignored `data/uploads/`.
- **UI** (`/supplier`): drop zone, "Use a demo document" dropdown, split view (pdf.js canvas or image with highlight box) with editable fields, confidence chips, "Check" marking, checks list, confirm and submit; supplier invoice list with status chips. Server action `submitInvoice` creates an Invoice with status `received` (shown as "Submitted").
- Types added: `Contract.history`, `Invoice.resolvedOn/submittedBy/printedVendor`. `UNKNOWN_VENDOR` = "UNKNOWN" (`src/lib/status.ts`) for vendors not in the master.

## Golden invoice INV-7781 (Vihar, PO 4500001234)
L1 AX-40 1,000 kg @ 412 = 4,12,000 (PO 398; contract C-22 = 412 from 01-Oct) · L2 C-12 5 MT @ 86,000 = 4,30,000 (PO 5,000 kg @ 86; 1 MT = 1,000 kg) · L3 DR-200 40 nos @ 1,450 = 58,000 (GR 32 nos on 02-Nov; DN-5521 says 40). Subtotal 9,00,000, GST 18% 1,62,000 (CGST+SGST), total **10,62,000**. Line 1 is received in two GRs (600 + 400) so cumulative receipts are exercised.

## Other documents
7782 Konkan (clean, total 70,564) · 6120R Deccan (same lines and amount as paid INV-6120, total 1,24,254) · 7784 Sahyadri (PO 4500001242, no GR, total 1,37,352) · 7785 Malabar (JPG, IGST 12% vs PO GST18, total 63,056) · 7786 Girnar (FRT-20 billed 19,400; PO 18,500; contract 18,200; total 2,86,504).

## Verified
- `npm test`: 25 tests pass (extraction of all six vs expected, golden table exact, bbox on every PDF field, bad inputs, seed coverage, submit action). `npm run build` passes.
- Headless Chrome run against `next start`: login, dropdown read of INV-7781, highlight boxes for vendor, PO, invoice number, line qty, tax, total, PDF canvas drawn, submit, list updated, JPG path, .txt rejected with a clear message, no external network requests. HTTP: 0-byte file, corrupt PDF and corrupt JPG all return clear errors; clerk gets 401 on extract; path traversal on `/api/document` gets 404. PDF extraction takes ~10-200 ms.

## Known limits (tester please check)
- **Live OCR on INV-7785 is not reliable** (Tesseract misreads the label/GSTIN lines), so the app normally shows the **stored fixture result with a visible amber note** "Fixture result: scanned image". This is the planned fallback. The fixture only applies to the exact committed JPG (SHA-256 match); any other image shows live OCR output with its failures. OCR results are capped at Medium confidence.
- Demo mode: either supplier login can submit any of the six documents; the invoice is recorded under the vendor printed on it (matched by GSTIN or name), and shows in the submitting login's list.
- Checks on the review screen reflect the extracted values and are not recomputed when the supplier edits a field. Server-side validation is basic (formats and positive numbers).
- Dates: the ticket says GR "02-Dec"; the dataset uses 02-Nov-2026 because "today" is 12-Nov-2026.
- `public/pdf.worker.min.mjs` is copied from node_modules by `predev`/`prebuild` (git-ignored). Resubmitting the same invoice number replaces it only while status is Submitted; clerk "Reset demo data" clears submissions (uploaded files stay in data/uploads).
- Not checked by a human: visual review of the pages, contrast, keyboard order. Drag-and-drop was not exercised (file chooser path was).
