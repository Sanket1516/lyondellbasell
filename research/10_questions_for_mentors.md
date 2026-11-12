# 10 Questions for Mentors

**TL;DR**
- Top: unresolved clarifications Q1–Q5 (all [UNRESOLVED] → default assumptions in use), then 10 ranked design questions.
- Must answer before build: tolerances/approval thresholds, expected demo scope/judging, GR/PO data shape.
- Each question lists the dependent decision.

## Unresolved clarifications (default assumptions in use)
U1 Plant X Indian vs global (assumed Indian + GST). U2 Standalone vs SAP integration (assumed standalone). U3 AP-only vs procurement scope (assumed AP + supplier view). U4 Organiser tools/data (assumed none). U5 Extra judging criteria (assumed none).

| # | Question | Decision it drives |
|---|---|---|
| **1 TOP** | What does a successful demo look like to judges and which core items weigh most? | Scope/demo script |
| **2 TOP** | Typical price/quantity tolerances and approval thresholds? | Match rules, workflow |
| **3 TOP** | Format of PO/GR data (fields, partial deliveries)? | Synthetic dataset |
| 4 | Most frequent invoice exceptions today? | Exception taxonomy |
| 5 | Invoice submission channels and volume mix (Ariba/email/EDI)? | Ingestion story |
| 6 | Duplicate handling today? | Duplicate rule |
| 7 | Approval hierarchy and SoD rules? | Roles |
| 8 | What do suppliers ask most about payments? | Status view/chatbot |
| 9 | Is GenAI (Azure OpenAI) expected; declaration rules? | AI choices, −10 pts |
| 10 | Integration expectations (S/4HANA, Ariba, MuleSoft)? | Architecture slide |
