import { DEFAULT_PAYMENT_TERMS_DAYS } from "./constants";
import { addDaysIso } from "./format";
import type { Invoice, Vendor } from "./types";

export function paymentTermsDays(vendor: Vendor | undefined): number {
  return vendor?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
}

/** Payment due date: invoice date plus the vendor's payment terms. */
export function paymentDueDate(inv: Pick<Invoice, "invoiceDate">, vendor: Vendor | undefined): string {
  return addDaysIso(inv.invoiceDate, paymentTermsDays(vendor));
}
