// SUPER_ADMIN is platform-level (tenantId: null). All other roles are
// tenant-scoped. OWNER is the first user created for a tenant (see
// tenant.service.ts::createTenant) and is the only role that can manage
// other users within the tenant.
export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  STORE_KEEPER: 'STORE_KEEPER',
  SALES_PERSON: 'SALES_PERSON',
  ACCOUNTANT: 'ACCOUNTANT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const InventoryTransactionType = {
  // Legacy: the Opening Stock flow has been removed (stock now only enters
  // through Purchases). Kept so existing ledger rows still read and filter.
  OPENING_STOCK: 'OPENING_STOCK',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  STOCK_ADJUSTMENT_IN: 'STOCK_ADJUSTMENT_IN',
  STOCK_ADJUSTMENT_OUT: 'STOCK_ADJUSTMENT_OUT',
} as const;
export type InventoryTransactionType =
  (typeof InventoryTransactionType)[keyof typeof InventoryTransactionType];

// Transaction types that increase stock vs. decrease stock.
// This is the single source of truth for stock direction — every service
// that mutates inventory must go through inventory.service.ts, which reads this map.
export const STOCK_INCREASING_TYPES: ReadonlySet<InventoryTransactionType> = new Set([
  InventoryTransactionType.OPENING_STOCK,
  InventoryTransactionType.PURCHASE,
  InventoryTransactionType.SALE_RETURN,
  InventoryTransactionType.STOCK_ADJUSTMENT_IN,
]);

export const STOCK_DECREASING_TYPES: ReadonlySet<InventoryTransactionType> = new Set([
  InventoryTransactionType.SALE,
  InventoryTransactionType.PURCHASE_RETURN,
  InventoryTransactionType.STOCK_ADJUSTMENT_OUT,
]);

export const ReferenceType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  SYSTEM: 'SYSTEM',
} as const;
export type ReferenceType = (typeof ReferenceType)[keyof typeof ReferenceType];

export const DocumentStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

// UNPAID remains Purchase's "nothing paid yet" value (a tenant owes its
// supplier — see purchase.model.ts). CREDIT is the Sale-side equivalent (a
// customer owes the tenant) added for customer credit tracking — see
// sale.model.ts and sale.service.ts::createSale. Both mean "paidAmount is
// zero"; they're kept as distinct values only because the two documents
// describe opposite directions of money owed and existing Purchase
// documents/consumers already depend on the literal string "UNPAID".
export const PaymentStatus = {
  PAID: 'PAID',
  PARTIAL: 'PARTIAL',
  UNPAID: 'UNPAID',
  CREDIT: 'CREDIT',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CARD: 'CARD',
  CREDIT: 'CREDIT',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

// A separate enum from PaymentMethod (rather than reusing it): an expense
// is never paid "on credit" the way a sale/purchase can be, and it adds
// OTHER for the odd payment rail (cheque, wallet, etc.) that doesn't fit
// the other four — see expense.model.ts.
export const ExpensePaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CARD: 'CARD',
  OTHER: 'OTHER',
} as const;
export type ExpensePaymentMethod = (typeof ExpensePaymentMethod)[keyof typeof ExpensePaymentMethod];

// Soft-deletion for expenses (see expense.model.ts / "Important Rules": no
// physical deletion of financial records) — CANCELLED expenses are excluded
// from summaries/reports but never removed from the collection.
export const ExpenseStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

// A tenant's configured GST regime (see taxConfig.model.ts). This is the
// tenant's own registration type / intra-state fallback — the actual
// CGST+SGST vs IGST split used on any one transaction is still resolved
// per-transaction from business-state vs counterparty-state (see
// taxCalculation.service.ts::resolveTaxSplit), not read directly off this
// field except as a fallback when the counterparty's state is unknown.
export const TaxType = {
  CGST_SGST: 'CGST_SGST',
  IGST: 'IGST',
  UTGST: 'UTGST',
  NO_TAX: 'NO_TAX',
} as const;
export type TaxType = (typeof TaxType)[keyof typeof TaxType];

// The GST slabs exposed as presets in Tax Settings / product tax-rate
// pickers. A per-line taxRate on a Sale/Purchase item is NOT restricted to
// this list (real invoices occasionally need an odd rate), only the
// tenant's defaultTaxRate and a product's own configured taxRate are.
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Lifecycle of a self-service business registration (see
// registrationRequest.model.ts): submitted from the app's Register screen,
// then approved (business + owner created) or rejected by a Super Admin.
export const RegistrationStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type RegistrationStatus = (typeof RegistrationStatus)[keyof typeof RegistrationStatus];
