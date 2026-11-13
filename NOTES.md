# NOTES: Smart Procure-to-Pay (PS4), engineering log

Append-only log of decisions, schema changes, run instructions and what is left. Read this first.

## Stage 1 of 8: Foundation (2026-11-12)

### Audit of existing work (done before building)

| Stage 1 item | State found | Action |
|---|---|---|
| 1. SQLite schema + models | **partial**: `data/plantx.db` (src/lib/db.ts) stores each collection as JSON documents; no vendor bank accounts, addresses, employees, materials, inventory, PO change history, contract amendments | Added a normalised relational schema (new file, see below). App store untouched. |
| 2. Seed: ~30 vendors, ~500 POs, ~600 invoices + planted cases | **partial**: 6 vendors, 47 POs, 43 invoices, hand-tuned and asserted for the T5 dashboard | Kept as is. New deterministic generator adds 24 vendors, 466 POs and the rest; the curated seed is loaded into the same database. |
| 2b. Demo set of 15+ documents | **partial**: 6 documents in `data/demo-docs` | Kept. Added 13 new PDFs in `data/demo-set` (19 total listed in `manifest.json`). |
| 3. Three-way matching | **done** (`src/engine/match.ts`, tested) with two gaps found and fixed (see Decisions) | Verified, fixed, reused. Added a structured-result wrapper. |
| 4. FastAPI endpoints | **missing as FastAPI**; a Next.js invoice list API existed (`/api/v1/invoices`) | Built as Next.js route handlers (stack decision below). |
| 5. Minimal Streamlit page | **missing as Streamlit**; clerk queue existed | Built as a Next.js page `/foundation`. |

### Decisions

- **Stack**: the prompt names FastAPI and Streamlit, but CLAUDE.md locks the project to Next.js + TypeScript and the repo already has a working app. Asked the team leader; the answer was to audit the existing TypeScript app and fill gaps in TypeScript. No Python was added.
- **Separate database**: the foundation lives in `data/foundation.db` (git-ignored), not in `data/plantx.db`, so the working T1 to T5 app and its 123 tests are not at risk. Later stages should read from the foundation DB.
- **Single source of matching rules**: `src/foundation/threeWay.ts` loads relational rows, calls the existing engine `matchInvoice`, and reshapes findings into `{status, checks[], discrepancies[]}`. No second copy of the rules. Deterministic; no ML or AI in the decision path.
- **Duplicate check scoped to earlier invoices** (wrapper): the original of a duplicate pair is not blamed for the copy that arrived after it.
- **Engine fix 1, re-keyed duplicates** (`src/engine/match.ts`): the duplicate fingerprint only caught numbers that differ by a prefix/suffix (INV-6120 vs INV-6120R). A copy with a completely different number, same PO, same lines, same total was missed. Added that path, but only when the PO's goods receipts cannot cover both bills, so two halves of a staged delivery are not flagged.
- **Engine fix 2, none needed to the 30-day window**: an existing test deliberately says 40 days apart is not a duplicate. The app's seeded duplicate INV-6135 is 40 days after its original, so the engine would not flag it. In the foundation dataset only, that copy is re-dated inside the window (documented in `generate.ts`). The app seed is unchanged.
- **Stage 1 does not judge bank details, splitting or shared accounts.** Those cases are in the data (planted with `stage` = stage3/5/6) and pass the three-way match; later stages add the warnings. Wording stays "review", never an accusation. Shared bank accounts can be legitimate: the dataset includes one legitimate pair (Dahej Catalysts and its trading arm) and one unrelated-vendor pair.
- **Root causes**: each discrepancy carries `rootCauseStatus`: `supported_by_evidence` when the engine attached evidence rows, otherwise `unverified_prediction`.
- **Amounts** are INR. All names, GSTINs, bank accounts and IFSC codes are fictional (`FICT` GSTIN pattern, `FICB` IFSC prefix).
- Determinism: fixed PRNG seed 20261113 and fixed "today" 2026-11-12; two builds are byte-identical and the demo PDFs have identical hashes across runs.

### Schema (src/foundation/schema.ts), `data/foundation.db`

Reference: `vendors`, `addresses`, `vendor_bank_accounts` (status verified / pending_verification / closed, valid_from/to), `employees` (buyer, stores, ap_clerk, approver_l1, approver_l2 with approval limits), `materials`, `material_uoms` (unit conversions such as MT to kg = 1000).
Contracts: `contracts`, `contract_prices` (effective-dated, newest = current), `contract_amendments` (old/new price, effective date, signed date).
Purchasing: `purchase_orders`, `po_line_items`, `po_change_history`.
Receiving: `goods_receipts`, `gr_line_items`, `delivery_notes`, `delivery_note_lines`, `inventory_transactions` (GR, ISSUE, ADJUST).
Invoices: `invoices` (includes `remit_account_no`, `remit_ifsc`, `source_file`), `invoice_line_items`.
Support: `planted_cases` (ground truth for deliberate exceptions, with `stage`), `demo_documents`, `match_results` (latest structured result per invoice as JSON), `meta`.
Foreign keys are enforced and checked in tests.

### Data

- 30 vendors (6 curated + 24 new), 513 POs, 585 goods receipts, 611 invoices, 103 planted/labelled cases, 19 demo documents.
- Planted types (6 required + extras): price mismatch, quantity mismatch, missing GR, duplicate, unit mismatch (5 MT vs 5000 kg; plus unconvertible units), stale PO price vs newer contract, tax rate; later-stage: threshold splitting (3 invoices, same PO, same day, each under Rs 1,00,000), bank-detail change, shared bank account, contract amendment handled correctly.
- Demo set: 6 curated PDF/JPG in `data/demo-docs` (golden INV-7781, clean INV-7782, duplicate INV-6120R, missing GR INV-7784, scanned image with 12% GST INV-7785, off-contract price INV-7786) + 13 in `data/demo-set` with 5 layouts, 4 amount formats ("Rs. 2,36,000.00", "INR 236,000.00", "236000.00", "Rs 2,36,000/-") and 3 date formats. Each has an `.expected.json` and an entry in `data/demo-set/manifest.json`.

### API and UI (Next.js; sign in as a clerk or approver; suppliers get 403)

- `GET  /api/foundation/invoices?status=pass|review|block&vendor=&q=&demo=1&limit=&offset=` list with match status and counts
- `GET  /api/foundation/invoices/{id}` invoice, lines, stored result (ids contain `/`; URL-encode them)
- `POST /api/foundation/invoices/{id}/match` run and store the three-way match
- `GET  /api/foundation/invoices/{id}/result` stored result (clear 404s for unknown invoice or not yet matched)
- Page `/foundation` (nav: "Match foundation"): counts, filters, search, demo-only toggle, paging. `/foundation/invoices/{id}`: per-check pass/fail, discrepancies with evidence, "Run match".
- The foundation DB seeds itself on first request if empty, so a fresh checkout is never an empty screen.

### How to run

```
npm install
npm run seed:foundation       # builds data/foundation.db and matches all 611 invoices
npm run demo-set:generate     # (re)renders data/demo-set PDFs + manifest (deterministic)
npm run dev                   # sign in as priya.clerk (Clerk@2026), open /foundation
npm test                      # 150 tests
```

### Verification (2026-11-12)

- `npm test`: 10 files, 150 tests passed (123 existing + 27 new). `tsc --noEmit` clean.
- Planted detection: 611 of 611 invoices match their labelled outcome (0 mismatches); every planted type has at least 5 cases.
- Live check against `next dev`: unauthenticated 401; list, get, match, result return the shapes above; encoded ids work; unknown ids give 404 messages; `/foundation` and the detail page render 200.
- One extraction test (`src/lib/extract`, OCR timing) failed once in the first run of the session and passed in later full runs; it is timing sensitive on a slow machine.
- Not done: no visual/browser check of the new page (only HTTP status and content checks). Do this before the demo.

### What is left

- Stage 2 onward consume `foundation.db`: bank-detail verification, threshold splitting, shared-account and graph warnings, contract-amendment explanation, ML predictions (must come from a trained, evaluated model).
- The extraction pipeline (`/api/extract`) still writes to the app store, not the foundation DB; connect them when upload-to-match is needed on foundation data.
- The 13 new PDFs have a text layer but have not been run through the extraction parser; the 6 curated ones have.
- GenAI declaration: Claude Code (Anthropic) was used to write this code, per the hackathon rule that GenAI use must be declared. Team members must be able to explain it.

## Stage 1B: PlantPay architecture (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| Six source databases | **missing** (one combined DB) | Built: `data/sources/{procurement,warehouse,quality,finance,logistics,supplier}.db`, each with its own native conventions |
| Read-only connectors, canonical model | **missing** | `src/plantpay/connectors.ts`, `canonical.ts` |
| REST facade, API keys, event stream, outage toggle | **missing** (an older session-only `/api/v1/invoices` existed) | `/api/plantpay/v1/*`, `integration.ts` (outbox, keys, source_state) |
| Matching rules | **done** (3-way engine) | Reused unchanged; added quality and weighbridge cross-checks in `rules.ts` |
| Risk detection (Stage 5) | **missing** | Interface `RiskDetector`; interim detectors for bank change, shared account, threshold splitting (marked interim) |
| Root cause / counterfactual (Stage 3) | **done** in the existing engine (root cause, evidence, smallest fix) | Reused |
| Prediction (Stage 6) | **missing** | `Predictor` interface plus a stub that says it is not built. No probabilities are shown without a trained, evaluated model |
| RAG with citations | **missing** | `rag.ts`: BM25 over synthetic policies + contracts + amendments, extractive answers, "will not guess" when nothing matches |
| Workflow automation | **partial** (tasks lived in the old app store) | Routing to departments, tasks, event-driven re-matching in `engine.ts` |
| Hash-chained audit | **done** (app) | Reused the same hash algorithm in the integration DB |
| Dashboard | **missing** | Next.js `/plantpay` (see decision below) |

