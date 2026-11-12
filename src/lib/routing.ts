// Who must decide on a clean invoice, from its amount. Pure: used by the workflow service and by every screen.
import { THRESHOLDS } from "./constants";
import { fmtRupees } from "./format";

export type ApprovalBand = "clerk" | "L1" | "L2";

/** Up to the clerk limit: clerk releases. Up to the L1 limit: Approver L1. Above: Approver L2. */
export function bandFor(total: number): ApprovalBand {
  if (total <= THRESHOLDS.clerkMax) return "clerk";
  if (total <= THRESHOLDS.l1Max) return "L1";
  return "L2";
}

export function routeText(total: number): string {
  const band = bandFor(total);
  if (band === "clerk") return `Clerk can release: amount ${fmtRupees(total)} is within ${fmtRupees(THRESHOLDS.clerkMax)}`;
  if (band === "L1") return `Needs Approver L1: amount ${fmtRupees(total)} > ${fmtRupees(THRESHOLDS.clerkMax)}`;
  return `Needs Approver L2: amount ${fmtRupees(total)} > ${fmtRupees(THRESHOLDS.l1Max)}`;
}
