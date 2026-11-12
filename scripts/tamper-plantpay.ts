// Tamper demo for the PlantPay audit trail. Works on COPIES of data/plantpay-integration.db, never on the live file.
// Shows that editing, deleting and reordering a past record, and editing a workflow event, are each detected, with the position reported.
// Run: npm run audit:tamper:plantpay
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { INTEGRATION_DB_FILE, openIntegrationDb } from "../src/plantpay/integration";
import { verifyIntegrity } from "../src/plantpay/workflowEvents";

if (!fs.existsSync(INTEGRATION_DB_FILE)) { console.error("Run `npm run seed:sources` first."); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plantpay-tamper-"));
const show = (label: string, r: ReturnType<typeof verifyIntegrity>) =>
  console.log(`${label.padEnd(44)} ${r.ok ? `OK (${r.auditEntries} audit entries, ${r.workflowEvents} workflow events)` : `BROKEN at record ${r.position} [${r.kind}]: ${r.reason}`}`);

/** Copy the live database (checkpointing its WAL first), apply a tamper, verify the copy. */
function scenario(label: string, tamper: (db: Database.Database) => void) {
  const live = new Database(INTEGRATION_DB_FILE, { readonly: true });
  const file = path.join(tmp, `${label.replace(/\W+/g, "_")}.db`);
  live.backup(file).then(() => {
    live.close();
    const db = openIntegrationDb(file);
    db.exec("DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete;"); // an attacker with file access would do the same
    tamper(db);
    show(label, verifyIntegrity(db));
    db.close();
  });
}

const base = openIntegrationDb(INTEGRATION_DB_FILE);
show("Untouched database", verifyIntegrity(base));
const total = (base.prepare("SELECT MAX(seq) m FROM audit_events").get() as { m: number }).m;
const target = Math.floor(total / 2);
base.close();

scenario(`Edit the detail of record ${target}`, (db) => {
  const row = db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(target) as { data: string };
  const e = JSON.parse(row.data); e.detail = "Edited after the fact"; db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(JSON.stringify(e), target);
});
scenario(`Delete record ${target}`, (db) => { db.prepare("DELETE FROM audit_events WHERE seq = ?").run(target); });
scenario(`Swap records ${target} and ${target + 1}`, (db) => {
  const a = db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(target) as { data: string };
  const b = db.prepare("SELECT data FROM audit_events WHERE seq = ?").get(target + 1) as { data: string };
  db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(b.data, target);
  db.prepare("UPDATE audit_events SET data = ? WHERE seq = ?").run(a.data, target + 1);
});
scenario("Edit a workflow event row (payload)", (db) => {
  const row = db.prepare("SELECT id FROM workflow_events WHERE event_type = 'approval_granted' ORDER BY id LIMIT 1").get() as { id: number };
  db.prepare("UPDATE workflow_events SET actor = 'someone.else' WHERE id = ?").run(row.id);
});
scenario("Delete a workflow event row", (db) => {
  const row = db.prepare("SELECT id FROM workflow_events WHERE event_type = 'exception_resolved' ORDER BY id LIMIT 1").get() as { id: number };
  db.prepare("DELETE FROM workflow_events WHERE id = ?").run(row.id);
});
