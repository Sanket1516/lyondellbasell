// PlantPay MongoDB schema: collections, $jsonSchema validators and indexes.
// Standalone. The app does NOT use this database; it still runs on SQLite (src/lib/db.ts).
//
// Run (safe to re-run; existing collections get their validator updated):
//   mongosh "mongodb://localhost:27017/plantpay" db/mongo/schema.js
//
// Documents mirror the TypeScript types in src/lib/types.ts field for field, so a future
// adapter could read and write them without reshaping. Dates stay ISO strings like the app.

if (db.getName() === "test") db = db.getSiblingDB("plantpay");

const ISO_DATE = "^\\d{4}-\\d{2}-\\d{2}$";
const ISO_TS = "^\\d{4}-\\d{2}-\\d{2}T";

const str = { bsonType: "string" };
const num = { bsonType: "number" };
const int = { bsonType: ["int", "long", "double"] };
const bool = { bsonType: "bool" };
const date = { bsonType: "string", pattern: ISO_DATE };
const ts = { bsonType: "string", pattern: ISO_TS };
const strArr = { bsonType: "array", items: str };
const enumOf = (...v) => ({ bsonType: "string", enum: v });
const obj = (required, properties) => ({ bsonType: "object", required, properties });
const arrOf = (item, minItems = 0) => ({ bsonType: "array", minItems, items: item });

const VERDICT = enumOf("approve", "flag", "block");
const INVOICE_STATUS = enumOf("received", "matched", "pending_owner", "pending_approval", "approved", "blocked", "sent_back", "rejected", "paid");
const FINDING_KIND = enumOf("price", "quantity", "missing_receipt", "missing_po", "unknown_vendor", "duplicate", "tax", "uom", "arithmetic", "not_on_po");

