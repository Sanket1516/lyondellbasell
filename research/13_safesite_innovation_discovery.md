# 13 SafeSite — Innovation Discovery & Differentiation

**TL;DR**
- **Recommended signature innovation: "Hazard Memory"**: every report joins a persistent *hazard thread* per location/hazard, and the system detects **"closure didn't hold"** (recurrence after an action was closed) and rates **action strength** (is the fix a durable control or just "retrain/tighten"?). Humans decide everything.
- Why: it attacks the real gap (information lost between notice and fix), is deterministic and demo-reliable, and strengthens all five mandatory items.
- Honest ranking: 29 concepts scored; **no concept qualifies as a true "breakthrough"** (strict rule: originality ≥8 and total ≥75). Hazard Memory is the best overall (80/100 by my model; originality 7).
- Runner-ups: **Barrier Health Lens** (links reports to bow-tie barriers; chemical-industry-native but needs authored content) and **Silence Map** (shows where reporting is suspiciously quiet; needs exposure data).
- Competitor claims are vendor marketing; I found **no verified product gaps**, so differentiation is argued as "not publicly demonstrated in sources found", never "missing".
- Tags: [VERIFIED] sourced · [INFERRED] · [ASSUMPTION] · [REC] my recommendation. Source IDs at bottom.
- **Mismatch to resolve:** `CLAUDE.md` currently says PS4 was chosen. This report is for PS2 (SafeSite); the team must confirm which one it is building.

## 1. Executive summary
SafeSite as specified collects, classifies, assigns and visualises. The sources point to a deeper failure: recurring deviations treated as isolated issues, near-misses whose root causes were never addressed, and actions marked complete without changing exposure [S9, S10 — practitioner sources, VERIFIED-practitioner]. Process-safety bodies treat near-miss and operating-discipline events as **leading indicators** (CCPS/API RP 754 Tier 3/4) [S5, S6 VERIFIED]. Hazard Memory turns reports into a **hazard lifecycle** (first seen → recurrences → actions → closure → recurrence-after-closure) and surfaces it to the reporter, the next shift and the arriving contractor. It does not predict incidents and does not rate individuals.

## 2. Existing landscape (what vendors say)
| Platform | Documented capabilities (vendor-reported unless noted) | Predictive/proactive | Gaps |
|---|---|---|---|
| Intelex | Input AI (frontline reporting), Insight AI (patterns), predictive analytics from leading indicators and history [S2] | Claimed [vendor] | Not verified; Data unavailable |
| Sphera | AI analytics; data-quality argument (near-miss, observations, training, audits feed prediction); new AI tool showing where exposure builds vs HAZOP assumptions (IT Brief, Nov 2026) [S1, S3] | Claimed [vendor/press] | Not verified |
| Enablon (Wolters Kluwer) | Control-of-work/permit-to-work, contractor visibility, SIMOPS conflict checks [S11] | Partial [vendor] | Not verified |
| Cority | Mobile/offline hazard reporting, guided steps, embedded AI [SS10 archive] | Claimed | Not verified |
| SafetyCulture | Mobile checklists, photo evidence, offline [SS10] | Not found | — |
| VelocityEHS, Benchmark Gensuite | No feature detail found | Data unavailable | Data unavailable |
Analyst view: Verdantix rated Intelex, SAI Global and Sphera 71% of max on safety/incident/risk functionality; Cority, VelocityEHS, Gensuite "solid" [S4]. **I found no evidence either way on "closure-holds" detection or action-strength rating in any product.** Treat that as "[UNKNOWN] — not publicly demonstrated in sources found". Judges may know enterprise tools better than I can verify; avoid claiming "no one does this".

