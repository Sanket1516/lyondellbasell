// Developer script: proves the audit trail detects tampering.
//   npm run audit:tamper              edits one saved record in data/state.json, then verifies the chain
//   npm run audit:tamper -- --seq 5   choose which record to edit (default: the middle one)
//   npm run audit:tamper -- --restore put the original file back
//   npm run audit:tamper -- --verify  only verify the saved log
// With the app running, click "Verify chain" on /audit straight after tampering: it reads the saved file.
// Do not use the app before restoring: the next change rewrites the file from memory and repairs the record.
import fs from "node:fs";
import path from "node:path";
import { verifyChain } from "../src/lib/audit";
import type { AppState } from "../src/lib/types";

const FILE = path.join(process.cwd(), "data", "state.json");
const BACKUP = path.join(process.cwd(), "data", "state.pre-tamper.json");
const args = process.argv.slice(2);

function report(label: string, state: AppState) {
  const r = verifyChain(state.auditEvents);
  if (r.ok) console.log(`${label}: Chain intact. ${r.count} records checked.`);
  else console.log(`${label}: CHAIN BROKEN at record #${r.brokenSeq}. ${r.reason}`);
  return r;
}

if (args.includes("--restore")) {
  if (!fs.existsSync(BACKUP)) { console.error("Nothing to restore (no backup found)."); process.exit(1); }
  fs.copyFileSync(BACKUP, FILE);
  fs.unlinkSync(BACKUP);
  console.log("Restored data/state.json.");
  report("After restore", JSON.parse(fs.readFileSync(FILE, "utf8")));
  process.exit(0);
}

if (!fs.existsSync(FILE)) { console.error("data/state.json not found. Start the app or run npm run seed first."); process.exit(1); }
const state = JSON.parse(fs.readFileSync(FILE, "utf8")) as AppState;
if (args.includes("--verify")) { process.exit(report("Saved log", state).ok ? 0 : 2); }

if (state.auditEvents.length === 0) { console.error("The audit log is empty. Run the golden journey first."); process.exit(1); }
report("Before", state);
const i = args.includes("--seq") ? state.auditEvents.findIndex((e) => e.seq === Number(args[args.indexOf("--seq") + 1])) : Math.floor(state.auditEvents.length / 2);
if (i < 0) { console.error("No such record."); process.exit(1); }
if (!fs.existsSync(BACKUP)) fs.copyFileSync(FILE, BACKUP);
const e = state.auditEvents[i];
console.log(`Tampering with record #${e.seq} (${e.action}${e.invoiceId ? ", " + e.invoiceId : ""}): "${e.detail.slice(0, 60)}"`);
e.detail = e.detail + " [edited by hand]";
fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
const r = report("After", state);
console.log(r.ok ? "Not detected: this is a bug." : `Detected. Run "npm run audit:tamper -- --restore" to put the file back.`);
process.exit(r.ok ? 1 : 0);
