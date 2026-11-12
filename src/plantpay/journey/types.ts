// Golden Journey: the payload shapes shared by the server builder, the pre-computed fallback and the client screens.
// Everything here is plain JSON (no Maps, Dates or class instances) so it can be sent over HTTP or stored in a file.
import type { Passport } from "../passport";
import type { Resolution } from "../resolver";
import type { InvoicePath, StationStat, Edge, LoopStat, Variant } from "../processMining";
import type { RiskSignal } from "../risk/types";

export const JOURNEY_STEPS = 9;
export const JOURNEY_TITLES = [
  "Control tower", "Supplier uploads the invoice", "Six sources, one picture", "Matching", "Resolution",
  "Risk signals", "Intelligence", "Process twin", "Trust and finish",
] as const;

/** Names in the story brief that do not exist in the seeded data, and the real records that play their part. */
export interface StoryKeyRow { story: string; actual: string; supplier: string; note: string }

export interface SourceRow { id: string; label: string; holds: string; status: "up" | "down"; records: number | null; lastSync: string | null; contributed: string[] }
export interface Snapshot { status: string; summary: string; notEvaluated: string[]; unavailable: string[] }

export interface Step1 {
  counts: { total: number; demo: number; pass: number; review: number; block: number; incomplete: number };
  sources: SourceRow[]; openWork: { department: string; open: number }[];
  integrity: { ok: boolean; auditEntries: number; workflowEvents: number };
  story: StoryKeyRow[];
}
export interface InvoiceCard {
  id: string; supplier: string; vendorId: string; po?: string; invoiceDate: string; receivedOn: string; totalInr: number; file?: string;
  lines: { lineNo: number; description: string; qty: number; uom: string; unitPrice: number; amount: number }[];
}
export interface Step2 { invoice: InvoiceCard; passport: Passport; supplierNote: string }
export interface EvidenceRow { source: string; label: string; status: "ok" | "unavailable"; facts: string[] }
export interface Step3 {
  invoiceId: string; evidence: EvidenceRow[];
  outage: { source: string; label: string; online: Snapshot; offline: Snapshot; restored: Snapshot; affectedChecks: string[]; explanation: string };
}
export interface CheckRow { check: string; label: string; passed: boolean | null; detail: string }
export interface Step4 {
  invoiceId: string; status: string; summary: string; checks: CheckRow[];
  validation: { threeWay: { state: string; headline: string; issues: string[] }; contract: { state: string; headline: string; issues: string[]; terms: string[] }; inventory: { state: string; headline: string; issues: string[]; rows: string[] } };
  priceTrio: { invoice: number; po: number; contract: number; unit: string; description: string } | null;
  normalisations: { invoiceId: string; supplier: string; text: string; evidence: string[]; purpose: string }[];
  qualityCase: { invoiceId: string; supplier: string; statement: string; evidence: string[] } | null;
}
export interface RagBlock { question: string; answer: string; grounded: boolean; citations: { id: string; kind: string; title: string; ref: string; text: string }[]; notes: string[] }
export interface Step5 {
  invoiceId: string; resolutions: Resolution[]; rag: RagBlock[];
  tasks: { department: string; title: string; status: string; owner: string }[];
  fix: {
    steps: string[]; before: { status: string; summary: string }; after: { status: string; summary: string }; passes: boolean;
    events: { at: string; type: string; department: string; note: string }[]; auditEntriesAdded: number; remaining: string[];
  };
}
export interface RiskBlock { detector: string; title: string; subject: string; flag: boolean; score: number; label: string; reasons: string[]; recommendedAction: string; requiresIndependentVerification: boolean; supporting: string[]; task?: string }
export interface Step6 {
  duplicate: RiskBlock & { original: string; copy: string };
  splitting: RiskBlock & { invoices: { id: string; totalInr: number; date: string }[]; combinedInr: number };
  bank: RiskBlock & { supplier: string };
  graph: RiskBlock & { vendorA: string; vendorB: string; account: string; edges: { from: string; to: string; kind: string }[]; confirmedLegitimate: boolean; supplierNote: string };
  label: string;
}
export interface SupplierRow { vendorId: string; name: string; relationship: { score: number; band: string; summary: string }; criticality: { score: number; band: string; summary: string }; risk: { score: number; band: string; summary: string }; priority?: { score: number; band: string; explanation: string }; materials: string }
export interface FactorRow { label: string; value: string; effectPoints: number; direction: string }
export interface Step7 {
  suppliers: SupplierRow[]; priorityNote: string;
  invoiceId: string; disclaimer: string;
  predictions: { key: string; title: string; question: string; probability: number; level: string; model: string; auc?: number; trainedOn: string; factors: FactorRow[] }[];
  causes: { label: string; probabilityIfException: number; evidenceStatus: string; evidence: string[] }[];
  priority: { score: number; band: string; explanation: string; contributions: { label: string; points: number; why: string }[] };
  history: string[];
}
export interface Step8 {
  invoiceId: string; asOf: string; expected: string[]; actual: InvoicePath | null;
  stations: StationStat[]; edges: Edge[]; bottlenecks: StationStat[]; loops: LoopStat[]; variants: Variant[];
  totals: { invoices: number; reworkPct: number; reworkInvoices: number; avgCycleDays: number; conformingPct: number };
}
export interface TamperRow { label: string; ok: boolean; position?: number; reason: string }
export interface ChecklistRow { feature: string; step: number; evidence: string }
export interface Step9 {
  integrity: { ok: boolean; auditEntries: number; workflowEvents: number };
  tamper: TamperRow[]; passport: Passport; readyForPayment: boolean; approvalNote: string;
  checklist: ChecklistRow[];
}

export interface JourneyStepData { 1: Step1; 2: Step2; 3: Step3; 4: Step4; 5: Step5; 6: Step6; 7: Step7; 8: Step8; 9: Step9 }
export interface JourneyData {
  version: 1; mode: "live" | "fallback"; builtAt: string; today: string; hero: string; heroSupplier: string; steps: JourneyStepData; ms?: number;
}

export type { RiskSignal };
