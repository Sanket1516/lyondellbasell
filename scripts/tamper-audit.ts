// Developer script: proves the audit trail detects tampering, now against the database (data/plantx.db).
//   npm run audit:tamper              edits one saved audit record, then verifies the chain
//   npm run audit:tamper -- --seq 5   choose which record to edit (default: the middle one)
//   npm run audit:tamper -- --restore put the original record back
//   npm run audit:tamper -- --verify  only verify the saved log
// Two layers: the database refuses UPDATE/DELETE on audit_events (triggers). This script plays an attacker with
// direct file access who drops the trigger first; the hash chain still catches the edit. Click "Verify chain" on /audit.
import fs from "node:fs";
import path from "node:path";
import { verifyChain } from "../src/lib/audit";
import { loadAuditEvents, openDb } from "../src/lib/db";
import type { AuditEvent } from "../src/lib/types";

const BACKUP = path.join(process.cwd(), "data", "audit.pre-tamper.json");
const args = process.argv.slice(2);
const db = openDb();

function report(label: string) {
  const r = verifyChain(loadAuditEvents(db));
  if (r.ok) console.log(`${label}: Chain intact. ${r.count} records checked.`);
  else console.log(`${label}: CHAIN BROKEN at record #${r.brokenSeq}. ${r.reason}`);
  return r;
}

/** Bypass the append-only triggers (what an attacker with the DB file could do), write, then put the triggers back. */
function forceWrite(e: AuditEvent) {
  db.transaction(() => {
    db.exec("DROP TRIGGER IF EXISTS audit_no_update;");
    db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(JSON.stringify(e), e.seq);
    db.exec("CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;");
  })();
}

if (args.includes("--restore")) {
  if (!fs.existsSync(BACKUP)) { console.error("Nothing to restore (no backup found)."); process.exit(1); }
  forceWrite(JSON.parse(fs.readFileSync(BACKUP, "utf8")) as AuditEvent);
  fs.unlinkSync(BACKUP);
  console.log("Restored the original record.");
  report("After restore");
  process.exit(0);
}
if (args.includes("--verify")) process.exit(report("Saved log").ok ? 0 : 2);

const events = loadAuditEvents(db);
if (events.length === 0) { console.error("The audit log is empty. Run the golden journey first."); process.exit(1); }
report("Before");
const i = args.includes("--seq") ? events.findIndex((e) => e.seq === Number(args[args.indexOf("--seq") + 1])) : Math.floor(events.length / 2);
if (i < 0) { console.error("No such record."); process.exit(1); }
const e = events[i];
try {
  db.prepare("UPDATE audit_events SET data = json_set(data, '$.detail', 'x') WHERE seq = ?").run(e.seq);
  console.log("WARNING: the database accepted a direct edit. The append-only trigger is missing.");
} catch (err) {
  console.log(`Layer 1, database: direct UPDATE refused ("${(err as Error).message}").`);
}
if (!fs.existsSync(BACKUP)) fs.writeFileSync(BACKUP, JSON.stringify(e));
console.log(`Layer 2, attacker drops the trigger and edits record #${e.seq} (${e.action}${e.invoiceId ? ", " + e.invoiceId : ""}): "${e.detail.slice(0, 60)}"`);
forceWrite({ ...e, detail: e.detail + " [edited by hand]" });
const r = report("After");
console.log(r.ok ? "Not detected: this is a bug." : `Detected. Run "npm run audit:tamper -- --restore" to put the record back.`);
process.exit(r.ok ? 1 : 0);
