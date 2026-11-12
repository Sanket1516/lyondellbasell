# T3 handoff: Match and root-cause engine, duplicates, clerk review

## What exists
- **Engine** `src/engine/` (pure: imports only `lib/format`, `lib/types`, `lib/constants`; no UI, IO, clock or randomness).
  - `match.ts`: `matchInvoice(invoice, data, today, config?) -> { verdict, summary, findings, lineVerdicts }`, plus `contractPriceOn`, `normaliseInvoiceNo`, `summarise`.
  - `config.ts`: every tunable in one place (below). Pass a different config to `matchInvoice` and results change (tested).
- **State glue** `src/lib/matching.ts`: `matchInState(state, id, actor)` (mutates a state object), `rematch(id, actor)` (persists; **T4 calls this after any PO/GR/contract change**), `applyDuplicateDecision(...)`. `src/lib/audit.ts` has `appendAudit` (sha256 hash chain, genesis = 64 zeros). T4 owns the audit UI and may extend events.
- **Hook to T2**: `submitInvoice` now runs `matchInState`, so a submitted invoice leaves as `pending_approval` (clean), `pending_owner` (flag) or `blocked`. A supplier may resubmit (replace) their own invoice only until a task, approval or payment exists.
- **Clerk screens**: `/clerk` queue (Open / All tabs, oldest first, verdict chip, top root cause, owner, age, status) and `/clerk/invoices/[id]` review: verdict banner with one-line summary, original document with highlight boxes ("Show on document"), lines table with per-line result, finding cards (expected vs billed, root cause, owner, smallest fix, "Show evidence" listing the PO/GR/DN/contract/unit rows used), "Re-run match", and for duplicates a side-by-side comparison with **Confirm duplicate / Not a duplicate** (reason of at least 8 characters, saved in the audit log).
- Types: `Finding` gains optional `expected/actual/deltaPct/evidence/matchedInvoiceId`; kinds `arithmetic`, `not_on_po`; `Invoice.duplicateDecision`.
- `store.ts` cache now lives on `globalThis` (Next bundles pages, actions and routes separately; a module variable gave the clerk page a stale copy of what the supplier action wrote).

## Rules as implemented (in order, per invoice)
| # | Check | Result | Root cause (as stored) | Owner |
|---|---|---|---|---|
| 1 | Vendor not in master / inactive | Block | Supplier not in vendor master / Supplier inactive | Buyer |
| 1 | PO missing | Block | No valid PO | Supplier |
| 1 | PO raised on another supplier | Block | PO belongs to a different supplier | Supplier |
| 2 | Same supplier, same normalised number (`INV-6120R` = `6120`), total within ₹1, date within 30 days, and same PO or same lines | Block | Possible duplicate of a paid invoice (or "Confirmed duplicate…" after a clerk decision) | AP Clerk |
| per line | Item not on PO | Flag | Item not on the PO | Buyer |
| 3 | UoM converted with `UomRule` (either direction); no rule | Flag | Unit of measure cannot be converted | Supplier |
| 3 | Converted and nothing else wrong on that line | Approve | Unit of measure only | System |
| 4 | Price outside ±2% of PO (after UoM conversion), equals contract price on the delivery date | Flag | PO not updated after contract change | Buyer |
| 4 | …equals neither PO nor contract | Flag | Price differs from both PO and contract | Supplier |
| 4 | …no contract price on file | Flag | Price differs from PO, no contract price on file | Buyer |
| 5 | No receipt, delivery due after "today" | Block | Billed before delivery or receipt | Supplier |
| 5 | No receipt, delivery date passed | Block | Goods receipt not posted | Warehouse |
| 5 | Qty above cumulative receipts +5%, delivery note covers it | Flag | Goods receipt under-posted | Warehouse |
| 5 | Qty above receipts +5% and above delivery note (or no note) | Flag | Billed for undelivered quantity | Supplier |
| 6 | Line tax rate differs from PO line tax rate (one finding for the invoice) | Flag | Invoice tax rate differs from PO tax code | Supplier |
| 7 | Line amount, subtotal, tax or total does not add up (±₹1) | Flag | Invoice arithmetic does not add up | Supplier |