### Decisions

- **Stack**: Next.js, not Streamlit, same decision as Stage 1 (CLAUDE.md locks the stack). The dashboard is `/plantpay`: inline-SVG architecture diagram, data-sources panel (health, last sync, outage toggle), invoice list showing which sources contributed, invoice drill-down with evidence from each of the six databases, recent approvals, audit reports.
- **Source conventions** (so normalisation is real): finance in paise, logistics in tonnes, `PO-`/`GRN-` prefixed references in warehouse and quality, supplier DB uses `SUP-nnnn` while others use `V-nnnn`. `canonical.ts` converts to rupees, kg, bare PO/GRN numbers, `V-` ids and one spelling per unit.
- **Read-only** is enforced by opening each file with SQLite's `readonly` flag. Only `sources/writers.ts` writes to a source file, playing the department's own system (post GRN, record inspection, change or verify bank details) and publishing the matching event.
- **Outage**: a failing or switched-off source becomes `SourceUnavailableError`, never a crash. Dependent checks show "not evaluated", no false findings are produced (for example no "missing PO" when Procurement is down), and a would-be pass becomes `incomplete`. Events stay queued while Finance is down. Stored results still display.
- **Status values**: `pass`, `review`, `block`, `incomplete`. Review-level warnings make an otherwise clean invoice `review`; `info` warnings (the confirmed legitimate Dahej group account, a long-standing shared account) do not.
- **Bank-detail changes** always carry `requiresIndependentVerification` and wording to call a contact already on file.
- **Quality** compares billed quantity with quantity accepted at inspection (5 percent tolerance, unit-converted); goods received but not inspected are held. **Weighbridge** compares net kg with GRN kg (1 percent tolerance, an assumption) and with billed kg.
- Two new planted case types (`quality_reject`, `weighbridge_mismatch`: 6 each in bulk plus one demo document each); the demo set is now 21 documents. Under the Stage 1 matcher they still pass, so each carries a separate `plantpay_status`.
- RAG policies are synthetic and agree with the configured tolerances; no language model is involved.
- `foundation.db` is kept for the Stage 1 `/foundation` page and its tests; the six databases are the system of record for PlantPay.

### Schema changes

- New: six source DBs (schemas in `src/plantpay/sources/schemas.ts`) and `data/plantpay-integration.db` with `source_state`, `outbox` (events), `audit_events`, `api_keys`, `workflow_tasks`, `evaluations`, `demo_invoices`, `workflow_events` (Stage 2).
- `foundation.db`: `planted_cases.plantpay_status`, `demo_documents.plantpay_status`.

### How to run

```
npm run seed:sources         # rebuilds the six DBs and integration state, evaluates all 625 invoices (about 10 s)
npm run dev                  # sign in as priya.clerk (Clerk@2026), open /plantpay
npm test                     # 213 tests
# REST: curl -H "x-api-key: pp_demo_key_2026" localhost:3000/api/plantpay/v1/sources   (demo key, fictional)
```
Demo script: open `/plantpay`, click "Simulate outage" on Procurement and watch invoices go incomplete; open INV-7784 (no goods receipt), click "Warehouse posts the goods receipt" (event, re-match, now waiting on Quality), then "Quality records inspection" (passes).

### Verification

- 625 of 625 invoices evaluated through the six databases match their labelled outcome; all 21 demo documents get evidence from all six sources.
- Live check against `next dev`: 401 without a key or with a bad key, working with the demo key, outage toggle through API and UI, RAG "no source" answer, pages and encoded invoice numbers return 200.

### What is left

- Stage 5 detectors, Stage 6 prediction and Stage 3 refinements plug into `RiskDetector`, `Predictor` and the existing explanation fields.
- The REST facade is covered by live checks, not unit tests (its module imports `server-only`); engine, connectors, canonical, RAG, outage and event paths have unit tests.
- No browser visual check of `/plantpay` yet. Do this before the demo.
- The original `/clerk` and `/approver` flows still use the old app store; they are not fed by the six databases.

## Stage 2: Workflow events and audit trail (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| Hash-chained audit log | **done** (`src/lib/audit.ts`, app viewer `/audit` with verify) | Reused the algorithm; PlantPay has its own chain |
| verify_chain, first broken link | **done** (`verifyChain` reports `brokenSeq` and reason) | Exported alias `verify_chain`; added `verifyIntegrity` |
| Tamper demo | **done** for the app store (`npm run audit:tamper`) | Added `npm run audit:tamper:plantpay` (works on copies) |
| workflow_events table | **missing** | Built |
| Event instrumentation | **partial** | Engine emits events automatically |
| Seeded histories with loops | **missing** | Built in `history.ts` |
| Audit viewer + Verify button | **done** for the app | Added `/plantpay/audit` over the new chain |

### Decisions and design

- `workflow_events(id, invoice_id, event_type, actor, department, at, payload, content_hash, audit_seq)`; types: invoice_received, department_assigned, review_started, review_completed, exception_raised, exception_resolved, approval_requested, approval_granted, payment_status_changed (CHECK constraint).
- Every event is also appended to the hash-chained audit log with a SHA-256 of its canonical JSON (sorted keys). The chain catches edit, delete or reorder of audit entries; comparing each event row with the hash in its audit entry catches an edited or deleted `workflow_events` row.
- Instrumentation: re-evaluation emits review_started and review_completed; routing a discrepancy emits exception_raised and department_assigned; a condition clearing emits exception_resolved; `processEvents` emits invoice_received; `requestApproval`, `grantApproval`, `setPaymentStatus` emit the approval and payment events.
- Seeded histories (about 5,000 events) are derived from the source records: a paid invoice has approval and payment events; an open Procurement exception stops at "assigned to Procurement". About one in four resolved invoices has a loop (AP review, department, AP review again), some twice. Nothing is dated after 2026-11-12.
- The audit table has append-only triggers; the tamper script drops them (as an attacker with file access could) to show the chain still detects the change.

### Verification

- Tamper demo (`npm run audit:tamper:plantpay`): untouched is OK; edited record 2337 reported at 2337; deleted 2337 reported at 2338 (the gap); swap of 2337 and 2338 reported; edited workflow event reported with its audit position; deleted workflow event reported.
- Tests cover valid chain, edited, deleted and reordered records (pure arrays and database copies), appending after a tamper not hiding the break, append-only triggers, workflow-event edit and delete detection, event type coverage, loops and instrumentation.
- Full suite: 11 files, 213 tests passed (two consecutive runs).

### What is left

- The tamper demo is a script plus unit tests; the UI only has "Verify integrity".
- Approval and payment events for live invoices are recorded through engine methods; `/plantpay` has no approve or pay buttons (approvals still happen in the original `/approver` flow).

## Stage 3: Exception resolution, Root-Cause Resolver + Counterfactual Explanation as ONE module (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| Collect invoice, PO, GR and retrieve evidence | **partial**: the engine cited PO/GR/contract/delivery-note rows, but not amendments, PO change history, shipments, inspections or weighbridge | Resolver pulls all of them from the canonical bundle |
| Rule-based root cause (amendment not in PO, unit difference, missing GR, wrong material mapping) | **partial**: price, receipt, quantity, tax, duplicate, unit existed in the Stage 1 engine; **wrong material mapping missing** | Reused the engine's findings as input; added mapping rule and refined missing-GR using Logistics evidence |
| Output: problem, cause, evidence, owner, correction, counterfactual | **partial**: cause, evidence, owner, "Passes if..." fix existed; no amendment citation, no "assuming all other checks pass" | New combined module `src/plantpay/resolver.ts` |
| 5 MT vs 5000 kg as normalisation | **done** in the engine (auto-cleared note) | Verified; the resolver lists it under "Normalised, not a mismatch" and never as an exception |
| Re-run matching after a simulated human correction | **missing** for PlantPay (the old app had it for its own store) | `src/plantpay/simulate.ts` |
| Exception detail page with evidence-supported vs unverified label | **partial** (labels on the invoice page, no combined view) | `/plantpay/invoices/{id}/exceptions` (Next.js, same stack decision as before) |

### Decisions

