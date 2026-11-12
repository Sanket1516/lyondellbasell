import { loadCanonical } from "@/plantpay/canonical";
import { authenticate, json, logRequest } from "@/plantpay/http";
import { appendAudit, getSourceStates, recentEvents, setOutage, verifyAudit } from "@/plantpay/integration";
import { plantpay } from "@/plantpay/runtime";
import { SOURCE_IDS, type SourceId } from "@/plantpay/sources/schemas";
import { resolve } from "@/plantpay/resolver";
import { simulate } from "@/plantpay/simulate";
import { SourceUnavailableError } from "@/plantpay/connectors";
import { modelSummary, predictionFor, supplierTable } from "@/predict/service";

export const dynamic = "force-dynamic";

/** The request body as a plain object; anything else (no body, bad JSON, null, an array, a string) becomes {} and is rejected by the caller's checks. */
async function jsonBody<T extends object>(req: Request): Promise<Partial<T>> {
  const v: unknown = await req.json().catch(() => undefined);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<T>) : {};
}

/**
 * PlantPay REST facade. Auth: header `x-api-key`, or a signed-in AP clerk / approver session.
 *   GET  /sources                          health and last sync of the six sources
 *   POST /sources/{id}/outage              body {"outage": true|false}  (demo toggle)
 *   GET  /invoices?status=pass|review|block|incomplete&limit=
 *   GET  /invoices/{id}                    stored evaluation (evaluates on first request)
 *   GET  /invoices/{id}/canonical          the normalised records from every source
 *   POST /invoices/{id}/evaluate           re-run matching, risk checks and routing
 *   GET  /invoices/{id}/resolution         root cause, evidence, owner, correction and counterfactual per exception
 *   POST /invoices/{id}/simulate           body {"resolutionId": "..."} or {"all": true}; runs on a sandbox copy
*   GET  /predictions/{id}                 exception, root-cause, delay and supplier-risk predictions with contributing factors and evidence status
 *   GET  /suppliers                        the three supplier scores for every supplier
 *   GET  /models                           evaluation metrics of the four trained models
 *   GET  /events                           recent integration events
 *   POST /events/process                   consume queued events and re-match affected invoices
 *   POST /ask                              body {"question": "...", "invoiceId": "optional"}
 *   GET  /audit?verify=1                   audit trail (and hash-chain check)
 * Invoice numbers contain "/" : URL-encode them.
 */
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const engine = plantpay();
  const caller = await authenticate(req, engine);
  const seg = (await ctx.params).path.map(decodeURIComponent);
  const respond = (body: unknown, status = 200) => { logRequest(engine, caller, req, status); return json(body, status); };
  if (!caller.ok) return respond({ error: "Authentication required. Send a valid x-api-key header or sign in as an AP clerk or approver." }, 401);

  try {
    const [a, b, c] = seg;
    const url = new URL(req.url);
    if (req.method === "GET" && a === "sources" && !b) {
      return respond({ sources: engine.connectors.health().map((h) => ({ ...h, outage: getSourceStates(engine.integration).find((s) => s.source === h.id)?.outage ?? false })) });
    }
    if (req.method === "POST" && a === "sources" && b && c === "outage") {
      if (!SOURCE_IDS.includes(b as SourceId)) return respond({ error: `Unknown source "${b}". Use one of: ${SOURCE_IDS.join(", ")}.` }, 404);
      const body = await jsonBody<{ outage?: unknown }>(req);
      if (typeof body.outage !== "boolean") return respond({ error: 'Send {"outage": true} or {"outage": false}.' }, 400);
      setOutage(engine.integration, b as SourceId, body.outage);
      appendAudit(engine.integration, { actor: caller.actor, role: caller.role, action: body.outage ? "outage_simulated" : "outage_cleared", detail: `${b} source ${body.outage ? "taken offline (demo toggle)" : "brought back online"}` });
      return respond({ source: b, outage: body.outage });
    }
    if (req.method === "GET" && a === "predictions" && b) {
      const o = predictionFor(engine, b);
      return o.ok ? respond(o.prediction) : respond({ error: o.message }, o.status);
    }
    if (req.method === "GET" && a === "suppliers" && !b) {
      const t = supplierTable(engine);
      return "error" in t ? respond(t, 503) : respond({ suppliers: t.map((f) => ({ supplierId: f.vendorId, name: f.name, scores: { relationshipStrength: f.scores.relationshipStrength.score, supplyCriticality: f.scores.supplyCriticality.score, supplierRisk: f.scores.supplierRisk.score }, bands: { relationshipStrength: f.scores.relationshipStrength.band, supplyCriticality: f.scores.supplyCriticality.band, supplierRisk: f.scores.supplierRisk.band } })) });
    }
    if (req.method === "GET" && a === "models" && !b) return respond(modelSummary());
    if (req.method === "GET" && a === "invoices" && !b) {
      const status = url.searchParams.get("status");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 1000);
      const heads = engine.connectors.finance.listInvoiceHeaders();
      const rows = heads.map((h) => ({ invoiceId: String(h.invoice_no), receivedOn: String(h.received_on), supplierId: String(h.supplier_id), poId: h.po_ref ? String(h.po_ref) : null, totalInr: Number(h.total_paise) / 100, status: engine.stored(String(h.invoice_no))?.status ?? null }))
        .filter((r) => !status || r.status === status);
      return respond({ total: rows.length, invoices: rows.slice(0, limit) });
    }
    if (a === "invoices" && b) {
      if (req.method === "GET" && !c) {
        const r = engine.stored(b) ?? engine.evaluate(b, { actor: caller.actor, role: caller.role });
        const code = r.unavailable.includes("finance") ? 503 : r.summary.startsWith("Incomplete: Invoice") ? 404 : 200;
        return respond(code === 200 ? r : { error: r.summary.replace(/^Incomplete: /, ""), ...r }, code);
      }
      if (req.method === "GET" && c === "canonical") {
        const out = loadCanonical(engine.connectors, b);
        return respond(out, out.bundle ? 200 : out.unavailable.includes("finance") ? 503 : 404);
      }
      if (req.method === "GET" && c === "resolution") {
        const cur = engine.compute(b);
        if (!cur.bundle) return respond({ error: cur.result.summary, unavailable: cur.result.unavailable }, cur.result.unavailable.includes("finance") ? 503 : 404);
        return respond(resolve(cur.bundle, cur.result));
      }
      if (req.method === "POST" && c === "simulate") {
        const body = await jsonBody<{ resolutionId?: unknown; all?: unknown }>(req);
        if (body.all !== true && (typeof body.resolutionId !== "string" || !body.resolutionId.trim())) return respond({ error: 'Send {"resolutionId": "..."} or {"all": true}.' }, 400);
        return respond(simulate(engine, b, body.all ? "all" : { resolutionId: String(body.resolutionId) }));
      }
      if (req.method === "POST" && c === "evaluate") {
        const r = engine.evaluate(b, { actor: caller.actor, role: caller.role });
        const code = r.unavailable.includes("finance") ? 503 : r.summary.startsWith("Incomplete: Invoice") ? 404 : 200;
        return respond(code === 200 ? r : { error: r.summary.replace(/^Incomplete: /, ""), ...r }, code);
      }
    }
    if (req.method === "GET" && a === "events") return respond({ events: recentEvents(engine.integration, 50) });
    if (req.method === "POST" && a === "events" && b === "process") return respond(engine.processEvents());
    if (req.method === "POST" && a === "ask") {
      const body = await jsonBody<{ question?: unknown; invoiceId?: unknown }>(req);
      if (typeof body.question !== "string" || body.question.trim().length < 3) return respond({ error: 'Send {"question": "..."} with a question of at least a few words.' }, 400);
      return respond(engine.ask(body.question.slice(0, 500), typeof body.invoiceId === "string" && body.invoiceId ? body.invoiceId : undefined));
    }
    if (req.method === "GET" && a === "audit") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 500);
      return respond({ events: (await import("@/plantpay/integration")).readAudit(engine.integration, limit), ...(url.searchParams.get("verify") === "1" ? { integrity: verifyAudit(engine.integration) } : {}) });
    }
    return respond({ error: `No such endpoint: ${req.method} /${seg.join("/")}` }, 404);
  } catch (e) {
    if (e instanceof SourceUnavailableError) return respond({ error: e.message, source: e.source, status: "source unavailable" }, 503);
    return respond({ error: "Something went wrong handling this request. It has been logged." }, 500);
  }
}

export { handle as GET, handle as POST };
