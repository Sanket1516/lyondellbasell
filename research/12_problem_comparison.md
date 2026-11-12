# 12 Problem Comparison: PS4 Smart Procure-to-Pay (A) vs PS2 SafeSite (B)

**TL;DR**
- **Correction (added after file 14 research):** SAP Ariba Network already validates supplier invoices against buyer rules at submission [see 14, R5], so innovation A3 "supplier pre-submission check" is *not* novel. A3 drops to a meaningful differentiator; the recommended PS4 signature is now the Root-Cause Resolver (file 14). The PS4 verdict is unchanged.
- **Verdict: PS4 Smart Procure-to-Pay**, by a narrow, execution-dependent margin (est. 71.5 vs 68 of 100; all scores are my estimates, not predictions).
- A wins on prototype reliability (20 pts), quantifiable impact (15 pts), LYB fit evidence and live-demo determinism. B wins on innovation headroom, UX and emotional story.
- Decision flips to B only if judges weight innovation most AND the team can reliably deliver voice/camera/offline on stage.
- A's weakness: crowded space; OCR + 3-way match are table stakes, so innovation must come from explainability, supplier-side prevention and controls.
- Tags: [VERIFIED] sourced · [INFERRED] deduced · [ASSUMPTION] unverified · [REC] my recommendation. Source IDs: `P#` = research/11_sources.md; `SS#` = research/_archive_safesite/11_sources.md; `D` = dossier.
- Not known: how many other teams choose each statement, judge identities, LYB baselines. No LYB statistics are invented.

## 1. Executive verdict
Choose **PS4**. Reasons: (1) deterministic core (matching, thresholds, audit trail) makes the 20-pt prototype criterion safest; (2) impact is easiest to quantify transparently (15 pts); (3) verified LYB alignment: Ariba Network invoicing, unique-ID/3-way-match/PO-terms rules [P1–P3], S2P on S/4HANA and Cash Improvement Plan [D]; (4) AI can be advisory while rules decide, which scores Responsible AI (10 pts). Choose B only under the flip conditions in §12.

## 2. Business problems
| | A: P2P | B: SafeSite |
|---|---|---|
| Problem | Invoices mismatch PO/GR, duplicates, missing approvals → late payment, delay, audit risk [brief] | Hazards/near-misses unreported; contractors/new joiners most at risk [brief] |
| Root causes | Unstructured inputs; PO/GR in separate records; late GR; weak enforcement of approval rules [INFERRED] | Fear of blame, friction, no visible follow-up [SS7, VERIFIED-secondary]; no owner/escalation [INFERRED] |
| If unresolved | Late/duplicate/incorrect payment, supplier friction, audit findings [INFERRED] | Hazards persist; precursors to serious incidents (La Porte: contractors, no procedure/training, 2 killed [SS5, D] VERIFIED) |
| Relevance to chemical/plastics co. | Large supplier base; LYB cut trade working capital ~$400M in 2025 [D]; link to AP is [INFERRED] | Safety is a stated core value; GoalZERO [SS1] VERIFIED |
| LYB-specific verified hooks | Ariba invoicing, 3-way match, 45/60-day terms [P1–P5] | GoalZERO, contractor policy compliance [SS1–SS3] |

## 3. Stakeholders / users
| | A | B |
|---|---|---|
| Who | AP clerk, approver, procurement/PO specialist, supplier finance, GR/warehouse, controller, auditors | Contract worker, new joiner, operator, shift supervisor, HSE manager, maintenance, leadership |
| Most painful (illustrative, [ASSUMPTION]) | Clerk can't see why it failed; supplier can't see status; approver signs without evidence | Fear of reporting; nothing visibly fixed; info lost at handover |
| Adoption needs | Explained decisions, fewer touches | No-blame, fast, own-language, visible closure |
| Evidence strength | LYB supplier docs verified [P2]; employee-side [ASSUMPTION] | Barriers verified via secondary sources [SS7, SS8]; LYB internals [UNKNOWN] |

## 4. Business importance & frequency/severity
- A: **high-frequency, moderate-severity, cumulative** (every invoice; leakage and audit exposure accumulate). Frequency at LYB: Data unavailable.
- B: **low-frequency, extreme-severity** (rare incidents, but catastrophic; near-misses frequent but under-reported). Hard to prove value inside a demo.
- Business-priority links: A → cost reduction, financial controls, supplier relations (verified LYB: Cash Improvement Plan, S2P) [D]. B → safety culture, risk prevention (verified GoalZERO) [SS1]. Sustainability: neither is central.

