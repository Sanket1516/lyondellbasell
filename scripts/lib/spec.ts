// Fictional Plant X master data and the six demo invoices. Everything here is invented.
// Used by generate-seed.ts (data/seed/*.json) and generate-docs.ts (data/demo-docs/*).
import { PLANT } from "../../src/lib/constants";
import type { Contract, DeliveryNote, GoodsReceipt, PurchaseOrder, UomRule, Vendor, Verdict } from "../../src/lib/types";

export { PLANT };

export interface VendorInfo extends Vendor {
  address: string;
  stateCode: string; // "27" = same state as the plant, so CGST+SGST; otherwise IGST
}

export const VENDORS: VendorInfo[] = [
  { id: "V-1001", name: "Vihar Chem Supplies", gstin: "27FICTV1001A1Z0", active: true, stateCode: "27", address: "Gala 7, Rabale MIDC, Navi Mumbai 400701" },
  { id: "V-1002", name: "Konkan Packaging Works", gstin: "27FICTK1002B1Z0", active: true, stateCode: "27", address: "Survey 88, Mahad Industrial Area, Raigad 402309" },
  { id: "V-1003", name: "Sahyadri Industrial Gases", gstin: "27FICTS1003C1Z0", active: true, stateCode: "27", address: "B-12, Ranjangaon MIDC, Pune 412220" },
  { id: "V-1004", name: "Deccan Valve & Fittings", gstin: "29FICTD1004D1Z0", active: true, stateCode: "29", address: "No. 41, Peenya 2nd Stage, Bengaluru 560058" },
  { id: "V-1005", name: "Malabar Lab Instruments", gstin: "32FICTM1005E1Z0", active: true, stateCode: "32", address: "Kinfra Park, Kakkanchery, Malappuram 673634" },
  { id: "V-1006", name: "Girnar Logistics", gstin: "24FICTG1006F1Z0", active: true, stateCode: "24", address: "7 Transport Nagar, Vapi, Gujarat 396195" },
];
export const vendorById = (id: string) => VENDORS.find((v) => v.id === id)!;

export interface CatalogItem {
  code: string;
  description: string;
  uom: string;
  price: number; // price on POs raised before any amendment
  qty: number[]; // typical order quantities
}

export const CATALOG: Record<string, CatalogItem[]> = {
  "V-1001": [
    { code: "AX-40", description: "Process additive AX-40", uom: "kg", price: 398, qty: [500, 800, 1000] },
    { code: "C-12", description: "Catalyst carrier C-12", uom: "kg", price: 86, qty: [2000, 3000, 5000] },
    { code: "DR-200", description: "HDPE drum 200 L", uom: "nos", price: 1450, qty: [20, 30, 40] },
    { code: "SOL-55", description: "Solvent blend S-55", uom: "L", price: 142, qty: [1000, 1500, 2000] },
  ],
  "V-1002": [
    { code: "CTN-5P", description: "Corrugated carton 5-ply 40x30x25", uom: "nos", price: 62, qty: [500, 1000, 2000] },
    { code: "WRAP-500", description: "Stretch wrap film 500 mm", uom: "rolls", price: 480, qty: [40, 60, 100] },
    { code: "BAG-25", description: "PP woven bag 25 kg", uom: "nos", price: 18, qty: [5000, 8000, 10000] },
    { code: "PAL-WD", description: "Wooden pallet 1200x1000", uom: "nos", price: 640, qty: [50, 80, 120] },
  ],
  "V-1003": [
    { code: "N2-47", description: "Nitrogen, industrial grade, 47 L cylinder", uom: "nos", price: 520, qty: [100, 150, 200] },
    { code: "AR-47", description: "Argon, 47 L cylinder", uom: "nos", price: 1100, qty: [20, 30, 40] },
    { code: "CO2-22", description: "Carbon dioxide, 22 kg cylinder", uom: "nos", price: 960, qty: [20, 40, 60] },
  ],
  "V-1004": [
    { code: "BV-2SS", description: "Ball valve 2 in SS316", uom: "nos", price: 3850, qty: [12, 24, 30] },
    { code: "GSK-2P", description: "Gasket set PTFE 2 in", uom: "nos", price: 215, qty: [40, 60, 120] },
    { code: "FL-2", description: "Flange 2 in SS316 150#", uom: "nos", price: 1240, qty: [20, 30, 50] },
  ],
  "V-1005": [
    { code: "PH-PR", description: "pH probe, glass electrode", uom: "nos", price: 7250, qty: [4, 6, 8] },
    { code: "BUF-3", description: "Buffer solution set pH 4/7/10", uom: "sets", price: 640, qty: [10, 20, 30] },
    { code: "KF-500", description: "Karl Fischer reagent 500 mL", uom: "bottles", price: 3100, qty: [6, 10, 12] },
  ],
  "V-1006": [
    { code: "FRT-20", description: "Road freight Taloja to Nhava Sheva, 20 ft container", uom: "trips", price: 18500, qty: [6, 10, 12] },
    { code: "DET-1", description: "Container detention charge", uom: "days", price: 2500, qty: [2, 3, 4] },
  ],
};
export const catalogItem = (vendorId: string, code: string) => CATALOG[vendorId].find((i) => i.code === code)!;

