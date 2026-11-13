# PlantPay: Responsible AI, Security and Data — 90-second script

**Before you start:** signed in as Clerk on `localhost:3600`, with these tabs open:

1. Sidebar → **Responsible AI** (`/plantpay/responsible-ai`)
2. Sidebar → **Audit trail** (`/audit`)
3. Sidebar → **Architecture** (`/plantpay/architecture`), scrolled to "Source health right now"

About 230 spoken words. That is 90 seconds at a calm pace.

---

## Part 1 — Responsible AI (0:00–0:35) · *Tab 1: Responsible AI*

> Our first rule: **rules decide, AI explains.** Approve, flag or block always comes from fixed rules that give the same answer every time. The four machine-learning models only add predictions, and they never sit in the decision path.
>
> Every screen tells you which is which. *(point at the two labels)* "Rule-based" means a fixed rule produced it. "AI-assisted, human review required" means a model did.
>
> A predicted root cause only counts as a fact when a source record backs it. Otherwise it says "unverified prediction". And fraud signals, like duplicates, splitting or a shared bank account, read "warning, not proof". They create a review task. They never block a payment or accuse anyone on their own.

## Part 2 — Security (0:35–1:05) · *Tab 2: Audit trail*

> Humans stay in control. Approval limits are enforced by role: up to ₹1 lakh the clerk, up to ₹15 lakh Approver L1, above that L2. Whoever worked on an invoice can't approve it, and every rejection needs a written reason. Bank-detail changes always need independent verification by someone else.
>
> Every decision is chained to the one before it by a hash. *(click **Verify chain**)* If anyone edits an old record, this check shows exactly where the chain breaks.
>
> Passwords are stored hashed, sessions are signed, and a supplier only ever sees its own invoices.

## Part 3 — Data (1:05–1:30) · *Tab 3: Architecture*

> All data is **synthetic**. Every company, bank account and amount is made up. No real LyondellBasell data, credentials or systems are used.
>
> Six department databases are read through **read-only** connectors. *(point at source health)* If one goes offline, only the checks that need it say "source unavailable", and the rest keep working. And nothing leaves the machine: invoice reading and the contract search run locally, with no external AI service.
>
> **GenAI declaration:** we built PlantPay with AI coding assistants: Claude Code, OpenAI Codex and Google Antigravity. Every line was reviewed, and every team member can explain it.

---

**If asked "how do you know the models are any good?"** Open any invoice's prediction view. Each model shows its accuracy on held-out test data, for example AUC 0.78 for exception prediction.
**If asked "can someone tamper with the audit log?"** Run `npm run audit:tamper` to edit one old record on purpose, then click **Verify chain**. It shows the break.
