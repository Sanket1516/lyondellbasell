import s from "@/components/Info.module.css";

export const dynamic = "force-dynamic";

const EP: [string, string, string][] = [
  ["GET", "/sources", "Health and last sync of the six source systems"],
  ["POST", "/sources/{id}/outage", 'Demo toggle: body {"outage": true|false}'],
  ["GET", "/invoices?status=&limit=", "Invoices with their decision"],
  ["GET", "/invoices/{id}", "Stored evaluation (evaluated on first request)"],
  ["GET", "/invoices/{id}/canonical", "Normalised records from every source"],
  ["POST", "/invoices/{id}/evaluate", "Re-run matching, risk checks and routing"],
  ["GET", "/invoices/{id}/resolution", "Root cause, evidence, owner, fix and counterfactual"],
  ["POST", "/invoices/{id}/simulate", "Apply a fix to a sandbox copy"],
  ["GET", "/predictions/{id}", "Predictions with contributing factors and evidence status"],
  ["GET", "/suppliers", "Relationship strength, criticality and risk scores"],
  ["GET", "/models", "Evaluation metrics of the four trained models"],
  ["GET", "/events", "Recent integration events"],
  ["POST", "/events/process", "Consume queued events and re-match affected invoices"],
  ["POST", "/ask", 'Body {"question": "...", "invoiceId": "optional"}'],
  ["GET", "/audit?verify=1", "Audit trail and hash-chain check"],
];

export default function ApiDocs() {
  return (
    <>
      <h1 style={{ marginBottom: 6 }}>API reference</h1>
      <p className={s.prose}>All endpoints live under <code>/api/plantpay/v1</code>. Every call needs an <code>x-api-key</code> header or a signed-in AP clerk or approver session; without one the answer is 401. Invoice numbers contain “/”, so URL-encode them. Every request is logged.</p>
      <table className={s.ep}>
        <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
        <tbody>{EP.map(([m, p, d]) => <tr key={m + p}><td><code>{m}</code></td><td><code>{p}</code></td><td>{d}</td></tr>)}</tbody>
      </table>
    </>
  );
}
