// Domain types shared by every ticket. Money is in whole rupees (INR).

export type Role = "supplier" | "clerk" | "approver";
export type ApproverLevel = "L1" | "L2";

export interface User {
  id: string;
  username: string;
  password: string; // fictional demo password, shown on the login page
  displayName: string;
  title: string;
  role: Role;
  approverLevel?: ApproverLevel;
  vendorId?: string; // suppliers only
}

export interface Vendor {
  id: string;
  name: string;
  gstin: string;
  active: boolean;
}

export interface PoLine {
  lineNo: number;
  itemCode: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  taxCode: string; // e.g. "GST18"
  taxRatePct: number;
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  buyer: string;
  issuedOn: string; // ISO date
  contractId?: string;
  lines: PoLine[];
}

export interface GrLine {
  lineNo: number; // PO line number
  qtyReceived: number;
  uom: string;
}

export interface GoodsReceipt {
  id: string;
  poId: string;
  receivedOn: string;
  receivedBy: string;
  lines: GrLine[];
}

export interface Contract {
  id: string;
  vendorId: string;
  effectiveFrom: string;
  prices: { itemCode: string; unitPrice: number; uom: string }[];
  /** Earlier prices, newest first. The current price is in `prices`. */
  history?: { itemCode: string; unitPrice: number; uom: string; effectiveFrom: string }[];
}

export interface DeliveryNote {
  id: string;
  poId: string;
  vendorId: string;
  deliveredOn: string;
  lines: { itemCode: string; qty: number; uom: string }[];
}

export interface UomRule {
  itemCode: string;
  fromUom: string;
  toUom: string;
  factor: number;
}

export type Verdict = "approve" | "flag" | "block";

export type InvoiceStatus =
  | "received"
  | "matched"
  | "pending_owner"
  | "pending_approval"
  | "approved"
  | "blocked"
  | "paid";

export interface InvoiceLine {
  lineNo: number;
  itemCode?: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  taxRatePct: number;
  amount: number;
}

export interface Invoice {
  id: string;
  vendorId: string;
  poId?: string;
  invoiceDate: string;
  receivedOn: string;
  currency: "INR";
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  status: InvoiceStatus;
  verdict?: Verdict;
  /** Where the original document is served from, e.g. "demo:INV-7781.pdf" or "upload:<file>". */
  sourceFile?: string;
  /** Vendor name and GSTIN as printed on the document. Set when the vendor is not in the master ("UNKNOWN"). */
  printedVendor?: { name: string; gstin?: string };
  /** Date the exception was closed or the invoice was paid. Used for ageing. */
  resolvedOn?: string;
  /** A clerk's decision on a possible-duplicate finding. A reason is always required. */
  duplicateDecision?: { decision: "duplicate" | "not_duplicate"; matchedInvoiceId: string; by: string; reason: string; at: string };
  /** Username that submitted it (a supplier login may submit on behalf of the vendor on the document). */
  submittedBy?: string;
}

export type FindingKind =
  | "price"
  | "quantity"
  | "missing_receipt"
  | "missing_po"
  | "unknown_vendor"
  | "duplicate"
  | "tax"
  | "uom"
  | "arithmetic"
  | "not_on_po";

/** One underlying record the engine used, shown behind "Show evidence". */
export interface EvidenceRef {
  kind: "po" | "goods_receipt" | "contract" | "delivery_note" | "uom_rule" | "invoice";
  ref: string;
  text: string;
}

export interface Finding {
  id: string;
  invoiceId: string;
  lineNo?: number;
  kind: FindingKind;
  verdict: Verdict;
  message: string;
  rootCause: string;
  owner: string; // named owner, e.g. "Buyer"
  smallestFix: string;
  /** Set by the matching engine (absent on older seeded findings). */
  expected?: string;
  actual?: string;
  deltaPct?: number;
  evidence?: EvidenceRef[];
  /** Duplicate findings: the invoice this one looks like. */
  matchedInvoiceId?: string;
}

export type TaskStatus = "open" | "done";

export interface Task {
  id: string;
  invoiceId: string;
  findingId?: string;
  owner: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
}

export interface AuditEvent {
  seq: number;
  at: string; // ISO timestamp
  actor: string; // username or "system"
  action: string;
  invoiceId?: string;
  detail: string;
  prevHash: string;
  hash: string;
}

export interface AppState {
  version: 1;
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  contracts: Contract[];
  deliveryNotes: DeliveryNote[];
  uomRules: UomRule[];
  invoices: Invoice[];
  findings: Finding[];
  tasks: Task[];
  auditEvents: AuditEvent[];
}
