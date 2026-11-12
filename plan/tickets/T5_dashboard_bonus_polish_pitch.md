# T5 — Dashboard, bonus items, polish and pitch assets

**Read first:** `CLAUDE.md`, `00_PLAN.md`, handoffs T1–T4.
**Depends on:** T4. **Delivers:** core item 5 (dashboard) + bonus chatbot and controls report + pitch assets.
**Estimate:** one to two sessions. Order matters (cut line at the end).

## Goal
Finish the mandatory scope, add the two remaining bonus items, make the UI demo-grade, and produce what the rules and judges require outside the app (AI declaration, architecture diagram, impact calculation).

## Work order (do in this order)
### 1. Exceptions dashboard (`/dashboard`, clerk and approver): MANDATORY
- **By type** (price, quantity, missing receipt, duplicate, tax, unit of measure, off-contract), **by supplier**, **by age** (0–2, 3–7, 8–14, 15+ days). Charts are hand-built SVG in the design tokens (no default chart-library look): horizontal bars, a stacked ageing bar, a small ranked table.
- **Root-cause panel**: top causes with counts; "PO not updated after contract change: 7 cases → upstream fix: update 7 POs" with the affected POs listed (a link to each invoice). The golden journey adds to this live: after resolving INV-7781, counts and ageing update.
- Filters: supplier, date range; clicking a bar filters the table below. Numbers come from state, never hard-coded.
- A KPI strip (no more than four): open exceptions, average age, first-pass match rate, blocked value, each with its definition on hover.
### 2. Polish pass on every screen
Empty/loading/error states, consistent copy, tab order, keyboard shortcuts on the clerk queue (J/K, Enter), long-text wrapping, 1366×768 and 1920×1080 checks, print-friendly controls report. Re-check plan §7 line by line.
### 3. Controls report for auditors (bonus) (`/audit/report`)
A one-page report generated from state: controls tested (three-way match enforced on N invoices, 0 paid without a match, approval thresholds applied, SoD violations attempted/refused, duplicates blocked, audit chain verified with timestamp), exceptions summary, sample evidence links. Export to PDF using the browser print stylesheet.
### 4. "Where is my payment?" chatbot (bonus), supplier view only
**Deterministic, grounded intents** (no LLM): invoice status, why held, what's needed from me, payment due date, "which invoices are late?". Answers are templates filled from invoice state, quote the exact timeline data, and say "I can't see that" for anything unknown. A quick-reply chip row for the common questions. No free-text hallucination, and it can only read the logged-in supplier's data. Label it "Answers come from your invoice records".
### 5. Pitch assets (`pitch/`)
- `AI_DECLARATION.md`: where AI was used (build-time assistants such as Claude Code, Google Antigravity, OpenAI Codex; synthetic data and document generation scripts) and where it is **not** (no runtime AI in matching, root cause, thresholds or chatbot). Be specific and honest. This avoids the −10 penalty.
- `architecture.svg` (or PNG): matches the plan §5 exactly; dashed future adapters.
- `impact.md`: one calculation with assumptions labelled. Example: 300 exceptions/month × 20 min saved = 100 h/month; show the inputs, source of each assumption, and what we do *not* claim.
- `demo_script.md`: the timed 4-minute script from the plan with exact clicks, the fallback plan for each step, and answers to likely judge questions (tolerances, integration, wrong extraction, why no AI, segregation of duties).
- `README.md` "How to run" and a one-page "Judge Q&A" cheat sheet.
### 6. Rehearsal
Run the full golden journey three times from a fresh reset; time it (target 4:00 ± 20 s); fix any friction found. Test on the demo laptop with the network off.

## Out of scope
Anything not in the slide. No new roles or integrations.

## Acceptance criteria
- [ ] Dashboard shows by type / supplier / age and updates live after the golden journey; numbers reconcile with the invoice list (test).
- [ ] Controls report matches the audit data (test) and prints cleanly to one page.
- [ ] Chatbot answers all five intents correctly for each seeded supplier and refuses to answer about other suppliers' invoices.
- [ ] Declaration, architecture diagram, impact note and demo script are complete and consistent with what the app does.
- [ ] Three clean rehearsals within the time target; works offline.
- [ ] Design review: no AI-template tells (plan §7), consistent spacing, no console errors.
- [ ] Full test suite green; tester PASS from Lokesh and Utkarsh on the final build.

## Cut line (if behind schedule)
Drop in this order: (1) chatbot, (2) controls report, (3) keyboard shortcuts. **Never drop** the dashboard, audit trail, or the rehearsal.

## Tester checklist
Run the whole journey from the demo script on a clean machine; check reset; verify every dashboard number against the invoice list; ask the chatbot edge-case questions; print the controls report; read every screen for copy that sounds like marketing or a template.

## Handoff
`plan/handoffs/T5_handoff.md`: final state, demo checklist, any known issues, what to say if something fails live.
