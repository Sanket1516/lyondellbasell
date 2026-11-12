# 01 Problem Breakdown (PS4 Smart Procure-to-Pay)

**TL;DR**
- Real pain: invoices don't match what was ordered/received, so AP clerks chase exceptions, suppliers chase payment, auditors chase evidence. [INFERRED]
- LYB's own supplier guidance already demands unique invoice IDs, 3-way match, PO-consistent terms and no duplicate channels (S1–S3) — the demo should mirror these rules. [VERIFIED]
- Best leverage: explain every decision (reason + audit trail) and show exceptions by type/supplier/age.
- Plant X is fictional; all data synthetic (rules).
- SafeSite research archived at `research/_archive_safesite/`.

## Clarifications
| Q | Answer | Label |
|---|---|---|
| Q1 PS4 replaces SafeSite? | Yes; SafeSite archived, nothing deleted | [DEFAULT ASSUMPTION] (chosen to maximise points) |
| Q2 Plant X location | Indian-style site (INR, GST) + a few foreign-currency invoices | [DEFAULT ASSUMPTION] |
| Q3 ERP integration | Standalone app on SAP-style synthetic PO/GR/vendor data; integration shown as concept | [DEFAULT ASSUMPTION] |
| Q4 Scope | AP at centre + supplier status view; PO/GR upstream treated as given data | [DEFAULT ASSUMPTION] |
| Q5 Extra organiser info | None; PDF says no data/inputs supplied; 10 published criteria only | [DEFAULT ASSUMPTION] |
All assumptions go to [10](10_questions_for_mentors.md) for validation: [UNRESOLVED] until mentor confirms.

## A. Explicit problem
Build a web app: 3 role logins; upload invoice (PDF/image) → extract vendor, PO no., items, qty, price, tax; 3-way match invoice↔PO↔GR with approve/flag/block + reason (price, quantity, missing receipt); role-based approval thresholds + audit trail; exceptions dashboard (type, supplier, age) + supplier status view. Bonus: duplicate detection, "Where is my payment?" chatbot, auditor controls report. Rules: all 5 core; own fictional data; run own demo; declare GenAI (−10 if undeclared); explain every part. Scoring weights: prototype 20, impact 15, others ≤10.

## B. Underlying business problem
| Pain | Basis |
|---|---|
| Mismatches vs PO/GR, missing GR, duplicates, missing approvals → late payment, delays, audit risk | [VERIFIED] stated in brief |
| Manual reconciliation effort | [INFERRED] |
| Duplicate/incorrect payment cash leakage | [INFERRED]; SAP's own duplicate check has known gaps (S7) |
| Supplier dissatisfaction; status queries (LYB: AP is status-only resource, response 24–48 h, S2) | [VERIFIED] |
| Working-capital impact (LYB frames Cash Improvement Plan, D) | [VERIFIED] context; link to AP is [INFERRED] |
| Audit exposure: 3-way match, SoD, audit trail are testable controls (S10) | [VERIFIED-secondary] |

## C. Who suffers
AP clerks (daily exceptions), approvers (context-free approvals), buyers/procurement (supplier chasers; "buyers remain primary contact", S2), warehouse (GR timeliness), suppliers (late/unclear payment), auditors/controllers. Frequency: [UNKNOWN – requires mentor validation].

## D. Success after six months (hypotheses; no invented baselines)
Lower processing time; higher first-pass match; faster exception resolution; fewer duplicate payments; more on-time payments; less manual touch; faster approvals; complete audit trace; fewer supplier queries. See [09](09_value_and_metrics.md).

## E. Unknowns → working assumptions
Volumes, supplier/plant counts, formats/languages, GR availability, partial deliveries, tax/currency, hierarchies, tolerances, payment terms, systems. Evidence: LYB regional terms differ (45 days DE, 60 days NL; S4–S5), so terms are per PO/contract [VERIFIED]. Demo assumptions: tolerances (e.g. price ±2%, qty ±5%) are [ASSUMPTION]; SAP uses tolerance keys (S6).

## Problem tree
- Root causes: unstructured invoice inputs; PO/GR data in other systems; late/missing GR; inconsistent master data; approval rules not enforced in-system [INFERRED].
- Symptoms: exceptions queue, chasing, duplicates, stalled approvals.
- Consequences: late payment/supplier friction, cash leakage, audit findings, month-end pressure.
## 5 Whys
Late payment? → invoice stuck. Why? → exception unresolved. Why? → mismatch/missing GR needs human lookup across systems. Why? → no single explained decision view. Why? → matching result lacks reason/owner/age tracking. [INFERRED]
## Explicit vs inferred
Explicit = items in A. Inferred = B–D rows tagged [INFERRED]. Cross-refs: [05](05_current_process_and_systems.md), [08](08_constraints_and_risks.md).