## 5. Innovation opportunities: A (P2P)
Strictness: OCR, chatbot, dashboard or CRUD = **Basic**. Nothing here is "game-changing"; best are **Strong**.
## 6. Innovation opportunities: B (SafeSite)
Same strictness. Nothing is game-changing; best are **Strong**.

## 7. Shortlisted innovations (≥10 each)
Scores 1–5: Orig/Nov/UserV/BizV/Feas/Demo/Diff/Risk(5=low risk)/Scale. Class: B=Basic, M=Meaningful differentiator, S=Strong, G=Game-changing.
### A: P2P
| # | Idea | O | N | U | Bz | F | D | Df | Rk | Sc | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | **Decision receipt**: plain-language reason + line-by-line invoice/PO/GR diff for every approve/flag/block | 3 | 3 | 5 | 4 | 5 | 5 | 4 | 5 | 4 | M |
| A2 | **Tolerance what-if simulator**: change thresholds, see how many invoices flip and cost of exceptions vs risk | 4 | 4 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | **S** |
| A3 | **Supplier pre-submission check** against LYB's published rules (unique ID, PO ref, bill-to, one channel) [P2,P3] | 4 | 3 | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **S** |
| A4 | **Field provenance**: click any extracted value → highlighted region in source doc + confidence | 4 | 3 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | **S** |
| A5 | Multi-signal duplicate detection (exact, near, cross-channel [P2]) | 3 | 3 | 4 | 5 | 4 | 5 | 3 | 4 | 4 | M |
| A6 | Missing-GR owner + ageing nudges ("who is holding this up") | 3 | 3 | 5 | 4 | 5 | 4 | 3 | 5 | 4 | M |
| A7 | Approval bottleneck/aging prediction + escalation | 3 | 3 | 4 | 4 | 3 | 3 | 3 | 3 | 4 | M |
| A8 | Supplier price-drift/anomaly flags vs PO history | 3 | 3 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | M |
| A9 | Auto-generated **control evidence pack** (match, SoD, thresholds, audit trail) [P10] | 3 | 3 | 4 | 5 | 5 | 4 | 4 | 5 | 4 | M |
| A10 | Ledger-grounded "Where is my payment?" explainer (answers from invoice state, not free text) | 2 | 2 | 4 | 3 | 4 | 4 | 3 | 4 | 4 | B→M |
| A11 | Cash view: due dates vs terms, late/discount risk [P4,P5] | 3 | 3 | 3 | 4 | 4 | 3 | 3 | 4 | 4 | M |
| A12 | India GST e-invoice (IRN) presence check [P8; thresholds unverified] | 3 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | M |
### B: SafeSite
| # | Idea | O | N | U | Bz | F | D | Df | Rk | Sc | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | Voice-first multilingual report (EN/HI/MR), editable transcript | 4 | 3 | 5 | 3 | 3 | 5 | 4 | 2 | 4 | **S** |
| B2 | Reporter-visible loop: "your report → action → closed" | 4 | 4 | 5 | 4 | 5 | 5 | 4 | 5 | 4 | **S** |
| B3 | Shift-handover digest of open/repeat hazards | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | **S** |
| B4 | Zone QR check-in (location without GPS) | 3 | 3 | 4 | 3 | 4 | 4 | 3 | 4 | 3 | M |
| B5 | Explainable severity with rule-based safety floor | 3 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | M |
| B6 | Duplicate/related-incident clustering | 3 | 3 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | M |
| B7 | Heatmap area×shift with drift/early-warning | 3 | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4 | M |
| B8 | Confidential/anonymous mode with retaliation safeguards | 3 | 3 | 5 | 3 | 4 | 3 | 3 | 4 | 3 | M |
| B9 | Contractor induction quiz gating zone access | 3 | 3 | 4 | 3 | 4 | 4 | 3 | 4 | 3 | M |
| B10 | Offline-first with idempotent sync/conflict handling | 3 | 3 | 4 | 3 | 2 | 3 | 3 | 2 | 4 | M |
| B11 | Closed-loop CAPA with escalation clock | 2 | 2 | 4 | 4 | 5 | 4 | 2 | 5 | 4 | B |
| B12 | PPE photo check (advisory) | 2 | 3 | 3 | 3 | 2 | 4 | 3 | 1 | 3 | B (high risk) |

