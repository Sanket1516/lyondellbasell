import Link from "next/link";
import { notFound } from "next/navigation";
import { FINDING_KIND_LABEL, summarise } from "@/engine/match";
import { fmtDate } from "@/lib/format";
import { boxFor, loadReviewDoc } from "@/lib/review-doc";
import { bandFor, routeText } from "@/lib/routing";
import { getState } from "@/lib/store";
import { OPEN_FOR_FIXES } from "@/lib/workflow";
import { workflowView } from "@/lib/workflow-status";
import { ReviewView, type ReviewProps, type TaskView } from "./ReviewView";
import s from "./Review.module.css";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const state = getState();
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) notFound();

  const vendor = state.vendors.find((v) => v.id === inv.vendorId);
  const findings = state.findings.filter((f) => f.invoiceId === id);
  const doc = await loadReviewDoc(inv.sourceFile, state.vendors);

  const tasks = state.tasks.filter((t) => t.invoiceId === id);
  const taskView = (t: (typeof tasks)[number]): TaskView => ({
    id: t.id, owner: t.owner, status: t.status, dueOn: t.dueOn, resolution: t.resolution,
    simulate: !t.fix ? "none" : t.fix.type === "supplier" ? "supplier" : "erp",
  });
  const canFix = (OPEN_FOR_FIXES as readonly string[]).includes(inv.status);
  const clean = inv.status === "pending_approval" && inv.verdict === "approve" && !tasks.some((t) => t.status === "requested");
  const dec = inv.decision;

  const worstOf = (lineNo: number) => {
    const vs = findings.filter((f) => f.lineNo === lineNo).map((f) => f.verdict);
    return vs.includes("block") ? "block" : vs.includes("flag") ? "flag" : "approve";
  };

  const dup = findings.find((f) => f.kind === "duplicate" && f.matchedInvoiceId);
  // Keep the comparison on screen after a decision, even though the finding itself may have gone.
  const matchedId = dup?.matchedInvoiceId ?? inv.duplicateDecision?.matchedInvoiceId;
  const matched = matchedId ? state.invoices.find((i) => i.id === matchedId) : undefined;

  const props: ReviewProps = {
    id,
    vendor: vendor?.name ?? inv.printedVendor?.name ?? "Unknown supplier",
    poId: inv.poId ?? "",
    invoiceDate: inv.invoiceDate,
    receivedOn: inv.receivedOn,
    subtotal: inv.subtotal, tax: inv.tax, total: inv.total,
    statusView: workflowView(inv, tasks),
    verdict: inv.verdict ?? null,
    summary: inv.verdict ? summarise(inv.verdict, findings) : "This invoice has not been matched yet.",
    lines: inv.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, amount: l.amount, verdict: worstOf(l.lineNo) })),
    findings: findings.map((f) => ({
      id: f.id, lineNo: f.lineNo, kind: f.kind, kindLabel: FINDING_KIND_LABEL[f.kind], verdict: f.verdict, message: f.message, rootCause: f.rootCause,
      owner: f.owner, smallestFix: f.smallestFix, expected: f.expected, actual: f.actual, evidence: f.evidence ?? [], box: doc ? boxFor(doc.ex, f) : null,
      task: (() => { const k = [...tasks].reverse().find((x) => x.kind === f.kind && x.lineNo === f.lineNo && x.rootCause === f.rootCause); return k ? taskView(k) : null; })(),
      canRequest: canFix && f.verdict !== "approve" && f.kind !== "duplicate",
    })),
    flow: {
      route: clean ? routeText(inv.total) : null,
      canRelease: clean && bandFor(inv.total) === "clerk",
      canReopen: inv.status === "sent_back" || inv.status === "rejected",
      note: (inv.status === "sent_back" || inv.status === "rejected") && dec
        ? `${inv.status === "rejected" ? "Rejected" : "Sent back"} by ${dec.by}${dec.level ? ` (Approver ${dec.level})` : ""} on ${fmtDate(dec.at.slice(0, 10))}. Reason: ${dec.reason ?? "none recorded"}`
        : null,
      approvedNote: inv.status === "approved" && dec
        ? `${dec.outcome === "released" ? "Released by" : "Approved by"} ${dec.by} on ${fmtDate(dec.at.slice(0, 10))}. Ready for payment.`
        : null,
    },
    doc: doc ? { src: doc.src, kind: doc.kind, pages: doc.pages, fixture: !!doc.ex.fixture } : null,
    hasSource: !!inv.sourceFile,
    duplicate: matched
      ? {
          matched: { id: matched.id, invoiceDate: matched.invoiceDate, poId: matched.poId ?? "", total: matched.total, status: matched.status, resolvedOn: matched.resolvedOn, lines: matched.lines.map((l) => ({ description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice })) },
          fields: dup?.message ?? "A decision has been recorded on this comparison.",
        }
      : null,
    decision: inv.duplicateDecision ?? null,
  };

  return (
    <>
      <p className={s.crumb}><Link href="/clerk">Invoice queue</Link> / <span className="mono">{id}</span></p>
      <ReviewView {...props} />
    </>
  );
}