/** collection name -> { validator schema, indexes } */
const COLLECTIONS = {
  meta: {
    schema: obj(["_id"], { _id: str, schemaVersion: int, revision: int, seededAt: ts, seedSource: str }),
    indexes: [],
  },

  users: {
    schema: obj(["_id", "username", "role", "passwordHash", "createdAt"], {
      _id: str, // = username
      username: str,
      displayName: str,
      title: str,
      role: enumOf("supplier", "clerk", "approver"),
      approverLevel: enumOf("L1", "L2"),
      vendorId: str,
      passwordHash: { bsonType: "string", pattern: "^scrypt\\$" }, // same format as src/lib/db.ts
      createdAt: ts,
    }),
    indexes: [{ key: { role: 1 } }, { key: { vendorId: 1 }, sparse: true }],
  },

  vendors: {
    schema: obj(["_id", "id", "name", "gstin", "active"], {
      _id: str, id: str, name: str,
      gstin: { bsonType: "string", pattern: "^[0-9]{2}[A-Z0-9]{13}$" },
      active: bool,
      paymentTermsDays: int,
    }),
    indexes: [{ key: { gstin: 1 }, unique: true }],
  },

  purchaseOrders: {
    schema: obj(["_id", "id", "vendorId", "buyer", "issuedOn", "lines"], {
      _id: str, id: str, vendorId: str, buyer: str, issuedOn: date, contractId: str,
      lines: arrOf(obj(["lineNo", "itemCode", "description", "qty", "uom", "unitPrice", "taxCode", "taxRatePct"], {
        lineNo: int, itemCode: str, description: str, qty: num, uom: str, unitPrice: num, taxCode: str, taxRatePct: num,
      }), 1),
    }),
    indexes: [{ key: { vendorId: 1 } }, { key: { contractId: 1 }, sparse: true }, { key: { "lines.itemCode": 1 } }],
  },

  goodsReceipts: {
    schema: obj(["_id", "id", "poId", "receivedOn", "receivedBy", "lines"], {
      _id: str, id: str, poId: str, receivedOn: date, receivedBy: str,
      lines: arrOf(obj(["lineNo", "qtyReceived", "uom"], { lineNo: int, qtyReceived: num, uom: str }), 1),
    }),
    indexes: [{ key: { poId: 1 } }],
  },

  contracts: {
    schema: obj(["_id", "id", "vendorId", "effectiveFrom", "prices"], {
      _id: str, id: str, vendorId: str, effectiveFrom: date,
      prices: arrOf(obj(["itemCode", "unitPrice", "uom"], { itemCode: str, unitPrice: num, uom: str })),
      history: arrOf(obj(["itemCode", "unitPrice", "uom", "effectiveFrom"], { itemCode: str, unitPrice: num, uom: str, effectiveFrom: date })),
    }),
    indexes: [{ key: { vendorId: 1 } }, { key: { "prices.itemCode": 1 } }],
  },

  deliveryNotes: {
    schema: obj(["_id", "id", "poId", "vendorId", "deliveredOn", "lines"], {
      _id: str, id: str, poId: str, vendorId: str, deliveredOn: date,
      lines: arrOf(obj(["itemCode", "qty", "uom"], { itemCode: str, qty: num, uom: str })),
    }),
    indexes: [{ key: { poId: 1 } }],
  },

  uomRules: {
    schema: obj(["_id", "itemCode", "fromUom", "toUom", "factor"], {
      _id: str, // = "itemCode|fromUom|toUom", same key as the SQLite table
      itemCode: str, fromUom: str, toUom: str,
      factor: { bsonType: "number", minimum: 0, exclusiveMinimum: true },
    }),
    indexes: [{ key: { itemCode: 1 } }],
  },

  invoices: {
    schema: obj(["_id", "id", "vendorId", "invoiceDate", "receivedOn", "currency", "lines", "subtotal", "tax", "total", "status"], {
      _id: str, id: str, vendorId: str, poId: str,
      invoiceDate: date, receivedOn: date, resolvedOn: date,
      currency: enumOf("INR"),
      lines: arrOf(obj(["lineNo", "description", "qty", "uom", "unitPrice", "taxRatePct", "amount"], {
        lineNo: int, itemCode: str, description: str, qty: num, uom: str, unitPrice: num, taxRatePct: num, amount: num,
      })),
      subtotal: num, tax: num, total: num,
      status: INVOICE_STATUS,
      verdict: VERDICT,
      sourceFile: str,
      printedVendor: obj(["name"], { name: str, gstin: str }),
      duplicateDecision: obj(["decision", "matchedInvoiceId", "by", "reason", "at"], {
        decision: enumOf("duplicate", "not_duplicate"), matchedInvoiceId: str, by: str,
        reason: { bsonType: "string", minLength: 1 }, at: ts,
      }),
      submittedBy: str,
      touchedBy: strArr,
      rejectedBy: strArr,
      decision: obj(["outcome", "by", "at"], {
        outcome: enumOf("released", "approved", "rejected", "sent_back"), by: str, level: enumOf("L1", "L2"), at: ts, reason: str,
      }),
    }),
    indexes: [
      { key: { status: 1 } },
      { key: { vendorId: 1, invoiceDate: -1 } },
      { key: { poId: 1 }, sparse: true },
      { key: { submittedBy: 1 }, sparse: true },
    ],
  },

  findings: {
    schema: obj(["_id", "id", "invoiceId", "kind", "verdict", "message", "rootCause", "owner", "smallestFix"], {
      _id: str, id: str, invoiceId: str, lineNo: int,
      kind: FINDING_KIND, verdict: VERDICT,
      message: str, rootCause: str, owner: str, smallestFix: str,
      expected: str, actual: str, deltaPct: num,
      evidence: arrOf(obj(["kind", "ref", "text"], {
        kind: enumOf("po", "goods_receipt", "contract", "delivery_note", "uom_rule", "invoice"), ref: str, text: str,
      })),
      matchedInvoiceId: str,
    }),
    indexes: [{ key: { invoiceId: 1 } }, { key: { kind: 1, verdict: 1 } }, { key: { owner: 1 } }],
  },

  tasks: {
    schema: obj(["_id", "id", "invoiceId", "kind", "rootCause", "owner", "title", "status", "dueOn", "createdAt", "createdBy"], {
      _id: str, id: str, invoiceId: str, findingId: str, kind: FINDING_KIND, lineNo: int,
      rootCause: str, owner: str, title: str,
      status: enumOf("requested", "done"),
      dueOn: date, createdAt: ts, createdBy: str, completedAt: ts, completedBy: str,
      fix: obj(["type"], { type: enumOf("po_price", "post_receipt", "supplier") }),
      resolution: str, note: str,
    }),
    indexes: [{ key: { invoiceId: 1 } }, { key: { owner: 1, status: 1 } }, { key: { status: 1, dueOn: 1 } }],
  },

  // Hash-chained, append-only. MongoDB has no triggers, so append-only is enforced by the
  // plantpayApp role (see roles.js): it may insert and read audit events, never update or delete.
  auditEvents: {
    schema: obj(["_id", "seq", "at", "actor", "action", "detail", "prevHash", "hash"], {
      _id: int, // = seq
      seq: { bsonType: ["int", "long", "double"], minimum: 1 },
      at: ts, actor: str, role: str, action: str, invoiceId: str, detail: str,
      before: str, after: str, reason: str,
      prevHash: str, hash: str,
    }),
    indexes: [{ key: { seq: 1 }, unique: true }, { key: { hash: 1 }, unique: true }, { key: { invoiceId: 1, seq: 1 } }, { key: { actor: 1 } }],
  },
};

const existing = new Set(db.getCollectionNames());
for (const [name, { schema, indexes }] of Object.entries(COLLECTIONS)) {
  const validator = { $jsonSchema: schema };
  if (existing.has(name)) {
    db.runCommand({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  } else {
    db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  }
  for (const { key, ...opts } of indexes) db.getCollection(name).createIndex(key, opts);
  print(`${existing.has(name) ? "updated" : "created"}  ${name}  (${indexes.length} indexes)`);
}

db.meta.updateOne({ _id: "schema" }, { $setOnInsert: { schemaVersion: 1, revision: 0 } }, { upsert: true });
print(`\nSchema ready in database "${db.getName()}".`);
