# 14 Smart Procure-to-Pay — Innovation Discovery & Differentiation

**TL;DR**
- **Recommended signature innovation: "Root-Cause Resolver"**: for every exception the app works out *why* it happened and *who must fix it* (not just *what* mismatched), using extra evidence (contract price, delivery note, PO change history, unit conversions). It then states the **smallest change that would make the invoice pass** and routes it to that owner. Recurring root causes become upstream fix tasks.
- Why: exceptions mostly originate upstream and only 43% of surveyed organisations track them formally [R1]. Root cause is deterministic, explainable, demo-safe, and strengthens mandatory items 3, 4 and 5.
- **Correction to my earlier comparison [12]:** SAP Ariba Network already validates supplier invoices against buyer rules at submission and auto-rejects failures [R5]. A "supplier pre-submission check" is therefore *not* an innovation. I've corrected file 12.
- 30 concepts scored. Two pass my strict "potentially game-changing" rule (counterfactual explanation 77, tolerance simulator 76), but both rest on my subjective originality score and unverified novelty.
- The space is crowded: vendors already claim AI exception agents, anomaly detection and duplicate analytics [R3, R4, R8, R9]. Differentiation must be argued precisely, never as "nobody does this".
- Tags: [VERIFIED] sourced · [INFERRED] · [ASSUMPTION] · [REC] my recommendation. Source IDs: R# at bottom; P# = research/11_sources.md; D = dossier.

## 1. Executive summary
Conventional P2P automation answers *"does it match?"*. The evidence says the expensive part is *"why doesn't it, and who fixes it?"* Common causes are price/quantity discrepancies, no valid PO and goods not received [R1]. Stale PO prices (e.g. a contract amendment never loaded into the PO) and unit-of-measure differences create variances that bounce between AP, buyers and receiving [R2, R3]. The Root-Cause Resolver adds a reasoning step between matching and routing: it compares more documents, names the root cause and owner, gives a one-line counterfactual fix, and aggregates repeats into upstream fixes. Humans approve, pay and change master data; the app never does.

## 2. Enterprise P2P landscape
Lifecycle (15 stages) is mapped in [05](05_current_process_and_systems.md). Product capabilities (mostly vendor-reported):
| Product | Documented capabilities | Exceptions / prediction | Source quality |
|---|---|---|---|
| SAP Ariba Network | Validates invoices against buyer-configured rules at submission; auto-accept/auto-reject/manual tolerances at header and line level; rejection reasons visible to supplier [R5] | Rule-based | Official support/learning [VERIFIED] |
| SAP S/4HANA | Tolerance keys, payment blocks, duplicate invoice check [P6, P7]; continuous controls monitoring of master data, approvals, SoD via GRC (glossary-level) [R10] | Rule-based | Official + secondary |
| Coupa | Tolerance rules, workflows, routing; exception triggers include price, qty, missing PO, tax, duplicates [R3 glossary] | AI claims unverified | Third-party |
| HighRadius | Anomaly detection on irregular amounts/vendor mismatches; 2/3-way match; GenAI to explain flagged items [R8] | Claimed | Vendor |
| Basware, Esker, Tipalti, Oracle, UiPath | AI capture, touchless workflows (Esker); case studies in [06](06_industry_benchmarks.md) | Data unavailable | — |
| Xelix (duplicate specialist) | Claims S/4HANA native duplicate controls are insufficient; multi-data-point duplicate detection [R9] | Claimed | Vendor (sales) |
| "AI agent" vendors (Medius, Peakflo, others) | Classify exception, search related records, auto-resolve minor variances; "70–80% autonomous" claims [R3, R4] | Claimed | Vendor marketing, unverified |
**Verified gaps: none.** I found no reliable document showing any product lacks root-cause inference, counterfactual fixes or tolerance simulation. Treat novelty as "[UNKNOWN] — not publicly demonstrated in sources found".

