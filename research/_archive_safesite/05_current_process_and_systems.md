# 05 Current Process & Systems (as-is, generic)

**TL;DR**
- This is a GENERIC industry as-is model; LYB's actual process is [UNKNOWN – ASK MENTOR].
- No hazard-reporting system is publicly verified for LYB. SAP EHS / ServiceNow are [POSSIBLE LYB SYSTEM – UNCONFIRMED] (LYB runs SAP and ServiceNow, S12).
- Information loss concentrates at: informal→formal handoff, triage, owner assignment, and handover.
- ISO 45001 expects worker participation, barrier removal and root-cause corrective action (S8). Near-miss reporting itself is typically not legally mandated (S7).
- Regulatory vs voluntary: Indian OSH Code covers hazardous-process risk assessment (S9); near-miss programmes are voluntary good practice.

## Lifecycle (generic) — failure points
| # | Stage | Owner | Info / channel | Delay / failure | Safety implication |
|---|---|---|---|---|---|
| 1 | Hazard identification | Any worker | Observation | Not recognised as hazard | Persists |
| 2 | Immediate risk assessment | Worker/supervisor | Verbal | Inconsistent | Wrong urgency |
| 3 | Informal communication | Worker | Verbal/radio/WhatsApp | Not recorded | Lost |
| 4 | Formal report | Worker | Paper/e-form | Slow, English, fear | Under-reporting |
| 5 | Supervisor notification | Supervisor | Radio/form | Overload | Late ack |
| 6 | Safety-team review | HSE | Email/system | Backlog | Delay |
| 7 | Classification/priority | HSE | Matrix | Subjective | Mis-prioritised |
| 8 | Investigation | HSE/line | Interviews | Late, blame risk | Weak root cause |
| 9 | Corrective action assigned | Supervisor/HSE | Action tracker | No owner/date | Never done |
| 10 | Execution | Maintenance/ops | Work order | Permits, parts | Overdue |
| 11 | Verification | HSE | Inspection | Skipped | False closure |
| 12 | Closure | HSE | Record | Closed w/o proof | Recurrence |
| 13 | Trend reporting | HSE | Excel/BI | Manual, stale | Repeats unseen |
All rows [ASSUMPTION] except where tied to S5/S7/S8 themes.

## Systems taxonomy
| System | Tag |
|---|---|
| SAP EHS / S/4HANA | [POSSIBLE LYB SYSTEM – UNCONFIRMED] |
| ServiceNow (ITSM; used by LYB, S12) | [POSSIBLE LYB SYSTEM – UNCONFIRMED] for EHS |
| Power BI / Tableau (LYB uses, S12) | [VERIFIED LYB SYSTEM] for BI generally; for safety [UNKNOWN] |
| Excel/email | [INDUSTRY STANDARD SYSTEM] |
| Cority/Intelex/VelocityEHS/Enablon/SafetyCulture | [INDUSTRY STANDARD SYSTEM] |
| LYB incident/hazard tool | [UNKNOWN – ASK MENTOR] |

La Porte CSB lesson [VERIFIED]: absence of procedure and training for a "simple" task by contractors (S5) — a reporting app cannot replace procedures, but can surface unreported precursors.
Cross-refs: [06](06_industry_benchmarks.md), [08](08_constraints_and_risks.md).
