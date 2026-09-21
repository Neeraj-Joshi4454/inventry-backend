// Shared helpers for computing running payment totals (Sale.paidAmount /
// dueAmount and the CustomerPayment ledger) so drift from repeated
// floating-point addition/subtraction never produces a spurious
// PARTIAL/CREDIT status or a rejected exact pay-off.

// Amounts within this of each other are treated as equal — smaller than
// any real currency's minor unit, large enough to absorb float drift.
export const MONEY_EPSILON = 0.005;

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
