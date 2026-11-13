# PlantPay MongoDB database (standalone, not integrated)

A MongoDB version of the PlantPay data store. **The app does not use it.** It still runs on SQLite
(`src/lib/db.ts` → `data/plantx.db`). No npm package was added and nothing in `src/` touches this folder.

## Files

| File | What it does |
|---|---|
| `schema.js` | Creates 12 collections with strict `$jsonSchema` validators and their indexes. Safe to re-run (it updates the validators). |
| `seed.js` | Wipes the data collections and loads `data/seed/*.json` (the same files `npm run reset` uses), plus the 5 demo users with scrypt-hashed passwords. |
| `roles.js` | Optional, for a server with auth on. Creates the `plantpayApp` role (and the `plantpay_app` user if `APP_PASSWORD` is set). |

## Run

Needs a local `mongod` and `mongosh` (both installed on this machine: MongoDB 8.0).

```sh
mongosh "mongodb://localhost:27017/plantpay" db/mongo/schema.js
mongosh "mongodb://localhost:27017/plantpay" db/mongo/seed.js
# optional, as an admin on an auth-enabled server:
APP_PASSWORD=... mongosh "mongodb://admin:...@localhost:27017/plantpay?authSource=admin" db/mongo/roles.js
```

To load something other than the seed files, set `SEED_DIR` to a folder of `<collection>.json` arrays.

## Collections

Each collection is one key of `AppState` in `src/lib/types.ts`. Documents keep the TypeScript shapes
field for field (dates stay ISO strings, money stays rupees), so a future adapter would not need to reshape anything.

| Collection | SQLite table | `_id` | Indexes |
|---|---|---|---|
| `vendors` | vendors | `id` | gstin (unique) |
| `purchaseOrders` | purchase_orders | `id` | vendorId, contractId, lines.itemCode |
| `goodsReceipts` | goods_receipts | `id` | poId |
| `contracts` | contracts | `id` | vendorId, prices.itemCode |
| `deliveryNotes` | delivery_notes | `id` | poId |
| `uomRules` | uom_rules | `itemCode\|fromUom\|toUom` | itemCode |
| `invoices` | invoices | `id` | status, vendorId+invoiceDate, poId, submittedBy |
| `findings` | findings | `id` | invoiceId, kind+verdict, owner |
| `tasks` | tasks | `id` | invoiceId, owner+status, status+dueOn |
| `auditEvents` | audit_events | `seq` | seq (unique), hash (unique), invoiceId+seq, actor |
| `users` | users | `username` | role, vendorId |
| `meta` | meta | `"schema"` | none (holds schemaVersion, revision, seededAt) |

PO lines, GR lines, invoice lines, contract prices and evidence are embedded arrays rather than
separate collections, because the app always reads them with their parent document.

Each seeded document also gets a `pos` field holding the app's list order, because MongoDB does not
guarantee insertion order.

## How it differs from the SQLite store

- **Append-only audit log.** SQLite blocks updates and deletes on `audit_events` with triggers.
  MongoDB has no triggers, so `roles.js` grants `plantpayApp` only `find` and `insert` on `auditEvents`.
  This only applies when auth is on. On a no-auth dev server anyone can still edit the log, but the
  `prevHash`/`hash` chain still shows any tampering.
- **Validation.** The validators reject unknown statuses, verdicts and finding kinds, wrong date formats,
  non-INR currency, a duplicate-invoice decision without a reason, and duplicate GSTINs.
- **Transactions.** `saveChanges()` writes one SQLite transaction. The MongoDB equivalent needs a
  replica set (even a single-node one) to get multi-document transactions.

## Tested (13 Nov 2026, MongoDB 8.0, throwaway server)

- `schema.js` creates everything and re-runs without errors.
- `seed.js` loads every seed record (6 vendors, 47 POs, 44 GRs, 6 contracts, 13 DNs, 3 UoM rules, 43 invoices, 21 findings, 5 users).
- A read-only export of the live `data/plantx.db` (46 invoices, 4 tasks, 31 audit events) also passes every validator.
- Bad documents are rejected (wrong date, USD, unknown status, unknown finding kind, duplicate GSTIN).
- With auth on, `plantpay_app` can read and append audit events but gets `Unauthorized` when it tries to update, delete or drop them.
