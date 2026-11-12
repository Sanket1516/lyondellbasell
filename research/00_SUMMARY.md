# 00 Summary — PS4 Smart Procure-to-Pay

**TL;DR**
- Problem: invoices don't match what was ordered/received; AP, approvers, suppliers and auditors lose time and trust.
- LYB uses Ariba Network + email/XML/EDI and enforces unique invoice ID, 3-way match and PO-consistent terms — mirror this.
- Reason-coded decisions + audit trail + exception ageing = the winning story.
- Benchmarks are vendor-reported; LYB baselines unavailable.

**Problem (3 lines):** Fictional Plant X's finance team gets invoices that mismatch POs/receipts, duplicates and missing approvals. Build a web app that reads invoices, matches them to PO/GR, and approves/flags/blocks with reasons. Scored on 10 criteria; prototype 20, impact 15.

**Top 10 insights:** 1 LYB invoices via Ariba/email/XML/EDI/ERS (S1,S2). 2 Unique invoice ID + 3-way match required (S3). 3 Payment terms must match PO; regional terms differ 45/60 d (S4,S5). 4 AP is status-only; buyers fielding supplier queries, 24–48 h (S2). 5 SAP blocks on price/qty tolerance; GR-less invoices checked vs PO only (S6). 6 SAP duplicate check has known gaps (S7). 7 India e-invoice IRN/ITC matters (S8). 8 LYBOM Source-to-Pay targets invoice processing (D). 9 Auditors test 3-way match, SoD, thresholds, audit trail (S10). 10 Vendor benchmarks wide-ranging, self-reported (S9,S12).

**Three painful experiences [ILLUSTRATIVE]:** clerk can't tell why an invoice failed; supplier can't see status; approver signs without evidence.

**Five constraints:** no real ERP/data; tolerance/approval rules unknown; OCR accuracy on messy docs; tax/IRN/multi-currency; AI must be explainable and human-overridable.

**Five opportunities (HMW):** HMW explain every match decision in one line? HMW surface missing GR owner and age? HMW stop duplicates before posting? HMW give suppliers self-serve status (cut queries)? HMW give auditors a ready controls report?

**Validate with mentors:** tolerances/approval thresholds; PO/GR data shape; judges' success criteria. See [10](10_questions_for_mentors.md).
