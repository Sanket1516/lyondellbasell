# 08 Constraints & Risks

**TL;DR**
- Core financial risks: duplicate/incorrect payments, fraud, unauthorised approvals, tax-invalid invoices.
- Auditors typically test: 3-way match, segregation of duties, tiered approvals, audit trail (S10; practitioner guidance, not SOX text). [VERIFIED-secondary]
- India: invoices without a valid IRN may lose buyer ITC where e-invoicing applies; thresholds must be verified (S8).
- DPDP applies to personal data in invoices/contacts; employment-purpose processing may not need consent but must be necessary (S13).
- AI must be advisory with human override; show confidence and reasons.

## Financial
Duplicate: SAP check uses vendor/currency/company code/reference/date; amount handling sources conflict (S7) → also use amount+date fuzzy check. Fraud: fake vendors/changed bank details [INFERRED]. Misstatement: unrecorded liabilities from stuck invoices.
## Security
RBAC (3 roles), authentication, least privilege, API security, encryption at rest/in transit, immutable audit log, segregation of access (clerk ≠ approver, approver ≠ creator). 
## Regulatory (binding vs practice)
- Binding: GST e-invoice/ITC rules (S8, verify); DPDP (S13); SOX 404 only applies to US-listed LYB — and as control expectation here (S10).
- Practice: 3-way match, tolerance tiers, DOA limits.
## Operational
ERP dependence, bad master data, document quality, multiple formats (LYB Mexico: <10 MB, 1 invoice/PDF, ≤5 per email; S2), multi-currency/tax, partial deliveries, UoM.
## Human
Trust in automation, approver accountability, supplier adoption, training; clerks need to override AI.
## Demo-relevant controls
Confidence thresholds, human review queue, reason codes, audit trail, role segregation, synthetic data banner, GenAI declaration. Cross-refs: [01](01_problem_breakdown.md), [07](07_tech_landscape.md).
