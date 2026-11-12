# T6 — Real database + backend API (deadline 16:30, 12 Nov)

**Status 16:11: Phase 1 and Phase 2 built and verified, waiting for tester PASS.** 123/123 tests, typecheck clean, build OK,
golden journey passes on SQLite (36 s, no console errors), data survives a restart, tamper demo detected, JSON fallback runs.
Testers: run `npm install` first (new native module `better-sqlite3`). The first start copies `data/state.json` into `data/plantx.db`.

## Goal
Move app data from `data/state.json` into a real database, with no change to any screen or rule.

## Why this cannot break current features
Every page, server action and API route reads and writes data through four functions in
`src/lib/store.ts`: `getState`, `updateState`, `resetState`, `readSavedAuditEvents`.
Only the inside of those functions changes. Their names, signatures and synchronous behaviour stay
the same, so the matching engine, workflow, audit chain, dashboard and chatbot are not touched.

Safety net: `PLANTX_STORE=json` in `.env` switches back to the old JSON file store immediately.

## Phase 1: SQLite store (must ship)
- Driver: `better-sqlite3` (synchronous, so the sync `store.ts` API stays as it is; one file, no server to run at the venue).
- File: `data/plantx.db` (WAL mode), git-ignored.
- `src/lib/db.ts`: schema, open/migrate, load, write changes, reset.
  - One table per collection (`vendors`, `purchase_orders`, `goods_receipts`, `contracts`, `delivery_notes`,
    `uom_rules`, `invoices`, `findings`, `tasks`, `audit_events`), each with a primary key, row order and a JSON body.
  - Indexes on invoice status, vendor and PO; findings by invoice; tasks by invoice.
  - `meta` table: schema version, seed time, revision counter (another process changing the DB triggers a reload).
  - **Audit log is append-only in the DB**: triggers reject UPDATE/DELETE on `audit_events`.
    `updateState` only ever inserts new audit rows. This also fixes the T4 gap where the next change rewrote a tampered record.
- `updateState` runs inside one transaction and writes only the rows that changed (upsert plus delete).
- First run: imports the existing `data/state.json` if there is one, otherwise loads the seed.
- `npm run reset` and `audit:tamper` work against the DB. The tamper script has to drop the trigger first,
  which is the pitch point: the DB blocks edits, and the hash chain still catches an attacker who bypasses it.

## Phase 2: backend API + users in DB (if time)
- `users` table with scrypt-hashed passwords. Login checks the hash; the demo accounts table on the login page stays.
- REST API for other systems: `GET /api/health` (DB status, row counts) and `GET /api/v1/invoices`
  (session-authenticated, role-scoped: a supplier sees only its own invoices).

## Phase 3: after the hackathon (not now)
Postgres via the same `db.ts` interface, a real webhook ingestion endpoint, migrations tool.

## Done when
- `npm test` passes (118 of 118), `npx tsc --noEmit` is clean, `npm run build` passes.
- Golden journey script passes end to end against the DB.
- Restarting the server keeps all data (persistence check).
- `PLANTX_STORE=json` still runs the old path.