## 3. Deepest stakeholder pain points
| Stakeholder | Pain | Root cause | Workaround | Consequence | Unmet need → opportunity | Tag |
|---|---|---|---|---|---|---|
| AP clerk | Exceptions dominate effort | Upstream data problems [R3] | Email/phone chasing [ASSUMPTION] | Delay, month-end pressure | Know cause + owner instantly → Root-Cause Resolver | [VERIFIED-vendor] |
| AP clerk | False variances | UoM each/case/pallet [R2] | Manual conversion | Wasted time | Auto-normalise UoM | [VERIFIED-secondary] |
| AP clerk | Duplicates slip through | ERP check has gaps [P7, R9] | Manual search | Duplicate/erroneous payments 0.8–2% of disbursements (APQC via Corpay) [R6] | Multi-signal fingerprint | [VERIFIED-secondary] |
| Procurement | Price disputes | Contract amendments not loaded into POs [R3] | Ad-hoc PO edits | Repeat exceptions | Contract-aware match + upstream fix | [VERIFIED-vendor] |
| Procurement | Supplier calls about payment | AP is status-only; buyers are primary contact [P2] | Ask AP | Lost time | Supplier-safe status → Passport | [VERIFIED] |
| Approver | Approves without context | Evidence scattered | Trust the clerk | Accountability risk | Evidence card | [INFERRED] |
| Approver | Threshold avoidance | Splitting just under limits is a known red flag [R7] | Periodic audit | Control gap | Threshold-split detector | [VERIFIED-secondary] |
| Supplier | Unexplained rejection / no status | Status hidden; 24–48 h query response [P2] | Repeated follow-ups | Friction, late payment | Plain-language status + "nothing needed from you" | [VERIFIED] |
| Auditor/controller | Tracing decisions | Manual evidence | Sampling | Findings | Evidence pack, tamper-evident trail | [INFERRED] |
| Controller | Tolerances set by gut feel | No what-if view | Static config | Over/under-control | Tolerance simulator | [ASSUMPTION] |
| All | Exceptions not tracked | Only 43% track formally [R1] | None | Same causes recur | Root-cause trend + upstream fix loop | [VERIFIED-survey] |
Frequency at LYB: Data unavailable — requires mentor validation. No LYB employee experiences are invented.

