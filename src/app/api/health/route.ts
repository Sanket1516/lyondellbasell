import { NextResponse } from "next/server";
import { verifyChain } from "@/lib/audit";
import { getRevision, rowCounts, SCHEMA_VERSION } from "@/lib/db";
import { database, readSavedAuditEvents, storeDriver } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Service health for operators and monitoring: storage driver, database status, row counts, audit chain. No business data. */
export async function GET() {
  try {
    const db = database();
    const chain = verifyChain(readSavedAuditEvents());
    return NextResponse.json({
      status: chain.ok ? "ok" : "degraded",
      time: new Date().toISOString(),
      store: storeDriver(),
      database: db ? { engine: "sqlite", schemaVersion: SCHEMA_VERSION, revision: getRevision(db), rows: rowCounts(db) } : undefined,
      auditChain: chain.ok ? { intact: true, records: chain.count } : { intact: false, brokenAt: chain.brokenSeq, reason: chain.reason },
    }, { status: chain.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json({ status: "down", error: (err as Error).message }, { status: 503 });
  }
}
