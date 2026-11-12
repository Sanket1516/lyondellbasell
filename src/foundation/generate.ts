// Deterministic Stage 1 dataset: 30 fictional vendors, ~500 purchase orders, ~600 invoices, planted exceptions,
// and the fixed demo document set. Same output on every run (fixed PRNG seed, fixed "today").
// The six curated Plant X vendors, their POs and invoices come from data/seed/*.json (the app's own seed).
import fs from "node:fs";
import path from "node:path";
import { DEMO_TODAY, TOLERANCE } from "../lib/constants";
import type { Contract, DeliveryNote, GoodsReceipt, Invoice, InvoiceLine, PurchaseOrder, UomRule } from "../lib/types";
import { computeTotals, r2 } from "../../scripts/lib/money";
import { AMENDMENTS, BUYERS, DEMO_INVOICES, RECEIVERS, UOM_RULES, VENDORS, buildContracts, buildDemoSupport, catalogItem } from "../../scripts/lib/spec";
import { CATALOG } from "../../scripts/lib/spec";

export type AmountFormat = "rs_lakh" | "inr_western" | "plain" | "rs_dash";
export type DateFormat = "dmy_dash" | "d_mon_y" | "ymd_slash";
export type Layout = "classic" | "modern" | "compact" | "ledger" | "letterhead";

export interface Emp { id: string; name: string; title: string; role: "buyer" | "stores" | "ap_clerk" | "approver_l1" | "approver_l2"; limit: number }
export interface Bank { id: string; vendorId: string; bankName: string; accountNo: string; ifsc: string; status: "verified" | "pending_verification" | "closed"; validFrom: string; validTo?: string; verifiedOn?: string; verifiedBy?: string; note?: string }
export interface Planted { invoiceId: string; caseType: string; expectedStatus: "approve" | "flag" | "block"; expectedCheck?: string; stage: string; note?: string; plantpayStatus?: "approve" | "flag" | "block" }
export interface DemoDoc { file: string; invoiceId: string; layout: Layout | "existing"; amountFormat: AmountFormat | "existing"; dateFormat: DateFormat; purpose: string; expectedStatus: "approve" | "flag" | "block"; rendered: boolean; plantpayStatus?: "approve" | "flag" | "block" }

export interface Inspection { id: string; grId: string; poId: string; inspectedOn: string; inspector: string; lines: { poLineNo: number; qtyInspected: number; qtyAccepted: number; qtyRejected: number; uom: string; reason?: string }[] }
export interface GateEntry { id: string; poId: string; grId: string; vehicleNo: string; enteredOn: string }
export interface Weighbridge { id: string; gateEntryId: string; poId: string; weighedOn: string; grossKg: number; tareKg: number; netKg: number }
export interface Shipment { id: string; poId: string; dispatchedOn: string; deliveredOn?: string; status: "in_transit" | "delivered" }
export interface Payment { invoiceId: string; paidOn: string; amount: number; utr: string }
export interface Approval { invoiceId: string; approverId: string; level: "clerk" | "L1" | "L2"; approvedOn: string }
export interface Contact { vendorId: string; name: string; phone: string; email: string }

export interface Dataset {
  today: string;
  vendors: { id: string; name: string; gstin: string; stateCode: string; active: boolean; paymentTermsDays: number; onboardedOn: string }[];
  addresses: { vendorId: string; kind: "registered" | "dispatch"; line: string; city: string; pincode: string; validFrom?: string; validTo?: string }[];
  banks: Bank[];
  employees: Emp[];
  materials: { code: string; description: string; baseUom: string; standardPrice: number; hsn: string }[];
  materialUoms: UomRule[];
  contracts: { id: string; vendorId: string; validFrom: string; validTo: string }[];
  contractPrices: { contractId: string; materialCode: string; uom: string; unitPrice: number; effectiveFrom: string }[];
  amendments: { contractId: string; materialCode: string; oldPrice: number; newPrice: number; effectiveFrom: string; signedOn: string; note: string }[];
  purchaseOrders: PurchaseOrder[];
  poHistory: { poId: string; lineNo: number; field: string; oldValue: string; newValue: string; changedOn: string; changedBy: string; reason: string }[];
  goodsReceipts: GoodsReceipt[];
  deliveryNotes: DeliveryNote[];
  inventory: { materialCode: string; type: "GR" | "ISSUE" | "ADJUST" | "RETURN" | "REVERSAL"; qty: number; uom: string; date: string; refType: string; refId: string }[];
  invoices: Invoice[];
  remit: Record<string, { accountNo: string; ifsc: string }>;
  planted: Planted[];
  demoDocs: DemoDoc[];
  inspections: Inspection[];
  gateEntries: GateEntry[];
  weighbridge: Weighbridge[];
  shipments: Shipment[];
  payments: Payment[];
  approvals: Approval[];
  contacts: Contact[];
  /** Stage 5: GSTIN as printed on an invoice, only where it differs from the vendor master (a conflict). Others print the master value. */
  invoiceGstin?: Record<string, string>;
  /** Stage 5: which invoices carry a planted risk signal (or a deliberate look-alike that must NOT be flagged). */
  riskPlants?: RiskPlant[];
}
export interface RiskPlant { invoiceId: string; detector: "duplicate" | "splitting" | "vendor" | "graph"; kind: string; expectFlag: boolean; note: string }

