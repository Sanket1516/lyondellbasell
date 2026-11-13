import { AiLabel, SeeLive } from "@/components/Info";
import s from "@/components/Info.module.css";

export const dynamic = "force-dynamic";

const ITEMS: { title: string; blurb: string; href: string; kind: "ai" | "rule" | "both" }[] = [
  { title: "Root-Cause Resolver", blurb: "Not just “mismatch”. It says the contract was amended, the PO was not updated, the buyer owns the fix, and shows the evidence from each system.", href: "/plantpay/invoices/INV-7781/exceptions", kind: "both" },
  { title: "Counterfactual explanation", blurb: "“This invoice would pass if the PO price were updated to ₹412.” The exact smallest change, with a sandbox button to simulate it.", href: "/plantpay/invoices/INV-7781/exceptions", kind: "rule" },
  { title: "Process-mining twin", blurb: "The path invoices actually took against the expected one: where the time goes and where rework loops repeat.", href: "/plantpay/process", kind: "rule" },
  { title: "Relationship graph", blurb: "Vendors, bank accounts, addresses and approvers as a network. Shared accounts show up as warnings for a person, never accusations.", href: "/plantpay/graph", kind: "rule" },
  { title: "Supplier intelligence", blurb: "Relationship strength, supply criticality and risk kept as three separate scores, so a critical supplier is handled with care, not just fast.", href: "/plantpay/suppliers", kind: "both" },
  { title: "Four predictive models", blurb: "Exception, root-cause, payment-delay and supplier-risk predictions from trained, evaluated models with their contributing factors shown.", href: "/plantpay/predictions", kind: "ai" },
  { title: "Payment Readiness Passport", blurb: "Tells a supplier what is holding their payment, who owns it, and when it is due.", href: "/plantpay/invoices/INV-7781/passport", kind: "rule" },
  { title: "Six-source integration layer", blurb: "Six department databases read through one canonical model. Take one offline and the rest of the pipeline keeps going.", href: "/plantpay/architecture", kind: "rule" },
  { title: "Hash-chained audit trail", blurb: "Every decision is chained to the one before; one click proves nothing was altered.", href: "/audit", kind: "rule" },
  { title: "Golden Journey", blurb: "A guided nine-step story with presenter notes and an automatic fallback if any live call fails.", href: "/plantpay/journey", kind: "rule" },
];

export default function Innovations() {
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>Innovations</h1>
      <p className={s.prose}>Ten things PlantPay does that a standard matching engine does not. Each button opens the feature running on the demo data.</p>
      <div className={s.cards}>
        {ITEMS.map((i) => (
          <article key={i.title} className={s.card}>
            <h3>{i.title}</h3>
            <p>{i.blurb}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {i.kind !== "ai" && <AiLabel kind="rule" />}
              {i.kind !== "rule" && <AiLabel kind="ai" />}
            </div>
            <SeeLive href={i.href} />
          </article>
        ))}
      </div>
    </>
  );
}
