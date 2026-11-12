// Stage 5 risk signals. Every detector returns the same shape. A signal is a prompt for a person to look, never an accusation.
export const WARNING_LABEL = "warning, not proof";

export type DetectorId = "duplicate" | "splitting" | "vendor" | "graph";
export const DETECTOR_TITLE: Record<DetectorId, string> = {
  duplicate: "Duplicate fingerprint",
  splitting: "Threshold splitting",
  vendor: "Vendor master red flags",
  graph: "Relationship graph",
};

export interface SupportingRecord {
  /** Where the record lives, for the reader: "Finance", "Supplier master", "Procurement". */
  source: string;
  /** Record kind and id, for example "invoice INV-6120". */
  ref: string;
  text: string;
}

export interface RiskSignal {
  detector: DetectorId;
  /** Which specific pattern fired inside the detector (a vendor flag has several). */
  kind: string;
  /** Yes/no: does this need a person to look? */
  flag: boolean;
  /** 0 to 100. Comes from fixed, documented weights (see config.ts), never from a guess. */
  score: number;
  /** "review" holds the invoice for a person; "info" is shown but does not hold it. */
  severity: "review" | "info";
  reasons: string[];
  supportingRecords: SupportingRecord[];
  recommendedAction: string;
  /** Always "warning, not proof". */
  label: typeof WARNING_LABEL;
  /** Bank-detail changes always need a call-back to a contact already on file. */
  requiresIndependentVerification?: boolean;
  /** Department that should own the follow-up. */
  department: string;
}

export interface DetectorOutcome { detector: DetectorId; title: string; flag: boolean; score: number; signals: RiskSignal[]; summary: string }

export interface RiskAssessment {
  detectors: Record<DetectorId, DetectorOutcome>;
  /** Everything that fired, flagged or not, in one list (vendor red flags and graph findings stay distinct by `detector`). */
  flagged: RiskSignal[];
  label: typeof WARNING_LABEL;
}

export function makeSignal(s: Omit<RiskSignal, "label" | "score"> & { score: number }): RiskSignal {
  return { ...s, score: Math.max(0, Math.min(100, Math.round(s.score))), label: WARNING_LABEL };
}