## 4. Innovation concepts (30), scored
Weights: Originality 20 · Value 20 · Feasibility 15 · Control/risk value 15 · Differentiation 10 · Demo 10 · Scalability 5 · Explainability 5. Scores 0–10 in that order; totals computed by script; all subjective [ASSUMPTION]. **Class rule:** <55 Incremental improvement; 55–64 Meaningful differentiator; 65+ Strong innovation; Potentially game-changing only if total ≥75 **and** originality ≥8. U = unconventional.
| # | Concept | Scores | Total | Class |
|---|---|---|---|---|
| 1 | **Root-Cause Resolver**: cross-document evidence → root cause + owner + minimal fix | 7/9/8/8/7/9/8/9 | **80** | Strong innovation |
| 5 | Counterfactual explanation: smallest change that makes it pass (U) | 8/8/7/7/8/8/7/9 | **77** | Potentially game-changing* |
| 3 | **Payment Readiness Passport**: live blocker checklist vs due date, supplier-safe view | 6/9/8/7/6/9/8/9 | **76** | Strong innovation |
| 4 | **Tolerance & threshold what-if simulator** (U) | 8/7/7/8/8/8/7/8 | **76** | Potentially game-changing* |
| 2 | Upstream-fix loop: recurring root cause → fix task → did recurrence stop? | 7/8/7/8/7/7/8/8 | 74 | Strong innovation |
| 10 | Contract-aware matching (contract as 4th document) | 6/8/7/8/6/7/8/8 | 72 | Strong innovation |
| 6 | Multi-signal duplicate fingerprint | 4/8/8/9/4/8/8/8 | 70 | Strong innovation |
| 13 | Approver evidence card | 5/8/8/7/5/8/7/8 | 69 | Strong innovation |
| 23 | Process-mining twin of invoice flow (U) | 8/7/5/6/7/8/8/7 | 69 | Strong innovation |
| 9 | Relationship graph: vendor–bank–address–approver (U) | 8/7/4/8/7/7/7/6 | 68 | Strong innovation |
| 7 | Threshold-splitting detector | 5/7/8/8/5/8/7/7 | 68 | Strong innovation |
| 17 | Supplier exception coaching scorecard | 6/7/8/6/6/7/8/8 | 68 | Strong innovation |
| 20 | Tamper-evident (hash-chained) audit trail | 5/6/8/8/5/7/7/9 | 66 | Strong innovation |
| 22 | Auto audit evidence pack / controls report | 4/7/8/8/4/7/8/9 | 66 | Strong innovation |
| 19 | Resolution memory: how similar exceptions were resolved (U) | 7/7/6/6/6/6/7/7 | 65 | Strong innovation |
| 21 | Segregation-of-duties conflict monitor | 4/7/8/9/3/6/8/9 | 65 | Strong innovation |
| 12 | Field provenance + confidence-gated extraction | 5/7/7/6/5/8/7/9 | 64 | Meaningful differentiator |
| 28 | Price-drift anomaly vs history/contract | 5/7/7/7/5/7/8/7 | 64 | Meaningful differentiator |
| 8 | Vendor master red flags (bank change, shell signals) | 4/7/7/9/4/6/8/7 | 64 | Meaningful differentiator |
| 11 | Partial-delivery & UoM reconciliation | 4/8/7/7/4/6/8/8 | 63 | Meaningful differentiator |
| 25 | GST e-invoice (IRN) & tax-rate validation | 5/7/7/7/5/6/6/8 | 63 | Meaningful differentiator |
| 27 | Supplier pre-submission validation (**Ariba already does this** [R5]) | 3/8/8/7/2/7/8/8 | 62 | Meaningful differentiator |
| 18 | Agent-drafted resolution messages; human sends (U) | 6/7/6/5/5/7/7/6 | 61 | Meaningful differentiator |
| 24 | Early-payment discount / working-capital optimiser | 6/7/6/4/5/6/7/7 | 59 | Meaningful differentiator |
| 14 | Approval-delay prediction from queue ages | 5/6/6/5/4/6/7/6 | 55 | Meaningful differentiator |
| 16 | Ledger-grounded "Where is my payment?" assistant | 3/7/7/4/3/8/7/6 | 54 | Incremental improvement |
| 26 | Self-learning classification from clerk overrides | 6/6/4/5/5/5/7/5 | 54 | Incremental improvement |
| 30 | Multi-layout / multilingual LLM extraction | 3/7/6/5/2/7/7/5 | 52 | Incremental improvement |
| 15 | ML payment-delay / resolution-time prediction | 5/6/4/5/4/6/7/4 | 51 | Incremental improvement |
| 29 | Month-end workload forecast | 4/5/6/3/3/5/7/7 | 46 | Incremental improvement |
\*The "game-changing" label depends on my originality score of 8, and their novelty in products is unverified. Read it as "highest originality on my scale", not a fact. Six unconventional concepts (U) are included. OCR, chatbots, dashboards and plain 3-way match are table stakes, not innovation. Anomaly flags (#7, #8, #9, #28) are **review prompts, never fraud findings** [R7].

## 5. Ten biggest innovation gaps
| # | Existing practice | Limitation | Unmet need | Opportunity |
|---|---|---|---|---|
| 1 | Match result = "price variance" | Says *what*, not *why* or *who* | Root cause + owner | Root-Cause Resolver |
| 2 | Route by exception type (price → procurement) [R3] | Wrong owner when the supplier, not the PO, is wrong | Evidence-based owner | Compare PO vs contract vs invoice |
| 3 | Exceptions resolved one by one | Same cause recurs; 57% don't track formally [R1] | Fix at source | Upstream-fix loop |
| 4 | Explanations list failed checks | Users don't know the fix | Actionable explanation | Counterfactual "passes if…" |
| 5 | Static tolerances | No view of the trade-off | Evidence-based tuning | Tolerance simulator |
| 6 | Supplier sees "rejected/pending" | No reason or owner; queries to buyers [P2] | Plain status | Payment Readiness Passport |
| 7 | Duplicate check on exact fields | Misses changed numbers/layouts [P7, R9] | Robust detection | Multi-signal fingerprint |
| 8 | Approval limits on paper | Splitting under limits [R7] | Control analytics | Threshold-split detector |
| 9 | Audit evidence assembled manually | Slow, sampling | Continuous evidence | Evidence pack + tamper-evident log |
| 10 | UoM/partial deliveries cause false variances [R2] | Noise in queue | Normalisation | UoM/partial reconciliation |
Why the gaps persist [INFERRED]: tools optimise straight-through rates and stop at the variance; root cause needs documents (contracts, delivery notes, PO history) that sit in other modules. All ten are demonstrable with fictional data; #5 and #3 need synthetic history.

## 6. Top three candidates
### 1. Root-Cause Resolver (80; absorbs #5 counterfactual and feeds #2 upstream loop)
- **Concept and problem:** Explains each discrepancy as root cause → owner → minimal fix. It solves exceptions bouncing between teams.
- **Stakeholders:** AP clerk, buyer, warehouse, supplier, approver.
- **How it works:** Compares the invoice line with the PO line, cumulative GR, contract price, delivery note, PO change log and UoM table. Deterministic rules then produce one verdict per line.
- **Required data (synthetic):** POs, GRs, contracts, delivery notes, UoM factors, PO change history.
- **Logic:** see the §7 table.
- **What's different:** answers who and why, plus the one-line fix.
- **Value:** less ping-pong, faster resolution, cleaner upstream data.
- **Financial impact:** hours, fewer late payments (illustrative only, §10).
- **Feasibility:** high, since it's rules on structured data.
- **Limits:** needs the extra documents, and real-world data quality varies.
- **Control risks:** must not auto-edit POs or approve. It only suggests.
- **Demo:** §9.

### 2. Payment Readiness Passport (76)
- **Concept and problem:** A live checklist of everything between an invoice and its payment (extracted, matched, GR, approvals, due date). It flags "at risk" when blocker age plus remaining steps exceed the time to due date. The supplier sees a redacted version.
- **Problem it solves:** "Where is my payment?" queries.
- **Logic:** deterministic.
- **What's different:** status plus blockers plus owner; it feeds the chatbot bonus without free-text guessing.
- **Limits:** less novel, since portals already show status [R5]. Value depends on accurate due dates and payment terms (45/60-day regional terms [P4, P5]).
- **Control risks:** must not leak internal names or reasons to suppliers.

### 3. Tolerance & Threshold Simulator (76)
- **Concept and problem:** Replays history under different price/qty tolerances and approval thresholds. It shows auto-approved count, value passing without review, workload, and invoices that would have changed outcome. It solves "tolerances set by gut feel".
- **Stakeholders:** controller, AP manager, auditor.
- **What's different:** turns controls into a decision tool.
- **Limits:** needs history (synthetic in the demo), so it can look abstract to non-finance judges.
- **Control risks:** it must not change live settings without an approval and an audit trail.

**Signature = Root-Cause Resolver [REC].**
- It has the most value for the most users.
- It is fully deterministic, so it's reliable on stage.
- It explains itself in one line to non-technical judges.
- It plugs straight into mandatory items 3 (reason), 4 (routing to the right approver or owner) and 5 (dashboard by root cause, supplier view).
- It preserves controls: it suggests, and humans act.
- Adoption path: it uses documents ERPs already hold, so it's a plausible later integration.
- Passport and Simulator are strong secondaries. Passport works as the supplier-facing surface of the Resolver, and Simulator is a stretch goal.

## 7. Signature innovation in detail
**One sentence:** For every invoice exception, the app tells you why it happened, who must fix it, and the smallest change that would make it pass, and learns which causes keep coming back.

**Paragraph:** Matching finds variances; the Resolver explains them. It pulls in the supporting evidence a human would chase (contract terms, delivery notes, PO change history, unit conversions) and applies transparent rules to classify each line's root cause. It assigns the owner who can actually fix it and phrases a counterfactual ("passes if PO line 1 price = ₹412 per contract amendment C-22"). Root causes are logged, so the dashboard shows *sources* of exceptions, not just counts. When a cause repeats, it proposes an upstream fix task, such as updating 7 POs to the amended contract price. Every step lands in the audit trail.

**Root-cause rules (deterministic; tolerances are [ASSUMPTION] and configurable):**
| Symptom | Evidence test | Root cause | Owner | Counterfactual fix |
|---|---|---|---|---|
| Price variance | Invoice price = contract price ≠ PO price | PO not updated after contract change | Buyer | Amend PO price to contract |
| Price variance | Invoice ≠ contract and ≠ PO | Supplier billed off-contract | Supplier | Credit note / corrected invoice |
| Qty variance | Invoice qty ÷ GR qty = UoM factor | Unit-of-measure mismatch (not a real variance) | Master data / buyer | Normalise UoM |
| Qty variance | Invoice = delivery note > GR | Receipt under-posted or pending | Warehouse | Verify and post GR |
| Qty variance | Invoice > delivery note = GR | Billed for undelivered qty | Supplier | Corrected invoice |
| Missing GR | Delivery date passed | GR not posted | Warehouse | Post GR |
| Missing GR | Delivery date in future | Billed before delivery | Supplier (hold) | Resubmit after delivery |
| Extra line | Freight/surcharge not on PO | Unplanned charge | Buyer decides | Approve via PO change or reject |
| Duplicate fingerprint | Same vendor + amount + date window + similar number | Possible resubmission | AP clerk confirms | Reject one copy (human) |

- **User experience:**
  - Supplier: sees "2 internal actions pending, nothing needed from you", or a precise fix request.
  - AP clerk: a queue grouped by root cause and owner, not by symptom.
  - Buyer/warehouse: receive only items they can fix, with evidence attached.
  - Approver: evidence card plus root cause, inside the role-based threshold workflow.
- **Journey:** upload → extract (confidence) → match → Resolver verdict per line → route to owner → owner acts (human) → re-match → approval workflow (thresholds) → payment-ready → dashboard and audit trail. Repeated causes create an upstream fix task.
- **Intelligence layer:**
  - Deterministic: matching, root-cause rules, routing, thresholds, ranking.
  - AI (optional, declared): extraction, and a plain-language summary shown beside the rule output.
  - Historical data: recurrence counts, simulator.
  - Human judgement: every fix, every approval, master-data changes.
- **Explainability:** each flag shows the failed check, the evidence rows (with document links), the rule that fired, the owner and the counterfactual.
- **Human oversight:** AI never approves, pays, overrides thresholds, edits POs or accuses suppliers. Segregation of duties holds: the submitter can't approve and the clerk can't pay.
- **Business value:** shorter exception loops, fewer repeats, a supplier relationship built on clear reasons, audit-ready logic. Frame it in the cash and fixed-cost terms LYB uses (Cash Improvement Plan [D]) as [INFERRED].
- **Differentiation:** moves from "variance detected" to "cause, owner, fix, recurrence". Whether competitors do this is [UNKNOWN]. Vendor AI agents claim to classify and search records [R3, R4], so pitch the transparency and determinism, not exclusivity.

## 8. Judging contribution
| Criterion | Pts | Contribution | Still needed |
|---|---|---|---|
| Problem understanding | 10 | Strong: targets the real cost (exceptions, upstream causes) | Personas, LYB invoicing rules [P2, P3] |
| Innovation | 10 | Strong | Precise novelty claim |
| Working prototype | 20 | Positive, deterministic | **All five mandatory items first** |
| Technical design | 10 | Positive: clear rule engine | Architecture diagram matching demo |
| Feasibility/scalability | 10 | Positive: uses ERP-native documents | Integration story (concept) |
| Impact | 15 | Strong: measurable resolution time, repeat causes | One labelled calculation |
| Responsible AI/security | 10 | Strong: rules decide, humans act | GenAI declaration, RBAC, SoD |
| UX/accessibility | 5 | Neutral-positive | Clean clerk and supplier screens |
| Presentation/demo | 5 | Strong: one invoice, three owners | Rehearsal |
| Q&A | 5 | Strong: every rule explainable | — |
Not directly improved: extraction quality, login/RBAC. These still have to be built. The innovation can't win alone.

## 9. Demo scenario (all fictional)
1. Supplier "Vihar Chem Supplies" [ILLUSTRATIVE] uploads INV-7781 against PO 4500001234 at Plant X. There are three lines and the total is above the Level-1 approval threshold.
2. Extraction fills the fields with confidence scores. The PO, GRs, contract C-22, delivery note and UoM table are retrieved.
3. Line 1, additive at ₹412/kg vs PO ₹398: the contract amendment of 1 Oct sets ₹412, so the cause is *PO not updated*. Owner: buyer. Fix: "passes if PO price = ₹412 per C-22".
4. Line 2, 5 MT invoiced vs GR 5,000 kg: a UoM normalisation, not a variance. Auto-cleared, with the reason logged.
5. Line 3, 40 drums invoiced vs GR 32, while the delivery note says 40: the cause is *receipt under-posted*. Owner: warehouse.
6. The supplier's view says: **"Two internal actions pending (price confirmation, receipt confirmation). Nothing needed from you."**
7. The buyer amends the PO and the warehouse posts the GR (both humans). The invoice re-matches and goes to the Level-2 approver, who sees the evidence card and approves. Everything is in the audit trail.
8. Dashboard (synthetic month): the top root cause of price exceptions is "PO not updated after contract change", with an upstream fix task to update 7 POs. A replay shows the exceptions that fix would have avoided (synthetic data, labelled).
9. A resubmitted copy with a changed invoice number is flagged as a possible duplicate for clerk review. It is not called fraud.

**Memorable moment:** one invoice, three different mismatches, three different owners, and the supplier told "nothing needed from you".

## 10. Financial and business value (illustrative, assumptions labelled)
- **Exceptions:** 2,000 invoices/month × 15% = 300 exceptions [ASSUMPTION]. If root-cause routing saves 20 min each, that's 100 h/month, or 1,200 h/yr. No salary is applied.
- **Upstream fix:** if 30% of price exceptions share one cause and the fix removes them, 300 × 0.5 price share × 0.3 = 45 fewer exceptions a month [ASSUMPTION].
- **Duplicates:** APQC-cited duplicate and erroneous payments run at 0.8–2% of disbursements [R6], and recovery audits plan around ~0.1% of spend. Don't apply either to LYB without data.
- **Double counting:** time saved and cost saved are the same benefit.
- **Working capital:** only claim it with known payment terms.

## 11. Risks & limitations
| Risk | Mitigation |
|---|---|
| Needs contract and delivery-note data | Synthetic for the demo; state real sources as a mentor question |
| Rule mis-attribution (wrong owner) | Show evidence and rule; owner can reject; log overrides |
| Overclaiming novelty | "Not publicly demonstrated in sources found" |
| Fraud implications | Anomalies are review prompts only [R7] |
| Mandatory items squeezed | Build five core items first; Resolver last but planned |
| Simulator looks abstract | Keep as stretch |
| Undeclared GenAI | Declaration slide (−10) |
| Source quality | Many vendor blogs; Ariba/SAP facts are official |

## 12. Final recommendation
Build the five mandatory items with **Root-Cause Resolver** as the signature. Use the Payment Readiness Passport as the supplier-facing surface, and keep the Tolerance Simulator as a stretch goal. Cheap control amplifiers that also cover bonuses: the multi-signal duplicate fingerprint and the auto evidence pack (controls report). Don't make the chatbot or OCR the headline. Validate tolerances, the data available for root cause (contracts, delivery notes) and the judges' priorities with mentors [10](10_questions_for_mentors.md).

## Sources (accessed 2026-11-12 via search summaries; not all pages opened)
- R1 The Paypers, AP exceptions survey: https://www.thepaypers.com/e-invoicing-scf-e-procurement/eliminating-invoice-exceptions-an-effective-way-for-ap-to-cut-costs-survey/750229-24
- R2 Centime, exception management (UoM): https://www.centime.com/articles/exception-management-in-ap-reducing-touchpoints-without-sacrificing-control
- R3 Peakflo, why three-way matching fails (vendor): https://peakflo.co/blog/three-way-matching-exceptions-ai-solutions ; Hyperbots Coupa exceptions glossary: https://www.hyperbots.com/glossary/coupa-invoice-exceptions
- R4 Medius, AI exception handling (vendor): https://www.medius.com/blog/ai-ap-automation-invoice-exception-handling/
- R5 SAP: invoicing errors on Ariba Network: https://blogs.sap.com/2020/11/06/understanding-invoicing-errors-on-ariba-network/ ; SAP Learning, reconciling invoices automatically: https://learning.sap.com/courses/invoice-reconciliation-br/reconciling-invoices-automatically
- R6 Corpay, duplicate payment detection (cites APQC): https://www.corpay.com/resources/blog/duplicate-payment-detection ; apexanalytix, profit recovery audit: https://www.apexanalytix.com/resources/blog/profit-recovery-audit/
- R7 Corpay, AP fraud guide: https://www.corpay.com/resources/blog/accounts-payable-fraud ; ApprovalMax, AP fraud red flags: https://blog.approvalmax.com/accounts-payable-fraud-types-red-flags-and-how-to-prevent-it
- R8 HighRadius, AI in AP (vendor): https://www.highradius.com/resources/Blog/ai-in-accounts-payable-automation/
- R9 Xelix, S/4HANA duplicate controls (vendor claim): https://xelix.com/resources/accounts-payable-solutions/erp/analysing-accounts-payable-controls-on-sap-s4hana
- R10 Hyperbots, SAP continuous controls monitoring (glossary): https://www.hyperbots.com/glossary/sap-continuous-controls-monitoring

Not verified: competitors' lack of root-cause or counterfactual features; ACFE primary figures; LYB's contract or delivery-note data availability.