// ---------------------------------------------------------------- deterministic helpers
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const day = (iso: string, delta: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

// ---------------------------------------------------------------- masters
const NEW_VENDORS: { name: string; city: string; state: string; pin: string; line: string }[] = [
  ["Ratnagiri Resins", "Ratnagiri", "27", "415639", "Lote Parshuram MIDC"],
  ["Pune Polymer Traders", "Pune", "27", "411019", "Bhosari MIDC, Plot 22"],
  ["Nashik Pallet Co", "Nashik", "27", "422010", "Ambad Industrial Estate"],
  ["Thane Lubricants", "Thane", "27", "400604", "Wagle Estate, Unit 9"],
  ["Bhiwandi Packaging Hub", "Bhiwandi", "27", "421302", "Godown 14, Kalher"],
  ["Vasai Chemicals", "Vasai", "27", "401208", "Sativli Road, Shed 6"],
  ["Nagpur Abrasives", "Nagpur", "27", "441108", "Hingna MIDC, Plot 31"],
  ["Aurangabad Fasteners", "Aurangabad", "27", "431136", "Waluj MIDC, Plot 77"],
  ["Kolhapur Castings", "Kolhapur", "27", "416234", "Shiroli MIDC, Plot 5"],
  ["Satara Rubber Products", "Satara", "27", "415004", "Additional MIDC, Plot 40"],
  ["Surat Dyestuffs", "Surat", "24", "394230", "Sachin GIDC, Plot 118"],
  ["Vadodara Pumps & Seals", "Vadodara", "24", "390010", "Makarpura GIDC, Shed 3"],
  ["Ahmedabad Filters", "Ahmedabad", "24", "382445", "Vatva GIDC, Plot 902"],
  ["Indore Gaskets", "Indore", "23", "452015", "Sanwer Road, Plot 12"],
  ["Chennai Bearings", "Chennai", "33", "600058", "Ambattur Industrial Estate"],
  ["Hosur Electricals", "Hosur", "33", "635126", "SIPCOT Phase 2, Plot 8"],
  ["Coimbatore Motors", "Coimbatore", "33", "641021", "Kuruchi Industrial Estate"],
  ["Hyderabad Safety Gear", "Hyderabad", "36", "500055", "Jeedimetla, Plot 63"],
  ["Goa Marine Logistics", "Vasco da Gama", "30", "403802", "Mormugao Port Road"],
  ["Mundra Freight Lines", "Mundra", "24", "370421", "Port Road, Yard 4"],
  ["Dahej Catalysts", "Bharuch", "24", "392130", "Dahej SEZ, Plot 207"],
  ["Dahej Catalysts Trading Co", "Bharuch", "24", "392130", "Dahej SEZ, Plot 207A"],
  ["Kochi Instruments", "Kochi", "32", "682030", "Kakkanad Infopark Road"],
  ["Daman Plastics Moulding", "Daman", "26", "396210", "Kachigam Industrial Area"],
].map(([name, city, state, pin, line]) => ({ name, city, state, pin, line }));

interface PoolItem { code: string; description: string; uom: string; price: number; hsn: string; qty: number[] }
const POOL: PoolItem[] = [
  { code: "PP-GR", description: "Polypropylene granules, injection grade", uom: "kg", price: 118, hsn: "3902", qty: [2000, 5000, 10000] },
  { code: "RES-PF", description: "Phenolic resin PF-20", uom: "kg", price: 142, hsn: "3909", qty: [1000, 2000, 4000] },
  { code: "PE-MB", description: "Masterbatch blue, 40% loading", uom: "kg", price: 265, hsn: "3206", qty: [500, 1000, 2000] },
  { code: "CAL-CO3", description: "Calcium carbonate filler, coated", uom: "kg", price: 24, hsn: "2836", qty: [5000, 10000, 20000] },
  { code: "ZN-ST", description: "Zinc stearate powder", uom: "kg", price: 188, hsn: "2915", qty: [500, 1000, 2000] },
  { code: "TIO2", description: "Titanium dioxide rutile", uom: "kg", price: 312, hsn: "3206", qty: [1000, 2000, 3000] },
  { code: "GRS-EP2", description: "EP-2 lithium grease", uom: "kg", price: 320, hsn: "2710", qty: [200, 400, 800] },
  { code: "LUB-68", description: "Lube oil ISO VG 68", uom: "L", price: 168, hsn: "2710", qty: [1000, 2000, 4000] },
  { code: "CLN-IPA", description: "Isopropyl alcohol, cleaning grade", uom: "L", price: 96, hsn: "2905", qty: [400, 800, 1600] },
  { code: "ANT-FRZ", description: "Coolant concentrate", uom: "L", price: 134, hsn: "3820", qty: [400, 800, 1200] },
  { code: "BRG-6205", description: "Deep groove bearing 6205", uom: "nos", price: 410, hsn: "8482", qty: [50, 100, 200] },
  { code: "BLT-V38", description: "V-belt B-38", uom: "nos", price: 295, hsn: "4010", qty: [40, 80, 120] },
  { code: "FLT-OIL", description: "Hydraulic oil filter element", uom: "nos", price: 740, hsn: "8421", qty: [20, 40, 60] },
  { code: "SEAL-MS", description: "Mechanical seal 35 mm", uom: "nos", price: 5600, hsn: "8484", qty: [6, 10, 16] },
  { code: "GLV-NIT", description: "Nitrile gloves, size L", uom: "pairs", price: 85, hsn: "4015", qty: [500, 1000, 2000] },
  { code: "HLM-SF", description: "Safety helmet, ISI", uom: "nos", price: 360, hsn: "6506", qty: [50, 100, 150] },
  { code: "FUS-10A", description: "HRC fuse 10 A", uom: "nos", price: 42, hsn: "8536", qty: [200, 400, 800] },
  { code: "CBL-4C", description: "Armoured cable 4 core 16 sq mm", uom: "m", price: 210, hsn: "8544", qty: [200, 500, 1000] },
  { code: "PMP-IMP", description: "Pump impeller SS304", uom: "nos", price: 8900, hsn: "8413", qty: [4, 6, 10] },
  { code: "ABR-DSC", description: "Abrasive cutting disc 4 in", uom: "nos", price: 76, hsn: "6805", qty: [200, 500, 1000] },
  { code: "BOLT-M16", description: "Hex bolt set M16 HT", uom: "sets", price: 520, hsn: "7318", qty: [20, 40, 80] },
  { code: "LBL-RL", description: "Thermal label roll 100x150", uom: "rolls", price: 310, hsn: "4821", qty: [40, 80, 120] },
  { code: "TAPE-48", description: "BOPP packing tape 48 mm", uom: "rolls", price: 58, hsn: "3919", qty: [200, 500, 1000] },
  { code: "STRP-PP", description: "PP strapping roll 12 mm", uom: "rolls", price: 640, hsn: "3920", qty: [20, 40, 60] },
];

const BANKS = ["First India Commerce Bank", "Deccan Union Bank", "Konkan Cooperative Bank", "Western Trust Bank", "Sahyadri Mercantile Bank"];

// ---------------------------------------------------------------- build
export function buildDataset(seedDir = path.join(process.cwd(), "data", "seed")): Dataset {
  const rand = mulberry32(20261113);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const TODAY = DEMO_TODAY;

  const readSeed = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(seedDir, `${f}.json`), "utf8"));
  const seedPos = readSeed<PurchaseOrder[]>("purchaseOrders");
  const seedGrs = readSeed<GoodsReceipt[]>("goodsReceipts");
  const seedDns = readSeed<DeliveryNote[]>("deliveryNotes");
  const seedInvoices = readSeed<Invoice[]>("invoices");
  const seedFindings = readSeed<{ invoiceId: string; kind: string; rootCause: string; verdict: "approve" | "flag" | "block" }[]>("findings");

  const ds: Dataset = {
    today: TODAY, vendors: [], addresses: [], banks: [], employees: [], materials: [], materialUoms: [...UOM_RULES], contracts: [], contractPrices: [], amendments: [],
    purchaseOrders: [...seedPos], poHistory: [], goodsReceipts: [...seedGrs], deliveryNotes: [...seedDns], inventory: [], invoices: [...seedInvoices],
    remit: {}, planted: [], demoDocs: [],
    inspections: [], gateEntries: [], weighbridge: [], shipments: [], payments: [], approvals: [], contacts: [],
  };
  const qualityRejects: Record<string, { lineNo: number; rejected: number }> = {};
  const weighFactor: Record<string, number> = {};

  // employees ----------------------------------------------------------
  const emp = (id: string, name: string, title: string, role: Emp["role"], limit = 0) => ds.employees.push({ id, name, title, role, limit });
  emp("E-01", BUYERS[0], "Senior Buyer", "buyer"); emp("E-02", BUYERS[1], "Buyer", "buyer");
  emp("E-03", "Rohit Bhagat", "Buyer, Utilities", "buyer"); emp("E-04", "Sneha Kamat", "Buyer, MRO", "buyer");
  emp("E-05", "Sunil Patil", "Stores Executive", "stores"); emp("E-06", "Kavita More", "Stores Executive", "stores");
  emp("E-07", "Ajay Chavan", "Stores Supervisor", "stores"); emp("E-08", "Pooja Rane", "Stores Executive", "stores");
  emp("E-09", "Priya Nair", "AP Clerk", "ap_clerk", 100000);
  emp("E-10", "Neha Kulkarni", "Finance Manager", "approver_l1", 1500000);
  emp("E-11", "Rajesh Menon", "Finance Controller", "approver_l2", 99999999);
  const empId = (name: string) => ds.employees.find((e) => e.name === name.replace(/ \(Stores\)$/, ""))!.id;
  const buyers = ds.employees.filter((e) => e.role === "buyer");
  const stores = ds.employees.filter((e) => e.role === "stores");

  // materials ----------------------------------------------------------
  const seenMat = new Set<string>();
  const addMat = (code: string, description: string, baseUom: string, standardPrice: number, hsn: string) => {
    if (!seenMat.has(code)) { seenMat.add(code); ds.materials.push({ code, description, baseUom, standardPrice, hsn }); }
  };
  const HSN: Record<string, string> = { "AX-40": "3824", "C-12": "3815", "DR-200": "3923", "SOL-55": "3814" };
  for (const items of Object.values(CATALOG)) for (const i of items) addMat(i.code, i.description, i.uom, i.price, HSN[i.code] ?? "9999");
  for (const p of POOL) {
    addMat(p.code, p.description, p.uom, p.price, p.hsn);
    if (p.uom === "kg") ds.materialUoms.push({ itemCode: p.code, fromUom: "MT", toUom: "kg", factor: 1000 });
    if (p.uom === "L") ds.materialUoms.push({ itemCode: p.code, fromUom: "drum", toUom: "L", factor: 200 });
  }

  // vendors, addresses, bank accounts ---------------------------------
  const bank = (vendorId: string, no: number): Bank => ({
    id: `B-${vendorId.slice(2)}-1`, vendorId, bankName: BANKS[no % BANKS.length],
    accountNo: String(50100000000000 + no * 7919117 + 40213).padStart(14, "0"), ifsc: `FICB0${String(100000 + no * 37).slice(0, 6)}`,
    status: "verified", validFrom: "2025-04-01", verifiedOn: "2025-04-05", verifiedBy: "E-09",
  });
  VENDORS.forEach((v, i) => {
    ds.vendors.push({ id: v.id, name: v.name, gstin: v.gstin, stateCode: v.stateCode, active: true, paymentTermsDays: 45, onboardedOn: "2025-04-01" });
    const m = /^(.*?),\s*(.*?)\s*(\d{6})$/.exec(v.address);
    ds.addresses.push({ vendorId: v.id, kind: "registered", line: m ? m[1] : v.address, city: m ? m[2] : "India", pincode: m ? m[3] : "400001" });
    ds.banks.push(bank(v.id, i + 1));
  });
  const initials = (n: string) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toUpperCase()).join("").slice(0, 3);
  NEW_VENDORS.forEach((nv, i) => {
    const id = `V-${1007 + i}`;
    const gstin = `${nv.state}FICT${nv.name[0].toUpperCase()}${1007 + i}${String.fromCharCode(65 + (i % 26))}1Z0`;
    ds.vendors.push({ id, name: nv.name, gstin, stateCode: nv.state, active: true, paymentTermsDays: pick([30, 45, 45, 60]), onboardedOn: day("2025-04-01", between(0, 200)) });
    ds.addresses.push({ vendorId: id, kind: "registered", line: nv.line, city: nv.city, pincode: nv.pin });
    if (i % 4 === 0) ds.addresses.push({ vendorId: id, kind: "dispatch", line: `Warehouse ${between(2, 40)}, ${nv.city} Logistics Park`, city: nv.city, pincode: nv.pin });
    ds.banks.push(bank(id, i + 7));
  });
  // Legitimate shared account: Dahej Catalysts and its trading arm (same address block, same group account).
  const dahej = ds.banks.find((b) => b.vendorId === "V-1027")!;
  const tradingArm = ds.banks.find((b) => b.vendorId === "V-1028")!; // Dahej Catalysts Trading Co is index 21 -> V-1028
  tradingArm.accountNo = dahej.accountNo; tradingArm.ifsc = dahej.ifsc; tradingArm.bankName = dahej.bankName;
  tradingArm.note = "Group account shared with Dahej Catalysts (same promoters). Confirmed legitimate at onboarding.";
  const vendorsNew = ds.vendors.slice(VENDORS.length);
  const vendorCatalog: Record<string, PoolItem[]> = {};
  vendorsNew.forEach((v, i) => {
    vendorCatalog[v.id] = [0, 1, 2].map((k) => {
      const p = POOL[(i * 3 + k) % POOL.length];
      return { ...p, price: Math.round(p.price * (0.97 + ((i * 7 + k * 3) % 9) / 100)) };
    });
  });
  const prefix = (v: { id: string; name: string }) => `${initials(v.name)}${v.id.slice(-2)}`;

  // contracts ----------------------------------------------------------
  for (const c of buildContracts() as Contract[]) {
    const amended = c.history?.[0];
    const start = amended?.effectiveFrom ?? c.effectiveFrom;
    ds.contracts.push({ id: c.id, vendorId: c.vendorId, validFrom: start, validTo: "2027-03-31" });
    for (const p of c.prices) {
      const hist = c.history?.find((h) => h.itemCode === p.itemCode);
      if (hist) ds.contractPrices.push({ contractId: c.id, materialCode: p.itemCode, uom: p.uom, unitPrice: hist.unitPrice, effectiveFrom: hist.effectiveFrom });
      ds.contractPrices.push({ contractId: c.id, materialCode: p.itemCode, uom: p.uom, unitPrice: p.unitPrice, effectiveFrom: hist ? c.effectiveFrom : start });
    }
    const am = AMENDMENTS[c.vendorId];
    if (am) ds.amendments.push({ contractId: c.id, materialCode: am.itemCode, oldPrice: catalogItem(c.vendorId, am.itemCode).price, newPrice: am.newPrice, effectiveFrom: am.effectiveFrom, signedOn: day(am.effectiveFrom, -14), note: "Annual price revision" });
  }
  const contractOf: Record<string, string> = Object.fromEntries(ds.contracts.map((c) => [c.vendorId, c.id]));
  const amendedOf: Record<string, { code: string; oldPrice: number; newPrice: number; from: string }> = {};
  vendorsNew.forEach((v, i) => {
    const cid = `C-${100 + i}`;
    contractOf[v.id] = cid;
    ds.contracts.push({ id: cid, vendorId: v.id, validFrom: "2026-01-01", validTo: "2027-03-31" });
    vendorCatalog[v.id].forEach((it, k) => {
      ds.contractPrices.push({ contractId: cid, materialCode: it.code, uom: it.uom, unitPrice: it.price, effectiveFrom: "2026-01-01" });
      if (i % 3 === 0 && k === 0) {
        const from = day("2026-07-20", i * 3), np = Math.round(it.price * 1.06);
        amendedOf[v.id] = { code: it.code, oldPrice: it.price, newPrice: np, from };
        ds.contractPrices.push({ contractId: cid, materialCode: it.code, uom: it.uom, unitPrice: np, effectiveFrom: from });
        ds.amendments.push({ contractId: cid, materialCode: it.code, oldPrice: it.price, newPrice: np, effectiveFrom: from, signedOn: day(from, -12), note: "Raw material index revision" });
      }
    });
  });
  for (const v of VENDORS) contractOf[v.id] ??= "";

  // ---- builders --------------------------------------------------------
  const seq: Record<string, number> = {};
  const nextNo = (v: { id: string; name: string }, date: string) => {
    seq[v.id] = (seq[v.id] ?? 100) + between(3, 37);
    const fy = date >= "2026-04-01" ? "26-27" : "25-26";
    return `${prefix(v)}/${fy}/${String(seq[v.id]).padStart(4, "0")}`;
  };
  let poSeq = 4600000000, grSeq = 5100000000, dnSeq = 0;
  const lineAmt = (q: number, p: number) => r2(q * p);

  interface BulkOpts {
    vendor: (typeof vendorsNew)[number]; recvOn: string; scn: "clean" | "price" | "qty" | "missing_gr" | "uom_ok" | "uom_bad" | "stale" | "quality" | "weighbridge" | "contract_price";
    itemIdx?: number[]; poId?: string; noDn?: boolean; invNo?: string; qty?: number;
  }
  /** Creates PO + GR (+ delivery note) + invoice for one scenario and returns the ids. */
  function makeCase(o: BulkOpts): { poId: string; invoice: Invoice } {
    const v = o.vendor;
    const cat = vendorCatalog[v.id];
    const am = amendedOf[v.id];
    let items = o.itemIdx ? o.itemIdx.map((k) => cat[k]) : [...cat].sort(() => rand() - 0.5).slice(0, between(1, 2));
    if (o.scn === "stale") items = [cat[0], ...(rand() < 0.5 ? [cat[1]] : [])];
    if (o.scn === "uom_ok") items = [cat.find((c) => c.uom === "kg" || c.uom === "L") ?? cat[0]];
    if (o.scn === "uom_bad") items = [cat[1]];
    if (o.scn === "weighbridge") items = [cat.find((c) => c.uom === "kg") ?? cat[0]];
    const recvOn = o.recvOn;
    const invDate = day(recvOn, -between(1, 2));
    let grDate = day(invDate, -between(1, 4));
    if (o.scn === "stale") { grDate = day(am.from, between(3, 10)); }
    const issued = o.scn === "stale" ? day(am.from, -between(8, 20)) : day(grDate, -between(5, 14));
    const poId = o.poId ?? String(++poSeq);
    const lines = items.map((it, i) => ({
      lineNo: i + 1, itemCode: it.code, description: it.description, qty: pick(it.qty), uom: it.uom,
      unitPrice: o.scn === "stale" && i === 0 ? am.oldPrice : o.scn === "contract_price" && i === 0 ? Math.round(it.price * 1.06) : it.price, taxCode: "GST18", taxRatePct: 18,
    }));
    if (o.qty) lines[0].qty = o.qty;
    const po: PurchaseOrder = { id: poId, vendorId: v.id, buyer: pick(buyers).name, issuedOn: issued, contractId: contractOf[v.id], lines };
    ds.purchaseOrders.push(po);

    const invLines: InvoiceLine[] = lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, taxRatePct: 18, amount: lineAmt(l.qty, l.unitPrice) }));
    const grQty = lines.map((l) => l.qty);
    let hasGr = o.scn !== "missing_gr";
    const first = invLines[0], pl = lines[0];
    switch (o.scn) {
      case "stale": first.unitPrice = am.newPrice; first.amount = lineAmt(first.qty, am.newPrice); break;
      case "price": { const billed = Math.round(pl.unitPrice * 1.07); first.unitPrice = billed; first.amount = lineAmt(first.qty, billed); break; }
      case "qty": grQty[0] = Math.max(1, Math.floor((pl.qty * 0.8) / 5) * 5); break;
      case "uom_ok": { first.qty = pl.qty / (pl.uom === "kg" ? 1000 : 200); first.uom = pl.uom === "kg" ? "MT" : "drum"; first.unitPrice = pl.unitPrice * (pl.uom === "kg" ? 1000 : 200); first.amount = lineAmt(first.qty, first.unitPrice); break; }
      case "uom_bad": { first.uom = "bundle"; break; }
      default: break;
    }
    const t = computeTotals(invLines, 18);
    const inv: Invoice = {
      id: o.invNo ?? nextNo(v, invDate), vendorId: v.id, poId, invoiceDate: invDate, receivedOn: recvOn, currency: "INR", lines: invLines,
      subtotal: t.subtotal, tax: t.tax, total: t.total, status: "received",
    };
    if (o.scn === "quality") qualityRejects[poId] = { lineNo: 1, rejected: Math.max(1, Math.round(grQty[0] * 0.15)) };
    if (o.scn === "weighbridge") weighFactor[poId] = 0.92;
    if (hasGr) {
      const gid = String(++grSeq);
      ds.goodsReceipts.push({ id: gid, poId, receivedOn: grDate, receivedBy: pick(stores).name, lines: lines.map((l, i) => ({ lineNo: l.lineNo, qtyReceived: grQty[i], uom: l.uom })) });
      if (!o.noDn && (o.scn === "qty" || rand() < 0.3)) {
        ds.deliveryNotes.push({ id: `DN-${5000 + ++dnSeq}`, poId, vendorId: v.id, deliveredOn: grDate, lines: lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty, uom: l.uom })) });
      }
    } else hasGr = false;
    // Plain bookkeeping status; the match result is the source of truth about the invoice.
    const clean = o.scn === "clean" || o.scn === "uom_ok";
    if (clean) {
      const age = diffDays(TODAY, recvOn);
      if (age > 25) { inv.status = "paid"; inv.resolvedOn = day(recvOn, between(10, 18)); } else if (age > 6) { inv.status = "approved"; inv.resolvedOn = day(recvOn, between(2, 5)); } else inv.status = "pending_approval";
    } else inv.status = o.scn === "missing_gr" ? "blocked" : "pending_owner";
    ds.invoices.push(inv);
    return { poId, invoice: inv };
  }

  const plant = (invoiceId: string, caseType: string, expectedStatus: Planted["expectedStatus"], expectedCheck?: string, stage = "stage1", note?: string, plantpayStatus?: Planted["plantpayStatus"]) =>
    ds.planted.push({ invoiceId, caseType, expectedStatus, expectedCheck, stage, note, plantpayStatus });

  // ---- bulk plan ---------------------------------------------------------
  type Scn = BulkOpts["scn"];
  const plan: Scn[] = [
    ...Array<Scn>(12).fill("price"), ...Array<Scn>(12).fill("qty"), ...Array<Scn>(10).fill("missing_gr"),
    ...Array<Scn>(8).fill("uom_ok"), ...Array<Scn>(3).fill("uom_bad"), ...Array<Scn>(10).fill("stale"), ...Array<Scn>(6).fill("quality"), ...Array<Scn>(6).fill("weighbridge"), ...Array<Scn>(400).fill("clean"),
  ];
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  const amendedVendors = vendorsNew.filter((v) => amendedOf[v.id]);
  const kgVendors = vendorsNew.filter((v) => vendorCatalog[v.id].some((c) => c.uom === "kg"));
  const convertibleVendors = vendorsNew.filter((v) => vendorCatalog[v.id].some((c) => c.uom === "kg" || c.uom === "L"));
  const cleanSingles: Invoice[] = [];
  plan.forEach((scn, n) => {
    const vendor = scn === "stale" ? amendedVendors[n % amendedVendors.length]
      : scn === "uom_ok" ? convertibleVendors[n % convertibleVendors.length] : scn === "weighbridge" ? kgVendors[n % kgVendors.length] : vendorsNew[(n * 5 + 3) % vendorsNew.length];
    let recvOn = day("2026-03-02", Math.floor(rand() * 250));      // 2 Mar .. 6 Nov
    if (scn === "stale") recvOn = day(amendedOf[vendor.id].from, between(14, 40));
    if (recvOn > "2026-11-10") recvOn = "2026-11-10";
    if (scn === "stale") recvOn = recvOn > "2026-11-10" ? "2026-11-10" : recvOn;
    if (scn === "missing_gr" && recvOn > "2026-11-05") recvOn = "2026-11-05";
    if (scn === "stale" && diffDays(recvOn, amendedOf[vendor.id].from) < 14) recvOn = day(amendedOf[vendor.id].from, 14);
    const r = makeCase({ vendor, recvOn, scn });
    const id = r.invoice.id;
    if (scn === "price") plant(id, "price_mismatch", "flag", "price");
    else if (scn === "qty") plant(id, "quantity_mismatch", "flag", "quantity");
    else if (scn === "missing_gr") plant(id, "missing_gr", "block", "quantity");
    else if (scn === "uom_ok") plant(id, "unit_mismatch", "approve", "unit_of_measure", "stage1", "Billed in MT/drum, PO in kg/L: passes after unit normalisation.");
    else if (scn === "uom_bad") plant(id, "unit_mismatch_unconvertible", "flag", "unit_of_measure");
    else if (scn === "stale") plant(id, "stale_po_price", "flag", "price", "stage1", "PO still at the pre-amendment price; the newer contract price was billed.");
    else if (scn === "quality") plant(id, "quality_reject", "approve", undefined, "stage1b", "Part of the received quantity was rejected at inspection but the full quantity is billed.", "flag");
    else if (scn === "weighbridge") plant(id, "weighbridge_mismatch", "approve", undefined, "stage1b", "Weighbridge net weight is about 8% below the GRN and the invoice quantity.", "flag");
    else if (r.invoice.lines.length >= 1) {
      cleanSingles.push(r.invoice);
    }
  });

  // Split deliveries: ~85 clean single-line POs delivered and billed in two halves (two receipts, two invoices, one PO).
  const splitSources = cleanSingles.filter((i) => i.lines.length === 1 && i.lines[0].qty % 2 === 0 && i.lines[0].qty >= 2 && i.receivedOn <= "2026-10-25" && i.status !== "pending_approval").slice(0, 85);
  const splitIds = new Set<string>();
  for (const inv1 of splitSources) {
    const gr = ds.goodsReceipts.find((g) => g.poId === inv1.poId)!;
    const half = inv1.lines[0].qty / 2, v = ds.vendors.find((x) => x.id === inv1.vendorId)!;
    const l1 = inv1.lines[0];
    l1.qty = half; l1.amount = r2(half * l1.unitPrice);
    const t1 = computeTotals(inv1.lines, 18); Object.assign(inv1, { subtotal: t1.subtotal, tax: t1.tax, total: t1.total });
    gr.lines[0].qtyReceived = half;
    const g2On = day(gr.receivedOn, between(5, 12));
    const recv2 = day(g2On, between(2, 3)) > "2026-11-10" ? "2026-11-10" : day(g2On, between(2, 3));
    ds.goodsReceipts.push({ id: String(++grSeq), poId: inv1.poId!, receivedOn: g2On > recv2 ? recv2 : g2On, receivedBy: pick(stores).name, lines: [{ lineNo: 1, qtyReceived: half, uom: l1.uom }] });
    const date2 = day(recv2, -1);
    const inv2: Invoice = { ...structuredClone(inv1), id: nextNo(v, date2), invoiceDate: date2, receivedOn: recv2, status: "received", resolvedOn: undefined };
    delete inv2.resolvedOn;
    const age = diffDays(TODAY, recv2);
    if (age > 25) { inv2.status = "paid"; inv2.resolvedOn = day(recv2, between(10, 18)); } else if (age > 6) { inv2.status = "approved"; inv2.resolvedOn = day(recv2, 3); } else inv2.status = "pending_approval";
    ds.invoices.push(inv2);
    splitIds.add(inv1.id);
  }

  // duplicates: re-keyed copies of earlier paid invoices (number differs by a suffix, date a few days later)
  const dupSources = cleanSingles.filter((i) => !splitIds.has(i.id) && i.status === "paid" && i.receivedOn <= "2026-10-20").slice(0, 8);
  dupSources.forEach((src, k) => {
    const date = day(src.invoiceDate, between(2, 7));
    const dup: Invoice = { ...structuredClone(src), id: `${src.id}${["R", "-A", "/R", "DUP", "-1", "R", "-B", "/A"][k]}`, invoiceDate: date, receivedOn: day(date, 1), status: "blocked", resolvedOn: undefined };
    delete dup.resolvedOn;
    ds.invoices.push(dup);
    plant(dup.id, "duplicate", "block", "duplicate", "stage1", `Re-submission of paid ${src.id}.`);
  });

  // PO change history on some bulk POs (qty revisions by the buyer; the PO already holds the new value)
  ds.purchaseOrders.filter((p) => p.id.startsWith("46")).filter((_, i) => i % 29 === 0).forEach((p) => {
    const l = p.lines[0];
    const old = l.qty - Math.max(1, Math.round(l.qty * 0.1));
    ds.poHistory.push({ poId: p.id, lineNo: 1, field: "qty", oldValue: String(old), newValue: String(l.qty), changedOn: day(p.issuedOn, between(1, 3)), changedBy: empId(p.buyer), reason: "Quantity revised after production planning update" });
  });

  // ---- demo set ----------------------------------------------------------
  // curated documents: records already in the seed; only the invoice rows are added here
  const support = buildDemoSupport();
  void support;
  for (const d of DEMO_INVOICES) {
    const lines: InvoiceLine[] = d.lines.map((l, i) => ({ lineNo: i + 1, itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.uom, unitPrice: l.unitPrice, taxRatePct: d.taxRatePct, amount: r2(l.qty * l.unitPrice) }));
    const t = computeTotals(lines, d.taxRatePct);
    ds.invoices.push({ id: d.invoiceNo, vendorId: d.vendorId, poId: d.poId, invoiceDate: d.invoiceDate, receivedOn: day(d.invoiceDate, 1), currency: "INR", lines, subtotal: t.subtotal, tax: t.tax, total: t.total, status: "received", sourceFile: `demo:${d.file}` });
    ds.demoDocs.push({ file: `demo-docs/${d.file}`, invoiceId: d.invoiceNo, layout: "existing", amountFormat: "existing", dateFormat: "dmy_dash", purpose: d.purpose, expectedStatus: d.expectedVerdict, rendered: false });
  }
  plant("INV-7781", "stale_po_price", "flag", "price", "stage1", "Golden invoice: stale price on AX-40, quantity short on DR-200, MT vs kg on C-12.");
  plant("INV-7782", "clean", "approve", undefined, "stage1");
  plant("INV-6120R", "duplicate", "block", "duplicate");
  plant("INV-7784", "missing_gr", "block", "quantity");
  plant("INV-7785", "tax_rate", "flag", "tax");
  plant("INV-7786", "price_mismatch", "flag", "price");

  // The app's seeded duplicate is dated 40 days after its original, outside the engine's tested 30-day window, so the
  // engine (correctly, by its own rule) would not flag it. In this dataset it is re-dated inside the window.
  for (const f of seedFindings.filter((x) => x.kind === "duplicate")) {
    const d = ds.invoices.find((i) => i.id === f.invoiceId)!;
    const orig = ds.invoices.find((i) => i.id !== d.id && i.vendorId === d.vendorId && i.poId === d.poId && i.total === d.total)!;
    if (diffDays(d.invoiceDate, orig.invoiceDate) > 25) { d.invoiceDate = day(orig.invoiceDate, 12); d.receivedOn = day(orig.invoiceDate, 13); }
  }

  // curated seed invoices: derive the planted label from the findings the curated generator wrote
  const kindMap: Record<string, [string, string]> = { quantity: ["quantity_mismatch", "quantity"], missing_receipt: ["missing_gr", "quantity"], duplicate: ["duplicate", "duplicate"], tax: ["tax_rate", "tax"], uom: ["unit_mismatch", "unit_of_measure"] };
  for (const inv of seedInvoices) {
    const fs_ = seedFindings.filter((f) => f.invoiceId === inv.id);
    if (!fs_.length) continue;
    const f = fs_[0];
    const [caseType, check] = f.kind === "price" ? (f.rootCause.startsWith("PO not updated") ? ["stale_po_price", "price"] : ["price_mismatch", "price"]) : kindMap[f.kind] ?? [f.kind, f.kind];
    plant(inv.id, caseType, f.verdict, check);
  }

  // new demo documents ---------------------------------------------------
  const demoBase = 4600009000;
  let demoPo = demoBase;
  const newDoc = (
    id: string, vendorId: string, layout: Layout, amountFormat: AmountFormat, dateFormat: DateFormat, purpose: string, expected: Planted["expectedStatus"],
    o: Pick<BulkOpts, "scn"> & { itemIdx?: number[]; recvOn?: string; qty?: number; pp?: Planted["plantpayStatus"] },
  ) => {
    const vendor = ds.vendors.find((v) => v.id === vendorId)!;
    const r = makeCase({ vendor, recvOn: o.recvOn ?? "2026-11-09", scn: o.scn, itemIdx: o.itemIdx, qty: o.qty, poId: String(++demoPo), invNo: id, noDn: false });
    r.invoice.status = "received"; delete r.invoice.resolvedOn; r.invoice.sourceFile = `demo:${id}.pdf`;
    ds.demoDocs.push({ file: `demo-set/${id.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`, invoiceId: id, layout, amountFormat, dateFormat, purpose, expectedStatus: expected, rendered: true, plantpayStatus: o.pp });
    return r.invoice;
  };
  const exp = (v: string) => ds.vendors.find((x) => x.id === v)!;
  const P = (v: string) => prefix(exp(v));

  const d1 = newDoc(`${P("V-1010")}/26-27/0901`, "V-1010", "classic", "rs_lakh", "dmy_dash", "Clean match, three lines, Indian digit grouping", "approve", { scn: "clean", itemIdx: [0, 1, 2] });
  newDoc(`${P("V-1009")}/26-27/0902`, "V-1009", "modern", "inr_western", "d_mon_y", "Clean match, single line, western digit grouping", "approve", { scn: "clean", itemIdx: [1] });
  const d3 = newDoc(`${P("V-1008")}/26-27/0903`, "V-1008", "compact", "rs_dash", "ymd_slash", "Unit mismatch: billed 5 MT against a PO of 5000 kg, passes after normalisation", "approve", { scn: "uom_ok", itemIdx: [0], qty: 5000 });
  const d4 = newDoc(`${P("V-1011")}/26-27/0904`, "V-1011", "ledger", "plain", "dmy_dash", "Price about 7% above PO and contract", "flag", { scn: "price", itemIdx: [1] });
  const d5 = newDoc(`${P("V-1012")}/26-27/0905`, "V-1012", "letterhead", "rs_lakh", "d_mon_y", "Quantity billed above goods receipt (delivery note shows full quantity)", "flag", { scn: "qty", itemIdx: [0] });
  const d7 = newDoc(`${P("V-1016")}/26-27/0906`, "V-1016", "modern", "rs_dash", "dmy_dash", "Stale PO price: contract amendment raised the price after the PO", "flag", { scn: "stale", recvOn: "2026-11-05" });
  plant(d1.id, "clean", "approve"); plant(d3.id, "unit_mismatch", "approve", "unit_of_measure", "stage1", "5 MT billed against 5000 kg on the PO");
  plant(d4.id, "price_mismatch", "flag", "price"); plant(d5.id, "quantity_mismatch", "flag", "quantity"); plant(d7.id, "stale_po_price", "flag", "price");
  plant(ds.demoDocs.find((x) => x.invoiceId.startsWith(P("V-1009")))!.invoiceId, "clean", "approve");

  const dq = newDoc(`${P("V-1014")}/26-27/0913`, "V-1014", "ledger", "rs_dash", "dmy_dash", "Quality: 15% of the received quantity was rejected at inspection but the full quantity is billed", "approve", { scn: "quality", itemIdx: [0], pp: "flag" });
  plant(dq.id, "quality_reject", "approve", undefined, "stage1b", "Inspection accepted less than the billed quantity.", "flag");
  const dw = newDoc(`${P("V-1007")}/26-27/0914`, "V-1007", "classic", "inr_western", "d_mon_y", "Logistics: weighbridge net weight is about 8% below the GRN and the invoice", "approve", { scn: "weighbridge", itemIdx: [0], pp: "flag" });
  plant(dw.id, "weighbridge_mismatch", "approve", undefined, "stage1b", "Weighbridge shows less than the GRN and the invoice.", "flag");

  // exact duplicate of an earlier paid invoice (re-keyed number, later date)
  {
    const vendor = exp("V-1013");
    const orig = makeCase({ vendor, recvOn: "2026-10-20", scn: "clean", poId: String(++demoPo) });
    orig.invoice.status = "paid"; orig.invoice.resolvedOn = "2026-11-02";
    const dupId = `${orig.invoice.id}-R`;
    const date = "2026-11-08";
    const dup: Invoice = { ...structuredClone(orig.invoice), id: dupId, invoiceDate: date, receivedOn: "2026-11-09", status: "received", sourceFile: `demo:${dupId}.pdf` };
    delete dup.resolvedOn;
    ds.invoices.push(dup);
    ds.demoDocs.push({ file: `demo-set/${dupId.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`, invoiceId: dupId, layout: "classic", amountFormat: "plain", dateFormat: "ymd_slash", purpose: `Re-submission of paid ${orig.invoice.id} with a changed number and date`, expectedStatus: "block", rendered: true });
    plant(dupId, "duplicate", "block", "duplicate", "stage1", `Re-submission of paid ${orig.invoice.id}.`);
  }

  // contract amendment, handled correctly: the buyer amended the PO to the new price, invoice matches
  {
    const vendor = exp("V-1019");
    const am = amendedOf[vendor.id];
    const id = `${P("V-1019")}/26-27/0907`;
    const r = makeCase({ vendor, recvOn: "2026-11-06", scn: "clean", poId: String(++demoPo), invNo: id, itemIdx: [0] });
    const po = ds.purchaseOrders.find((p) => p.id === r.poId)!;
    po.issuedOn = day(am.from, -6);
    po.lines[0].unitPrice = am.newPrice;
    const il = r.invoice.lines[0]; il.unitPrice = am.newPrice; il.amount = lineAmtOf(il.qty, am.newPrice);
    const t = computeTotals(r.invoice.lines, 18); Object.assign(r.invoice, { subtotal: t.subtotal, tax: t.tax, total: t.total, status: "received", sourceFile: `demo:${id}.pdf` });
    delete r.invoice.resolvedOn;
    ds.poHistory.push({ poId: po.id, lineNo: 1, field: "unit_price", oldValue: String(am.oldPrice), newValue: String(am.newPrice), changedOn: day(am.from, 1), changedBy: empId(po.buyer), reason: "PO amended to the revised contract price" });
    ds.demoDocs.push({ file: `demo-set/${id.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`, invoiceId: id, layout: "ledger", amountFormat: "inr_western", dateFormat: "d_mon_y", purpose: "Contract amendment handled: PO amended to the new contract price, invoice matches", expectedStatus: "approve", rendered: true });
    plant(id, "contract_amendment", "approve", undefined, "stage4", "Price changed by contract amendment; PO amended; should pass and be explained as an amendment.");
  }

  // threshold splitting: one PO of ~Rs 2.7 lakh billed as three invoices, same day, each just under Rs 1,00,000
  {
    const vendor = exp("V-1020");
    const it = vendorCatalog[vendor.id][2];
    const unitPrice = it.price;
    const qtyEach = Math.floor(97000 / 1.18 / unitPrice);
    const poId = String(++demoPo);
    const issued = "2026-10-20";
    ds.purchaseOrders.push({ id: poId, vendorId: vendor.id, buyer: buyers[0].name, issuedOn: issued, contractId: contractOf[vendor.id], lines: [{ lineNo: 1, itemCode: it.code, description: it.description, qty: qtyEach * 3 - 3, uom: it.uom, unitPrice, taxCode: "GST18", taxRatePct: 18 }] });
    ds.goodsReceipts.push({ id: String(++grSeq), poId, receivedOn: "2026-11-05", receivedBy: stores[0].name, lines: [{ lineNo: 1, qtyReceived: qtyEach * 3 - 3, uom: it.uom }] });
    ["A", "B", "C"].forEach((s, k) => {
      const id = `${P("V-1020")}/26-27/09${10 + k}`;
      const qk = qtyEach - k; // different quantities, so the three bills are not byte-identical duplicates
      const lines: InvoiceLine[] = [{ lineNo: 1, itemCode: it.code, description: it.description, qty: qk, uom: it.uom, unitPrice, taxRatePct: 18, amount: lineAmtOf(qk, unitPrice) }];
      const t = computeTotals(lines, 18);
      ds.invoices.push({ id, vendorId: vendor.id, poId, invoiceDate: "2026-11-09", receivedOn: "2026-11-10", currency: "INR", lines, subtotal: t.subtotal, tax: t.tax, total: t.total, status: "received", sourceFile: `demo:${id}.pdf` });
      ds.demoDocs.push({ file: `demo-set/${id.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`, invoiceId: id, layout: (["compact", "compact", "compact"] as Layout[])[k], amountFormat: "rs_lakh", dateFormat: "dmy_dash", purpose: `Threshold splitting, part ${k + 1} of 3: same PO, same day, each under Rs 1,00,000 (${s})`, expectedStatus: "approve", rendered: true });
      plant(id, "threshold_split", "approve", undefined, "stage3", `Part ${k + 1} of 3 invoices on PO ${poId}; combined total is above the Rs 1,00,000 clerk limit.`, "flag");
    });
  }

  // bank-detail change: the invoice asks for payment to an account that is new and not yet verified
  {
    const v = exp("V-1021");
    const id = `${P("V-1021")}/26-27/0908`;
    const inv = newDocRaw(id, v.id, "modern", "inr_western", "dmy_dash", "Bank-detail change: remittance account differs from the verified account on file", "approve");
    const oldAcc = ds.banks.find((b) => b.vendorId === v.id)!;
    oldAcc.status = "closed"; oldAcc.validTo = "2026-11-03"; oldAcc.note = "Closed at the supplier's request by e-mail (not independently verified).";
    const na: Bank = { id: `B-${v.id.slice(2)}-2`, vendorId: v.id, bankName: "Western Trust Bank", accountNo: "60410000771205", ifsc: "FICB0554321", status: "pending_verification", validFrom: "2026-11-03", note: "Change requested by e-mail on 2026-11-03; call-back verification not done." };
    ds.banks.push(na);
    ds.remit[inv.id] = { accountNo: na.accountNo, ifsc: na.ifsc };
    plant(id, "bank_change", "approve", undefined, "stage5", "Three-way match passes; the payment instruction changed and needs independent verification.", "flag");
  }

  // shared bank account: invoice remits to an account that also belongs to an unrelated vendor
  {
    const v = exp("V-1023");
    const id = `${P("V-1023")}/26-27/0909`;
    const inv = newDocRaw(id, v.id, "letterhead", "rs_dash", "d_mon_y", "Remittance account is also on file for an unrelated vendor", "approve");
    const other = ds.banks.find((b) => b.vendorId === "V-1015")!;
    ds.banks.push({ id: `B-${v.id.slice(2)}-2`, vendorId: v.id, bankName: other.bankName, accountNo: other.accountNo, ifsc: other.ifsc, status: "verified", validFrom: "2026-09-15", verifiedOn: "2026-09-16", verifiedBy: "E-09" });
    ds.remit[inv.id] = { accountNo: other.accountNo, ifsc: other.ifsc };
    plant(id, "shared_bank_account", "approve", undefined, "stage6", `Account is also held by ${exp("V-1015").name}. Shared accounts can be legitimate; review, do not accuse.`, "flag");
  }


  // ---- Stage 4: contract-aware and inventory-aware cases (all pass the three-way match; PlantPay flags them) ----
  const returnsToPlant: { poId: string; lineNo: number; frac: number; daysAfter: number }[] = [];
  const stage4 = {
    contractPrice: (docId: string | undefined, vendor: (typeof vendorsNew)[number], recvOn: string) => {
      // Invoice and PO both price the item 6% above the contract, so the three-way price check (invoice vs PO) passes.
      if (docId) return newDoc(docId, vendor.id, "modern", "rs_lakh", "d_mon_y", "Contract price: invoice and PO agree with each other but are about 6% above the contract price", "approve", { scn: "contract_price", itemIdx: [0], pp: "flag" });
      return makeCase({ vendor, recvOn, scn: "contract_price", itemIdx: [0] }).invoice;
    },
    contractExpired: (docId: string | undefined, vendor: (typeof vendorsNew)[number], recvOn: string, n: number) => {
      const inv = docId ? newDoc(docId, vendor.id, "classic", "inr_western", "dmy_dash", "Contract expired: goods were delivered after the contract's end date", "approve", { scn: "clean", itemIdx: [0], pp: "flag" }) : makeCase({ vendor, recvOn, scn: "clean", itemIdx: [0] }).invoice;
      const po = ds.purchaseOrders.find((p) => p.id === inv.poId)!;
      const cid = `C-9${String(n).padStart(2, "0")}`;
      const firstGr = ds.goodsReceipts.filter((g) => g.poId === inv.poId).map((g) => g.receivedOn).sort()[0];
      ds.contracts.push({ id: cid, vendorId: vendor.id, validFrom: "2025-11-01", validTo: day(firstGr, -4) });
      ds.contractPrices.push({ contractId: cid, materialCode: po.lines[0].itemCode, uom: po.lines[0].uom, unitPrice: po.lines[0].unitPrice, effectiveFrom: "2025-11-01" });
      po.contractId = cid;
      return inv;
    },
    returned: (docId: string | undefined, vendor: (typeof vendorsNew)[number], recvOn: string) => {
      const inv = docId ? newDoc(docId, vendor.id, "letterhead", "rs_dash", "ymd_slash", "Returned goods: 30% of the received quantity went back to the supplier, but the full quantity is billed", "approve", { scn: "clean", itemIdx: [0], pp: "flag" }) : makeCase({ vendor, recvOn, scn: "clean", itemIdx: [0] }).invoice;
      returnsToPlant.push({ poId: inv.poId!, lineNo: 1, frac: 0.3, daysAfter: 2 });
      return inv;
    },
    overAllocated: (docId: string | undefined, vendor: (typeof vendorsNew)[number], firstRecv: string) => {
      // An earlier invoice already bills the whole receipt; a second invoice (different quantity, so not a copy) bills more of it.
      const first = makeCase({ vendor, recvOn: firstRecv, scn: "clean", itemIdx: [0], poId: String(++demoPo) });
      first.invoice.status = "paid"; first.invoice.resolvedOn = day(firstRecv, 8);
      const src = first.invoice;
      const line = { ...src.lines[0] };
      line.qty = Math.max(1, Math.round(line.qty * 0.4)); line.amount = lineAmtOf(line.qty, line.unitPrice);
      const t = computeTotals([line], 18);
      const id = docId ?? `${prefix(vendor)}/26-27/${String(7000 + ds.invoices.length)}`;
      const invDate = docId ? "2026-11-09" : day(firstRecv, 12);
      const inv: Invoice = { id, vendorId: vendor.id, poId: src.poId, invoiceDate: invDate, receivedOn: day(invDate, 1), currency: "INR", lines: [line], subtotal: t.subtotal, tax: t.tax, total: t.total, status: "received", ...(docId ? { sourceFile: `demo:${id}.pdf` } : {}) };
      if (!docId) inv.status = "pending_owner";
      ds.invoices.push(inv);
      if (docId) ds.demoDocs.push({ file: `demo-set/${id.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`, invoiceId: id, layout: "compact", amountFormat: "plain", dateFormat: "dmy_dash", purpose: `Over-allocated quantity: an earlier invoice (${src.id}) already bills the whole receipt, this one bills ${line.qty} more`, expectedStatus: "approve", rendered: true, plantpayStatus: "flag" });
      return inv;
    },
  };
  {
    const free = vendorsNew.filter((v) => !amendedOf[v.id]);
    const dv = (id: string) => ds.vendors.find((v) => v.id === id)!;
    const c1 = stage4.contractPrice(`${P("V-1017")}/26-27/0915`, dv("V-1017"), "2026-11-09");
    plant(c1.id, "contract_price_above", "approve", undefined, "stage4", "Invoice and PO match, but both are above the contract price; only a contract check sees it.", "flag");
    const c2 = stage4.contractExpired(`${P("V-1026")}/26-27/0916`, dv("V-1026"), "2026-11-09", 0);
    plant(c2.id, "contract_expired", "approve", undefined, "stage4", "The contract ended a few days before the goods arrived.", "flag");
    const c3 = stage4.overAllocated(`${P("V-1018")}/26-27/0917`, dv("V-1018"), "2026-10-28");
    plant(c3.id, "over_allocated_quantity", "approve", undefined, "stage4", "An earlier invoice already claims the whole goods receipt.", "flag");
    const c4 = stage4.returned(`${P("V-1024")}/26-27/0918`, dv("V-1024"), "2026-11-09");
    plant(c4.id, "returned_goods", "approve", undefined, "stage4", "30% of the receipt was returned to the supplier (stock ledger RETURN), the invoice bills all of it.", "flag");
    for (let k = 0; k < 4; k++) {
      const v = (n: number) => free[(k * 3 + n) % free.length];
      const d = (n: number) => day("2026-08-24", k * 11 + n);
      plant(stage4.contractPrice(undefined, v(0), d(0)).id, "contract_price_above", "approve", undefined, "stage4", "Invoice and PO are above the contract price.", "flag");
      plant(stage4.contractExpired(undefined, v(1), d(3), 1 + k).id, "contract_expired", "approve", undefined, "stage4", "Delivered after the contract's end date.", "flag");
      plant(stage4.overAllocated(undefined, v(2), d(5)).id, "over_allocated_quantity", "approve", undefined, "stage4", "An earlier invoice already claims the whole goods receipt.", "flag");
      plant(stage4.returned(undefined, v(2), d(8)).id, "returned_goods", "approve", undefined, "stage4", "Part of the receipt was returned; the invoice bills all of it.", "flag");
    }
  }

  // helper used by the two blocks above (hoisted function declarations)
  function lineAmtOf(q: number, p: number) { return r2(q * p); }
  function newDocRaw(id: string, vendorId: string, layout: Layout, amountFormat: AmountFormat, dateFormat: DateFormat, purpose: string, expected: Planted["expectedStatus"]): Invoice {
    return newDoc(id, vendorId, layout, amountFormat, dateFormat, purpose, expected, { scn: "clean", itemIdx: [0, 2] });
  }

  // remittance accounts on every normal invoice = the vendor's verified account at the time
  for (const inv of ds.invoices) {
    if (ds.remit[inv.id]) continue;
    const b = ds.banks.find((x) => x.vendorId === inv.vendorId && x.status !== "pending_verification" && x.validFrom <= inv.invoiceDate && (!x.validTo || x.validTo >= inv.invoiceDate)) ?? ds.banks.find((x) => x.vendorId === inv.vendorId)!;
    ds.remit[inv.id] = { accountNo: b.accountNo, ifsc: b.ifsc };
  }

  // ---- operational records: inspections, gate entries, weighbridge, shipments, payments, approvals, contacts ----
  {
    const r2o = mulberry32(7771);
    const pk = <T,>(a: T[]) => a[Math.floor(r2o() * a.length)];
    const inspectors = ["Mahesh Gaikwad (QC)", "Deepa Sawant (QC)", "Imran Shaikh (QC)"];
    const reasons = ["Moisture above specification", "Damaged packaging", "Out of dimensional tolerance"];
    const poById = new Map(ds.purchaseOrders.map((p) => [p.id, p]));
    const hasGr = new Set(ds.goodsReceipts.map((g) => g.poId));
    let ge = 0, wb = 0, sh = 0;
    for (const g of ds.goodsReceipts) {
      const po = poById.get(g.poId)!;
      const rej = qualityRejects[g.poId];
      const first = ds.goodsReceipts.find((x) => x.poId === g.poId)!.id === g.id;
      const insDay = day(g.receivedOn, r2o() < 0.5 ? 0 : 1);
      ds.inspections.push({
        id: `QI-${g.id}`, grId: g.id, poId: g.poId, inspectedOn: insDay > TODAY ? g.receivedOn : insDay, inspector: pk(inspectors),
        lines: g.lines.map((l) => {
          const rejected = rej && first && rej.lineNo === l.lineNo ? rej.rejected : 0;
          return { poLineNo: l.lineNo, qtyInspected: l.qtyReceived, qtyAccepted: l.qtyReceived - rejected, qtyRejected: rejected, uom: l.uom, ...(rejected ? { reason: pk(reasons) } : {}) };
        }),
      });
      const gid = `GE-${String(++ge).padStart(5, "0")}`;
      const veh = `MH${String(43 + (ge % 5)).padStart(2, "0")}${String.fromCharCode(65 + (ge % 26))}${String.fromCharCode(65 + ((ge * 7) % 26))}${String(1000 + ((ge * 37) % 9000))}`;
      ds.gateEntries.push({ id: gid, poId: g.poId, grId: g.id, vehicleNo: veh, enteredOn: g.receivedOn });
      if (!ds.shipments.some((x) => x.poId === g.poId)) ds.shipments.push({ id: `SHP-${String(++sh).padStart(5, "0")}`, poId: g.poId, dispatchedOn: day(g.receivedOn, -((ge % 3) + 1)), deliveredOn: g.receivedOn, status: "delivered" });
      if (po.lines.every((l) => l.uom === "kg")) {
        const totalKg = g.lines.reduce((a, l) => a + l.qtyReceived, 0);
        const factor = weighFactor[g.poId] ?? 1 + (r2o() - 0.5) * 0.008;
        const net = Math.round(totalKg * factor), tare = 6000 + Math.round(r2o() * 3000);
        ds.weighbridge.push({ id: `WB-${String(++wb).padStart(5, "0")}`, gateEntryId: gid, poId: g.poId, weighedOn: g.receivedOn, grossKg: net + tare, tareKg: tare, netKg: net });
      }
    }
    for (const p of ds.purchaseOrders) if (!hasGr.has(p.id) && !ds.shipments.some((x) => x.poId === p.id)) ds.shipments.push({ id: `SHP-${String(++sh).padStart(5, "0")}`, poId: p.id, dispatchedOn: day(TODAY, -2), status: "in_transit" });
    for (const i of ds.invoices) {
      if (i.status === "paid") ds.payments.push({ invoiceId: i.id, paidOn: i.resolvedOn ?? day(i.receivedOn, 14), amount: i.total, utr: `UTR26${String(1000000 + ds.payments.length * 7919).slice(0, 7)}` });
      if (i.status === "paid" || i.status === "approved") {
        const level = i.total <= 100000 ? "clerk" : i.total <= 1500000 ? "L1" : "L2";
        ds.approvals.push({ invoiceId: i.id, approverId: level === "clerk" ? "E-09" : level === "L1" ? "E-10" : "E-11", level, approvedOn: i.resolvedOn ?? day(i.receivedOn, 3) });
      }
    }
    for (const v of ds.vendors) {
      const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      ds.contacts.push({ vendorId: v.id, name: pk(["R. Iyer", "S. Pawar", "M. Qureshi", "A. Deshmukh", "K. Nambiar"]), phone: `+91 22 ${String(40000000 + Number(v.id.slice(2)) * 1237).slice(0, 8)}`, email: `accounts@${slug}.example` });
    }
  }

  // inventory transactions from receipts: receipt in, then partial issues to production
  for (const g of ds.goodsReceipts) {
    const po = ds.purchaseOrders.find((p) => p.id === g.poId)!;
    for (const l of g.lines) {
      const pl = po.lines.find((x) => x.lineNo === l.lineNo)!;
      ds.inventory.push({ materialCode: pl.itemCode, type: "GR", qty: l.qtyReceived, uom: l.uom, date: g.receivedOn, refType: "GR", refId: g.id });
      const issueDate = day(g.receivedOn, between(3, 20));
      if (issueDate <= TODAY && (Number(g.id.slice(-3)) + l.lineNo) % 3 !== 0) ds.inventory.push({ materialCode: pl.itemCode, type: "ISSUE", qty: -Math.round(l.qtyReceived * (0.3 + ((Number(g.id.slice(-2)) % 5) / 10))), uom: l.uom, date: issueDate, refType: "PROD", refId: `WO-${g.id.slice(-5)}` });
    }
  }
  // Stage 4: goods returned to the supplier after receipt (negative stock movement tied to the goods receipt)
  for (const r of returnsToPlant) {
    const g = ds.goodsReceipts.find((x) => x.poId === r.poId);
    if (!g) continue;
    const po = ds.purchaseOrders.find((p) => p.id === r.poId)!;
    const l = g.lines.find((x) => x.lineNo === r.lineNo)!;
    const pl = po.lines.find((x) => x.lineNo === r.lineNo)!;
    ds.inventory.push({ materialCode: pl.itemCode, type: "RETURN", qty: -Math.max(1, Math.round(l.qtyReceived * r.frac)), uom: l.uom, date: day(g.receivedOn, r.daysAfter), refType: "RETURN", refId: g.id });
  }
  // ---- Stage 5: risk-signal plants (vendor-master facts) and deliberate look-alikes that must NOT be flagged ----
  {
    const plantedIds = new Set(ds.planted.map((x) => x.invoiceId));
    const poCount = new Map<string, number>(); for (const i of ds.invoices) if (i.poId) poCount.set(i.poId, (poCount.get(i.poId) ?? 0) + 1);
    const eligible = (vendorId: string) => ds.invoices.filter((i) => i.vendorId === vendorId && !plantedIds.has(i.id) && i.total < 80000 && i.invoiceDate >= "2026-06-01" && i.invoiceDate <= "2026-10-31" && (!i.poId || poCount.get(i.poId) === 1)).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
    const plants: RiskPlant[] = [];
    const rp = (invoiceId: string, detector: RiskPlant["detector"], kind: string, expectFlag: boolean, note: string) => plants.push({ invoiceId, detector, kind, expectFlag, note });
    // (a) registered address changed the day before the vendor LATEST invoice (flag; no later invoice of that vendor is affected)
    const latest = (v: string) => ds.invoices.filter((i) => i.vendorId === v).sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate))[0];
    const av = ["V-1022", "V-1006", "V-1013", "V-1029", "V-1014"].find((v) => { const l = latest(v); return l && !plantedIds.has(l.id) && l.total < 80000 && l.invoiceDate >= "2026-07-01"; });
    const a = av ? latest(av) : undefined;
    if (a && av) {
      const old = ds.addresses.find((x) => x.vendorId === av && x.kind === "registered")!;
      old.validTo = day(a.invoiceDate, -2);
      ds.addresses.push({ vendorId: av, kind: "registered", line: "Plot 41, SIPCOT Industrial Complex", city: old.city === "Hosur" ? "Krishnagiri" : "Satellite Township", pincode: "635109", validFrom: day(a.invoiceDate, -1) });
      rp(a.id, "vendor", "address_change", true, "Registered address changed the day before the invoice date.");
    }
    // (b) GSTIN printed on the invoice differs from the master (flag)
    const bv = ["V-1029", "V-1016", "V-1024", "V-1018", "V-1014"].find((v) => eligible(v).length > 0);
    const b = bv ? eligible(bv)[0] : undefined;
    if (b) {
      const g = ds.vendors.find((v) => v.id === b.vendorId)!.gstin;
      ds.invoiceGstin = { ...(ds.invoiceGstin ?? {}), [b.id]: g.slice(0, 6) + (g[6] === "7" ? "3" : "7") + g.slice(7) };
      rp(b.id, "vendor", "tax_id_conflict", true, "The GSTIN printed on the invoice does not match the supplier master.");
    }
    // (c) bank account changed recently BUT verified by call-back before the invoice (look-alike: not flagged)
    for (const v of ["V-1012", "V-1010", "V-1009", "V-1011", "V-1008", "V-1016", "V-1017", "V-1018", "V-1019", "V-1024"]) {
      if (v === b?.vendorId) continue;
      const c = eligible(v).pop();
      if (!c) continue;
      const older = ds.banks.find((x) => x.vendorId === v && x.status === "verified" && !x.validTo)!;
      older.status = "closed"; older.validTo = day(c.invoiceDate, -21);
      const nb: Bank = { id: `B-${v.slice(2)}-2`, vendorId: v, bankName: "Western Trust Bank", accountNo: `6041${String(Number(v.slice(2)) * 7919).padStart(10, "0")}`, ifsc: "FICB0554321", status: "verified", validFrom: day(c.invoiceDate, -20), verifiedOn: day(c.invoiceDate, -18), verifiedBy: "E-09", note: "Change verified by call-back to the contact on file before first use." };
      ds.banks.push(nb);
      for (const o of ds.invoices) if (o.vendorId === v && o.invoiceDate >= nb.validFrom) ds.remit[o.id] = { accountNo: nb.accountNo, ifsc: nb.ifsc };
      rp(c.id, "vendor", "verified_bank_change", false, "Recent bank change, but verified independently by call-back before the invoice: noted, not flagged.");
      break;
    }
    // (d) address changed long ago (look-alike: not flagged)
    const dv = ["V-1013", "V-1011", "V-1010"].find((v) => v !== av && !ds.addresses.some((x) => x.vendorId === v && x.validFrom));
    const d = dv ? eligible(dv)[0] ?? ds.invoices.find((i) => i.vendorId === dv && !plantedIds.has(i.id)) : undefined;
    if (d) {
      const old = ds.addresses.find((x) => x.vendorId === dv && x.kind === "registered")!;
      old.validTo = "2025-06-30";
      ds.addresses.push({ vendorId: dv!, kind: "registered", line: "Hingna MIDC, Plot 17", city: old.city, pincode: old.pincode, validFrom: "2025-07-01" });
      rp(d.id, "vendor", "old_address_change", false, "Address changed more than a year ago: not flagged.");
    }
    // (e) legitimate group account (Dahej) and a long-standing shared account holder (look-alikes)
    const dh = ds.invoices.find((i) => i.vendorId === "V-1028" && !plantedIds.has(i.id));
    if (dh) rp(dh.id, "graph", "legitimate_shared_account", false, "Account shared with its group company; confirmed legitimate at onboarding.");
    // planted cases from earlier stages that Stage 5 must recognise
    for (const p of ds.planted) {
      if (p.caseType === "duplicate") rp(p.invoiceId, "duplicate", "duplicate", true, "Re-issued or repeated bill.");
      if (p.caseType === "threshold_split") rp(p.invoiceId, "splitting", "threshold_split", true, "One of three invoices on one PO, same day, each just under the clerk limit.");
      if (p.caseType === "bank_change") rp(p.invoiceId, "vendor", "bank_change", true, "Payment account is new and not verified.");
      if (p.caseType === "shared_bank_account") { rp(p.invoiceId, "vendor", "shared_bank_account", true, "Account also on file for an unrelated vendor."); rp(p.invoiceId, "graph", "shared_bank_account", true, "Linked to another vendor through a shared bank account."); }
    }
    ds.riskPlants = plants;
  }
  for (const d of ds.demoDocs) d.plantpayStatus ??= ds.planted.find((p) => p.invoiceId === d.invoiceId)?.plantpayStatus;
  void TOLERANCE;
  return ds;
}
