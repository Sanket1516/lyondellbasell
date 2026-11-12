# 05 Current Process & Systems

**TL;DR**
- Generic P2P below is industry-standard; LYB specifics verified only for: Ariba Network invoicing, email/XML/EDI/ERS channels, SAP (S/4HANA programme), 3-way match requirement (S1–S3, D).
- SAP matching uses tolerance keys for price/quantity; invoices exceeding tolerance are blocked (S6). [VERIFIED]
- Without a GR the invoice is checked only against PO price/qty; GR-less invoices can be blocked (S6). [VERIFIED]
- SAP duplicate check compares vendor/currency/company code/reference/date; sources conflict on amount (S7). [VERIFIED w/ caveat]
- LYB's internal tolerances and exception categories: Data unavailable — requires mentor validation.

## System labels
- [VERIFIED LYB] SAP Ariba Network invoicing; email PDF/XML/EDI/ERS; SAP S/4HANA programme (S1–S3, D).
- [INDUSTRY STANDARD] SAP S/4HANA, Ariba, Coupa, Oracle Fusion, Basware.
- [UNKNOWN] LYB's AP workflow tool, OCR vendor, approval engine.

## 15-stage P2P
| # | Stage | Role | In → Out | Systems | Bottleneck / error | Financial consequence |
|---|---|---|---|---|---|---|
| 1 | Requisition | Requisitioner | need → PR | ERP | Wrong spec | Wrong PO |
| 2 | PR approval | Manager | PR → approved PR | ERP workflow | Delay | Late supply |
| 3 | Supplier/PO creation | Buyer | PR → PO | ERP | Wrong price/terms | Future mismatch |
| 4 | PO transmission | Buyer | PO → supplier | Ariba/email | Not received | Wrong invoice |
| 5 | Delivery | Supplier | goods → site | — | Partial delivery | Qty variance |
| 6 | GR | Warehouse | delivery → GR | ERP | Late/missing GR | Blocked invoice |
| 7 | Invoice submission | Supplier | invoice → LYB | Ariba/email/EDI | Wrong channel, duplicates (S2) | Delay/duplicate |
| 8 | Capture/extraction | AP/OCR | doc → data | OCR/ERP | Poor quality | Keying errors |
| 9 | Validation | AP | data → checked | ERP | Missing PO/vendor | Rejection |
| 10 | 2/3-way match | AP/system | inv+PO+GR → match | ERP tolerance | Price/qty/UoM/tax | Overpayment |
| 11 | Exceptions | AP/buyer | mismatch → resolved | email/phone | Slow loop | Late payment |
| 12 | Approval | Approver | → approved | workflow | Thresholds/delays | Audit risk |
| 13 | Payment scheduling | Treasury/AP | → due date | ERP | Terms misapplied | Missed discount/late fee |
| 14 | Payment | Treasury | → bank | Bank | Duplicate | Cash leakage |
| 15 | Reconcile/audit | Controller/audit | → evidence | ERP | Missing trail | Findings |
Stages are [INFERRED] general practice.

## 3-way match details (general)
Price, quantity, partial deliveries, tax, freight, UoM, tolerance limits. SAP: tolerance keys DQ/DW (quantity), KW/PP/PS (price); upper price limit can block payment (S6). No PO → cannot be 3-way matched; may block above a value (S6).
## Exception types
Missing PO; invalid supplier; duplicate; amount/tax mismatch; missing GR; missing approval; invalid documents. India GST: valid e-invoice needs IRN/QR where applicable; without it ITC may be lost (S8). Thresholds: Data unavailable (sources conflict; verify CBIC).
Cross-refs: [06](06_industry_benchmarks.md), [08](08_constraints_and_risks.md).
