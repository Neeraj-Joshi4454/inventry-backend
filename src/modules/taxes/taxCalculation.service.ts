import { TaxType } from '../../types/enums';
import { roundMoney } from '../../utils/money';

/**
 * The single place Sale and Purchase creation (and nothing else) computes
 * tax — see "Important Rules": keep tax calculation in one reusable
 * backend service, never duplicated. Sale/Purchase returns use the
 * simpler proportional reversal in saleReturn.service.ts /
 * purchaseReturn.service.ts, which reads already-persisted per-line rates
 * rather than recomputing from current config (returns must reference the
 * original transaction, not today's tax settings).
 */

export type ResolvedTaxSplit = 'CGST_SGST' | 'IGST' | 'UTGST' | 'NO_TAX';

export interface TaxableLineInput {
  quantity: number;
  unitPrice: number;
  taxRate: number;
  isPriceInclusive?: boolean;
}

export interface TaxableLineResult {
  quantity: number;
  /** Always tax-exclusive, even if the input price was inclusive. */
  unitPrice: number;
  taxRate: number;
  isPriceInclusive: boolean;
  lineSubTotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface DocumentTaxResult {
  lines: TaxableLineResult[];
  taxType: ResolvedTaxSplit;
  subTotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Whether a document's tax splits into CGST+SGST/UTGST or IGST — derived
 * purely from comparing the tenant's configured state against the
 * counterparty's (customer/supplier) state, never a client-supplied "which
 * bucket" flag. `gstEnabled: false` or `taxType: NO_TAX` short-circuits to
 * NO_TAX regardless of state.
 */
export function resolveTaxSplit(
  taxConfig: { gstEnabled: boolean; state?: string | null; taxType: string } | null,
  counterpartyState?: string | null
): ResolvedTaxSplit {
  if (!taxConfig || !taxConfig.gstEnabled || taxConfig.taxType === TaxType.NO_TAX) {
    return 'NO_TAX';
  }

  const businessState = taxConfig.state?.trim().toLowerCase();
  const otherState = counterpartyState?.trim().toLowerCase();

  // Same state, or we don't know one side well enough to compare — default
  // to the tenant's own intra-state registration type rather than
  // guessing IGST, since most of a small business's transactions are local.
  if (!businessState || !otherState || businessState === otherState) {
    return taxConfig.taxType === TaxType.UTGST ? 'UTGST' : 'CGST_SGST';
  }
  return 'IGST';
}

function normalizeLine(input: TaxableLineInput, split: ResolvedTaxSplit): TaxableLineResult {
  const isPriceInclusive = input.isPriceInclusive ?? false;
  const taxRate = split === 'NO_TAX' ? 0 : input.taxRate;

  // Tax-inclusive pricing: the entered unitPrice already contains tax, so
  // back it out to a tax-exclusive base before anything else is computed —
  // every downstream number (subtotal, discount, taxable amount) is always
  // in exclusive terms, the same as a tax-exclusive line.
  const unitPrice =
    isPriceInclusive && taxRate > 0 ? input.unitPrice / (1 + taxRate / 100) : input.unitPrice;
  const lineSubTotal = roundMoney(input.quantity * unitPrice);

  return {
    quantity: input.quantity,
    unitPrice: roundMoney(unitPrice),
    taxRate,
    isPriceInclusive,
    lineSubTotal,
    discountAmount: 0,
    taxableAmount: lineSubTotal,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    taxAmount: 0,
    lineTotal: lineSubTotal,
  };
}

/**
 * Computes subtotal, proportional discount allocation, taxable amount, and
 * the CGST/SGST/IGST split — line by line and then totalled. An
 * invoice-level discount is spread across lines in proportion to each
 * line's share of the subtotal, and GST is always computed on the
 * post-discount taxable value (never the gross price) — see "Discounts
 * before tax" in the module's testing checklist.
 */
export function calculateDocumentTax(
  inputLines: TaxableLineInput[],
  discountAmount: number,
  split: ResolvedTaxSplit
): DocumentTaxResult {
  const lines = inputLines.map((line) => normalizeLine(line, split));
  const subTotal = roundMoney(lines.reduce((sum, l) => sum + l.lineSubTotal, 0));
  const safeDiscount = Math.min(Math.max(discountAmount, 0), subTotal);

  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let taxableTotal = 0;
  let discountTotal = 0;

  for (const line of lines) {
    const lineDiscount =
      subTotal > 0 ? roundMoney(safeDiscount * (line.lineSubTotal / subTotal)) : 0;
    const taxableAmount = roundMoney(line.lineSubTotal - lineDiscount);
    const lineTax = roundMoney(taxableAmount * (line.taxRate / 100));

    line.discountAmount = lineDiscount;
    line.taxableAmount = taxableAmount;

    if (split === 'CGST_SGST' || split === 'UTGST') {
      // Residual method: sgst = total - cgst, so the two halves always sum
      // exactly to lineTax even after independent rounding.
      line.cgstAmount = roundMoney(lineTax / 2);
      line.sgstAmount = roundMoney(lineTax - line.cgstAmount);
    } else if (split === 'IGST') {
      line.igstAmount = lineTax;
    }
    // NO_TAX: taxRate was already forced to 0 in normalizeLine, so lineTax
    // is 0 and every bucket stays 0.

    line.taxAmount = roundMoney(line.cgstAmount + line.sgstAmount + line.igstAmount);
    line.lineTotal = roundMoney(line.taxableAmount + line.taxAmount);

    discountTotal = roundMoney(discountTotal + lineDiscount);
    taxableTotal = roundMoney(taxableTotal + taxableAmount);
    cgstTotal = roundMoney(cgstTotal + line.cgstAmount);
    sgstTotal = roundMoney(sgstTotal + line.sgstAmount);
    igstTotal = roundMoney(igstTotal + line.igstAmount);
  }

  const taxTotal = roundMoney(cgstTotal + sgstTotal + igstTotal);

  return {
    lines,
    taxType: split,
    subTotal,
    discountAmount: discountTotal,
    taxableAmount: taxableTotal,
    cgstAmount: cgstTotal,
    sgstAmount: sgstTotal,
    igstAmount: igstTotal,
    taxAmount: taxTotal,
    totalAmount: roundMoney(taxableTotal + taxTotal),
  };
}
