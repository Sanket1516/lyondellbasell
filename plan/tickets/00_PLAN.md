# 00 — Master Plan: PS4 Smart Procure-to-Pay (prototype demo)

**TL;DR**
- Goal: a **polished, scripted prototype** that runs one flawless end-to-end journey on predefined demo documents. Not a full website. All five core items must work for real on that data.
- Scope is locked to the slide: 5 core expectations + the 3 listed bonus items (duplicate detection, "Where is my payment?" chatbot, controls report). Nothing else.
- Five tickets, one per fresh session, in `plan/tickets/`. Order: T1 → T2 → T3 → T4 → T5. Merge to `main` only after tester PASS.
- Winning hook (lives inside core item 3, "approve/flag/block **with a clear reason**"): every reason names the **root cause, the owner, and the smallest fix**.
- UI must look hand-designed for a finance desk, not AI-generated (rules in §7).
- Decisions marked [ASSUMPTION] are mine; change them freely before T1.

## 1. What the slides say, and what it means for us
| Slide item | Implication |
|---|---|
| Context: mismatches vs PO/GR, duplicates, missing approvals → late payments, delays, audit risk | The demo must show all four failures being caught |
| Objective: reads invoices, checks vs purchase records, approves/flags/blocks **with a clear reason** | The *reason* is the product. Invest here |
| 1 Separate logins: supplier, AP clerk, approver | Three real login paths with role-guarded screens |
| 2 Upload PDF/image; extract vendor, PO no., items, qty, prices, tax | Real extraction on our predefined docs, with confidence and click-to-source |
| 3 Match invoice+PO+GR; approve/flag/block with reason (price, qty, missing receipt) | Deterministic engine; all three reason types demonstrated |
| 4 Role-based thresholds + audit trail of every decision | Amount-based routing, segregation of duties, append-only log |
| 5 Exceptions dashboard by type, supplier, age + supplier status view | Seeded history so charts are meaningful; supplier timeline |
| Bonus: duplicates, chatbot, controls report | Included, built last, cut in that order if time runs out (chatbot first) |
| Rule 3 own data · Rule 4 own demo | We control every input, so we script and rehearse one journey |
| Rule 5 declare GenAI (−10) | `pitch/AI_DECLARATION.md` is a T5 deliverable |
| Scoring: prototype 20, impact 15, tech/feasibility/AI-security 10 each | Reliability beats breadth; one defensible impact calculation; visible controls |

## 2. Locked scope
**In:** the five core items; duplicate-invoice detection; "Where is my payment?" chatbot; controls report for auditors; a "Reset demo data" control; the audit trail.
**Out (do not build):** webhooks/ERP integrations (mention as architecture slide only), real OCR across arbitrary layouts, payment execution, mobile app, multi-plant/multi-currency, email notifications, admin panels, real user management, tolerance simulator, predictions/ML, extra roles (buyer, warehouse).
Buyer/warehouse owners appear as **named owners on tasks** only. In the demo the clerk records their actions via a clearly labelled "Simulated ERP update" control.

## 3. Key decisions [ASSUMPTION unless noted]
| Topic | Decision | Why |
|---|---|---|
| Stack | Next.js (App Router) + TypeScript, **CSS Modules + design tokens** (no UI kit, no Tailwind defaults) | One codebase and one command; custom look avoids the "template" feel |
| Storage | JSON snapshot + in-memory repository, "Reset demo data" button | No DB setup risk on stage |
| Auth | Real login form, signed session cookie, role route guards; fictional demo accounts | Meets "separate logins" without an identity provider |
| Extraction | Generated PDFs with a text layer parsed via pdf.js (real, with bounding boxes for click-to-source); one scanned JPG invoice via Tesseract.js with a stored fallback result, flagged lower confidence | Real, offline, and still reliable |
| Runtime AI | **None in the decision path.** Matching, root cause, thresholds, chatbot are rules/templates | Deterministic, explainable, safe. AI used at build time is declared |
| Currency/tax | INR, GST 18% (one 12% case) | Indian-style plant [ASSUMPTION from Q2] |
| Tolerances | Price ±2% of PO; quantity ±5% of cumulative GR; tax must equal PO tax code | Configurable constants, labelled as assumptions |
| Approval thresholds | Clean match ≤ ₹1,00,000: clerk releases · up to ₹15,00,000: Approver L1 · above: Approver L2 | Role-based thresholds |
| Verdicts | **Approve** (all pass) · **Flag** (fixable discrepancy, human action needed) · **Block** (no PO, missing GR, unknown vendor, confirmed duplicate). Invoice verdict = worst line | Maps exactly to the slide |
| Branding | Fictional "Plant X". **No LYB logo or branding** | Avoid impersonation |

