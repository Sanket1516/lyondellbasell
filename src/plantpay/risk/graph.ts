// Detector 4: relationship graph.
// Nodes: vendors, bank accounts, addresses, approvers, POs, invoices. Edges are facts from the six source databases.
// The graph looks for patterns ACROSS records (a bank account held by two vendors, an address used by two vendors, an
// approver who repeatedly approves just-under-limit invoices from one vendor) and groups linked vendors into clusters.
// It is separate from the vendor red flags (vendorFlags.ts), which look at one supplier's own attributes.
// A link is a question for a person, never an accusation: group companies legitimately share accounts and addresses.
// Implemented in TypeScript (no networkx: the stack is Next.js); the algorithms used are plain adjacency maps and BFS.
import { fmtInr } from "../../lib/format";
import { makeSignal, type DetectorOutcome, type RiskSignal } from "./types";

export type NodeType = "vendor" | "bank" | "address" | "approver" | "po" | "invoice";
export type EdgeKind = "holds_account" | "registered_at" | "billed_by" | "for_po" | "approved_by" | "ordered_from";
export interface GraphNode { id: string; type: NodeType; label: string; detail?: string }
export interface GraphEdge { source: string; target: string; kind: EdgeKind }

export interface GraphInput {
  vendors: { id: string; name: string; gstin: string }[];
  banks: { vendorId: string; accountNo: string; bankName: string; status: string; note?: string }[];
  addresses: { vendorId: string; line: string; city: string; pincode: string; closed: boolean }[];
  invoices: { id: string; vendorId: string; poId?: string; total: number; date: string; approvals: { approverId: string; level: string; on: string }[] }[];
  approvers: { id: string; name: string; limitInr: number }[];
}

export type FindingKind = "shared_bank_account" | "shared_address" | "shared_tax_id" | "approver_pattern";
export interface GraphFinding {
  kind: FindingKind;
  /** Vendors (or the approver) involved. */
  vendorIds: string[];
  nodeIds: string[];
  /** True when the sharing is explained by a confirmed group arrangement on the supplier master. */
  confirmedLegitimate: boolean;
  text: string;
  evidence: string[];
  score: number;
}
export interface VendorCluster { id: string; vendorIds: string[]; links: { kind: FindingKind; text: string; confirmedLegitimate: boolean }[]; allConfirmedLegitimate: boolean }

const normAddr = (a: { line: string; city: string; pincode: string }) => `${a.line}|${a.city}|${a.pincode}`.toLowerCase().replace(/[^a-z0-9|]/g, "");

