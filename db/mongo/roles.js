// Optional: a least-privilege role and app user for a server with authentication on.
// Run as an admin after schema.js:
//   mongosh "mongodb://admin:<pw>@localhost:27017/plantpay?authSource=admin" db/mongo/roles.js
//
// plantpayApp can read and write every collection, but on auditEvents it can only find and insert.
// That is the MongoDB stand-in for the SQLite triggers that make audit_events append-only.
// Set APP_PASSWORD to also create the "plantpay_app" login (never commit the password).

if (db.getName() === "test") db = db.getSiblingDB("plantpay");
const DB = db.getName();
const RW = ["find", "insert", "update", "remove", "createIndex"];
const DATA = ["meta", "users", "vendors", "purchaseOrders", "goodsReceipts", "contracts", "deliveryNotes", "uomRules", "invoices", "findings", "tasks"];

const privileges = [
  ...DATA.map((collection) => ({ resource: { db: DB, collection }, actions: RW })),
  { resource: { db: DB, collection: "auditEvents" }, actions: ["find", "insert"] },
];

if (db.getRole("plantpayApp")) db.updateRole("plantpayApp", { privileges, roles: [] });
else db.createRole({ role: "plantpayApp", privileges, roles: [] });
print('role "plantpayApp" ready');

const pw = process.env.APP_PASSWORD;
if (pw) {
  if (db.getUser("plantpay_app")) db.updateUser("plantpay_app", { pwd: pw, roles: ["plantpayApp"] });
  else db.createUser({ user: "plantpay_app", pwd: pw, roles: ["plantpayApp"] });
  print('user "plantpay_app" ready');
}
