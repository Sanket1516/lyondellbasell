import type { ChipKind } from "@/components/ui";
import type { InvoiceStatus } from "./types";

export const UNKNOWN_VENDOR = "UNKNOWN";

/** How a status reads on the supplier's list. Later tickets refine the wording of the in-between states. */
export const STATUS_VIEW: Record<InvoiceStatus, { kind: ChipKind; label: string }> = {
  received: { kind: "pending", label: "Submitted" },
  matched: { kind: "pending", label: "In review" },
  pending_owner: { kind: "flag", label: "Internal action pending" },
  pending_approval: { kind: "pending", label: "Awaiting approval" },
  approved: { kind: "approve", label: "Approved" },
  blocked: { kind: "block", label: "On hold" },
  paid: { kind: "paid", label: "Paid" },
};