/** Contract amendments: the price changed after POs for the old price were already raised. */
export const AMENDMENTS: Record<string, { itemCode: string; newPrice: number; effectiveFrom: string }> = {
  "V-1001": { itemCode: "AX-40", newPrice: 412, effectiveFrom: "2026-10-01" },
  "V-1002": { itemCode: "PAL-WD", newPrice: 680, effectiveFrom: "2026-09-20" },
  "V-1003": { itemCode: "AR-47", newPrice: 1160, effectiveFrom: "2026-10-10" },
  "V-1004": { itemCode: "FL-2", newPrice: 1310, effectiveFrom: "2026-10-05" },
};
export const CONTRACT_IDS: Record<string, string> = {
  "V-1001": "C-22", "V-1002": "C-23", "V-1003": "C-27", "V-1004": "C-31", "V-1005": "C-29", "V-1006": "C-33",
};
/** Girnar's contract rate sits below the PO rate; the off-contract demo bills a third price. */
export const GIRNAR_CONTRACT_FRT = 18200;

export function buildContracts(): Contract[] {
  return VENDORS.map((v) => {
    const am = AMENDMENTS[v.id];
    const items = CATALOG[v.id];
    const prices = items.map((i) => ({
      itemCode: i.code,
      uom: i.uom,
      unitPrice: am && am.itemCode === i.code ? am.newPrice : v.id === "V-1006" && i.code === "FRT-20" ? GIRNAR_CONTRACT_FRT : i.price,
    }));
    const history = am
      ? [{ itemCode: am.itemCode, unitPrice: catalogItem(v.id, am.itemCode).price, uom: catalogItem(v.id, am.itemCode).uom, effectiveFrom: "2026-04-01" }]
      : v.id === "V-1006"
        ? [{ itemCode: "FRT-20", unitPrice: 18500, uom: "trips", effectiveFrom: "2026-04-01" }]
        : [];
    return {
      id: CONTRACT_IDS[v.id],
      vendorId: v.id,
      effectiveFrom: am ? am.effectiveFrom : v.id === "V-1006" ? "2026-08-01" : "2026-07-01",
      prices,
      history,
    };
  });
}

export const UOM_RULES: UomRule[] = [
  { itemCode: "C-12", fromUom: "MT", toUom: "kg", factor: 1000 },
  { itemCode: "BAG-25", fromUom: "box", toUom: "nos", factor: 100 },
  { itemCode: "SOL-55", fromUom: "drum", toUom: "L", factor: 200 },
];

export const BUYERS = ["Anand Deshpande", "Meera Joshi"];
export const RECEIVERS = ["Sunil Patil (Stores)", "Kavita More (Stores)"];

// ---------------------------------------------------------------- demo invoices
export interface DemoLine {
  itemCode: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
}
export type TemplateId = "vihar" | "konkan" | "deccan" | "sahyadri" | "malabar" | "girnar";

export interface DemoInvoice {
  file: string; // file name inside data/demo-docs
  invoiceNo: string;
  invoiceDate: string;
  vendorId: string;
  poId: string;
  lines: DemoLine[];
  taxRatePct: number;
  expectedVerdict: Verdict;
  purpose: string;
  template: TemplateId;
}

const L = (vendorId: string, code: string, qty: number, over: Partial<DemoLine> = {}): DemoLine => {
  const it = catalogItem(vendorId, code);
  return { itemCode: code, description: it.description, qty, uom: it.uom, unitPrice: it.price, ...over };
};

export const DEMO_INVOICES: DemoInvoice[] = [
  {
    file: "INV-7781.pdf", invoiceNo: "INV-7781", invoiceDate: "2026-11-10", vendorId: "V-1001", poId: "4500001234", taxRatePct: 18,
    expectedVerdict: "flag", purpose: "Golden: 3 lines, 3 different findings", template: "vihar",
    lines: [
      L("V-1001", "AX-40", 1000, { unitPrice: 412 }),
      L("V-1001", "C-12", 5, { uom: "MT", unitPrice: 86000 }),
      L("V-1001", "DR-200", 40),
    ],
  },
  {
    file: "INV-7782.pdf", invoiceNo: "INV-7782", invoiceDate: "2026-11-09", vendorId: "V-1002", poId: "4500001236", taxRatePct: 18,
    expectedVerdict: "approve", purpose: "Clean match, total under Rs 1,00,000", template: "konkan",
    lines: [L("V-1002", "CTN-5P", 500), L("V-1002", "WRAP-500", 60)],
  },
  {
    file: "INV-6120R.pdf", invoiceNo: "INV-6120R", invoiceDate: "2026-11-09", vendorId: "V-1004", poId: "4500001240", taxRatePct: 18,
    expectedVerdict: "block", purpose: "Re-issue of paid INV-6120 with a changed number and date", template: "deccan",
    lines: [L("V-1004", "BV-2SS", 24), L("V-1004", "GSK-2P", 60)],
  },
  {
    file: "INV-7784.pdf", invoiceNo: "INV-7784", invoiceDate: "2026-11-09", vendorId: "V-1003", poId: "4500001242", taxRatePct: 18,
    expectedVerdict: "block", purpose: "No goods receipt yet", template: "sahyadri",
    lines: [L("V-1003", "N2-47", 150), L("V-1003", "CO2-22", 40)],
  },
  {
    file: "INV-7785.jpg", invoiceNo: "INV-7785", invoiceDate: "2026-11-09", vendorId: "V-1005", poId: "4500001244", taxRatePct: 12,
    expectedVerdict: "flag", purpose: "Scanned image; GST 12% billed against PO tax code 18%", template: "malabar",
    lines: [L("V-1005", "PH-PR", 6), L("V-1005", "BUF-3", 20)],
  },
  {
    file: "INV-7786.pdf", invoiceNo: "INV-7786", invoiceDate: "2026-11-08", vendorId: "V-1006", poId: "4500001246", taxRatePct: 18,
    expectedVerdict: "flag", purpose: "Price differs from both PO and contract", template: "girnar",
    lines: [L("V-1006", "FRT-20", 12, { unitPrice: 19400 }), L("V-1006", "DET-1", 4)],
  },
];