## 3. Deepest user pain points
| Role | Pain | Root cause | Workaround | Consequence | Emotion | Unmet need → opportunity | Tag |
|---|---|---|---|---|---|---|---|
| Worker | Reporting takes too long | Paper/forms | Verbal tell | Hazard unrecorded | Impatient | Seconds-level capture | [VERIFIED-secondary SS7] |
| Worker | Fear of blame | Blame culture | Stay silent | Under-reporting | Anxious | Safe reporting (confidential option) | [VERIFIED-secondary] |
| Worker | No feedback | No loop | Stop reporting | Disengagement | Cynical | See what happened to my report → thread status | [VERIFIED-secondary] |
| Worker | Same hazard reported again and again | Isolated treatment of repeats [S9] | "Me too" verbally | Normalised deviance | Resigned | Corroborate, don't re-file | [VERIFIED-practitioner] |
| Contractor/new joiner | Doesn't know zone's risks | Generic induction | Ask foreman | Exposure to known hazards | Unsure | Zone briefing at point of need | [INFERRED]; La Porte: no procedure/training [SS5] VERIFIED |
| Supervisor | Too many reports, no priority | Flat list | Memory/radio | Late action | Overloaded | Threads ranked by age×severity×recurrence | [INFERRED] |
| Supervisor | Lost at shift handover | Verbal handover | Notes | Repeat | Worried | Handover digest | [ASSUMPTION] |
| Safety manager | Fragmented data | Many channels | Excel | Missed patterns | Frustrated | One thread per hazard | [ASSUMPTION] |
| Safety manager | "Closed" ≠ fixed | Action marked complete w/o exposure change [S10] | Re-inspect | Recurrence | Doubt | Closure-holds + action strength | [VERIFIED-practitioner] |
| Safety manager | Quiet zones look "safe" | Silence is a warning sign [S9] | None | Missed risk | Unease | Silence map | [VERIFIED-practitioner] |
Frequency figures: Data unavailable — requires mentor validation.

## 4. Innovation concepts (29), scored
Weights: Originality 20 · Value 20 · Feasibility 15 · Risk reduction 15 · Differentiation 10 · Demo 10 · Scalability 5 · Responsible AI 5. Scores 0–10 in that order; total /100 computed by script (all subjective [ASSUMPTION]). **Class rule (strict):** <55 Incremental; 55–64 Strong differentiator; 65–79 Highly innovative; Potential breakthrough only if total ≥75 **and** originality ≥8 → **none qualify**. U = unconventional.
| # | Concept | Scores | Total | Class |
|---|---|---|---|---|
| 1 | **Hazard Memory**: persistent hazard threads + recurrence-after-closure | 7/9/8/8/7/9/7/8 | **80** | Highly innovative |
| 16 | Control-strength advisor (hierarchy of controls on actions) | 7/8/8/8/7/8/7/8 | **76** | Highly innovative |
| 2 | **Barrier Health Lens** (U): link reports to bow-tie barriers, CCPS/API 754 tiers | 8/8/5/9/8/7/7/6 | **74** | Highly innovative |
| 7 | Shift-handover digest | 6/8/8/7/6/7/7/8 | 71 | Highly innovative |
| 3 | Zone Context Lens: just-in-time zone briefing for contractors | 6/8/7/7/6/8/7/8 | 70 | Highly innovative |
| 29 | **Silence Map** (U): low-reporting zones vs headcount | 8/7/5/7/8/8/6/7 | 70 | Highly innovative |
| 25 | "Me too" one-tap corroboration | 6/7/9/6/5/8/8/8 | 70 | Highly innovative |
| 4 | SIMOPS hint vs concurrent (synthetic) work (U) | 7/7/6/8/7/7/6/6 | 69 | Highly innovative |
| 6 | Reporter feedback loop | 5/8/9/6/4/7/8/9 | 68 | Highly innovative |
| 19 | Exposure clock (days open × severity × exposure; not a prediction) | 6/7/8/7/5/7/7/7 | 68 | Highly innovative |
| 17 | Site risk knowledge graph (U) | 8/7/4/7/7/6/8/6 | 66 | Highly innovative |
| 12 | Visual before/after closure check (human-confirmed) | 6/7/6/7/6/8/6/6 | 66 | Highly innovative |
| 23 | Zone-adaptive induction quiz from open hazards | 6/7/7/6/6/7/7/7 | 66 | Highly innovative |
| 18 | Zone risk map with time-slider replay (U) | 6/6/7/6/5/9/7/8 | 65 | Highly innovative |
| 10 | Early-warning drift detection (rate of change) | 6/7/6/7/5/7/7/6 | 64 | Strong differentiator |
| 11 | Emerging-risk clustering (text embeddings) | 6/7/6/7/5/6/7/6 | 63 | Strong differentiator |
| 15 | Root-cause factor assist | 6/7/6/7/5/6/7/6 | 63 | Strong differentiator |
| 26 | Closure evidence + independent verifier | 4/7/8/7/3/6/7/9 | 62 | Strong differentiator |
| 28 | Toolbox-talk topics from open hazards | 5/6/8/6/4/6/7/8 | 60 | Strong differentiator |
| 9 | Explainable severity with safety floor | 4/7/8/6/3/6/7/8 | 60 | Strong differentiator |
| 24 | Smart escalation | 4/7/8/6/3/6/7/8 | 60 | Strong differentiator |
| 5 | Voice-first multilingual reporting | 5/8/5/5/4/8/7/5 | 59 | Strong differentiator |
| 8 | Confidential/anonymous reporting | 4/7/8/6/3/4/7/8 | 58 | Strong differentiator |
| 21 | Contractor-company participation (aggregate only) | 5/6/7/5/4/5/7/5 | 55 | Strong differentiator |
| 27 | Conversational follow-up prompts | 5/6/6/5/4/7/6/5 | 55 | Strong differentiator |
| 20 | Good-catch recognition (no individual scoring) | 4/6/8/5/3/5/7/7 | 54 | Incremental |
| 13 | VLM hazard suggestion from photo | 5/6/4/6/4/8/6/3 | 54 | Incremental |
| 22 | Offline-first with idempotent sync | 3/7/4/5/3/6/7/7 | 50 | Incremental |
| 14 | PPE photo check (advisory) | 3/5/3/5/2/7/5/3 | 41 | Incremental |
**Vision reality check:** photos can show visible conditions (spill, obstruction, missing guard, PPE presence in good light) but not pressure, concentration, leaks inside equipment or isolation status. Reported CV limits: lighting, occlusion, clustering, false-positive alert fatigue, privacy scrutiny (S7, vendor/blog level) → keep vision advisory and low in priority. Conventional features (voice, offline, PPE, chatbot-style, dashboards) are table stakes, not innovation.