## 4. The golden journey (4 minutes, rehearsed)
Cast and exact numbers are in T2. Beats:
1. **Supplier** (Vihar Chem Supplies) logs in, uploads **INV-7781**. Fields extracted with confidence; clicking a field highlights it on the document.
2. System matches against the PO, goods receipts, contract C-22, delivery note and UoM table. Verdict: **Flag**.
3. **AP clerk** sees three line verdicts: L1 price +3.5%, cause *PO not updated after contract amendment*, owner Buyer, fix "passes if PO price = ₹412"; L2 *unit-of-measure only* (auto-cleared); L3 qty 40 vs GR 32, cause *receipt under-posted*, owner Warehouse.
4. Clerk raises both owner tasks. Supplier's status reads **"2 internal actions pending. Nothing needed from you."**
5. Clerk applies the two simulated ERP updates → automatic re-match → clean → routes to **Approver L1** (₹10,62,000).
6. **Approver** opens the evidence card, approves. The audit trail shows every step, with the hash chain intact.
7. **Dashboard:** exceptions by type, supplier, age; top root cause "PO not updated after contract change" (7 seeded cases).
8. Quick extras: upload the duplicate **INV-6120R** → blocked "possible duplicate of paid INV-6120"; supplier asks the chatbot "Where is my payment?" → grounded answer; open the **controls report**.
Never call an anomaly "fraud"; humans approve every payment-relevant decision.

## 5. Architecture (for the slide, must match the demo)
Browser (3 role UIs) → Next.js API routes → Extraction (pdf.js / Tesseract.js) → Match & Root-Cause Engine (rules) → Workflow Service (thresholds, SoD, tasks) → Audit Log (append-only, hash-chained) → Snapshot store (seeded Plant X data). Adapters for ERP/Ariba/mailbox are **shown dashed as "future"**.

## 6. Ticket map
| Ticket | Title | Depends | Delivers |
|---|---|---|---|
| T1 | Foundation, design system, auth, seed store | — | App shell, 3 logins, tokens/components, data layer, reset |
| T2 | Demo data, documents & extraction | T1 | Seed dataset, 6 demo documents, parser, upload UI (core 2) |
| T3 | Match & Root-Cause engine + duplicates | T2 | Core 3 + duplicate bonus, tests, clerk review screen |
| T4 | Workflow, thresholds, audit trail, supplier status | T3 | Core 4 + supplier status half of core 5 |
| T5 | Dashboard, bonus, polish, pitch assets | T4 | Core 5 dashboard, chatbot, controls report, AI declaration, impact, rehearsal |
Cut line if time runs short: drop chatbot, then controls report. **Never** drop the dashboard or the audit trail.

## 7. UI direction: must not look AI-generated
**Identity:** a calm, dense finance desk, like a real internal AP tool.
- **Avoid:** purple/blue gradients, glassmorphism, glowing shadows, emoji icons, giant rounded cards, centered hero banners, "Welcome back 👋", default chart palettes, lorem ipsum, identical card grids, Inter/Space Grotesk defaults.
- **Use:** IBM Plex Sans for UI and IBM Plex Mono with tabular numerals for amounts and IDs. A restrained palette: warm off-white paper `#F6F5F1`, ink `#1B2330`, one deep teal accent `#0F5C63`, status colours used only for status (green `#2E7D4F`, amber `#B7791F`, red `#B3372F`, grey `#6B7280`). 4px radii, 1px hairline borders, minimal shadow.
- **Layout:** a left rail with plain-text navigation, a top bar showing the Plant X payables desk and the logged-in role. Tables with sticky headers and right-aligned numbers. Invoices open as a **split view**: document on the left with highlight boxes, findings on the right.
- **Details that sell realism:** Indian number grouping (₹10,62,000), real dates (DD-MMM-YYYY), real-looking invoice and PO numbers, status chips, ageing badges, keyboard focus rings, empty and loading states, short plain sentences ("Price is 3.5% above PO. Contract C-22 sets ₹412.").
- **Copy:** no marketing voice. Say what happened and what to do next.
- **Accessibility:** contrast ≥ 4.5:1, visible focus, no information by colour alone, labels on all inputs.

## 8. Working agreement
- One ticket per fresh session. Read, in order: `CLAUDE.md`, this file, your ticket, the previous ticket's handoff in `plan/handoffs/`.
- End each ticket: tests pass, tester checklist run, `plan/handoffs/T0X_handoff.md` written, `project-state/00_START_HERE.md` updated.
- Testers (Lokesh, Utkarsh) test with `prompts/05` and never edit feature code. Merge to `main` only after PASS.
- Every number shown in the demo comes from seeded data, never hard-coded in the UI.

## 9. Risks
| Risk | Mitigation |
|---|---|
| Image OCR misreads live | Stored fallback result for that single file; label the confidence |
| Demo state drifts between rehearsals | "Reset demo data" + deterministic seed |
| UI looks generic | §7 rules + T1 design review before T2 |
| Time runs out | Cut line in §6 |
| Judges ask about integration | Architecture slide with dashed adapters; mentor question list |
| Undeclared AI | T5 declaration deliverable |