// ---------------------------------------------------------------- supporting records for the demo invoices
function po(id: string, vendorId: string, issuedOn: string, buyer: string, codes: [string, number][]): PurchaseOrder {
  return {
    id, vendorId, buyer, issuedOn, contractId: CONTRACT_IDS[vendorId],
    lines: codes.map(([code, qty], i) => {
      const it = catalogItem(vendorId, code);
      return { lineNo: i + 1, itemCode: code, description: it.description, qty, uom: it.uom, unitPrice: it.price, taxCode: "GST18", taxRatePct: 18 };
    }),
  };
}

export function buildDemoSupport() {
  const purchaseOrders: PurchaseOrder[] = [
    po("4500001234", "V-1001", "2026-09-18", BUYERS[0], [["AX-40", 1000], ["C-12", 5000], ["DR-200", 40]]),
    po("4500001236", "V-1002", "2026-10-28", BUYERS[1], [["CTN-5P", 500], ["WRAP-500", 60]]),
    po("4500001240", "V-1004", "2026-09-30", BUYERS[0], [["BV-2SS", 24], ["GSK-2P", 60]]),
    po("4500001242", "V-1003", "2026-10-30", BUYERS[1], [["N2-47", 150], ["CO2-22", 40]]),
    po("4500001244", "V-1005", "2026-10-26", BUYERS[0], [["PH-PR", 6], ["BUF-3", 20]]),
    po("4500001246", "V-1006", "2026-10-22", BUYERS[1], [["FRT-20", 12], ["DET-1", 4]]),
  ];
  const goodsReceipts: GoodsReceipt[] = [
    // Golden PO: line 1 arrives in two receipts (600 + 400 = 1000, cumulative), line 3 is under-posted (32 of 40).
    { id: "5000009001", poId: "4500001234", receivedOn: "2026-11-02", receivedBy: RECEIVERS[0], lines: [{ lineNo: 1, qtyReceived: 600, uom: "kg" }, { lineNo: 2, qtyReceived: 5000, uom: "kg" }, { lineNo: 3, qtyReceived: 32, uom: "nos" }] },
    { id: "5000009002", poId: "4500001234", receivedOn: "2026-11-03", receivedBy: RECEIVERS[0], lines: [{ lineNo: 1, qtyReceived: 400, uom: "kg" }] },
    { id: "5000009005", poId: "4500001236", receivedOn: "2026-11-05", receivedBy: RECEIVERS[1], lines: [{ lineNo: 1, qtyReceived: 500, uom: "nos" }, { lineNo: 2, qtyReceived: 60, uom: "rolls" }] },
    { id: "5000009008", poId: "4500001240", receivedOn: "2026-10-10", receivedBy: RECEIVERS[0], lines: [{ lineNo: 1, qtyReceived: 24, uom: "nos" }, { lineNo: 2, qtyReceived: 60, uom: "nos" }] },
    // 4500001242 (Sahyadri) deliberately has no goods receipt.
    { id: "5000009011", poId: "4500001244", receivedOn: "2026-11-04", receivedBy: RECEIVERS[1], lines: [{ lineNo: 1, qtyReceived: 6, uom: "nos" }, { lineNo: 2, qtyReceived: 20, uom: "sets" }] },
    { id: "5000009014", poId: "4500001246", receivedOn: "2026-11-03", receivedBy: RECEIVERS[0], lines: [{ lineNo: 1, qtyReceived: 12, uom: "trips" }, { lineNo: 2, qtyReceived: 4, uom: "days" }] },
  ];
  const deliveryNotes: DeliveryNote[] = [
    { id: "DN-5521", poId: "4500001234", vendorId: "V-1001", deliveredOn: "2026-11-02", lines: [{ itemCode: "AX-40", qty: 1000, uom: "kg" }, { itemCode: "C-12", qty: 5000, uom: "kg" }, { itemCode: "DR-200", qty: 40, uom: "nos" }] },
  ];
  return { purchaseOrders, goodsReceipts, deliveryNotes };
}