## 5. Ten biggest innovation gaps
| # | Existing practice | Limitation | Unmet need | Opportunity |
|---|---|---|---|---|
| 1 | Reports stored as flat records | Same hazard looks like many isolated events [S9] | Hazard lifecycle | Hazard threads |
| 2 | Action "closed" by assignee | Closure ≠ risk change [S10] | Closure verification | Closure-holds check |
| 3 | Corrective action text ("retrain staff") | Weak controls, no quality view [S10] | Action strength | Hierarchy-of-controls advisor |
| 4 | Near-miss counts | Not tied to barriers | Barrier health | Barrier Health Lens [S5,S6] |
| 5 | Low reports read as "safe" | Silence is a warning sign [S9] | Under-reporting signal | Silence Map |
| 6 | Generic induction | Zone risks unknown to newcomers | Just-in-time context | Zone Context Lens |
| 7 | Verbal shift handover | Info loss | Continuity | Handover digest |
| 8 | Reports isolated from active work | Work-interaction risks (SIMOPS) [S11] | Context | SIMOPS hint (synthetic) |
| 9 | Reporter hears nothing | Disengagement | Visible outcome | Thread status to reporter |
| 10 | Each worker files a new report | Friction + lost corroboration | Low-effort confirmation | "Me too" |
Gaps exist because tools optimise intake and compliance reporting [INFERRED]. Demonstrable in a prototype: 1,2,3,7,9,10 yes; 4,5,6 yes with synthetic content/roster; 8 only with synthetic permits. Not a breakthrough: a new UI.

