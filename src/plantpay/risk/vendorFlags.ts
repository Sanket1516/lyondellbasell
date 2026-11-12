// Detector 3: vendor master red flags.
// These are suspicious ATTRIBUTES of the supplier record behind one invoice: a recent bank-account change, an account that
// another vendor also holds, a recent address change, a tax ID that does not match. Patterns across many records (clusters,
// shared addresses, approver relationships) belong to the relationship graph (graph.ts), not here.
// Every result is a warning for a person to check. Shared accounts and address moves can be perfectly legitimate.
import type { CanonicalBundle } from "../canonical";
import type { RiskConfig } from "./config";
import { makeSignal, type DetectorOutcome, type RiskSignal, type SupportingRecord } from "./types";

const dayGap = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86400000;
const CALL_BACK = "Call a contact already on file, using a telephone number you already hold (not the number or e-mail on the invoice or the change request), and record the verification.";

export function detectVendorFlags(b: CanonicalBundle, cfg: RiskConfig): DetectorOutcome {
  const title = "Vendor master red flags";
  const signals: RiskSignal[] = [];
  const v = b.vendor;
  if (!v) return { detector: "vendor", title, flag: false, score: 0, signals, summary: "The supplier master record is not available, so vendor attributes were not checked." };
  const inv = b.invoice;
  const bankRecs = (): SupportingRecord[] => v.bankAccounts.map((a) => ({ source: "Supplier master", ref: `bank account ${a.accountNo}`, text: `${a.bankName}, ${a.status}${a.validTo ? `, closed ${a.validTo}` : `, from ${a.validFrom}`}${a.verifiedOn ? `, verified ${a.verifiedOn}` : ""}${a.note ? `. ${a.note}` : ""}` }));

  // ---- 1. Bank-detail change ------------------------------------------------
  if (b.remit) {
    const matching = v.bankAccounts.find((a) => a.accountNo === b.remit!.accountNo);
    const unverified = matching?.status === "pending_verification";
    const closedBefore = matching?.status === "closed" && !!matching.validTo && matching.validTo < inv.invoiceDate;
    const recent = !!matching && matching.validFrom <= inv.invoiceDate && dayGap(inv.invoiceDate, matching.validFrom) <= cfg.changeLookbackDays;
    const replacedAnother = !!matching && v.bankAccounts.some((a) => a.id !== matching.id && a.validFrom < matching.validFrom);
    const verifiedByCallBack = !!matching && matching.status === "verified" && !!matching.verifiedOn;
    const reasons: string[] = [];
    if (!matching) reasons.push(`The invoice names account ${b.remit.accountNo}, which is not on the supplier master.`);
    else if (unverified) reasons.push(`The account on the invoice (${matching.accountNo}) is new and still pending verification (valid from ${matching.validFrom}).`);
    else if (closedBefore) reasons.push(`The invoice names account ${matching.accountNo}, which was closed on ${matching.validTo}, before the invoice date.`);
    else if (recent && replacedAnother && !verifiedByCallBack) reasons.push(`The account on the invoice replaced an earlier one ${Math.round(dayGap(inv.invoiceDate, matching.validFrom))} days before the invoice date and has no recorded verification.`);
    if (reasons.length) {
      signals.push(makeSignal({
        detector: "vendor", kind: "bank_change", flag: true, severity: "review", score: !matching ? 85 : unverified ? 90 : closedBefore ? 75 : 70, department: "Supplier master data", requiresIndependentVerification: true,
        reasons: [...reasons, "Changes to payment details are a common route for payment redirection, so they are always verified independently before payment."],
        supportingRecords: [{ source: "Finance", ref: `invoice ${inv.id}`, text: `Remittance account ${b.remit.accountNo} (${b.remit.ifsc})` }, ...bankRecs()],
        recommendedAction: `Do not pay until the change is verified. ${CALL_BACK}`,
      }));
    } else if (recent && replacedAnother && verifiedByCallBack) {
      signals.push(makeSignal({
        detector: "vendor", kind: "bank_change_verified", flag: false, severity: "info", score: 10, department: "Supplier master data",
        reasons: [`The supplier changed bank account ${Math.round(dayGap(inv.invoiceDate, matching!.validFrom))} days before this invoice, and the change was verified on ${matching!.verifiedOn}. Noted, not flagged.`],
        supportingRecords: bankRecs(), recommendedAction: "No action needed; the verification is on file.",
      }));
    }
  }

  // ---- 2. Account also held by another vendor (an attribute of this supplier's bank details) ------------
  if (b.remit && b.accountHolders.length > 0) {
    const own = v.bankAccounts.find((a) => a.accountNo === b.remit!.accountNo);
    const confirmed = [own?.note, ...b.accountHolders.map((h) => h.note)].some((n) => !!n && /confirmed legitimate/i.test(n));
    const recent = !!own && own.validFrom <= inv.invoiceDate && dayGap(inv.invoiceDate, own.validFrom) <= cfg.changeLookbackDays;
    const others = b.accountHolders.map((h) => `${h.name} (${h.vendorId})`).join(", ");
    const recs: SupportingRecord[] = [{ source: "Supplier master", ref: `bank account ${b.remit.accountNo}`, text: `Held by ${v.name} (${v.id}) and ${others}` }, ...(own?.note ? [{ source: "Supplier master", ref: "account note", text: own.note }] : [])];
    if (confirmed) {
      signals.push(makeSignal({ detector: "vendor", kind: "shared_bank_account", flag: false, severity: "info", score: 5, department: "Supplier master data", reasons: [`The remittance account is also held by ${others}. This was confirmed as a legitimate group arrangement when the supplier was onboarded.`], supportingRecords: recs, recommendedAction: "No action needed." }));
    } else {
      signals.push(makeSignal({
        detector: "vendor", kind: "shared_bank_account", flag: true, severity: recent ? "review" : "info", score: recent ? 70 : 35, department: "Supplier master data",
        reasons: [
          `The remittance account is also held by ${others}.`,
          recent ? "The account was added to this supplier recently." : "The account has been on this supplier's record for some time, so this is noted for information.",
          "Shared accounts can be legitimate (group companies, a parent and its trading arm). This only asks a person to confirm the relationship.",
        ],
        supportingRecords: recs,
        recommendedAction: "Ask Supplier master data to confirm how the two suppliers are related and record it on the supplier master. If they are unrelated, check with the supplier by call-back.",
      }));
    }
  }

  // ---- 3. Address change ----------------------------------------------------
  const reg = v.addresses.filter((a) => a.kind === "registered");
  const current = reg.find((a) => !a.validTo && a.validFrom);
  if (current?.validFrom && current.validFrom <= inv.invoiceDate) {
    const age = dayGap(inv.invoiceDate, current.validFrom);
    const prev = reg.find((a) => a.validTo);
    if (age <= cfg.changeLookbackDays && prev) {
      signals.push(makeSignal({
        detector: "vendor", kind: "address_change", flag: true, severity: "review", score: 55, department: "Supplier master data",
        reasons: [`The registered address changed ${Math.round(age)} days before this invoice (from ${prev.city} ${prev.pincode} to ${current.city} ${current.pincode}).`, "Suppliers do move, so this alone proves nothing. It matters more when it comes with a bank change or a new account."],
        supportingRecords: [{ source: "Supplier master", ref: "previous address", text: `${prev.line}, ${prev.city} ${prev.pincode} (until ${prev.validTo})` }, { source: "Supplier master", ref: "current address", text: `${current.line}, ${current.city} ${current.pincode} (from ${current.validFrom})` }],
        recommendedAction: `Confirm the move with the supplier. ${CALL_BACK}`,
      }));
    }
  }

  // ---- 4. Tax IDs -----------------------------------------------------------
  if (b.invoiceGstin && b.invoiceGstin !== v.gstin) {
    signals.push(makeSignal({
      detector: "vendor", kind: "tax_id_conflict", flag: true, severity: "review", score: 80, department: "Supplier master data",
      reasons: [`The GSTIN on the invoice (${b.invoiceGstin}) is not the GSTIN on the supplier master (${v.gstin}).`, "This can be a typing error on the invoice or a different legal entity billing under this supplier's name."],
      supportingRecords: [{ source: "Finance", ref: `invoice ${inv.id}`, text: `GSTIN printed on the invoice: ${b.invoiceGstin}` }, { source: "Supplier master", ref: `supplier ${v.id}`, text: `GSTIN on file: ${v.gstin}` }],
      recommendedAction: "Ask the supplier to confirm its GSTIN in writing and check it on the GST portal before the invoice is paid.",
    }));
  } else if (v.gstin.slice(0, 2) !== v.stateCode) {
    signals.push(makeSignal({
      detector: "vendor", kind: "tax_id_conflict", flag: true, severity: "review", score: 50, department: "Supplier master data",
      reasons: [`The state code in the GSTIN (${v.gstin.slice(0, 2)}) does not match the state on the supplier record (${v.stateCode}).`],
      supportingRecords: [{ source: "Supplier master", ref: `supplier ${v.id}`, text: `GSTIN ${v.gstin}, state ${v.stateCode}` }],
      recommendedAction: "Correct the supplier master if it is a typing error; otherwise confirm the GSTIN with the supplier.",
    }));
  }

  const flagged = signals.filter((s) => s.flag);
  return {
    detector: "vendor", title, flag: flagged.length > 0, score: Math.max(0, ...flagged.map((s) => s.score)), signals,
    summary: flagged.length ? `${flagged.length} vendor record warning${flagged.length === 1 ? "" : "s"}: ${flagged.map((s) => s.kind.replace(/_/g, " ")).join(", ")}.` : signals.length ? "Noted on the vendor record, nothing flagged." : "Bank details, address and tax ID on the supplier record are consistent with this invoice.",
  };
}
