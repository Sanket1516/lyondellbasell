import Link from "next/link";
import { ProblemBanner, RoleBanner } from "@/components/Info";
import { clerkValue } from "@/lib/impact";
import { DEMO_TODAY } from "@/lib/constants";
import { getState } from "@/lib/store";
import { workflowView } from "@/lib/workflow-status";
import type { Finding, Verdict } from "@/lib/types";
import { QueueTable, type QueueRow } from "./QueueTable";
import s from "./Clerk.module.css";

export const dynamic = "force-dynamic";

const RANK: Record<Verdict, number> = { approve: 0, flag: 1, block: 2 };
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

/** The finding that explains the verdict: most severe first, then the first one raised. */
function top(fs: Finding[]): Finding | undefined {
  return [...fs].filter((f) => f.verdict !== "approve").sort((a, b) => RANK[b.verdict] - RANK[a.verdict])[0];
}

export default async function ClerkHome({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const all = view === "all";
  const state = getState();
  const nameOf = (id: string, printed?: string) => state.vendors.find((v) => v.id === id)?.name ?? printed ?? "Unknown supplier";

  const open = state.invoices.filter((i) => i.status !== "approved" && i.status !== "paid");
  const rows: QueueRow[] = (all ? state.invoices : open)
    .map((i) => {
      const t = top(state.findings.filter((f) => f.invoiceId === i.id));
      return {
        id: i.id, vendor: nameOf(i.vendorId, i.printedVendor?.name), total: i.total, verdict: i.verdict,
        cause: t?.rootCause ?? (i.verdict ? "No issues" : "Waiting to be matched"), owner: t?.owner ?? "None",
        ageDays: days(i.receivedOn, DEMO_TODAY), receivedOn: i.receivedOn, status: workflowView(i, state.tasks.filter((x) => x.invoiceId === i.id)),
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || (a.id < b.id ? -1 : 1));

  const count = (v: Verdict) => open.filter((i) => i.verdict === v).length;

  return (
    <>
      <ProblemBanner />
      <RoleBanner role="AP clerk" title={clerkValue(state).headline} lines={clerkValue(state).lines} note="Measured from the live records; time saved assumes 12 minutes per manual check." />
      <h1 style={{ marginBottom: 6 }}>Invoice queue</h1>
      <p className={s.lead}>
        {open.length} open: {count("block")} blocked, {count("flag")} flagged, {count("approve")} clean. Oldest first. Keys: J and K to move, Enter to open.
      </p>
      <nav className={s.filters} aria-label="Queue filter">
        <Link href="/clerk" aria-current={all ? undefined : "page"} className={all ? s.filter : `${s.filter} ${s.filterOn}`}>Open ({open.length})</Link>
        <Link href="/clerk?view=all" aria-current={all ? "page" : undefined} className={all ? `${s.filter} ${s.filterOn}` : s.filter}>All invoices ({state.invoices.length})</Link>
      </nav>
      <QueueTable rows={rows} />
    </>
  );
}
