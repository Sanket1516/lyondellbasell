# 02 Company Context (LYB — P2P relevant only)

**TL;DR**
- LYB publicly runs supplier invoicing via SAP Ariba Network plus email PDF, XML, EDI and ERS; paper discouraged (S1, S2). [VERIFIED]
- LYB's supplier rules: unique invoice ID, 3-way match (qty, price, description), payment terms must match PO, vendor name must match PO, no duplicate multi-channel sends (S2, S3). [VERIFIED]
- Payment terms vary by region (45 d Germany, 60 d Netherlands; S4–S5). [VERIFIED]
- LYBOM/S4HANA includes Source-to-Pay (supplier onboarding, contracts, invoice processing) (D). [VERIFIED-posting evidence]
- Cash Improvement Plan: $1.3B cumulative target by end-2026, trade working capital cut ~$400M in 2025 (D). [VERIFIED]

| Fact | Source | Why it matters |
|---|---|---|
| 5 segments; O&P-Americas and I&D ≈85% of 9M 2026 segment EBITDA | D | Invoice flows concentrated in US Gulf Coast plants [INFERRED] |
| Mumbai hosts SAP, procurement, DT roles; Mumbai "Category Specialist / Tail Spend" roles use AI/digital sourcing tools | D | Judges likely DT/procurement-minded; tail-spend angle [INFERRED] |
| S2P track tasked to standardise supplier onboarding, contract mgmt, invoice processing on S/4HANA | D | Direct alignment with PS4 |
| Cash Improvement Plan, fixed-cost cuts, "scalable fixed costs" | D | Frame value in cash/cost terms |
| Tech: Azure, ServiceNow, Power BI/Tableau, MuleSoft, Azure OpenAI/Bedrock hiring | D | Stack fluency for architecture slide (not a final choice) |
| Ariba job aid: invoices must reference bill-to entity; Mexico: <10 MB, 1 invoice/PDF, ≤5 per email | S2, S3 | Concrete validation rules for the demo |
| AP is account-status resource; buyers are primary contact; inquiry response 24–48 h | S2 | Supports "Where is my payment?" value |
Not verified: LYB invoice volumes, supplier counts, exception rates, internal matching tolerances → "Data unavailable — requires mentor validation." Not every LYBOM initiative covers AP automation (D says posting-based). Cross-refs: [05](05_current_process_and_systems.md), [09](09_value_and_metrics.md).