- **One module**: `resolver.ts` produces, per exception: problem, rule id, root cause, evidence list (each item tagged with its source database), responsible department and role (and the named buyer where known), recommended correction, and a counterfactual sentence ending "assuming all other checks pass". Deterministic rules only; no ML or language model.
- **Evidence label**: `supported_by_evidence` only when a source record backs the deciding condition (for example the contract amendment row for a stale PO price, a shipment record for "billed before delivery", an identical description for a material mapping). Otherwise `unverified_prediction` (price with no contract on file, receipt not posted with no arrival record, merely similar material description). The page shows the label on every cause.
- **Planted case (₹412 / ₹398 / ₹412, INV-7781 line 1)** produces exactly: problem "Line 1 (AX-40, Process additive AX-40): invoice price ₹412.00 per kg is 3.5% above the PO price ₹398.00."; cause "Contract amendment not reflected in the PO" (supported by evidence); evidence: amendment of C-22 effective 01-Oct-2026 (₹398.00 to ₹412.00, signed 17-Sep-2026), PO 4500001234 line 1 issued 18-Sep-2026 at ₹398.00 with no price change on record, goods received from 02-Nov-2026, invoice at ₹412.00; owner Procurement, Buyer; correction "Buyer amends PO 4500001234 line 1 unit price from ₹398.00 to ₹412.00."; counterfactual "This invoice line would pass the price check if PO 4500001234 line 1 price were updated to ₹412.00, per amendment of contract C-22 effective 01-Oct-2026, assuming all other checks pass." Tests assert these strings exactly.
- **Simulated correction runs on a sandbox**: a copy of the six source databases plus a fresh in-memory integration DB. The same department writers and event-driven re-matching run there, and the page shows Before to After status, the steps, and what is still open. The live data is never touched (tested), so the presenter can repeat it. "Simulate all" repeats in rounds because one fix can reveal the next (INV-7781: amend PO, post the missing receipt, record inspection, then Review to Pass).
- Corrections that need a human decision or missing facts are marked "cannot be simulated" with the reason (unconvertible unit needs a factor; threshold splitting and shared bank account are review decisions; adding a PO line needs a Buyer decision).
- **Engine refinement found by this work**: the quality check compared billed quantity with accepted quantity even when billed exceeded what was received, so INV-7781 line 3 (billed 40, received 32, delivery note 40) was also reported as "rejected goods". The quality check now only considers the part of the bill that was received; the quantity check owns the rest. INV-7781 is now routed to Procurement and Warehouse only.
- Missing-receipt cause now uses Logistics evidence: shipment still in transit means "supplier billed before the goods arrived" (supplier follow-up); gate entry or delivery note means "goods arrived, receipt not posted" (Warehouse); no arrival record means an unverified prediction.

### Schema and interface changes