## 8. Side-by-side innovation answers
| Question | Winner | Why |
|---|---|---|
| More unexplored opportunities | B (slight) | Human-centered/ spatial space less saturated; A's space is crowded by vendors [P12] |
| More unconventional concepts | B | Voice, zone, handover |
| Greater meaningful AI scope | B | Speech, vision, multilingual |
| Greater non-AI scope | A | Simulator, pre-submission rules, evidence pack |
| Predictive/proactive | Tie | A: bottleneck/anomaly; B: hotspot drift |
| Creative UX | B | |
| Breakthrough differentiator | A (A2 simulator) ≈ B (B3 handover) | Neither is game-changing |
| More memorable demo | Tie | A: flip invoices live with simulator; B: spoken Marathi report |
| Impress experienced enterprise judges | A | ERP-literate judges likely [D: "most likely Digital Technology"] |
| Highest originality ceiling without sacrificing practicality | B ceiling, A floor | B higher variance |

## 9. Technical feasibility (technology-neutral)
| | A | B |
|---|---|---|
| Workflows | Upload→extract→match→approve→dashboard→supplier view | Report→classify→assign→escalate→dashboard + mobile capture |
| Straightforward | Roles, matching rules, thresholds, audit log, dashboards, status view | Roles, forms, actions, dashboard |
| Difficult | Messy-document extraction; tax/UoM/partial delivery; realistic data | Voice accuracy (accents/noise), camera, offline sync, multilingual, vision |
| Realistically demonstrable | Full chain on generated invoices | Full chain on typed/spoken input in controlled room |
| May only be simulated | ERP integration (no access) | Real plant GPS/PPE vision |
| Must be deterministic | Matching, thresholds, approvals, audit | Escalation, assignment, severity floor |
| AI-assistable | Extraction, summaries | Transcription, classification, duplicates |
| Human verification | Low-confidence extraction; every block/approval | Severity, closure |
| Never AI-only | Payment authorisation/approval | Declaring area safe, authorising work |
| Data simulation difficulty | Medium (invoices+PO+GR consistent) | Low–medium (reports, zones) |
| Live-demo failure points | OCR on a messy file; sample data mismatch | Mic/camera permissions, speech API, connectivity, device |
| Testing difficulty | Low (rules) | Medium–high |
Fully working vs simulated must be declared on stage.

## 10. Business impact & illustrative ROI (assumptions, fictional)
| Value | A | B |
|---|---|---|
| Direct | Less reconciliation, faster exceptions, duplicate prevention | Faster reporting, faster closure |
| Indirect | Supplier trust, audit readiness | Culture of reporting |
| Employee | Less chasing | Voice, feedback |
| Financial | Hours + leakage prevented (computable) | Hard to monetise; avoided-incident claims forbidden |
| Risk | Control evidence | Hazard visibility |
| Long-term | Working capital (terms-dependent) | Safety culture |
Illustrative A: 300 exceptions/month × 20 min saved = 1,200 h/yr (assumed inputs; see [09]). Illustrative B: 1,000 reports/yr × 4 min saved ≈ 67 h (assumed) — small, so B's impact must be argued via leading indicators (acknowledgement time, closure rate), which are measurable in a demo but not in £/₹. [INFERRED] A has the cleaner impact calculation.

## 11. Judging score matrix (my estimates)
| Criterion | Max | A | B | Reasoning | Biggest weakness | Conf. |
|---|---|---|---|---|---|---|
| Problem understanding | 10 | 7.5 | 7.5 | Both well-evidenced; A has verified LYB invoicing rules, B has La Porte | Employee-side evidence anecdotal | Med |
| Innovation | 10 | 6.0 | 7.0 | B has more novel human-centred angles; A table-stakes risk | A: "just OCR + matching" | Med |
| Working prototype | 20 | 15.0 | 13.0 | A deterministic; B device-dependent | A: extraction on live file; B: voice/camera | Med |
| Tech design | 10 | 7.0 | 6.5 | | B multi-modal complexity | Low |
| Feasibility & scalability | 10 | 7.0 | 6.5 | A maps to Ariba/S4 concepts | Both: no real integration | Med |
| Business value & impact | 15 | 11.0 | 10.0 | A computable; B qualitative | B: cannot claim prevented accidents | Med |
| Responsible AI/security | 10 | 7.5 | 6.5 | B's safety-critical bar higher | B: severity under-call | Med |
| UX & accessibility | 5 | 3.5 | 4.0 | B mobile/voice | A: dense finance screens | Low |
| Presentation & demo | 5 | 3.5 | 3.5 | | | Low |
| Q&A | 5 | 3.5 | 3.5 | | | Low |
| **Total** | **100** | **71.5** | **68.0** | Difference **3.5** | | |
Scenarios (rough, ±): A conservative ≈ 62, strong ≈ 80; B conservative ≈ 57, strong ≈ 79; best realistic A ≈ 82, B ≈ 82 (strong execution nearly closes the gap).

