# T4 — Workflow, thresholds, audit trail, supplier status

**Read first:** `CLAUDE.md`, `00_PLAN.md`, handoffs T1–T3.
**Depends on:** T3. **Delivers:** core item 4 and the supplier-status half of core item 5.
**Estimate:** one session.

## Goal
Turn verdicts into a working, controlled process: owner tasks, simulated ERP fixes with automatic re-match, amount-based approvals with segregation of duties, a tamper-evident audit trail, and a supplier view that explains status in plain language.

## In scope
### A. Owner tasks
- From a Flag/Block finding, the clerk can **"Request fix"**, creating a `Task` (owner: Buyer / Warehouse / Supplier, finding, due date, status requested → done).
- **Simulated ERP update** control (visibly labelled "Demo: simulate ERP update by <owner>"): applies the suggested fix to the seed data (PO price amendment, GR posting) and logs an event, then calls `rematch`. Supplier-owned tasks create a "Waiting for supplier" state (no simulated action needed).
- Invoice states: Submitted → Flagged/Blocked → Awaiting owner actions → Re-matched clean → Awaiting approval → Approved → Ready for payment (a status only; no payment execution).
### B. Thresholds and approvals [per plan §3]
- Clean match ≤ ₹1,00,000 → clerk "Release". Up to ₹15,00,000 → Approver L1. Above → Approver L2. Routing is automatic and shown on the invoice ("Needs Approver L1: amount ₹10,62,000 > ₹1,00,000").
- **Approver screens** (`/approver`): inbox of invoices assigned to their level. **Evidence card**: invoice vs PO vs GR diff, findings and how they were resolved, history, any duplicate check, SoD check result. Actions: Approve, Reject (reason required), Send back (reason required).
- **Segregation of duties** enforced in the service layer (not only the UI): the supplier cannot approve; the clerk who released/edited cannot approve; an approver cannot approve an invoice they rejected earlier in the same cycle; L1 cannot approve above their limit. Violations are refused with a readable message and logged.
### C. Audit trail
- Append-only `AuditEvent` log: id, timestamp, actor, role, action, invoice, before/after summary, reason, **hash = sha256(previous hash + event)**. Every state change, override, task, simulated ERP update, approval and rejection writes an event.
- **Audit screen** (`/audit`, clerk and approver): filter by invoice/actor/action, with a "Verify chain" button that recomputes hashes and shows "Chain intact" or the first broken record. Provide a developer script that tampers one record to prove detection.
### C2. Supplier view (`/supplier/invoices/[id]`)
- Timeline of steps with timestamps and a plain-language status. Examples: "Received" · "Checked against PO and goods receipt" · "2 internal actions pending. Nothing needed from you." · "Approved" · "Payment scheduled for 14-Dec-2026 (45-day terms)".
- If the supplier must act (e.g. off-contract price, tax rate), show exactly what to fix, with the expected value. **Never expose internal names, internal notes or other suppliers' data.**
- Payment due date = invoice date + payment terms (per vendor; 45 days default [ASSUMPTION]).

## Out of scope
Real payments, email notifications, extra roles, dashboards (T5).

## Acceptance criteria
- [ ] Golden journey steps 3–6 from the plan work end to end with no manual data edits.
- [ ] Each routing band demonstrated: ≤ ₹1L clerk release (INV-7782), ≤ ₹15L Approver L1 (INV-7781), and one invoice above ₹15L (add a seeded history invoice and a test) → L2.
- [ ] Every SoD rule has a test that proves the service layer refuses (calling the API directly, not only via UI).
- [ ] Audit trail contains an event for every action in the golden journey; "Verify chain" passes; tampered record is detected.
- [ ] Supplier view leaks no internal data (test with the supplier role's API responses).
- [ ] Rejections and send-backs require a reason.
- [ ] State survives a page refresh and server restart; "Reset demo data" returns to the seed.

## Tester checklist
Run the golden journey twice (reset in between); attempt each SoD violation via the UI and via direct API calls; tamper the log and verify; log in as the wrong role; check the supplier timeline wording; check all dates and amounts format correctly.

## Handoff
`plan/handoffs/T4_handoff.md`: state machine, SoD rules as implemented, event types, known gaps.