## 6. Top three candidates
### 1. Hazard Memory (80)
Core: persistent thread per hazard (zone + type + similarity), lifecycle timeline, recurrence-after-closure rule, action-strength rating. Problem: repeats treated as isolated; closed ≠ fixed. User: supervisor, safety manager; also reporter/contractor view. How: deterministic matching + suggested merges (human can split/merge); "closure didn't hold" when a new report joins a closed thread inside a configurable window [ASSUMPTION N days]; action category (eliminate/substitute/engineering/administrative/PPE) suggested by rules, confirmed by human. Different: lifecycle + closure quality vs counts. Existing tools: may offer duplicate detection/analytics (vendor claims) — specific combination [UNKNOWN]. Business value: fewer repeat touches, better prioritisation, audit trail. Safety value: surfaces recurring conditions for human action; no prediction. Feasible: High. Limits: relies on report quality; threshold tuning; false merges. Demo: see §9.
### 2. Barrier Health Lens (74)
Core: map each report to a barrier in a bow-tie for a hazard scenario (e.g. loss of containment during contractor work), so reports show barrier degradation; near-miss = Tier 3/4 leading signal [S5,S6]. Problem: near-misses not tied to the controls that protect people. User: safety manager. How: small authored bow-tie library (fictional), rule/LLM-assisted mapping with human confirm. Different: speaks the process-safety language judges from a chemical company know. Risk: content authoring; could look shallow to experts; mis-mapping. Feasibility: Medium-low. Demo: report about unlabeled valve bolts → barrier "task procedure/training" turns amber (cf. La Porte findings [SS5]). Limits: not a QRA; not predictive.
### 3. Silence Map (70)
Core: heatmap of *absence*: zones/shifts with fewer reports than expected from headcount (synthetic roster). Problem: low reports mistaken for safety [S9]. User: safety manager, site leadership. How: reports ÷ synthetic person-hours, compared to peer zones. Limits: needs exposure data that real sites may not hold; low report count has many causes → prompts a human conversation, not a verdict. Feasibility: Medium. Demo: night-shift Zone D flagged "quiet", walkthrough finds issue (fictional).

## 7. Signature innovation: **Hazard Memory**
Chosen because: most differentiated *and* most reliable; explainable to non-technical judges ("the app remembers this hazard, and notices when a fix didn't hold"); works with fictional data; complements every mandatory item; doesn't replace safety professionals; plausible adoption path (reads/writes standard reports and actions). Stronger than Barrier Health (needs authored process-safety content and higher expert-challenge risk) and Silence Map (needs exposure data and is easier to misread).
- **One sentence:** SafeSite remembers every hazard across shifts, shows what was done about it, and flags when a "closed" fix didn't hold.
- **Experience:** Worker: one-tap "me too" or new report; sees status. Supervisor: ranked threads, handover digest, action prompts. Safety manager: lifecycle timeline, closure-holds queue, action-strength view.
- **Journey:** report (photo/voice/zone) → classify (suggested) → match to thread or create → assign action + due date → escalate on age → closure with evidence/verifier → monitor window → recurrence reopens thread and escalates.
- **Intelligence layer:** Deterministic: thread matching rules, escalation clock, closure-holds rule, ranking formula. AI (optional, declared): transcription, hazard type/severity *suggestion*, similarity hints, thread summary with source text beside it. Human: severity, merges, action category, closure.
- **Explainability:** every flag shows "because": matched zone+type, N similar reports, last closure date, window.
- **Human oversight:** severity, closure, reopening decisions, action approval; AI never declares an area safe or authorises work.
- **Value beyond reporting:** converts scattered observations into a lifecycle and a closure-quality signal.
- **Differentiation:** lifecycle + recurrence-after-closure + action strength + three surfaces (reporter, handover, contractor zone briefing). No claim that others lack it [UNKNOWN].
- **Boundaries:** no individual scoring, no surveillance, no incident prediction.

## 8. Judging contribution
| Criterion | Pts | Hazard Memory contribution | Needs |
|---|---|---|---|
| Problem understanding | 10 | Strong (targets information loss) | Persona/pain evidence |
| Innovation | 10 | Strong | Be precise about what's novel |
| Working prototype | 20 | Neutral-positive (deterministic) | **All five mandatory items working first** |
| Technical design | 10 | Positive (clear rules) | Architecture diagram matching demo |
| Feasibility/scalability | 10 | Positive | Integration story (concept only) |
| Impact | 15 | Positive (repeat reduction, handover) | One transparent calc, labelled assumptions |
| Responsible AI/security | 10 | Positive (explainable, human-final) | Declare GenAI; RBAC; privacy |
| UX/accessibility | 5 | Neutral | Voice/large targets from mandatory items |
| Presentation/demo | 5 | Strong (visual timeline) | Rehearsed script |
| Q&A | 5 | Positive (can explain every rule) | — |
Does not directly improve: offline, PPE, induction (bonus). It cannot win alone; protect mandatory completeness.