## 12. Sensitivity analysis
| Condition | Preferred | Why |
|---|---|---|
| Limited dev time | A | Fewer device dependencies |
| Unexpected difficulties | A | Deterministic core |
| AI service failure | A | Rules still decide; fallback extraction from structured fixtures |
| Connectivity problems | A (local) | B relies on speech/AI + devices |
| Incomplete sample data | B | Easier to simulate |
| Judges prioritise innovation | B (narrow) | B ceiling |
| Judges prioritise business value | A | Computable impact, verified LYB fit |
| Judges prioritise completeness | A | |
| Strong competition | Depends [ASSUMPTION: unknown pick-rates]; if many teams pick A, only A2/A3/A4 differentiate |
**Flip rule [REC]:** switch to B only if (a) judges signal innovation-first, and (b) the team can demonstrate offline/voice/camera reliably. Otherwise stay on A.

## 13. Winning product concept per problem
| | A: "PayClear" (working name) | B: "SafeSite Loop" (working name) |
|---|---|---|
| Position | Every invoice decision explained, every control evidenced | Report in seconds, see it fixed |
| Central problem | Mismatches, duplicates, unexplained blocks | Lost safety information |
| Users | AP clerk, approver, supplier (+auditor view) | Contractor/new joiner, supervisor, HSE |
| Core | Extract, 3-way match with reason, thresholds, audit trail, exceptions, supplier view | Report (photo/voice/location), classify, assign, escalate, heatmap |
| Top 3 innovations | A3 pre-submission check · A2 tolerance simulator · A4 provenance | B2 visible loop · B3 handover digest · B1 voice multilingual |
| Differentiation | Prevention at source + explainability | Worker trust + continuity across shifts |
| Demo | Supplier uploads flawed invoice → told how to fix → clerk sees decision receipt | Marathi voice report → action → shift handover |
**Stronger to impress while reliable: PayClear** [REC].

## 14. Feature prioritisation
Priority = (value+innovation) ÷ effort; risk noted.
### A
| Cat | Feature | Value | Effort | Dep. | Demo | Risk |
|---|---|---|---|---|---|---|
| A Mandatory | 3 role logins; upload+extract; 3-way match w/ reasons; thresholds + audit trail; exceptions dashboard + supplier view | H | M | chain | Critical | Extraction |
| B Essential | A1 decision receipt; A3 pre-submission check; A5 duplicates (also bonus) | H | L–M | match | High | Low |
| C Advanced | A2 simulator; A4 provenance; A9 evidence pack | H | M | match/audit | High | Med |
| D Optional | A10 chatbot (grounded); A11 cash view; A12 GST; A7/A8 predictions | M | M | data | Med | Med–High |
### B
| Cat | Feature | Value | Effort | Dep. | Demo | Risk |
|---|---|---|---|---|---|---|
| A Mandatory | 3 logins; photo+voice+location report; classify+duplicates; action+escalation; heatmap | H | M–H | device | Critical | Device/speech |
| B Essential | B2 visible loop; B5 explainable severity; B8 anonymity | H | L–M | — | High | Low |
| C Advanced | B3 handover digest; B1 multilingual; B6 clustering | H | M | data | High | Med |
| D Optional | B10 offline; B9 quiz; B12 PPE | M | H | — | Med | High |
Rule: never trade mandatory completeness for optional items.

## 15. Live demo (3–5 min)
### A
1) Supplier uploads a deliberately flawed invoice; app says "PO ref missing / bill-to wrong" before submit. 2) Corrected invoice extracted with confidence + provenance. 3) Clerk view: match vs PO and GR; one line price +4% beyond tolerance → flagged with reason. 4) Missing-GR invoice blocked with owner and age. 5) Duplicate resubmitted → caught. 6) Approver threshold routing; audit trail. 7) Dashboard + simulator: tolerance 2%→5% flips N invoices. **Peak moment:** simulator flip. **Failure risk:** OCR on live file → backup: pre-extracted fixture file; deterministic scripted dataset.
### B
1) Contractor speaks report in Marathi. 2) Photo + zone. 3) Auto-classified with explainable severity; duplicate flagged. 4) Supervisor assigns, due date. 5) Escalation after SLA. 6) Handover digest. 7) Heatmap by area×shift. **Peak:** spoken report. **Failure risk:** mic/permission/speech accuracy/connectivity → backup: recorded audio + typed transcript.
Impact visible: A: hours and exceptions; B: acknowledgement and closure times.

