# 01 Problem Breakdown

**TL;DR**
- The problem is not collecting reports; it is that safety information is lost between "worker notices risk" and "organisation fixes it". [INFERRED]
- Five breakpoints: notice → feel safe to report → submit → get an owner → see it resolved.
- Top barriers: fear of blame, friction, no visible follow-up (S7, S8). [VERIFIED, vendor/secondary sources]
- Contractors/new joiners are named as highest-risk in the brief; La Porte 2021 (contract workers, no procedure/training) shows why (S5). [VERIFIED]
- Near-miss reporting is generally not legally mandated, so it is a culture/system problem, not a compliance one (S7). [VERIFIED-secondary]

## Clarification log
| Q | Answer | Status |
|---|---|---|
| Q1 primary role | Contractor / new joiner primary; supervisor + safety manager supporting | [DEFAULT ASSUMPTION] |
| Q2 constraints | Assume ALL: poor connectivity, restricted phones, gloves, noise, multilingual (EN/HI/MR), shared devices — maximum priority | [CONFIRMED – TEAM] |
| Q3 priority | Closed-loop action (report → owner → closure) first; <60 s reporting as entry; dashboard as proof. Chosen to maximise rubric (prototype 20, impact 15, responsible AI 10) | [DEFAULT ASSUMPTION] |
| Q4 anonymity | Identified by default + optional confidential/anonymous mode | [DEFAULT ASSUMPTION] |
| Q5 extra organiser info | None; no data/APIs supplied (rules PDF: none provided); generic hazard taxonomy + 5×5 matrix | [DEFAULT ASSUMPTION] |

## A. Explicit problem
Build a mobile-first app: <1 min hazard report; route to right person; show supervisors accumulating risk. Core 5: role logins; photo + voice-to-text + location; auto classify type/severity + duplicate flag; action with due date/escalation to closure; dashboard heatmap by area & shift, trends, repeats. Bonus: offline sync, induction quiz, PPE-from-photo. Unspecified: hazard taxonomy, severity scale, escalation rules, anonymity, location model, auth for contractors, duplicate definition, PPE success criteria. (Rules: own sample data, run own demo, declare GenAI or lose 10 pts.)

## B. Underlying business problem
| Question | Finding | Tag |
|---|---|---|
| Why don't employees report? | Fear of blame/retaliation, paperwork on own time, no acknowledgement, belief nothing changes | [VERIFIED-secondary] S7 |
| Why contractors/new joiners vulnerable? | Unfamiliar with site, task seen as "simple", no procedure/training (La Porte) | [VERIFIED] S5 |
| What happens if near-miss unreported? | Hazard persists; causes not analysed; recurrence | [INFERRED] from S7, S8 (ISO 10.2 root-cause expectation) |
| Why can supervisors miss recurrence? | Reports in separate channels (paper/WhatsApp/verbal), no location/shift aggregation | [ASSUMPTION] |
| Why don't reports become closed actions? | No owner, no due date, no escalation, no feedback | [INFERRED] S7 ("recommendations must be acted upon") |

## C. People affected
Encounter: operators, contractors, maintenance. Report: any worker. Receive: shift supervisor. Investigate: HSE officer. Assign CAPA: supervisor/HSE. Verify closure: HSE/safety manager. Accountable: plant/site management (ultimately). Exact LYB roles [UNKNOWN – ASK MENTOR].

## D. Success after six months (all hypotheses, to validate)
- Worker: faster reporting; contractors report at all; get feedback on their report.
- Supervisor: acknowledges and assigns quickly; fewer overdue actions.
- Safety mgmt: visible hotspots by area/shift; repeat hazards surfaced; closure rate tracked.
- Org: audit-ready trail; less admin; fewer repeat events. Reporting counts may RISE first (not a failure).

## E. Ambiguities → proposed working assumptions (all [ASSUMPTION], logged in 10)
Hazard vs near-miss: hazard = condition; near-miss = event with no harm → one form, type field. Severity by safety manager, AI suggests only. Location: plant zone picker (+GPS fallback). Contractor auth: site-issued code/QR, not corporate SSO. Offline: queue draft + photo, sync with idempotent ID. Duplicate: same zone + similar text/photo within a window → flag, never auto-merge. PPE verify: advisory only.

## Problem tree / 5 Whys
- Symptom: hazards unreported, repeat issues, open actions.
- 5 Whys: Why unreported? → friction/fear. Why fear? → blame culture/job risk (esp. contractors). Why persists? → no visible response. Why no response? → no owner/SLA/escalation. Why no owner? → reports not triaged to an accountable person in one system. [INFERRED]
- Consequence: recurrence → incidents (cf. La Porte), audit gaps, cost.
- Cross-refs: [03](03_stakeholders.md), [04](04_employee_personas_and_journeys.md), [08](08_constraints_and_risks.md).
