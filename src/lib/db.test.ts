import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAll, loadAuditEvents, openDb, replaceAll, rowCounts, saveChanges } from "./db";
import type { AppState } from "./types";

const seedDir = path.join(process.cwd(), "data", "seed");
function seed(): AppState {
  const s = { version: 1 } as Record<string, unknown>;
  for (const k of ["vendors", "purchaseOrders", "goodsReceipts", "contracts", "deliveryNotes", "uomRules", "invoices", "findings", "tasks", "auditEvents"]) {
    const f = path.join(seedDir, `${k}.json`);
    s[k] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  }
  return s as unknown as AppState;
}
function tmpDb() { return openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "plantx-")), "t.db")); }

describe("SQLite store", () => {
  it("round-trips the seed exactly, in order", () => {
    const db = tmpDb();
    replaceAll(db, seed(), "seed");
    expect(loadAll(db)).toEqual(seed());
    expect(rowCounts(db).invoices).toBe(seed().invoices.length);
  });

  it("writes changes, additions and deletions", () => {
    const db = tmpDb();
    replaceAll(db, seed(), "seed");
    const s = loadAll(db);
    s.invoices[0].status = "approved";
    s.vendors.push({ ...s.vendors[0], id: "V-TEST" });
    s.tasks = [];
    saveChanges(db, s);
    expect(loadAll(db)).toEqual(s);
  });

  it("keeps the audit log append-only", () => {
    const db = tmpDb();
    const s = seed();
    s.auditEvents = [{ seq: 1, at: "2026-11-12T10:00:00Z", actor: "system", action: "x", detail: "first", prevHash: "0", hash: "h1" }];
    replaceAll(db, s, "seed");
    expect(() => db.prepare("UPDATE audit_events SET data = '{}' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
    // The app rewriting an old record in memory must not change the saved one.
    const edited = loadAll(db);
    edited.auditEvents[0].detail = "rewritten";
    edited.auditEvents.push({ seq: 2, at: "2026-11-12T10:01:00Z", actor: "system", action: "y", detail: "second", prevHash: "h1", hash: "h2" });
    saveChanges(db, edited);
    const saved = loadAuditEvents(db);
    expect(saved.map((e) => e.detail)).toEqual(["first", "second"]);
  });

  it("imports the current state.json without loss", () => {
    const file = path.join(process.cwd(), "data", "state.json");
    if (!fs.existsSync(file)) return;
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as AppState;
    const db = tmpDb();
    replaceAll(db, s, "import");
    expect(loadAll(db)).toEqual(s);
  });
});

describe("users table", () => {
  it("stores hashed passwords and checks them", async () => {
    const { checkPassword } = await import("./db");
    const db = tmpDb();
    const row = db.prepare("SELECT password_hash FROM users WHERE username = 'priya.clerk'").get() as { password_hash: string };
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row.password_hash).not.toContain("Clerk@2026");
    expect(checkPassword(db, "priya.clerk", "Clerk@2026")).toBe(true);
    expect(checkPassword(db, "priya.clerk", "wrong")).toBe(false);
    expect(checkPassword(db, "nobody", "Clerk@2026")).toBe(false);
  });
});