export class RelationshipGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];
  private adj = new Map<string, Set<string>>();
  readonly findings: GraphFinding[] = [];
  readonly clusters: VendorCluster[] = [];
  private vendorName = new Map<string, string>();

  private addNode(n: GraphNode) { if (!this.nodes.has(n.id)) { this.nodes.set(n.id, n); this.adj.set(n.id, new Set()); } }
  private addEdge(source: string, target: string, kind: EdgeKind) { this.edges.push({ source, target, kind }); this.adj.get(source)?.add(target); this.adj.get(target)?.add(source); }
  neighbors(id: string): string[] { return [...(this.adj.get(id) ?? [])]; }
  degree(id: string) { return this.adj.get(id)?.size ?? 0; }

  constructor(input: GraphInput, opts: { approverWindowDays?: number; approverMinInvoices?: number; justUnderShare?: number } = {}) {
    const windowDays = opts.approverWindowDays ?? 30, minInv = opts.approverMinInvoices ?? 5, underShare = opts.justUnderShare ?? 0.85;
    for (const v of input.vendors) { this.addNode({ id: `vendor:${v.id}`, type: "vendor", label: v.name, detail: v.gstin }); this.vendorName.set(v.id, v.name); }
    for (const a of input.approvers) this.addNode({ id: `approver:${a.id}`, type: "approver", label: a.name, detail: `limit ₹${fmtInr(a.limitInr, 0)}` });
    for (const b of input.banks) {
      if (b.status === "closed") continue; // closed accounts stay in the supplier master but are not live links
      this.addNode({ id: `bank:${b.accountNo}`, type: "bank", label: `A/c ${b.accountNo}`, detail: b.bankName });
      this.addEdge(`vendor:${b.vendorId}`, `bank:${b.accountNo}`, "holds_account");
    }
    for (const a of input.addresses) {
      if (a.closed) continue;
      const key = `addr:${normAddr(a)}`;
      this.addNode({ id: key, type: "address", label: `${a.line}, ${a.city} ${a.pincode}` });
      this.addEdge(`vendor:${a.vendorId}`, key, "registered_at");
    }
    for (const i of input.invoices) {
      this.addNode({ id: `invoice:${i.id}`, type: "invoice", label: i.id, detail: `₹${fmtInr(i.total)} on ${i.date}` });
      this.addEdge(`invoice:${i.id}`, `vendor:${i.vendorId}`, "billed_by");
      if (i.poId) { this.addNode({ id: `po:${i.poId}`, type: "po", label: `PO ${i.poId}` }); this.addEdge(`invoice:${i.id}`, `po:${i.poId}`, "for_po"); this.addEdge(`po:${i.poId}`, `vendor:${i.vendorId}`, "ordered_from"); }
      for (const ap of i.approvals) if (this.nodes.has(`approver:${ap.approverId}`)) this.addEdge(`invoice:${i.id}`, `approver:${ap.approverId}`, "approved_by");
    }
    this.findShared(input, windowDays, minInv, underShare);
    this.buildClusters();
  }

  private findShared(input: GraphInput, windowDays: number, minInv: number, underShare: number) {
    const live = input.banks.filter((b) => b.status !== "closed");
    const byAcct = new Map<string, typeof live>();
    for (const b of live) (byAcct.get(b.accountNo) ?? byAcct.set(b.accountNo, []).get(b.accountNo)!).push(b);
    for (const [acct, rows] of byAcct) {
      const vendors = [...new Set(rows.map((r) => r.vendorId))];
      if (vendors.length < 2) continue;
      const confirmed = rows.every((r) => !!r.note && /confirmed legitimate/i.test(r.note)) || rows.some((r) => !!r.note && /confirmed legitimate/i.test(r.note));
      const names = vendors.map((v) => `${this.vendorName.get(v) ?? v} (${v})`);
      this.findings.push({
        kind: "shared_bank_account", vendorIds: vendors, nodeIds: [`bank:${acct}`, ...vendors.map((v) => `vendor:${v}`)], confirmedLegitimate: confirmed, score: confirmed ? 10 : Math.min(90, 60 + (vendors.length - 2) * 10),
        text: confirmed ? `${names.join(" and ")} share bank account ${acct}. Confirmed as a legitimate group arrangement on the supplier master.` : `${names.join(" and ")} share bank account ${acct}. Shared accounts can be legitimate; a person should confirm the relationship.`,
        evidence: rows.map((r) => `${this.vendorName.get(r.vendorId) ?? r.vendorId}: account ${r.accountNo} at ${r.bankName}${r.note ? `. ${r.note}` : ""}`),
      });
    }
    const byAddr = new Map<string, typeof input.addresses>();
    for (const a of input.addresses.filter((x) => !x.closed)) (byAddr.get(normAddr(a)) ?? byAddr.set(normAddr(a), []).get(normAddr(a))!).push(a);
    for (const [key, rows] of byAddr) {
      const vendors = [...new Set(rows.map((r) => r.vendorId))];
      if (vendors.length < 2) continue;
      const names = vendors.map((v) => `${this.vendorName.get(v) ?? v} (${v})`);
      this.findings.push({ kind: "shared_address", vendorIds: vendors, nodeIds: [`addr:${key}`, ...vendors.map((v) => `vendor:${v}`)], confirmedLegitimate: false, score: 40, text: `${names.join(" and ")} are registered at the same address (${rows[0].line}, ${rows[0].city} ${rows[0].pincode}). Industrial estates and group companies often share addresses; a person should confirm.`, evidence: rows.map((r) => `${this.vendorName.get(r.vendorId)}: ${r.line}, ${r.city} ${r.pincode}`) });
    }
    const byTax = new Map<string, typeof input.vendors>();
    for (const v of input.vendors) (byTax.get(v.gstin) ?? byTax.set(v.gstin, []).get(v.gstin)!).push(v);
    for (const [g, rows] of byTax) if (rows.length > 1) this.findings.push({ kind: "shared_tax_id", vendorIds: rows.map((r) => r.id), nodeIds: rows.map((r) => `vendor:${r.id}`), confirmedLegitimate: false, score: 85, text: `${rows.map((r) => r.name).join(" and ")} carry the same GSTIN ${g}. Two supplier records with one tax ID usually means a duplicated or mis-keyed record.`, evidence: rows.map((r) => `${r.name} (${r.id}): GSTIN ${g}`) });

    // Approver relationships: one approver repeatedly approving just-under-limit invoices from the same vendor within a short span.
    const limit = new Map(input.approvers.map((a) => [a.id, a]));
    const groups = new Map<string, { inv: GraphInput["invoices"][number]; on: string }[]>();
    for (const i of input.invoices) for (const ap of i.approvals) { const a = limit.get(ap.approverId); if (a && i.total <= a.limitInr && i.total >= a.limitInr * underShare) { const k = `${ap.approverId}|${i.vendorId}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push({ inv: i, on: ap.on }); } }
    for (const [k, rows] of groups) {
      rows.sort((a, b) => a.on.localeCompare(b.on));
      // longest run inside the window
      let best: typeof rows = [];
      for (let s = 0; s < rows.length; s++) { const run = rows.filter((r) => Date.parse(r.on) >= Date.parse(rows[s].on) && Date.parse(r.on) - Date.parse(rows[s].on) <= windowDays * 86400000); if (run.length > best.length) best = run; }
      if (best.length < minInv) continue;
      const [aid, vid] = k.split("|");
      const a = limit.get(aid)!;
      this.findings.push({ kind: "approver_pattern", vendorIds: [vid], nodeIds: [`approver:${aid}`, `vendor:${vid}`, ...best.map((r) => `invoice:${r.inv.id}`)], confirmedLegitimate: false, score: 65, text: `${a.name} approved ${best.length} invoices from ${this.vendorName.get(vid) ?? vid} within ${windowDays} days, each just under ${a.name}'s ₹${fmtInr(a.limitInr, 0)} limit. A person should check whether the work was really separate.`, evidence: best.map((r) => `${r.inv.id}: ₹${fmtInr(r.inv.total)}, approved ${r.on}`) });
    }
  }

  /** Connected groups of vendors, joined by shared accounts, addresses or tax IDs (breadth-first search over the findings). */
  private buildClusters() {
    const links = this.findings.filter((f) => f.kind !== "approver_pattern" && f.vendorIds.length > 1);
    const adj = new Map<string, Set<string>>();
    for (const f of links) for (const a of f.vendorIds) for (const b of f.vendorIds) if (a !== b) (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    const seen = new Set<string>();
    let n = 0;
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const comp: string[] = []; const q = [start]; seen.add(start);
      while (q.length) { const x = q.shift()!; comp.push(x); for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } }
      const cl = links.filter((f) => f.vendorIds.some((v) => comp.includes(v)));
      this.clusters.push({ id: `cluster-${++n}`, vendorIds: comp.sort(), links: cl.map((f) => ({ kind: f.kind, text: f.text, confirmedLegitimate: f.confirmedLegitimate })), allConfirmedLegitimate: cl.every((f) => f.confirmedLegitimate) });
    }
  }

  clusterOf(vendorId: string) { return this.clusters.find((c) => c.vendorIds.includes(vendorId)); }
  findingsFor(vendorId: string) { return this.findings.filter((f) => f.vendorIds.includes(vendorId)); }

  /** Per-invoice view of the graph: what the graph knows about this invoice's supplier, account and approvers. */
  detectForInvoice(inv: { id: string; vendorId: string }): DetectorOutcome {
    const title = "Relationship graph";
    const signals: RiskSignal[] = [];
    const mine = this.findingsFor(inv.vendorId);
    for (const f of mine) {
      const isApprover = f.kind === "approver_pattern";
      const flag = !f.confirmedLegitimate;
      const cluster = this.clusterOf(inv.vendorId);
      signals.push(makeSignal({
        detector: "graph", kind: f.kind, flag, severity: isApprover && flag ? "review" : "info", score: f.score, department: isApprover ? "Finance" : "Supplier master data",
        reasons: [f.text, ...(cluster && !isApprover ? [`This vendor is in a linked group of ${cluster.vendorIds.length}: ${cluster.vendorIds.map((v) => this.vendorName.get(v) ?? v).join(", ")}.`] : [])],
        supportingRecords: f.evidence.map((e) => ({ source: "Supplier master", ref: f.kind.replace(/_/g, " "), text: e })),
        recommendedAction: f.confirmedLegitimate ? "No action needed; the relationship is recorded on the supplier master." : isApprover ? "Review the approvals for these invoices with the approver's manager." : "Ask Supplier master data to confirm the relationship and record it. Open the graph to see the connection.",
      }));
    }
    const flagged = signals.filter((s) => s.flag);
    return { detector: "graph", title, flag: flagged.length > 0, score: Math.max(0, ...flagged.map((s) => s.score)), signals, summary: flagged.length ? `${flagged.length} cross-record link${flagged.length === 1 ? "" : "s"} involving this supplier.` : signals.length ? "Links found, all confirmed as legitimate on the supplier master." : "This supplier shares no bank account, address or tax ID with another vendor." };
  }

  /** Nodes and edges for the interactive view. Without a focus, invoices and POs are left out (there are hundreds). */
  toView(o: { focusVendors?: string[]; includeTransactions?: boolean } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const keep = new Set<string>();
    const focus = o.focusVendors?.map((v) => `vendor:${v}`);
    const isStructure = (t: NodeType) => t === "vendor" || t === "bank" || t === "address" || t === "approver";
    if (focus) {
      for (const f of focus) { keep.add(f); for (const n of this.neighbors(f)) if (isStructure(this.nodes.get(n)!.type)) keep.add(n); }
      if (o.includeTransactions) for (const f of focus) for (const n of this.neighbors(f)) { const t = this.nodes.get(n)!.type; if (t === "invoice" || t === "po") { keep.add(n); for (const m of this.neighbors(n)) if (this.nodes.get(m)!.type === "approver" || this.nodes.get(m)!.type === "po") keep.add(m); } }
    } else for (const n of this.nodes.values()) if (isStructure(n.type)) keep.add(n.id);
    // Hide account/address nodes held by a single vendor unless focused: they add clutter and no relationship.
    const nodes = [...this.nodes.values()].filter((n) => keep.has(n.id) && (focus || !(n.type === "bank" || n.type === "address") || this.neighbors(n.id).filter((x) => this.nodes.get(x)!.type === "vendor").length > 1));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: this.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }
}
