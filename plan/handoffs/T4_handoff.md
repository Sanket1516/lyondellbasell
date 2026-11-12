# T4 handoff: Workflow, thresholds, audit trail, supplier status

## What exists
- **Service layer** `src/lib/workflow.ts` (pure functions on the state; every rule lives here, not in the UI): `requestFix`, `simulateErpUpdate`, `releaseInvoice`, `decideApproval`, `reopenInvoice`, `closeSupplierTasks`, `approvalChecks`. A refusal returns a readable message and writes a `refused` audit event. Server actions (`src/app/clerk/actions.ts`, `src/app/approver/actions.ts`) pass any signed-in user to the service, so a wrong role is refused by the service itself.
- **Routing** `src/lib/routing.ts`: clean ≤ ₹1,00,000 clerk releases; ≤ ₹15,00,000 Approver L1; above Approver L2. `matchInState` writes a `routed` event when an invoice first becomes clean.
- **Audit** `src/lib/audit.ts`: append-only, `hash = sha256(seq, time, actor, action, invoice, detail, prevHash [, role, before, after, reason])`, `verifyChain()` reports the first broken record. Events written by T3 (no role field) still verify.
- **Screens**: clerk review gets "Request fix from <owner>", task rows, "Demo: simulate ERP update by <owner>", Release, and "Return to approval"; `/approver` inbox and `/approver/invoices/[id]` evidence card (invoice vs PO vs receipts, how findings were resolved, duplicate check, SoD checks, history, Approve / Send back / Reject); `/audit` (clerk and approver; filters; Verify chain); `/supplier/invoices/[id]` timeline; `GET /api/supplier/invoices/[id]` returns the same view as JSON.
- **Supplier view** `src/lib/supplier-view.ts` builds the page from an allow-list (no owners, names, notes, reasons, approval level or other suppliers). Payment due = invoice date + `Vendor.paymentTermsDays` or 45 days [ASSUMPTION].
- **Seed**: added fixed anchor INV-6150 (Girnar, 90 trips × ₹18,500, total ₹19,64,700, clean, pending approval) with PO 4500000990 and GR 5000008990. Built without the random generator, so no other seeded record changed. 43 invoices now.
- **Dev script**: `npm run audit:tamper` edits one saved record and shows detection; `-- --restore` puts it back; `-- --verify` checks only.

## State machine
`received` → match → `pending_owner` (flag) / `blocked` (block) / `pending_approval` (clean).
Flag/block + tasks requested → (owner tasks done by simulated ERP update, or supplier resubmits) → re-match → `pending_approval`.
`pending_approval` → clerk **Release** (≤ ₹1L) or approver **Approve** → `approved` (the "ready for payment" status; a `ready_for_payment` event records the due date; no payment is made) · approver **Reject** → `rejected` · **Send back** → `sent_back`. Clerk **Return to approval** (reason required) moves rejected/sent-back back to `received` and re-matches.
The labels the clerk sees ("Awaiting owner actions", "Waiting for supplier", "Awaiting Approver L1", "Approved, ready for payment") are derived in `src/lib/workflow-status.ts`.
Simulated updates: price "PO not updated after contract change" → PO line price set to the billed price; quantity "under-posted" and "receipt not posted" → a new goods receipt for the missing quantity. Other fixes have no simulation (the screen says so). Supplier-owned tasks wait for the supplier's corrected invoice, which closes them.

## SoD rules as implemented (approve)
1. Must be an approver (supplier and clerk refused).
2. Not the submitter, and not anyone who edited, released, raised tasks on, or decided a duplicate for the invoice (`touchedBy`).
3. Within limit: L1 up to ₹15,00,000, L2 any amount; invoices within the clerk limit are not an approver's to approve.
4. Not an approver who rejected it earlier in the cycle (`rejectedBy`; a supplier resubmission starts a new cycle).
Reject and send-back need rules 1 and 3 and a reason of at least 8 characters. The invoice must be clean with no open tasks.

## Event types
`invoice_submitted`, `invoice_resubmitted`, `match_run`, `rematch`, `routed`, `task_requested`, `erp_simulated`, `task_done`, `duplicate_confirmed`, `duplicate_dismissed`, `released`, `approved`, `rejected`, `sent_back`, `reopened`, `ready_for_payment`, `refused`.

## Tests (`npm test`: 105 pass, 7 files)
`src/lib/workflow.test.ts`: routing bands (INV-7782 clerk, INV-7781 L1, INV-6150 L2), the golden journey with an event for every action, every SoD rule called directly on the service, refusals logged, reasons required, audit tamper / delete / reorder detected, supplier view leak tests at every stage. `seed.test.ts` covers INV-6150.

## Verified in a browser (production build, headless Chrome)
Supplier submits INV-7781 → clerk raises both tasks → supplier reads "2 internal actions pending. Nothing needed from you." → both simulated updates → routed to Approver L1 (₹10,62,000) → L1 evidence card, reject without reason refused, approve → supplier sees "Approved. Payment scheduled for 25-Dec-2026 (45-day terms)". Audit shows every step and "Chain intact". Role guards redirect to /no-access; supplier API is clean and 404/401 otherwise; L1 on INV-6150 sees the failed limit check with Approve disabled; Approver L2 sees it. Tampered record #7 detected by the Verify chain button, restore passes. State survived a server restart; Reset demo data returned the 43 seeded invoices and an empty audit trail.

## Known gaps (tester please check)
- Verify chain reads the saved `data/state.json`. After `audit:tamper`, click Verify before using the app: the next change rewrites the file from memory and repairs the record.
- Audit timestamps are real wall-clock times; business dates use the fixed demo "today" (12-Nov-2026).
- Seeded flagged invoices have no tasks until the clerk requests them; seeded approved/paid invoices have no audit events.
- A rejected invoice stays in the clerk's open queue until reopened (no terminal "closed" state).
- L2 can also approve L1-band invoices and sees them in the inbox.
- Not checked by a human: visual polish, contrast, keyboard order of the new screens.