## 16. Responsible AI, security & trust
| | A | B |
|---|---|---|
| Privacy | Supplier/bank details; DPDP for personal data [P13] | Photos of people, location, reporter identity [SS11] |
| Controls | RBAC, SoD, tiered approvals, immutable audit [P10] | RBAC, confidential mode, retention |
| False positives/negatives | Wrong block = supplier friction; missed duplicate = cash loss | Over-flag = fatigue; under-call severity = safety risk |
| Hard rule | AI never approves/pays; rules + humans decide | AI never declares area safe or authorises work |
| Explainability | Decision receipt, provenance | "Why" severity, keyword floor |
| Competitive strength | "AI extracts, rules decide, humans approve" is a clear story judges can probe | Safety-first guardrails are compelling but riskier to defend |
Declare all GenAI use (−10 if not) [brief].

## 17. Judge simulation (five questions each)
### Judge 1 Business/Operations
A: 1 What are your tolerance assumptions? 2 How would suppliers adopt it alongside Ariba? 3 Who owns a missing GR? 4 What's the cash impact and how computed? 5 How do you handle partial deliveries?
B: 1 Why would a contractor trust it? 2 Who owns escalation? 3 How would phones be allowed in process areas? 4 How measure impact without claiming fewer accidents? 5 What about emergencies?
Impress: concrete, assumption-labelled calculation (A); no-blame design (B). Weakens: invented stats.
### Judge 2 Technology
A: 1 Extraction accuracy and fallback? 2 Why rules for matching? 3 Duplicate logic false positives? 4 How would it integrate with S/4HANA/Ariba? 5 Audit-log integrity?
B: 1 Speech accuracy in noise/Hindi/Marathi? 2 Offline sync conflicts? 3 Severity model failure? 4 Heatmap data source? 5 Image storage security?
Impress: deterministic core + declared AI. Weakens: unexplainable AI, screens without logic.
### Judge 3 Innovation/Product
A: 1 What's new vs Ariba/Coupa? 2 Why simulator? 3 Is the chatbot just a wrapper? 4 What do suppliers see differently? 5 What's memorable?
B: 1 What's new vs existing EHS apps? 2 Why voice? 3 Is PPE vision reliable? 4 What does the handover digest change? 5 What's memorable?
Overall: A gives stronger answers across Judges 1 and 2; B stronger on 3; net A. [REC]

## 18. Final recommendation
**Select PS4.** Superior because it combines verified LYB alignment, a deterministic and demo-safe core, and a computable impact story. B has the higher innovation ceiling and richer UX but weaker demo determinism and harder impact quantification. Best balance of innovation and feasibility: A (with A2/A3/A4). Highest expected score: A (+3.5, within noise). Strongest impact: A (computable). Most reliable end-to-end: A.
| | A | B |
|---|---|---|
| Expected score | 71.5 | 68.0 |
| Innovation ceiling | Medium | Med–High |
| Execution risk | Lower | Higher |
| Business impact | Higher | Medium |
| Differentiation | Medium (needs A2–A4) | Medium–High |
| Demo potential | High (deterministic) | High (fragile) |
| Overall | **Winner by narrow margin** | |

## 19. Three most promising innovations (for A)
1. ~~Supplier pre-submission check (A3)~~ **Superseded:** Ariba Network already does this. Use the **Root-Cause Resolver** (file 14): cause, owner and minimal fix for every exception.
2. **Tolerance what-if simulator** (A2): turns controls into a decision tool.
3. **Field provenance + confidence** (A4): builds trust in extraction.

## 20. Critical risks & mitigations
| Risk | Mitigation |
|---|---|
| Extraction fails live | Scripted fixtures + pre-extracted fallback; confidence + manual correction |
| Looks like "OCR + CRUD" | Lead demo with A3/A2, not extraction |
| Inconsistent sample data | Generate PO/GR/invoices from one seed and validate |
| Overclaiming impact | Label assumptions; no real LYB figures |
| Undeclared GenAI | Declaration slide (−10) |
| Unknown tolerances/thresholds | Configurable, flagged [ASSUMPTION], ask mentors [10] |
| Chatbot ordinary | Ground it in invoice state; optional |
**Avoid:** building both; AI approving payments; invented benchmarks; screens without logic.

## Limitations
No new web research this round; relied on research/ files (search summaries, not all pages opened). Competitor-team behaviour, judge identity, LYB volumes, tolerance rules: Data unavailable. Scores are subjective estimates.
