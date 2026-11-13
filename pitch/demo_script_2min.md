# PlantPay: 2-minute feature demo script

**Before you start:** sign in as Clerk and open these 7 pages in browser tabs, in this order, so you only switch tabs and never wait for navigation:

1. INV-7781 → exception resolution view
2. INV-7781 → full prediction view
3. VPS18/26-27/0917
4. PPT08/26-27/0903
5. NA13/26-27/0605-R
6. IG20/26-27/0912
7. CB21/26-27/0908, then the relationship graph (`/plantpay/graph`)

About 290 spoken words. That is 2 minutes at a calm pace.

---

**[0:00–0:10] Opening** · *PlantPay engine, Demo documents tab*

> Most invoice systems stop at "mismatch". PlantPay tells you why it happened, who fixes it, and exactly what has to change. Seven features, real documents, two minutes.

**[0:10–0:35] Root-Cause Resolver + Counterfactual** · *Tab 1: INV-7781 exception view*

> This supplier billed ₹412 a kilo. The PO says ₹398. A basic system flags it and the emails start. Our Resolver checks the contract: C-22 was amended to ₹412, but nobody updated the PO. So the owner is the buyer, and the fix is to amend the PO. The counterfactual gives the smallest change: "this line would pass if the PO price were ₹412." *(click Simulate)* One click proves it.

**[0:35–0:50] Predictive Intelligence** · *Tab 2: prediction view*

> Our models saw this coming: a 97% chance of an exception, 81% risk of paying late, and the likely root cause, ranked. These are labelled estimates. The evidence still decides.

**[0:50–1:05] Inventory-Aware Verification** · *Tab 3: VPS18, then Tab 4: PPT08*

> 1,200 litres were received. Earlier invoices already claim all of it, and this one bills 480 more. It's flagged for review, never auto-rejected. And units don't fool it: 5 tonnes against a 5,000 kg PO passes.

**[1:05–1:20] Duplicate Fingerprint** · *Tab 5: NA13-R*

> This is a paid invoice, resubmitted with a new number and date. Number matching misses it. Our fingerprint compares supplier, amount, PO, lines and tax, and scores it 95 out of 100. It's blocked before we pay twice.

**[1:20–1:35] Threshold Splitting** · *Tab 6: IG20/0912*

> Three invoices, each just under the ₹1 lakh approval limit. Same supplier, same PO, same day: ₹2.9 lakh together. Finance gets a flag to investigate, not an accusation.

**[1:35–1:50] Vendor Master Red Flags** · *Tab 7: CB21, then graph*

> This invoice asks us to pay a new bank account that isn't verified yet, so it goes for a call-back first. And the graph shows two unrelated vendors sharing one account.

**[1:50–2:00] Close**

> Every flag comes with evidence and an owner. It's a warning, not a verdict. Fewer emails, no duplicate payments, and approval controls nobody can quietly bypass. That's PlantPay.

---

**If you're running long:** cut the PPT08 unit sentence and the "These are labelled estimates" line. That saves about 10 seconds.
**Two speakers:** Speaker A takes 0:00–1:05 (Resolver, Predictions, Inventory). Speaker B takes 1:05–2:00 (the fraud and controls features).
