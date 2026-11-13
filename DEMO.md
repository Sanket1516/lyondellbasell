# PlantPay demo script (10 minutes)

Plant X Payables Desk, Next.js app. Synthetic data only. Start: `npm run setup` once, then `npm run demo`, open http://localhost:3000.
Warm up before judges arrive: open `/plantpay/predictions` and `/plantpay/journey` once (first load is slowest, about 2 to 5 seconds; later loads are under 1 second).

## Logins (click to fill on the login page)

| Role | Username | Password |
|---|---|---|
| Supplier (Vihar Chem Supplies) | vihar.supplier | Vihar@2026 |
| AP Clerk (Priya Nair) | priya.clerk | Clerk@2026 |
| Approver L1 (Neha Kulkarni) | neha.approver | ApproverL1@2026 |
| Approver L2 (Rajesh Menon) | rajesh.approver | ApproverL2@2026 |

Brief names map to demo records: ABC Chemicals = Vihar Chem Supplies; INV-2044 = **INV-7781** (invoice ₹412 vs PO ₹398); INV-1001A = **INV-6120R** (duplicate of a paid invoice).

## Click path

| # | Click | Say | Point at |
|---|---|---|---|
| 1 | Open `/login` | "Plant X gets hundreds of invoices a month. Mismatches sit for days, duplicates slip through, approvals go missing." | The "why" paragraph on the login card |
| 2 | Log in as **vihar.supplier**, upload `INV-7781.pdf` (demo document), confirm fields, submit | "A supplier uploads a PDF. We extract six fields; the supplier checks them, then submits." | Editable review form; role banner "Know where your payment is" |
| 3 | Log in as **priya.clerk** → Invoice queue → INV-7781 | "The rules checked it against the PO and goods receipt in seconds. Verdict: flag. Price ₹412 against PO ₹398." | Role banner (hours saved), verdict pill, reason text |
| 4 | Open "Exception resolution" for INV-7781 | "Not just a mismatch: the contract was amended, the PO was not updated, the buyer owns it. This would pass if the PO price were ₹412." | Root cause (evidence-supported), "What would make this pass", Simulate button |
| 5 | Request fix → simulate ERP update → re-match → route to Approver L1 | "The owner fixes the record, the invoice is re-matched, and only a clean one reaches the approver." | Task, status change, routing rule (clerk ≤ ₹1 lakh, L1 ≤ ₹15 lakh, L2 above) |
| 6 | Log in as **neha.approver** → open INV-7781 → Approve with a comment | "The approver sees what needs sign-off and the evidence on one screen." | Role banner, evidence, comment box |
| 7 | `/audit` → Verify integrity | "Every step is hash-chained. One click proves nothing was altered." | "Chain intact" message |
| 8 | `/dashboard` | "Exceptions by type, age and supplier, with the upstream fix that clears the most cases, and what PlantPay saved." | Impact tiles, "What would happen without PlantPay?" table |
| 9 | Supplier: INV-6120R (or clerk queue) | "Same invoice number reissued with a letter suffix. Caught as a duplicate before approval. Warning, not proof." | Duplicate finding, "Confirmed duplicate of INV-6120" |
| 10 | Supplier → chat: "Where is my payment for INV-7781?" | "Live answer from the records, no email chase." | Chat reply |
| 11 | `/audit/report` | "Controls report for auditors: six controls, impact summary, approvals by role." | Impact summary, six controls |
| 12 | `/plantpay/innovations` | "Ten features, each with a See it live button." | Rule-based / AI-assisted labels |

Shorter alternative: `/plantpay/journey` runs the whole story in nine guided steps (Next/Back or arrow keys; presenter notes toggle with a timer; closing screen ticks every feature).

## Fallback plan

- Any live call fails in the Journey: it switches automatically to pre-computed results and says so on screen. You can also force it with `?fallback=1`.
- A source system acts up: use "Simulate outage" on `/plantpay`, show the affected checks read "source unavailable", then "Bring back online".
- Data looks wrong after rehearsal: Demo controls (bottom of the sidebar) → "Reset demo data".
- App will not start: `npm run setup` then `npm run demo`. Last resort: show the pitch slides in `pitch/`.

## Presenter one-liners

- Rules decide; AI explains; people approve.
- Every risk flag says "Warning, not proof. Human review required." A bank-detail change says "Requires independent verification".
- A predicted cause is "unverified prediction" until a record backs it.

## Q&A cheat sheet

**Why not just use SAP or Oracle for this?**
PlantPay adds the intelligence layer on top: root cause, counterfactual, supplier criticality, process mining. ERP systems flag; PlantPay explains, routes and predicts.

**Is the AI making financial decisions?**
No. AI explains and predicts; deterministic rules validate; humans approve. Every AI output is labelled and every decision is in the audit trail.

**What happens if a source database is down?**
The integration layer degrades gracefully. The affected check is labelled "source unavailable" and the rest of the pipeline continues. Demo it live with the outage toggle on `/plantpay`.

**How would this scale to Plant X's real invoice volume?**
SQLite is a demo convenience. Connectors are database-agnostic; swap to PostgreSQL and the architecture is unchanged. Re-matching is event-driven, so processing is asynchronous and can run on parallel workers. See `/plantpay/architecture`.

**How do you prevent false accusations from the risk flags?**
Every flag says "warning, not proof". Bank changes require independent verification. The system never blocks on a risk flag alone; it creates a review task.

**What is the most innovative part?**
Root-Cause Resolver combined with the Counterfactual Explanation: not "mismatch found" but "here is why, who is responsible, and what exact change would make this invoice pass."

**Where do the impact numbers come from?**
Counts and rupee values (duplicate value held, invoices matched clean, exceptions with a root cause) are computed from the demo records each time the page loads. Time and day comparisons use three labelled assumptions: 12 minutes per manual check, 3 days to find a root cause, 5 working days for a supplier reply. They are marked "assumption" on screen. Data is synthetic.

**How do you know the ML predictions are real?**
Four models are trained on synthetic history, evaluated on a held-out split, and saved to disk (`data/ml/models.json`; metrics at `/api/plantpay/v1/models`). Probabilities come from the model, never hard-coded, and each shows its contributing factors.

**Can a supplier see another supplier's data or internal notes?**
No. Supplier pages read only that supplier's invoices, and internal notes and risk flags are left out by construction (the passport builder never receives them). Staff pages return a no-access page to a supplier session.

**Are the APIs protected?**
Yes. Every `/api/plantpay/v1` call needs an `x-api-key` or a signed-in clerk/approver session; otherwise 401. Requests are logged to the audit trail. See `/plantpay/api-docs`.

**What if the extraction reads a field wrongly?**
The supplier reviews and edits the six extracted fields before submitting, and the match runs on the confirmed values. Extraction never approves anything.

**What did GenAI do in this project?**
Claude Code helped write the code and documents (declared per the hackathon rules). No generative AI runs in the decision path at demo time.