Verdict = worst finding. Duplicate and PO/vendor findings are invoice-level; the rest carry `lineNo` (tax carries it only when one line is affected). Clean lines produce no finding, except the UoM pass note.

## Config (`src/engine/config.ts`)
`pricePct` 2 (from `TOLERANCE`), `qtyPct` 5, `duplicateDays` 30, `duplicateAmountInr` 1, `arithmeticInr` 1, `deliveryLeadDays` 7. Boundaries are inclusive: exactly ±2% price and exactly +5% quantity pass.
- **Delivery date** when no delivery note exists = PO date + `deliveryLeadDays`. The PO has no promised-date field, so this is an assumption. It is what makes INV-7784 (PO 30-Oct, no GR, no DN) read "Goods receipt not posted, Warehouse" on 12-Nov.
- **Contract price date** = delivery note date, else first receipt date, else invoice date. For INV-7781 that is 02-Nov, so C-22's ₹412 (from 01-Oct) applies and the earlier ₹398 is shown as evidence.

## Tests (`npm test`: 77 pass, 6 files)
`src/engine/match.test.ts` (golden INV-7781 exactly 3 findings, all six demo documents, ±2% / ±5% boundaries, config changes results, every rule, duplicate window/amount/decision, wording has no accusation words and every fix reads "Passes if/once…", determinism, < 50 ms, import isolation, runs on all 42 seeded invoices) and `src/lib/matching.test.ts` (verdict-to-status mapping, idempotent re-match with no extra event, PO price change then GR post flips to clean, paid/approved never moved, hash chain linked, duplicate decision needs a reason). `submit.test.ts` updated for the match hook.

## Verified in a browser (production build, headless Chrome)
Submitted all six demo documents as a supplier (live PDF extraction, JPG via the stored fixture), then as the clerk opened each review page: verdicts Flag, Approve, Block (duplicate), Block (no receipt), Flag (tax), Flag (off-contract); evidence expands; "Show on document" draws the highlight on the PDF and on the JPG; duplicate decision shows "Give a reason…" when empty and clears the block when given; seeded invoices open too. Queue showed 48 invoices (42 seeded + 6 submitted) after the `globalThis` fix.

## Known gaps (tester please check)
- **Seeded findings are the generator's, not the engine's.** 35 of 42 seeded invoices give the same root causes when re-run through the engine. The 7 that differ: 3 "Unit of measure only" notes on approved invoices (the engine omits them when the unit table does not apply), 2 "under-posted" that the engine words as "Billed for undelivered quantity" (no delivery note exists for them), INV-6135 "possible duplicate" (no matching original in the data), INV-6141 (two lines, same cause). Seeded rows show no "Show evidence" until re-run. Pressing **Re-run match** on a seeded invoice replaces its findings with the engine's.
- Already-billed quantity is not subtracted: a second invoice against the same receipt passes the quantity check. The ticket asks only for a check against cumulative receipts.
- Price-below-PO beyond 2% is flagged the same way as price-above.
- Highlights on uploaded (non-demo) images are unavailable (live OCR is too slow for a page load); PDFs and the demo JPG highlight.
- After a decision of "Not a duplicate" the invoice moves to Awaiting approval; routing by amount is T4.
- Clerk "Re-run match" does not stop an `approved`/`paid` invoice's status from staying as is (by design), but it still rewrites its findings.
- Not checked by a human: visual polish, contrast, keyboard order.

## For T4
Call `rematch(invoiceId, actor)` from `src/lib/matching.ts` after applying the simulated ERP updates (change PO line price, post a GR). It is idempotent and logs `rematch` only when something changed. Statuses after matching: approve -> `pending_approval`, flag -> `pending_owner`, block -> `blocked`. Task creation is not done here.
