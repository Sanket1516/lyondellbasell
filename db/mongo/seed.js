// Loads the demo data from data/seed/*.json into MongoDB (same files `npm run reset` uses for SQLite).
// Wipes and refills every data collection, like replaceAll() in src/lib/db.ts. Run schema.js first.
//
//   mongosh "mongodb://localhost:27017/plantpay" db/mongo/seed.js
//
// Override the seed folder with SEED_DIR=/path/to/seed. Users come from src/lib/users.ts's demo
// accounts (copied below) with scrypt-hashed passwords in the same format as the SQLite users table.

if (db.getName() === "test") db = db.getSiblingDB("plantpay");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SEED_DIR = process.env.SEED_DIR || path.resolve(__dirname, "..", "..", "data", "seed");

/** collection -> how to build _id (same primary keys as rowKey() in src/lib/db.ts) */
const KEYS = {
  vendors: (r) => r.id,
  purchaseOrders: (r) => r.id,
  goodsReceipts: (r) => r.id,
  contracts: (r) => r.id,
  deliveryNotes: (r) => r.id,
  uomRules: (r) => `${r.itemCode}|${r.fromUom}|${r.toUom}`,
  invoices: (r) => r.id,
  findings: (r) => r.id,
  tasks: (r) => r.id,
  auditEvents: (r) => r.seq,
};

// Fictional demo accounts, kept in step with src/lib/users.ts.
const USERS = [
  { username: "vihar.supplier", password: "Vihar@2026", displayName: "Vihar Chem Supplies", title: "Supplier", role: "supplier", vendorId: "V-1001" },
  { username: "konkan.supplier", password: "Konkan@2026", displayName: "Konkan Packaging Works", title: "Supplier", role: "supplier", vendorId: "V-1002" },
  { username: "priya.clerk", password: "Clerk@2026", displayName: "Priya Nair", title: "AP Clerk", role: "clerk" },
  { username: "neha.approver", password: "ApproverL1@2026", displayName: "Neha Kulkarni", title: "Approver L1 · Finance Manager", role: "approver", approverLevel: "L1" },
  { username: "rajesh.approver", password: "ApproverL2@2026", displayName: "Rajesh Menon", title: "Approver L2 · Finance Controller", role: "approver", approverLevel: "L2" },
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return ["scrypt", salt.toString("base64"), crypto.scryptSync(password, salt, 32).toString("base64")].join("$");
}

const now = new Date().toISOString();
const counts = {};

for (const [name, keyOf] of Object.entries(KEYS)) {
  const file = path.join(SEED_DIR, `${name}.json`);
  const records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  // `pos` keeps the app's list order, which MongoDB does not guarantee on its own.
  const docs = records.map((r, i) => ({ _id: keyOf(r), ...r, pos: i }));
  db.getCollection(name).deleteMany({});
  if (docs.length) db.getCollection(name).insertMany(docs, { ordered: true });
  counts[name] = docs.length;
}

db.users.deleteMany({});
db.users.insertMany(USERS.map(({ password, ...u }) => ({ _id: u.username, ...u, passwordHash: hashPassword(password), createdAt: now })));
counts.users = USERS.length;

db.meta.updateOne(
  { _id: "schema" },
  { $set: { seededAt: now, seedSource: "seed" }, $setOnInsert: { schemaVersion: 1 }, $inc: { revision: 1 } },
  { upsert: true },
);

print(`Seeded database "${db.getName()}" from ${SEED_DIR}`);
printjson(counts);
