# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- Accounts-payable clerks at a chemical plant ("Plant X"), reviewing a queue of supplier invoices all day.
- Approvers (L1/L2 by amount) deciding on invoices the clerk has cleared or escalated.
- Supplier staff submitting invoices and checking payment status, including a payment chatbot.
- Auditors/controllers reading the exceptions dashboard, audit trail and controls report.

## Product Purpose
Smart Procure-to-Pay Assistant (hackathon prototype, LYB Mumbai Hackathon 2026, PS4). Each submitted invoice is checked deterministically against the project's own PO, goods receipt, contract and vendor records. Findings are shown with their evidence; clerks resolve, approvers decide, and every step lands in a tamper-evident audit trail. Success: a judge sees the full golden journey (supplier upload, clerk review, approval, audit) in about four minutes and trusts it.

## Positioning
Verdicts come from fixed matching rules with visible source evidence and a hash-chained audit log, not from runtime AI.

## Operating Context
Synthetic data only. Roles: supplier, clerk, approver. Demo runs on a projector and laptop on stage.

## Capabilities and Constraints
Next.js + TypeScript + CSS Modules, SQLite store. Functionality, routes, server actions and copy must not change; this is a visual redesign. Tests (118+) must keep passing. Must not look AI-generated.

## Brand Commitments
Product name shown in the shell: "Plant X Payables Desk". No real LYB branding or data.

## Evidence on Hand
Seed data in data/seed. No real customers, benchmarks or claims; do not invent any.

## Product Principles
- Evidence beside every verdict.
- Fast scanning for repeated daily work.
- The audit trail is a feature, not a footer.
- Plain language over jargon.

## Accessibility & Inclusion
Readable on a projector; keyboard focus visible; status never conveyed by colour alone.
