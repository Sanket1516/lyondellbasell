# Round 2 Problem Statements — extracted

Source: `data/LYB_Mumbai_Hackathon_2026_Round2_Problem_Statements.pdf` (13 pages). Hypothetical scenarios; "Plant X" is a fictional company.

## Rules
1. One statement per team; cover **all 5 core** expectations. Bonus is optional.
2. Any stack, web or mobile. Open-source tools and APIs welcome.
3. Create your own sample data. Fictional only. No real/personal/confidential data; none is supplied (before or during presentation).
4. Run your own demo. Judges give no inputs or scenarios; you run your own end-to-end flow live.
5. Generative AI allowed but **must be declared** (where and how). **Undeclared use costs 10 points.** Every member must be able to explain all code, data and design.

Deliverable is a **coded, live-demoed app/web app/tool** — not slides or a concept. State assumptions.

## Presentation: 10 min per team, scored out of 100
| Segment | Time | Content |
|---|---|---|
| Problem & approach | ~2 min | Users, problem, key decision, where AI is and is not used |
| Live demo | ~4 min | Own scenario end to end on own sample data |
| Defend | ~2 min | Controls, risks, assumptions, pilot / next step |
| Judges' Q&A | ~2 min | At least one technical and one assumption question |

Have ready: (a) a measurable impact indicator with calculation + assumptions; (b) a simple architecture diagram matching the demo; (c) controls for AI risk — human review, confidence, privacy, access.

## Scoring (100)
| # | Criterion | Pts |
|---|---|---|
| 1 | Problem understanding & user fit | 10 |
| 2 | Innovation & original thinking | 10 |
| 3 | Working prototype / functionality | **20** |
| 4 | Technical design & architecture | 10 |
| 5 | Feasibility & scalability | 10 |
| 6 | Business / user value & impact | **15** |
| 7 | Responsible AI, security & data | 10 |
| 8 | User experience & accessibility | 5 |
| 9 | Presentation & demo | 5 |
| 10 | Q&A & team understanding | 5 |

## Final checklist
One statement, all 5 core covered · focus user & problem named · working prototype runs live · own sample data, nothing real · impact indicator with calculation/assumptions · architecture diagram matches demo · human review, confidence, privacy controls built in · GenAI use declared · every member can explain code, data, trade-offs.

---
## PS1 — Circular Plastics Exchange (Ending Plastic Waste)
**Context:** Plant X (fictional polymer maker) wants more plastic waste back in the recycling loop; waste from housing societies, campuses, small businesses is mixed, unsorted, untraceable.
**Objective:** Web/mobile platform connecting waste generators with collectors and recyclers; simple sorting, pickup, traceability.
**Roles:** waste generators, collectors, recyclers.
**Core:**
1. Separate logins for generators, collectors, recyclers.
2. Generator uploads photo → app identifies plastic type (PET, HDPE, PP…) with confidence score.
3. Match each listing to suitable collector/recycler by plastic type, quantity, location.
4. Schedule pickups; track status from requested → recycled.
5. Impact dashboard: kg diverted by plastic type and area, estimated CO₂ avoided.
**Bonus:** rewards/points for generators · QR label per batch (chain of custody) · (third item truncated in PDF).

## PS2 — SafeSite: A Digital Safety Companion (Safe People and Plants)
**Context:** Plant X (fictional chemical site): near-misses/hazards go unreported (slow, paper-based, feels pointless). Contractors and new joiners most at risk.
**Objective:** Mobile-first app: report a hazard in **under a minute**, route to the right person, show supervisors where risk builds up.
**Roles:** workers/contractors, supervisors, safety managers.
**Core:**
1. Separate logins for the 3 roles.
2. Report hazard/near-miss with photo, voice-to-text, location.
3. Auto-classify by hazard type and severity; flag likely duplicates.
4. Each report → assigned action, tracked to closure with due dates and escalation.
5. Dashboard: heatmap by area and shift, trends, repeat hazards.
**Bonus:** offline reporting that syncs later · contractor induction quiz before check-in · PPE check from a photo.

## PS3 — Order-to-Delivery Control Tower (Supply Chain and Logistics)
**Context:** Plant X (fictional polymer producer) ships bulk to business customers; order passes planning → dispatch → transport → delivery; customers/sales learn of lateness only after it happens.
**Objective:** Web app tracking orders plant → customer, predicting delays, one shared view.
**Roles:** customer, logistics coordinator, transporter/driver.
**Core:**
1. Separate logins for the 3 roles.
2. Track orders/shipments on a map with status milestones.
3. Predict ETA and delay risk per shipment, **show the reason**.
4. Alert customer and coordinator on delay risk with suggested action (reroute, split shipment).
5. Dashboard: on-time performance and delay causes by route and transporter.
**Bonus:** truck slot booking at plant gate · "Where is my order?" chatbot · invoice / proof-of-delivery upload & download.

## PS4 — Smart Procure-to-Pay Assistant (Smarter Business Processes)
**Context:** Fictional finance team at Plant X processes large invoice volumes; mismatches with PO/goods receipt, duplicates, missing approvals → late payments, delays, audit risk.
**Objective:** Web app that reads supplier invoices, checks vs purchase records, approves/flags/blocks each with a clear reason.
**Roles:** suppliers, accounts-payable clerks, approvers.
**Core:**
1. Separate logins for the 3 roles.
2. Suppliers upload invoice (PDF/image); app extracts vendor, PO number, items, quantities, prices, tax.
3. 3-way match invoice ↔ PO ↔ goods receipt; approve/flag/block with reason (price, quantity, missing receipt).
4. Approval workflow with role-based thresholds and audit trail of every decision.
5. Exceptions dashboard by type, supplier, age; supplier view of invoice status.
**Bonus:** duplicate-invoice detection · "Where is my payment?" chatbot · simple controls report for auditors.

> Note: the dossier (`lyb_dossier_notes.md` §Playbook) flags LYB's S/4HANA **Source-to-Pay** track and Cash Improvement Plan — relevant to PS4; Order-to-Delivery/Produce-to-Deliver — PS3; Safety/La Porte — PS2; Circular/MoReTec — PS1.