## 9. Demo scenario (all fictional)
Plant X, Pump Bay C-2. Contractor "Ravi" [ILLUSTRATIVE] reports a weeping flange by voice (Marathi) + photo; thread T-031 created, assigned. Night shift reports again → "me too" joins thread (count 3 across 2 shifts). Supervisor closes with action "tighten bolts + retrain crew"; action-strength advisor tags it *administrative/symptom fix* and prompts for a durable control (human decides). Day 9: a new report in C-2 → **"Closure didn't hold"** badge; escalated to safety manager; timeline shows 5 reports, 2 closures. Dashboard heatmap cell (C-2, night) goes red; handover digest lists T-031 first; a new contractor entering C-2 sees the open hazard in their zone briefing. **Memorable moment:** the timeline flipping from ✔ Closed to ✖ Recurred, with the reason shown. Never claim an incident would have happened.

## 10. Risks & limitations
| Risk | Mitigation |
|---|---|
| Thread matching false merges | Suggest, human confirm; split/merge; show similarity reasons |
| Closure window arbitrary | Configurable [ASSUMPTION]; ask mentors |
| Overselling novelty | Say "not publicly demonstrated in sources found" |
| Treating flags as predictions | Wording: "recurred", never "will occur" |
| Surveillance perception | No individual metrics; confidential option |
| Mandatory items neglected | Build five core items first |
| GenAI undeclared | Declaration slide (−10) |
| Source quality | Vendor and practitioner sources; verify |

## 11. Final recommendation
If the team builds SafeSite: make **Hazard Memory** the signature, deliver the five mandatory items first, then add cheap amplifiers (me-too, handover digest, zone briefing). Keep Barrier Health Lens and Silence Map as stretch ideas or "future work" slides. Note: my earlier comparison [12] preferred PS4 by a narrow margin; this report does not change that analysis, it only gives SafeSite its strongest concept. **Decide which statement the team is building.**

## Sources (accessed 2026-11-12 via search summaries; not all pages opened)
S1 Sphera, "Turning safety data into action": https://sphera.com/resources/blog/turning-safety-data-into-action-how-ai-and-digital-platforms-are-advancing-modern-ehs-programs/ · S2 Intelex Input AI/Insight AI (Nov 2025): https://blog.intelex.com/2025/11/25/input-ai-insight-ai/ · S3 IT Brief on Sphera AI tools: https://itbrief.co.uk/story/sphera-launches-ai-tools-after-survey-flags-safety-delays · S4 Verdantix EHS benchmark: https://www.verdantix.com/venture/report/ehs-software-benchmark-safety-incident-and-risk--management · S5 AIChE CEP, process safety indicators: https://www.aiche.org/resources/publications/cep/2016/february/predict-incidents-process-safety-performance-indicators · S6 CCPS Process Safety Metrics v4.1: https://www.aiche.org/sites/default/files/docs/pages/ccps_process_safety_metrics_-_v4.1.pdf · S7 CV/PPE limits (arXiv, blogs): https://arxiv.org/pdf/2605.19869 · S8 Tixier et al. NLP for injury reports: https://arxiv.org/abs/1907.11769v1 (construction injuries, not near-miss clustering) · S9 BritSafe, hidden failures in PSM: https://www.britsafe.in/blog/the-hidden-failures-that-weaken-process-safety-management · S10 Near-miss detection article (practitioner): https://www.geosurge.ai/corpus/gen-3445/behavior-based-safety/near-miss-detection.html · S11 Wolters Kluwer SIMOPS / Enablon control of work: https://wolterskluwer.com/en/expert-insights/your-5-step-plan-to-have-control-over-simops-in-your-plant · SS5/SS7/SS10: see research/_archive_safesite/11_sources.md.
Not verified: peer-reviewed evidence on closure-holds detection effectiveness; any competitor's lack of this feature; hierarchy-of-controls wording (general safety knowledge, not sourced here).
