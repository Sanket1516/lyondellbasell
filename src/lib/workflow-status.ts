// The invoice state as the clerk and approver read it. Derived from status, verdict and open tasks, so it never drifts.
import type { ChipKind } from "@/components/ui";
import { bandFor } from "./routing";
import { STATUS_VIEW } from "./status";
import type { Invoice, Task } from "./types";

export function workflowView(inv: Pick<Invoice, "status" | "verdict" | "total">, tasks: Pick<Task, "status" | "owner">[]): { kind: ChipKind; label: string } {
  const open = tasks.filter((t) => t.status === "requested");
  switch (inv.status) {
    case "received": return { kind: "pending", label: "Submitted" };
    case "matched": return { kind: "pending", label: "Matched" };
    case "pending_owner":
    case "blocked": {
      if (open.length) {
        const internal = open.some((t) => t.owner !== "Supplier");
        return { kind: inv.status === "blocked" ? "block" : "flag", label: internal ? "Awaiting owner actions" : "Waiting for supplier" };
      }
      return inv.status === "blocked" ? { kind: "block", label: "Blocked" } : { kind: "flag", label: "Flagged" };
    }
    case "pending_approval": {
      const band = bandFor(inv.total);
      return { kind: "pending", label: band === "clerk" ? "Awaiting clerk release" : `Awaiting Approver ${band}` };
    }
    case "approved": return { kind: "approve", label: "Approved, ready for payment" };
    case "sent_back": return { kind: "flag", label: "Sent back by approver" };
    case "rejected": return { kind: "block", label: "Rejected" };
    default: return STATUS_VIEW[inv.status];
  }
}
