# T3 — Match & Root-Cause engine, duplicate detection, clerk review screen

**Read first:** `CLAUDE.md`, `00_PLAN.md`, handoffs T1–T2.
**Depends on:** T2. **Delivers:** core item 3 + bonus "duplicate-invoice detection".
**Estimate:** one session (the most important one: spend the time here).

## Goal
A pure, tested, deterministic engine that matches invoice ↔ PO ↔ GR, decides Approve/Flag/Block, and gives every finding a **reason with root cause, owner and minimal fix**. Plus the clerk's review screen that shows it.

## In scope
### A. Engine (`src/engine/`), pure functions, no UI or IO, fully unit-tested
Per invoice line, in this order:
1. **Vendor/PO validity**: vendor exists; PO exists and belongs to the vendor; else **Block**.
2. **Duplicate fingerprint**: same vendor + similar invoice number (normalised: strip prefixes/suffixes like R/-A/spaces/zeros) + amount within ₹1 + date window ±30 days + PO + line count/descriptions. Match to a paid or open invoice → **Block** "Possible duplicate of INV-xxxx (paid dd-MMM)". Show the matched fields; a human confirms. Never say "fraud".
3. **UoM normalisation** using `UomRule` (e.g., 5 MT = 5,000 kg). If equal after conversion → pass with reason "Unit of measure only".
4. **Price check** vs PO unit price, tolerance ±2% (constant in `config.ts`). If outside: compare to the **contract price valid on the PO date or delivery date**. Equal to contract → root cause "PO not updated after contract change", owner **Buyer**, fix "Amend PO price to ₹412 per C-22". Not equal to contract either → root cause "Supplier billed off-contract", owner **Supplier**, fix "Credit note or corrected invoice".
5. **Quantity check** vs cumulative GR, tolerance ±5%.
   - No GR at all and delivery date not passed → **Block** "Billed before delivery/receipt", owner Supplier/hold.
   - No GR and delivery date passed → **Block** "Goods receipt not posted", owner **Warehouse**.
   - Invoice qty > GR but = delivery note → **Flag** "Receipt under-posted", owner **Warehouse**.
   - Invoice qty > delivery note → **Flag** "Billed for undelivered quantity", owner **Supplier**.
6. **Tax check**: tax rate must equal the PO tax code; mismatch → **Flag** "Tax rate differs from PO (12% vs 18%)", owner **Supplier**.
7. **Arithmetic check**: lines × price + tax = total.
**Verdict:** worst line wins (Block > Flag > Approve). Each `Finding` stores: line, check, status, expected, actual, delta%, rootCause, owner, fix (counterfactual wording: "Passes if …"), evidence refs (which PO/GR/contract/DN rows were used).
Wording must be plain, one sentence, with numbers: e.g. "Price ₹412.00 is 3.5% above PO ₹398.00. Contract C-22 (01-Oct) sets ₹412.00, so the PO looks outdated."
### B. Re-match
`rematch(invoiceId)` recomputes findings after any change to PO/GR data (T4 calls this). Idempotent and logged as events.
### C. Clerk screens (`/clerk`)
- Queue table: invoice, supplier, amount, verdict chip, top root cause, age, owner.
- **Review screen**: split view (document with highlights + findings). Findings table per line with expected vs actual, status chip, root cause, owner, fix; "Show evidence" opens the underlying PO/GR/contract rows. Verdict banner at the top with the one-line summary.
- Duplicate view: side-by-side comparison of the new invoice vs the matched paid invoice, with a "Confirm duplicate" / "Not a duplicate" decision (logged, reason required).
### D. Hook to T2
When the supplier submits (T2), the engine runs and the invoice status is set (Approved-pending-release / Flagged / Blocked).

## Out of scope
Workflow tasks, approvals, audit-log UI (T4). Dashboards (T5). Any ML or LLM.

## Acceptance criteria
- [ ] Unit tests for every rule and a **golden test**: INV-7781 yields exactly the three findings in the plan (L1 price/PO-stale/Buyer, L2 UoM pass, L3 qty/receipt-under-posted/Warehouse) and verdict Flag.
- [ ] Expected verdicts for all six demo documents (T2 table) pass as tests; INV-6120R is Block/duplicate.
- [ ] Boundary tests at exactly ±2% price and ±5% quantity.
- [ ] Engine has no imports from UI or IO modules; runs in < 50 ms per invoice.
- [ ] Every finding has a non-empty reason, owner and fix; none says "fraud" or an accusation.
- [ ] Clerk review screen shows evidence for each finding; opens from the queue; works for all six documents.
- [ ] Changing a seeded tolerance in `config.ts` changes results (proves the rules are configurable).

## Tester checklist
Run all six documents; confirm verdicts; change PO price in the seed file and re-run; try a PO that doesn't exist; check wording is readable by a non-expert; confirm the duplicate screen needs a reason to override.

## Handoff
`plan/handoffs/T3_handoff.md`: rule table as implemented, config constants, test summary, known gaps.