- Integration DB: new table `duplicate_decisions` (a clerk's decision with a reason, read by the engine); new event types `po_amended`, `invoice_corrected`, `master_data_changed`.
- New department-side writers: `amendPoPrice`, `addUnitConversion`, `confirmReweigh`, `correctInvoiceLine`, `recordDuplicateDecision`.
- REST: `GET /api/plantpay/v1/invoices/{id}/resolution`, `POST /api/plantpay/v1/invoices/{id}/simulate` (`{"resolutionId": "..."}` or `{"all": true}`).
- `Connectors` exposes `dir` and `close()`.

### How to run

```
npm run seed:sources && npm run dev
# sign in as priya.clerk, open /plantpay, open INV-7781, "Open the exception resolution view", then "Simulate all recommended corrections"
```

### Verification

- `npm test`: 12 files, 249 tests passed (two consecutive runs). New resolver tests cover each root-cause rule (amendment not in PO, off-contract, no contract price, billed before delivery, receipt not posted with and without an arrival record, under-posted receipt, billed undelivered, rejected goods, inspection pending, weighbridge, tax, unit not convertible, wrong material mapping exact / similar / unrelated, duplicate, bank change, splitting, shared account), the exact planted-case strings, normalisation of 5 MT vs 5,000 kg, labelling and wording on all 100+ exceptions across the 625 invoices, simulation before/after for the golden invoice and 8 other documents, live data untouched, and the WAL case.
- Live check against `next dev`: `/resolution` and `/simulate` API return the expected content; the exception page renders (200) with 6 "supported by evidence" and 2 "unverified prediction" labels across the golden invoice's explanations and tags; the simulation ran against the live app with the live status still Review afterwards. A WAL-mode clone failure that only appeared in the running app was found by this live check and fixed (regression test added).

### What is left

- No browser visual check of the new page; do this before the demo.
- The counterfactual for a weighbridge mismatch states both ways out; the simulated fix assumes the re-weigh confirms the GRN.
- Stage 6 prediction is still a stub; "unverified prediction" here refers to rule-based causes without a backing record, not an ML model.

## Stage 4: Contract-aware matching + inventory-aware verification (2026-11-12)

### Audit of existing work (done before building)

| Item | State found | Action |
|---|---|---|
| Hero invoice check | The prompt names INV-2044; this project's hero is **INV-7781** (₹412 / ₹398 / ₹412). INV-2044 does not exist. | Verified INV-7781: root cause, evidence and counterfactual strings unchanged (tests assert them exactly) |
| A. Contract terms for supplier + material | **partial**: the engine compared price with the contract only when the invoice differed from the PO; no validity dates, no amendment applicability, no contract-vs-both comparison | New `src/plantpay/contractCheck.ts` |
| A. Contract validity dates | **missing** (`contracts.valid_from/valid_to` were stored but never read) | Read into the bundle (`contractValidity`), checked against the delivery date |
| A. Amendments | **partial** (cited in the Stage 3 resolver only) | Applicable vs later-dated amendments; evidence text shared with the resolver |
| A. Wire into Root-Cause Resolver as evidence | **missing** | Resolver imports `contractEvidence`; no root-cause logic duplicated |
| B. Three-way unchanged | **done** | Untouched. Inventory runs after it |
| B. Receipts, earlier allocations, returns/reversals, duplicate quantity claims | **missing** (`stock_transactions` existed but held only GR and ISSUE rows and was never read) | New `src/plantpay/inventory.ts`, new RETURN / REVERSAL ledger rows |
| B. Graceful degradation, labelled "skipped" | **missing** | Three skip kinds, see below |
| C. Combined result side by side | **missing** | `validation` block on every result plus a three-column panel on the invoice page |

### Decisions

- **Stack**: TypeScript / Next.js again (CLAUDE.md locks it; same decision as Stages 1 to 3). No Python was added.
- **No double counting.** If the invoice differs from the PO, the three-way price check already raises it; the contract check only records the terms (state "In price check") and the resolver gets them as extra evidence. The contract check raises a finding only when **invoice and PO agree with each other but not with the contract** (three-way passes, so nothing else would notice), or when the **contract was not in force on the delivery date**. Likewise inventory leaves "billed more than received" to the quantity check and "copy of a blocked duplicate" to the duplicate check.
- **Price below contract is a note, not a finding** (no overpayment). Running the check on the existing data found 26 clean invoices 5 to 6 percent below an amended contract price (the PO pre-dates the revision); flagging them would have been noise.
- **Reference date** = first delivery note or goods receipt, otherwise the invoice date (same rule as the price check). Price tolerance is the engine's 2 percent; quantity tolerance 5 percent.
- **Inventory maths** (per PO line, in the PO unit): net = received less RETURN less REVERSAL; remaining = net less quantity on **earlier** invoices (same PO, same material, received earlier); held when earlier + this > net x 1.05. Cause wording: returned goods, else the same quantity claimed twice, else receipt already allocated.
- **A clerk's recorded "different bill" decision** removes that earlier invoice from the allocation, so the Stage 3 simulated duplicate fix still reaches Pass. It is a documented human decision with a reason.
- **Skipped, never silent.** Three kinds, all shown as "Skipped: <reason>" in the Checks list and in the side-by-side panel, never as a pass:
  - `source_unavailable` (Warehouse or Procurement down): joins the existing not-evaluated list; a would-be pass becomes **incomplete**.
  - `no_records` (a receipt with no stock-ledger rows, a PO not linked to a contract, a contract id missing from Procurement): labelled and named in the invoice summary ("Skipped inventory: the stock ledger has no entries for GRN ..."); status not changed.
  - `not_applicable` (no PO, nothing received yet): labelled with the reason.
- Wording stays "review", never an accusation. Root causes for the new findings are `supported_by_evidence` (each rests on ledger, receipt, contract or earlier-invoice rows).
- Ledger references in the Warehouse DB now use the native `GRN-` prefix; the connector and canonical model undo it like the other conventions.

### Schema and data changes

- `stock_transactions` (Warehouse DB) gains `RETURN` and `REVERSAL` rows tied to a GRN (`ref_type`/`ref_id` = `GRN-<id>`). No DDL change (txn_type was free text).
- `foundation.db`: the `inventory_transactions.txn_type` CHECK is widened to include RETURN and REVERSAL; `openFoundationDb` rebuilds an older copy of that table automatically. This was found by running `seed:foundation` on an existing file; the tests use fresh files and would not have caught it.
- Canonical bundle: `contractValidity`, `stockLedger`. Result JSON: `validation { threeWay, contract, inventory }` (results stored before Stage 4 simply lack it; the page guards for that).
- New planted types (stage4; all pass three-way, PlantPay says review): `contract_price_above`, `contract_expired` (a dedicated contract ending before delivery), `over_allocated_quantity`, `returned_goods`. One demo document each (4 new, so **25 demo documents**) plus 4 bulk cases each (5 per type). The dataset is now 650 invoices and 137 planted cases. Existing invoice ids are unchanged.
- Resolver rules: `po_price_off_contract`, `contract_not_in_force`, `returned_goods_billed`, `quantity_over_allocated`, `duplicate_quantity_claim`. Corrections reuse existing writers (amend PO price plus corrected invoice; corrected invoice quantity). Expiry and "nothing left to bill" say why they cannot be simulated.

### How to run

```
npm run demo-set:generate     # renders the 4 new PDFs into data/demo-set (manifest now lists 25)
npm run seed:foundation       # rebuilds data/foundation.db (650 invoices)
npm run seed:sources          # rebuilds the six DBs and evaluates all 650 (about 6 s)
npm run dev                   # sign in as priya.clerk, open /plantpay, then the Returned goods or Contract price document
npm test                      # 298 tests
```
Demo path: open the "Returned goods" demo invoice. Three-way says Pass, Contract says Pass, **Inventory says Review** (30 percent went back, the full quantity is billed). Open the exception view and run "Simulate all" to see Review change to Pass.

### Verification (2026-11-12)

- `npm test`: 13 files, 298 passed, two consecutive runs; `tsc --noEmit` clean. 49 new tests in `stage4.test.ts` cover: the pure contract and inventory rules (price above, below, equal, in-price-check; expiry before and after; amendment applicable and later; unit conversion; returns; reversals; over-allocation; staged delivery; a later invoice ignored; duplicate claim and its suppression; clerk decision; above-receipts left to the quantity check), the four planted cases, every planted Stage 4 case found and no unplanted invoice flagged across all 650, every invoice carrying all three validations with readable headlines, INV-7781 unchanged, missing-data fallbacks (Warehouse down, Procurement down, ledger rows deleted from a copy then restored, PO without a contract), resolver evidence and exact counterfactual strings, simulation (contract price and returned goods reach Pass; over-allocation explains why it cannot be simulated), and no accusing words.
- All 25 demo documents and all 650 invoices still match their labelled outcome. Results: 529 pass, 96 review, 25 block.
- Live check against `next dev`: the REST result carries `validation`; the invoice page and the exception page return 200 for all four planted documents and INV-7781; the three-column panel renders with real figures; no "undefined", "NaN" or "[object" in the visible text.

### What is left

- No browser visual check of the new panel (HTTP and visible-text checks only). Do this before the demo, especially at narrow width: the tables scroll horizontally inside each panel.
- The 4 new PDFs have a text layer but have not been run through the extraction parser (same status as the Stage 1 PDFs).
- A duplicate quantity claim only shows up on its own when the duplicate check does not already report the pair; cross-PO claims on one receipt cannot exist in this model (a receipt belongs to one PO).
- Stage 5 detectors and Stage 6 prediction are unchanged.
- GenAI declaration: Claude Code (Anthropic) wrote this code; team members must be able to explain it.

## Stage 5: Risk signals, four detectors (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| Duplicate check | **partial**: the three-way engine blocks re-keyed copies by invoice-number and PO-line overlap; no score, no reasons list | New multi-signal fingerprint (`risk/duplicate.ts`), shown beside it |
| Threshold splitting | **partial**: interim detector, same PO within 1 day only | Replaced by `risk/splitting.ts` (window, near-threshold band, configurable) |
| Vendor red flags | **partial**: bank change and shared account only | `risk/vendorFlags.ts`: adds address change and tax-ID conflict, verified-change look-alike |
| Relationship graph | **missing** | `risk/graph.ts` and `/plantpay/graph` |
| Bank change creates a verification task | **partial** (generic task) | Explicit task title, `requiresIndependentVerification` always set |

### Decisions

- **Stack**: TypeScript/Next.js again (CLAUDE.md locks it). No Python, FastAPI or Streamlit. The graph uses plain adjacency maps and BFS instead of networkx; the interactive view is an SVG with a small force layout, no new dependency.
- **Names**: INV-3001/3002/3003 and ABC Chemicals / XYZ Traders do not exist here. Equivalents: the splitting trio is IG20/26-27/0910 to 0912 (Indore Gaskets, about Rs 97k each, one PO); the shared-account pair is Kolhapur Castings (V-1015) and Coimbatore Motors (V-1023). The unit tests use ABC/XYZ and 95k/96k/98k fixtures.
- Every signal: `flag`, `score` (0 to 100, fixed documented weights in `risk/config.ts`), `reasons`, `supportingRecords`, `recommendedAction`, `label` = "warning, not proof". `severity` "review" holds the invoice, "info" is shown but does not.
- **Duplicate** weights: amount 22, PO 14, line items 18, quantities 6, tax 6, date 8, invoice number 16, text 10; flag at 70 and only with a document link (same PO or near-identical number). Staged billing (PO quantity covers both invoices) subtracts 45. Sequential numbers (INV-1001 / INV-1002) score 0. Found by running on the data: equal halves of one PO and repeat orders on different POs were false positives before these two rules.
- **Splitting**: near-threshold = at least 85 percent of Rs 1,00,000 (config), window 7 days, same supplier. Same PO: 2 invoices enough. Linked only by items on different POs: 3 needed. Copies are left to the duplicate detector.
- **Vendor flags** (attributes of one supplier's record) and **graph** (patterns across records) are separate detectors, panels and headings. Shared account appears in both: the vendor flag is about this supplier's account details and drives the status; the graph version is context (info) with the cluster.
- Graph findings: shared bank account, shared address, shared tax ID, approver pattern (5 or more just-under-limit approvals from one vendor in 30 days). Group account with "confirmed legitimate" on the master is not flagged. Approver pattern needs 5 because 4 occurs naturally in the synthetic data.
- Bank change: always independent call-back; a recent change with a recorded verification date is noted, not flagged.

### Schema and data changes

- Supplier DB `addresses` gains `valid_from`, `valid_to`; Finance DB `invoices` gains `gstin_on_invoice`. Rebuild with `npm run seed:sources`.
- Dataset: `invoiceGstin`, `riskPlants` (planted cases and look-alikes, kept apart from `planted`, so earlier counts are unchanged: 650 invoices, 137 planted). Plants: address change (HE22 latest invoice), GSTIN conflict (KI29/26-27/0375), verified recent bank change (look-alike), old address change (look-alike), confirmed Dahej group account (look-alike).
- Result JSON: `risk { detectors, flagged, label }`. New warning kinds: address_change, tax_id_conflict, duplicate_risk, graph_link.
- The old interim detectors in `rules.ts` remain for injected detector lists; the engine uses Stage 5 unless a list is injected.

### How to run

```
npm run seed:foundation && npm run seed:sources && npm run dev
# sign in as priya.clerk: open CM23/26-27/0909 (vendor + graph), IG20/26-27/0910 (splitting), CB21/26-27/0908 (bank change), /plantpay/graph
npm test    # 342 tests
```

### Verification

- 342 tests pass (14 files), tsc clean. 44 new tests in `risk/risk.test.ts`: pure planted and look-alike cases for each detector, then the 650-invoice dataset: every planted duplicate flagged and no other; exactly the 3 splitting invoices; bank change with task; shared account in vendor and graph; address and tax-ID plants; no review-level signal on an unplanted invoice; look-alikes not flagged; all 25 demo documents show exactly the expected detector; wording, no accusing words; Supplier outage shows graph as not evaluated.
- Live: invoice pages and the graph page return 200, contain "warning, not proof", no undefined/NaN.

### What is left

- No browser visual check of the risk panel or graph (drag, filter, narrow width). Do this before the demo.
- Graph is rebuilt when counts change (cached otherwise); first view of a large focus can be dense.
- Stage 6 prediction unchanged. GenAI declaration: Claude Code wrote this code; members must be able to explain it.

## Stage 6: Supplier intelligence + four predictive models (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| A. Three supplier scores, priority recommendation | **missing** (no supplier scoring anywhere) | `src/predict/supplier.ts`, pages `/plantpay/suppliers`, `/plantpay/suppliers/{id}` |
| A. Supplier A/B/C example from the spec | **spec not in the repo** | Reconstructed scenario as a test (A strong/low-risk, B new/critical sole source, C risky). Replace with the real figures if you have them |
| B. Labelled history, several thousand invoices | **missing** (650 curated/bulk invoices, no outcomes) | `src/predict/history.ts`: 8,000 invoices, 200 suppliers, 2,400 supplier-months, deterministic |
| B. Models A to D, train/test split, metrics saved | **missing** (`stubPredictor` only) | `src/ml/*` (own ML core) and `src/predict/train.ts`; `data/ml/{models.json,metrics.json,metrics.txt,history_*.csv}` |
| C. Predictive dashboard | **missing** | `/plantpay/predictions` and `/plantpay/predictions/{id}`; link added on the invoice page and in the nav |

### Decisions

- **Stack**: TypeScript/Next.js again (CLAUDE.md locks it). The brief names Python and scikit-learn; instead logistic regression, random forest and gradient boosting are implemented in `src/ml/core.ts` (about 200 lines, seeded, dependency-free) so every member can explain them. No Python was added.
- **Names**: INV-2044 and ABC Chemicals do not exist. Equivalents: INV-7781 and Vihar Chem Supplies (V-1001), as in earlier stages.
- **Scores are rule-based and explainable** (weights in `scoreSupplier`), not ML. Relationship Strength, Supply Criticality (impact) and Supplier Risk (likelihood) are kept separate. Inputs come from the six sources: tenure, on-time delivery (PO issue to first receipt within 21 days, an assumption), reject rate, share of invoices held for an exception, on-time payment, material criticality (master data in `materials.ts`), alternative suppliers per material, dependency, red flags.
- **Investigation priority** = urgency 25 + value 15 + supplier scores 30 + early-payment discount 10 + pending approvals 8 + contract obligations 12 (points). It orders human review; UI and API say final payment order must respect contracts and financial policy.
- **Models** (all chronological 60/20/20 split, supplier-grouped for D; best algorithm picked on validation log-loss; decision threshold picked on validation; metrics on the untouched test part):
  - A exception probability, B root cause (7 classes, trained on exception invoices), C payment delay, D supplier disruption in 90 days.
  - Test AUC: A 0.78, C 0.74, D 0.76; B accuracy 0.59 against a 0.34 majority baseline. See `data/ml/metrics.txt`.
- **Features are pre-match facts only** (value, supplier history, PO age, receipt timing and coverage, contract amendment after the PO, unit differences, approval level, terms). Matching outcomes are not features: rules decide, models estimate.
- **Evidence status** is not a model output. A predicted cause is "evidence-supported" only when the records confirm it (amendment, receipts vs billed quantity, unit mismatch, shipment in transit, inspection rejects, twin invoice); otherwise "unverified prediction". Tested.
- **Contributing factors**: sampled Shapley values (24 permutations, fixed seed) against the training-median invoice, in percentage points. "Supporting historical evidence" quotes training-history rates for similar cases, plus the supplier's own records.
- **Honest limits**: the history is synthetic and its relationships were written by us, so the metrics show the models learn them, not that they predict real LYB behaviour. Check against the live rules: flagged invoices rank above clean ones with AUC about 0.75 (subtle planted cases such as weighbridge or contract-expiry have no pre-signals). Live data has no late payments, so the "late payment" feature is always 0 there.

### Schema and data changes

- Procurement DB: new table `contract_terms` (early-payment discount, late-payment interest, strict payment date), synthetic and deterministic from the contract number. New bulk read methods on the connectors.
- New files in `data/ml/` (not git-ignored; regenerate with `npm run train:models`).
- Stored evaluation `prediction` now carries four headline probabilities when the engine is built with the predictor (`seedPlantPay({ predictions: true })`, used by `seed:sources` and the app runtime). Unit tests leave it off.
- REST: `GET /api/plantpay/v1/predictions/{id}`, `/suppliers`, `/models`.

### How to run

```
npm run train:models     # history, training, metrics printed and saved (about 12 s, deterministic)
npm run seed:sources     # rebuilds sources (adds contract_terms) and stores predictions for all 650 invoices
npm run dev              # sign in as priya.clerk, open Predictions or Supplier scores, then INV-7781
npm test                 # 370 tests
```
If `seed:sources` fails with EBUSY on Windows, stop the running `next dev` first (it holds the database files).

### Verification

- `npm test`: 15 files, 370 passed (28 new in `src/predict/predict.test.ts`); `tsc --noEmit` clean.
- New tests: ML core (learns, deterministic, probabilities sum to 1, AUC, Shapley efficiency), history correlations, split sizes and three algorithms per task, training twice identical, supplier A/B/C scenario, priority behaviour, V-1001 high criticality, INV-7781 predictions (High exception, price cause evidence-supported by the C-22 amendment), all 25 demo documents and all 650 invoices have predictions, evidence rule, reproducibility, outage gives a clear 503 message.
- Live check: the new pages and the invoice page return 200 on real data; REST suppliers endpoint works.

### What is left

- No browser visual check of the new pages, especially narrow width. Do this before the demo.
- Supplier A/B/C figures from the spec are reconstructed, not copied.
- Weights, thresholds and the 21-day on-time lead assumption are labelled assumptions; tune with the team.
- GenAI declaration: Claude Code (Anthropic) wrote this code; members must be able to explain it.

## Stage 7: Payment Readiness Passport + Process-Mining Twin (2026-11-12)

### Audit of existing work (done before building)

| Item | State found | Action |
|---|---|---|
| 1. Supplier-facing passport (milestones, blockers, pending actions, days to due, at-risk) | **missing** (supplier area only had the invoice list and payment chat) | `src/plantpay/passport.ts`, `/supplier/passport`, `/supplier/passport/{id}`, staff preview `/plantpay/invoices/{id}/passport` |
| 1. Restricted view and leak test | **missing** | Allow-list construction plus 7 leak tests (see below) |
| 2. Reconstruct paths from workflow_events, expected path, time spent, bottlenecks, loops, exception delay, complexity | **missing** (`workflow_events` and seeded loops from Stage 2 existed; nothing read them) | `src/plantpay/processMining.ts`, `processService.ts`, page `/plantpay/process` |
| 2. Flow diagram and variants table | **missing** | Inline-SVG `FlowDiagram.tsx`, variants table on the page |
| 2. Rework loop for the hero invoice | **missing**: INV-7781 had only 2 events (received, assigned to Finance), so no loop could appear | Hand-written hero history in `history.ts` (see Decisions) |

### Decisions

- **Stack**: Next.js, not Streamlit/FastAPI (CLAUDE.md locks the stack; same decision as Stages 1 to 6). The process twin is the page `/plantpay/process`.
- **INV-2044 does not exist.** The hero invoice is INV-7781 (as in Stages 3, 4, 6). The "rework loop must appear for INV-2044" requirement is met for INV-7781.
- **Restricted means allow-list, not block-list.** `buildPassport` assembles the passport field by field from a few safe inputs. Every sentence comes from a fixed template in `passport.ts`; nothing the engine wrote for staff (messages, root causes, evidence, suggested fixes, risk signals, scores, predictions, task titles, employee names, supplier names/ids/GSTIN/accounts) is copied. A check or warning the templates do not know becomes the generic "Additional verification ... You do not need to do anything unless we contact you." So duplicate, splitting, shared-account, bank-change, address and tax-ID flags all look the same to a supplier and say nothing about why.
- **Access**: the supplier route calls `loadSupplierPassport`, which returns nothing unless the signed-in user is a supplier and the invoice's vendor is theirs. "Not yours" and "does not exist" both give 404, so invoice numbers cannot be probed. Staff (clerk, approver) are redirected away from `/supplier/*` as before; they use the preview `/plantpay/invoices/{id}/passport`, which renders the same builder and component (nothing extra for staff).
- **Milestones**: Invoice uploaded, Invoice data extracted, Purchase order matched, Goods receipt confirmed (quantity, quality, weighbridge, inventory checks), Procurement confirmation (price, unit, tax, contract, arithmetic), Final approval (approval event; blocked by an additional-verification hold), Payment (payment event). States: done, in progress, needs attention, not started (words and symbols, not colour alone). A source outage shows "Waiting for records from the plant systems", never a failure.
- **Due date** = invoice date + the supplier's payment terms (Supplier DB; the 45-day default if none on file; not shown if the Supplier DB is down). **At risk** (assumption, constants in `passport.ts`): unpaid and past due; or due within 10 days with an item still blocking; or due within 5 days and not yet approved. Rule-based; the Stage 6 delay model is deliberately not shown to suppliers (it would be a risk score).
- **Pending internal actions** list the team and the action from the open tasks (templates only); "waiting since" is when the exception was raised in the event log (falls back to task creation).
- **Process reading**: a small state machine over events turns each invoice into time segments (waiting vs being worked) at stations: Intake, AP review (Finance until approval is requested), each department, Approval, Payment. Expected path: Intake → AP review → Approval → Payment. Loop = a station left and entered again (AP review → Procurement → AP review). Conformance: conforming, in progress on track, rework, extra steps. Open invoices are timed up to the demo "today" 18:00 and marked still open. Exception delay pairs `exception_raised` with the next `exception_resolved` of the same check (first in, first out); unresolved ones are counted to "today" and shown as still open. Complex = more than 6 stations or 2 or more loops. Per-visit targets (2 h, 24 h, 24 h, 48 h) are assumptions, labelled as such on the page.
- **Hero history**: INV-7781 now has a written story consistent with its open exceptions: AP flags the price, Procurement reviews and returns it (contract C-22 supports the invoice price, PO amendment pending), AP re-reviews and raises the receipt shortfall to Warehouse. Path Intake → AP review → Procurement → AP review → Warehouse, one AP → Procurement → AP loop.
- **Stage 2 seed bug found and fixed by this work**: `approval_granted` and payment events were dated from the Finance records, which for some invoices fell before the generated review events, so about 15 paths went Procurement → Payment → Procurement. Approval and payment now never precede the events before them (regression test: Payment is always the last station).

### Schema and interface changes

- No table changes. `workflow_events` seeded histories change for approved/paid invoices (times only, plus the hero invoice). Re-run `npm run seed:sources` (stop `next dev` first on Windows).
- New: `allWorkflowEventsByInvoice` in `workflowEvents.ts`; `HERO_INVOICE` exported from `history.ts`.
- New pages: `/supplier/passport`, `/supplier/passport/{id}`, `/plantpay/invoices/{id}/passport`, `/plantpay/process` (nav: "Payment readiness" for suppliers, "Process twin" for staff; links added on the invoice page).

### How to run

```
npm run seed:sources     # stop next dev first; rebuilds histories (hero loop, fixed ordering)
npm run dev
# supplier: sign in as vihar.supplier (Vihar@2026) -> Payment readiness -> INV-7781
# clerk: priya.clerk -> Process twin (hero overlay is selected by default), or an invoice page -> "Supplier view (payment passport)"
npm test                 # 403 tests
```

### Verification (2026-11-12)

- `npm test`: 16 files, 403 passed; `tsc --noEmit` clean. 33 new tests in `stage7.test.ts`.
- Passport tests: milestone order and states, blocker templates and teams, generic wording for risk and unknown checks, outage wording, paid and approved cases, every at-risk rule, due-date arithmetic, all 650 invoices (including the 25 demo documents) build a passport with 7 milestones, at most one current step and no placeholder text.
- **Restricted-view leak tests**: every key of every passport is on the allow-list; no passport contains any discrepancy message, root cause, evidence line, suggested fix, warning text, summary, prediction label, staff name, or any supplier's name, id, GSTIN or bank account number; no forbidden risk vocabulary (fraud, duplicate, splitting, shared, bank, score, probability, root cause...); risk-flagged invoices show only the generic item; a supplier can open only their own invoices (another supplier's looks the same as a missing one); staff roles and vendor-less suppliers get nothing from the supplier loader; a supplier's list never contains another supplier's invoice numbers; a stored result carrying risk, prediction and task data still yields an allow-listed passport.
- Process tests: path and time split, loop and detour time, exception pairing, open exceptions, in-progress paths, all 650 invoices rebuilt with no negative time, the AP → Procurement → AP loop for INV-7781 (also in the loops table, edges and variants), INV-7781's exceptions (price/Procurement open, quantity/Warehouse open), shares sum to 100 percent, determinism and caching.
- Live check against `next dev`: both pages return 200 for all 25 demo documents (no "undefined", "NaN" or "[object" in visible text); supplier Vihar sees INV-7781, Konkan gets 404 for it, a clerk is redirected away from the supplier route.
- Flaky under parallel load, pass alone: the OCR extraction timing test (known) and the model "training twice identical" test (timed out once in a full run).

### What is left

- No browser visual check of the new pages (HTTP and visible-text checks only). Check before the demo: the flow diagram at narrow width (it scrolls horizontally) and the 7-step milestone tracker on a phone.
- The seeded histories of the other 24 demo documents are short (received, assigned to Finance); only INV-7781 has a hand-written loop. The loops in the all-invoice analysis come from the seeded bulk histories.
- Exception-delay averages are inflated by old open exceptions in the seed data (shown separately as "still open").
- Passport thresholds, per-visit targets and complexity limits are labelled assumptions; tune with the team.
- GenAI declaration: Claude Code (Anthropic) wrote this code; team members must be able to explain it.

## Stage 9: Golden Journey (2026-11-12)

### Audit of existing work

| Item | State found | Action |
|---|---|---|
| Full suite before building | 403 of 403 passing | none needed |
| Guided story mode, stepper, presenter notes, timer, fallback, headless journey test | **missing** | Built (below) |
| All features the story shows (resolver, contract/inventory, 4 detectors, scores, models, passport, twin, audit, RAG) | **done** (Stages 1 to 7) | Reused unchanged; only `apply` in `simulate.ts` was exported |

### Decisions

- **Stack**: Next.js/TypeScript again (no Python). Page `/plantpay/journey` (nav: "Golden Journey").
- **Names**: INV-2044, ABC Chemicals, INV-1001/1001A, INV-3001..3003 do not exist. The story key on step 1 maps them to real demo records: hero INV-7781 (Vihar Chem Supplies), duplicate INV-6120R/INV-6120, splitting IG20/26-27/0910 to 0912 (Rs 2.90 lakh combined), bank change CB21/26-27/0908, shared account CM23/26-27/0909. Narration uses the real names.
- **One document, one sandbox**: `buildJourney` (src/plantpay/journey/build.ts) copies the six source DBs and the integration DB to a temp folder, runs the outage and restore, the PO/receipt/inspection fix, the approval and the tamper copies there, and returns all nine screens as JSON (about 1.3 s). The live data is never touched (tested by fingerprint), so Reset is simply "build again" and three runs are byte-identical. `GET /api/plantpay/journey` serves it (`?fail=1` forces an error for rehearsal).
- **Fallback**: `src/plantpay/journey/fallback.json` (regenerate with `npm run journey:fallback` after any reseed or retrain). The page uses it for the whole journey if the call fails or times out, and per screen if a screen's live data fails `validate.ts`. `?fallback=1` forces it. A banner says so.
- **Presenter notes** (`notes.ts`): nine scripts, 57 to 64 s each at 150 words per minute, 8:47 in total; the on-screen timer counts against 9:00. A test checks the facts the script quotes against the data.
- Controls: left stepper, Back/Next, arrow keys, Skip to step, Reset journey, Presenter notes toggle, pause timer, feature badges, closing checklist of 18 features, each quoting a fact from the run.
- vitest config: `oxc.jsx.runtime = automatic` so the screen render test can compile JSX (tsconfig keeps `preserve` for Next).

### How to run

```
npm run journey:fallback   # only when data changed
npm run dev                # sign in as priya.clerk, open Golden Journey
npm run test:journey       # the journey tests, three consecutive runs
```

### Verification

- `npm run test:journey`: 3 consecutive passes (30 tests each: 3 headless journey runs inside each, screen render for all 9 steps, fallback, timing, script facts). Full suite 432 of 433 on the first run; the one failure was the known timing-sensitive extraction test and it passes when run alone. `tsc --noEmit` clean.
- Real browser (headless Chrome against `next dev`): nine Next presses by arrow key, no console errors, no raw error text; notes, Back, skip, outage toggle, Reset, `?fallback=1` and `?fail=1` (auto fallback with banner) all work.

### What is left

- Rehearse with a human at normal pace; the 9-minute figure is an estimate from word counts.
- Step 5 shows the full RAG answer truncated at about 520 characters. Narrow-width layout (under 900 px) was only checked in CSS, not in a browser.
- GenAI declaration: Claude Code (Anthropic) wrote this code; members must be able to explain it.

## QA and crash-free demo pass (2026-11-13, before the live demo)

### Inventory (every page, route and feature the code declares)

Stack note: the QA brief names FastAPI and Streamlit; as in every stage, the app is Next.js + TypeScript (CLAUDE.md). "API endpoints" = Next.js route handlers and server actions; "Streamlit pages" = Next.js pages.

| Area | Items | State |
|---|---|---|
| Sign-in and roles | `/login`, `/`, `/no-access`, signed session cookie, 5 demo users | exists |
| Original workflow (T1 to T5) | `/supplier` (upload, extract, submit, chat), `/supplier/invoices/{id}`, `/clerk`, `/clerk/invoices/{id}`, `/approver`, `/approver/invoices/{id}`, `/audit`, `/audit/report`, `/dashboard` | exists |
| Stage 1 foundation | `/foundation`, `/foundation/invoices/{id}`, `/api/foundation/invoices[/{id}[/match, /result]]` | exists |
| Stages 1B to 7 PlantPay | `/plantpay`, `/plantpay/invoices/{id}` (+ `/exceptions`, `/passport`), `/plantpay/graph`, `/plantpay/predictions[/{id}]`, `/plantpay/suppliers[/{id}]`, `/plantpay/process`, `/plantpay/audit`, `/supplier/passport[/{id}]`, REST `/api/plantpay/v1/*` (16 endpoints) | exists |
| Stage 9 Golden Journey | `/plantpay/journey`, `/api/plantpay/journey`, pre-computed `fallback.json` | exists |
| Other APIs | `/api/health`, `/api/v1/invoices`, `/api/document`, `/api/extract`, `/api/supplier/invoices/{id}` | exists |
| Server actions | 19 (login, logout, reset, submit, chat, request fix, simulate ERP, release, reopen, duplicate decision, re-run match, approve, verify chain, outage toggle, process queue, re-evaluate, post GRN, record inspection, foundation match) | exists |
| Error, not-found and loading screens | none | **missing**: a server exception showed Next's blank "Application error". Added (see Fixed) |
| Stage 8 / Stage 10 | no section in this file | not inventoried as separate stages; everything the code declares is covered |

Brief names mapped to real records (as in earlier stages): INV-2044 = INV-7781; INV-1001A = INV-6120R; INV-3001/3002/3003 = IG20/26-27/0910 to 0912; ABC Chemicals / XYZ Traders shared account = Coimbatore Motors (V-1023, CM23/26-27/0909) and Kolhapur Castings (V-1015); bank change = CB21/26-27/0908.

### Smoke test (`scripts/smoke/smoke.ts`, `npm run smoke`)

Starts `next start` (production build) on a **copy** of `data/*.db` and `data/sources` in the OS temp folder. The team's files are never touched; the copy is selected with `PLANTX_DB_FILE`, `FOUNDATION_DB_FILE`, `PLANTPAY_INTEGRATION_DB` and `PLANTPAY_SOURCES_DIR`. It signs in each role with a session cookie and drives server actions over HTTP exactly as the browser does (`Next-Action` header, ids from `.next/server/server-reference-manifest.json`).

Groups: auth (12); staff, approver and supplier pages including every invoice in the clerk queue (84); all 25 demo documents x 6 pages plus supplier scores (175); unknown and XSS-looking ids (15); REST facade with valid and edge input: bad JSON, null/array bodies, wrong types, limits `abc`/`-5`/`0`, unknown ids (~150); other APIs including extraction of empty, text and corrupt files and path traversal (82); planted cases and the tamper script (12); supplier submission edge cases including an **all-zero invoice**, null payloads and strings for numbers (23); each of the six sources offline plus quality.db really missing (76); the original clerk/approver golden journey through real server actions x3 (24 each); the Stage 9 Golden Journey x3 (25 each: live build, all 9 screens validated, planted facts, live data untouched, forced failure); the fallback file; and a **clean clone** with no databases at all.

Every check is pass / fail / crash / timeout, plus slow (> 3 s). A page fails if its visible text contains undefined, NaN, [object, null, Infinity, a stack trace, SQLITE_/ENOENT or "Application error", or is near-empty.

### Results before fixes (776 checks): 763 pass, 4 fail, 9 crash, 0 timeout, 1 slow

- Crashes: REST `/ask` with a non-string question (500); `submitInvoice` with a null payload or a null line (500); supplier chat with null input (500); the Golden Journey API returned 500 whenever any of the six sources had been left offline in the live dashboard (the page then silently showed only the pre-computed copy).
- Fails: REST `GET /invoices/{unknown}` returned 404 without an `error` message. The other three were harness mistakes (short `/no-access` page, approver page tested with the clerk role, a tamper record number from an older dataset), corrected in the harness.

### Fixed (priority order)

1. **Crashes**
   - REST facade: one `jsonBody()` reader. Null, array, string or invalid JSON bodies become `{}` and get a 400 with a readable message. `/ask` checks the question is a string (capped at 500 chars); `/simulate` requires `all: true` or a non-empty string id; `/audit?limit=-1` no longer returns every row (clamped to 1 to 500).
   - `submitInvoice` and `askPayment` reject non-object payloads and null lines with a message instead of throwing.
   - The Golden Journey sandbox clears demo outage flags on its copy, so a source left offline in `/plantpay` no longer forces the whole journey onto the fallback. Step 3 still takes Logistics offline itself, and the live switch is untouched (tested).
   - Safety net: `src/app/error.tsx` (friendly card, Try again, reference code, no stack trace), `src/app/global-error.tsx`, `src/app/not-found.tsx` (styled, links back). Before this, any unexpected server error during the demo gave a white "Application error" page.
2. **Junk data from wrong ids**: `PlantPayEngine.evaluate()` stored an "incomplete" evaluation (plus audit and workflow events) for any id it could not read. Opening `/plantpay/invoices/TYPO`, or calling the REST invoice or evaluate endpoint with a wrong number, added a row that inflated the `/plantpay` and journey step 1 counts. Now nothing is stored when there is no invoice record. That covers an unknown id, and Finance offline, where the last good result is also kept instead of being overwritten. A REST unknown invoice returns 404 with `error`. Event processing keeps an invoice event queued while Finance is offline and re-matches the invoice when Finance returns (the Stage 1B promise, now tested).
3. **Wrong results**: none found. All planted cases give the expected answer (see Verification).
4. **Performance**: every page and API on the production build answered in under 3 s (largest: journey build 0.7 to 2.6 s, extraction about 2 s). Only the first request on a clean clone is slow (6 to 10 s) because the app seeds itself; `npm run setup` does that before the demo.
5. **Fallback**: the journey page already switched to `fallback.json` when the live call fails, times out (30 s) or a step's data is incomplete. Added `ScreenBoundary.tsx`: if a screen throws while drawing live data, that step is redrawn from the pre-computed copy; if that also fails, a short message with Next/Reset is shown. Other pages show stored results during outages (verified for all six sources).

New npm scripts: `setup` (seed everything and train), `demo` (production build and start), `smoke`.

### Verification

- Planted cases (smoke, live server): INV-7781 root cause "Contract amendment not reflected in the PO", ₹412.00 / ₹398.00, supported by evidence, counterfactual "assuming all other checks pass"; INV-6120R blocked as a copy of INV-6120; IG20/26-27/0910, 0911 and 0912 each flagged for splitting; CM23 graph link to Kolhapur Castings, worded "warning, not proof", no accusing words; CB21 bank change flagged with independent verification; INV-7782 passes; audit chain intact; tamper script detects all 5 attacks (edit, delete, swap, workflow-row delete and edit).
- Original workflow journey x3 (supplier extracts and submits INV-7781, Flag, two fixes requested, two simulated ERP updates, clean, Approver L1 approves, audit verified, dashboard, INV-6120R, chatbot, controls report): 24/24 each run.
- Stage 9 Golden Journey x3: 25/25 each run, live mode, live INV-7781 still Review afterwards; forced failure returns a JSON error and the page switches to the fallback; `fallback.json` passes every screen check.
- New `src/plantpay/qa.test.ts` (9 tests): unknown ids store nothing; Finance offline keeps the last result; an invoice event stays queued while Finance is down; the journey builds live with each of the six sources left offline.
- Full unit suite: 442 tests, 439 passed in the parallel full run. The 3 failures are timing under parallel load and pass when run alone: the OCR extraction time budget (known flaky since Stage 1), and journey "same story" / "finishes in a couple of seconds" (33 s against a 30 s budget while another seeding test ran). Run alone: `journey.test.ts` 20/20, `qa.test.ts` 9/9.
- `tsc --noEmit` clean; `npm run build` clean.
- **Final regression smoke run (after all fixes, fresh production build): 782/782 pass, 0 fail, 0 crash, 0 timeout, 0 regressions** (before: 763/776). Both journeys ran three times in a row without an error. Slow but passing: server start (5.5 s), the very first page after start (`/login`, 4.7 s, cold start), and the clean-clone self-seed (6 to 23 s depending on machine load). **Before the judges arrive: run `npm run setup`, start the server, and open `/login` once to warm it up.**

### Known remaining limitations (honest list)

- This pass used no browser; pages are checked by HTTP status and server-rendered text. Client-only behaviour (chart drawing after hydration, graph drag, narrow width) is not visually verified here (Stage 9 did a headless Chrome pass of the journey). Do one manual click-through of `/plantpay/journey` and the clerk flow on the demo laptop.
- `ScreenBoundary` cannot be exercised by server rendering; it is type-checked, not runtime-tested.
- `notFound()` inside a dynamic page returns a 404 shell whose card is drawn in the browser from the RSC payload (Next 15 streaming); the smoke test checks the card text is in the payload.
- The session secret falls back to a hard-coded demo value if `SESSION_SECRET` is unset (acceptable for synthetic data, not for production).
- `npm run dev` compiles each page on first visit (several seconds). Present from the production build (`npm run demo`).
- The OCR timing test and the journey timing tests can fail on a loaded machine.
- Stages 8 and 10 have no section in this file.

### Start fresh from a clean clone

```
git clone <repo> && cd <repo>
npm install
npm run setup          # app store seed, foundation.db, trains the 4 models, six source DBs + integration DB (about 1 minute)
npm run demo           # production build, then next start on http://localhost:3000
# sign in: priya.clerk / Clerk@2026 -> /plantpay/journey (Golden Journey); neha.approver / ApproverL1@2026; vihar.supplier / Vihar@2026
npm test               # unit tests (re-run a timing failure alone)
npm run build && npm run smoke -- --label check   # full smoke test against a copy of the data
```
If `setup` fails with EBUSY on Windows, stop any running `next` process first (it holds the database files). Skipping `setup` also works: the app seeds itself on the first request (6 to 10 s, once).

## Round 2 primary-goals audit (2026-11-13, 05:30 to 05:45)

Every line of the LYB Round 2 brief checked against the code. Stack note as before: the brief names FastAPI/Streamlit/scikit-learn; the app is Next.js + TypeScript (CLAUDE.md). Brief names map to the existing demo records: ABC Chemicals = Vihar Chem Supplies, INV-2044 = INV-7781 (₹412 vs PO ₹398), INV-1001A = INV-6120R.

| Check | State | Where |
|---|---|---|
| Plant X used throughout | done | layout title, login hero, AppShell, `PLANT.name` in report |
| Home/login states the three problems (mismatch, duplicates, missing approvals) | **missing, fixed** | one paragraph added to the login card (`LoginForm.tsx`, `.why`) |
| Upload PDF/image, real extraction | done | `/supplier` UploadFlow (pdf, jpeg, png), `/api/extract` (text layer + OCR) |
| Auto check vs PO and GRN on submit | done | `submitInvoice` -> `matchInState` -> `src/engine/match.ts` |
| Exactly approve / flag / block with a readable reason | done | `Verdict` type; finding messages such as "Price ₹412.00 is 3.5% above PO ₹398.00" |
| 1a-c three roles, separate views, click-to-fill demo logins | done | `src/lib/users.ts`, role layouts, demo accounts table on `/login` |
| 2a-c six fields extracted, editable, confirm before submit | done | "Check the extracted fields" -> "Confirm and submit invoice" |
| 3a-d invoice vs PO vs GRN, one verdict, clear reason on detail and dashboard | done | clerk review page, `/dashboard` table "Issues" and "Root cause" |
| 4a-e thresholds (clerk up to ₹1 lakh, L1 up to ₹15 lakh, L2 above), approver queue, approve/reject/send back with comment, audit who/role/time/outcome/comment, hash chain | done | `src/lib/workflow.ts`, `/approver`, `/audit` + Verify |
| 5a-d dashboard by type, supplier, age; supplier sees only own invoices | done | `/dashboard` (By type, By age, By supplier, age badge per row), `/supplier` |
| B1-B2 duplicates caught with reason before approval | done | duplicate rule blocks INV-6120R ("Confirmed duplicate of INV-6120 ...") |
| B3-B4 "Where is my payment?" chatbot on live data | done | `src/lib/chatbot.ts` reads the store; supplier page PaymentChat |
| B5-B6 controls report | **partial, fixed** | had processed, exceptions, duplicates, audit; added **approvals by role** (AP clerk / L1 / L2) to the thresholds line in `src/lib/controls.ts` |

### Judge demo path (10 steps)

All PASS on the production build via `scripts/smoke` group `workflow-run1..3` (24/24 each): login and roles; supplier extracts and submits INV-7781; verdict flag with ₹412 / ₹398 on the clerk page; clerk requests fixes, simulated ERP updates, re-match clean, routed to Approver L1; L1 approves; audit trail records it and chain verifies; dashboard; supplier sees "internal action pending" wording, not internal notes; duplicate INV-6120R; chatbot answers "Where is my payment for INV-7781?"; controls report renders.

Design note kept on purpose: a flagged invoice is not sent to the approver with its findings open. The clerk raises fixes, the owners correct the records, the invoice is re-matched, and only a clean match reaches the approver. Rules decide; people approve.

### Verification

- `tsc --noEmit` clean; `npm run build` clean; t5/workflow/session tests 41/41.
- Full smoke on a fresh production build: **782/782 pass, 0 fail, 0 crash, 0 timeout** (5 slow but passing: cold start, clean-clone self-seed, first journey build).

### What is left

- The reason text reads "Price ₹412.00 is 3.5% above PO ₹398.00", not literally "Price mismatch: invoice ₹412 vs PO ₹398". It was not reworded because tests assert the engine strings exactly.
- No browser click-through in this pass; do one on the demo laptop after `npm run setup` and `npm run demo`.

## UI beauty pass (2026-11-13, 05:40 to 06:15)

Brief: "Prompt B, UI beauty pass" (written for Streamlit). Stack note as before: the app is Next.js + CSS Modules, so the "shared style.py / CSS injection" became the token sheet `src/styles/tokens.css`, which every page already reads. Work was limited to low-risk styling because it ran into the 06:00 code freeze. No logic, data or engine code changed.

### Step 1: design audit (before, light theme, screenshots at 1440px)

| Page | What looked unprofessional |
|---|---|
| `/login` | Condensed all-caps hero type felt like a poster, not a product. |
| `/clerk`, `/dashboard`, `/approver`, `/supplier` | Already polished, but gradient status pills and an indigo glow looked decorative rather than enterprise. |
| `/plantpay` (control tower) | Diagram column headings overlapped ("SOURCE SYSTEMS (one SQLite file each)" ran into "SECURE INTEGRATION LAYER"); plain 6px boxes and default grey buttons, unlike the rest of the app. |
| `/plantpay/invoices/{id}/exceptions` | Wall of text: root cause, counterfactual and correction all looked the same. |
| `/plantpay/predictions`, `/plantpay/suppliers` | Unstyled tables: no header band, no row shading, small tags. |
| `/plantpay/graph` | Default node colours on a white box; edges hard to read. |
| `/plantpay/process`, `/plantpay/audit`, `/foundation` | Same second, plainer style as the engine pages; tables overflowed at 900px. |
| `/supplier/passport/{id}` | Fine structure; colours tied to the light theme. |
| `/plantpay/journey` | Good structure; mixed light-theme hex colours in its stylesheet. |

### Step 2: design system (implemented once)

- `src/styles/tokens.css` now holds the brief's dark palette under the existing token names, so every stylesheet picks it up: background #0D1117, surface #161B22, border #30363D, accent #2F81F7, text #E6EDF3 / #8B949E, pass #3FB950, warning #D29922, fail #F85149. New tokens: `--surface-2`, `--row-alt`, `--ok-ink`, `--bad-ink`, `--warn-ink`.
- Type: Inter if installed, then Segoe UI / system-ui (no new font download, so it works offline at the venue). 24px bold h1, 15px body (16px made the dense finance tables wrap too much), 12 to 13px captions and badges. Removed all-caps condensed headings.
- Cards: 12px radius, 1px #30363D border, 20px padding, soft shadow (`.panel`, `.src`, `.tile`, `.disc`, `.evBox`).
- Badges: pill-shaped, tinted fill + coloured text + border. PASS/approve green, REVIEW/flag amber, BLOCK red, pending/skipped grey. Shape cue (dot, diamond, square, hollow) kept so meaning never relies on colour alone.
- Tables: a shared rule in tokens.css gives every table in `main` a sticky header band, alternating row shading and a hover tint. Number columns were already right-aligned with Indian comma grouping and ₹.
- Charts and graph: dashboard age bar uses a blue ramp; relationship graph has a dark radial background, blue vendors, amber bank accounts, green addresses, red outline on unconfirmed shared-account nodes.
- Sidebar: near-black rail; the active item has an electric-blue inset bar, tint and glowing dot.
- 60+ hard-coded light-theme colours replaced with tokens (sed across 7 module stylesheets, plus `Charts.tsx`, `GraphView.tsx`, `global-error.tsx`).

### Step 3: page changes made

- Exception detail: root cause sits in an amber alert box with an icon. If a cause is not backed by evidence, the cause text itself is in amber italics next to the "unverified prediction" tag. The counterfactual is a green block headed "What would make this pass". Responsible and correction lines are quieter.
- Control tower: diagram heading overlap fixed ("6 SOURCE SYSTEMS"); six source cards in a 3×2 grid (2 columns under 1100px, 1 under 640px) with glowing status dots; KPI tiles enlarged.
- Login: blue/green hero, sentence-case wordmark.

### Brief items NOT done in this pass (left on purpose: code freeze, each is a component rewrite with demo risk)

Invoice row side drawer; supplier score arc gauges; prediction probability bars; audit trail vertical-timeline redesign of `/audit` (the PlantPay audit list got timeline dots); passport milestone circles and countdown chip; Sankey diagram; 2-second step transitions, slide-in presenter panel and animated closing checklist in the Golden Journey; skeleton loaders; new KPI tiles (processed today, payment at risk, avg resolution time).

### Steps 4 and 5: consistency and performance

- Headless Chrome screenshots of 20 pages at 1440px and 900px (CDP script, forged demo session like smoke). At 900px every page now fits with no horizontal page scroll. Wide tables scroll inside their own box under 1100px, and the evidence grid no longer overflows. No browser JS errors on any page.
- Load time (production build, navigate to load complete): every page under 1 s, except `/plantpay/predictions` at about 2.2 to 2.4 s right after a server start. The Journey shows "Preparing the journey from the six systems..." while its first build runs. Warm up both before judges arrive.

### Verification

- `tsc --noEmit` clean, `npm run build` clean (the only warning is an existing autoprefixer note on `align-items: end` in Foundation.module.css).
- Unit tests: 438/442 in the full parallel run; the 4 failures (db append-only, state import, INV-6120R OCR timing, workflow-events date) all pass when re-run alone (18/18, 1/1), so they are load/timing flakes, not regressions.
- Full production smoke (`npm run smoke -- --label uibeauty`): **782/782 pass, 0 fail, 0 crash, 0 timeout**, same as the Round 2 baseline. 3 slow but passing: clean-clone self-seed 7.1 s, journey with procurement offline 6.5 s, `/plantpay/predictions` 4.8 s under smoke load (the 2-second target is not met for that page on a cold or busy server; it is fine once warm).

### Presenter one-liners (for DEMO.md)

- Login: Plant X Payables Desk; one card states the problem, demo accounts click to fill.
- Invoice queue (clerk): every open invoice, oldest first, with verdict pill, root cause, owner and age.
- PlantPay engine: control tower; architecture, six live source systems, demo documents with decisions.
- Exception resolution: each problem with root cause, evidence by source, owner, and what would make it pass; then simulate the fix.
- Predictions: four trained models give foresight; causes are unverified unless a record backs them.
- Supplier scores: strength, criticality and risk kept separate; scores order review work, not payments.
- Relationship graph: shared bank accounts and addresses as warnings for a person, not accusations.
- Process twin: actual vs expected invoice path, where time goes, rework loops.
- Exceptions dashboard: by type, age and supplier, with the upstream fix that clears the most cases.
- Audit trail and controls report: hash-chained events, verify in one click; six controls in one report.
- Supplier view: own invoices only; the payment readiness passport says what is holding payment and when it is due.
- Golden Journey: the nine-step guided story with presenter notes.
