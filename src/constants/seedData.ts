import { UserRole } from '../types/enums';

/**
 * System-wide role reference data (seeds the `roles` lookup collection —
 * see models/role.model.ts for why this is a lookup table, not the
 * authorization source of truth).
 */
export const DEFAULT_ROLES: Array<{ key: UserRole; label: string; description: string }> = [
  {
    key: UserRole.SUPER_ADMIN,
    label: 'Super Admin',
    description: 'Platform operator. Manages tenants and has cross-tenant visibility.',
  },
  {
    key: UserRole.OWNER,
    label: 'Owner',
    description: 'Business owner. Full access within their tenant, including managing users.',
  },
  {
    key: UserRole.MANAGER,
    label: 'Manager',
    description: 'Manages catalog, inventory, purchases and sales for the business.',
  },
  {
    key: UserRole.STORE_KEEPER,
    label: 'Store Keeper',
    description: 'Records stock-in/stock-out and stock adjustments at the store/warehouse.',
  },
  {
    key: UserRole.SALES_PERSON,
    label: 'Sales Person',
    description: 'Records sales and manages customers. No purchase or adjustment access.',
  },
  {
    key: UserRole.ACCOUNTANT,
    label: 'Accountant',
    description: 'Views sales, purchases and financial reports. Read-only on inventory.',
  },
];

/**
 * Default catalog seeded into a NEW TENANT at creation time (see
 * tenant.service.ts::createTenant). Categories/units are tenant-owned and
 * fully editable/deletable afterwards — this list just saves a new business
 * from having to type out an obvious construction-materials starter set.
 */
export const DEFAULT_CATEGORIES: Array<{ name: string; description?: string }> = [
  { name: 'Cement', description: 'OPC, PPC and other cement varieties' },
  { name: 'Steel', description: 'TMT bars, structural steel' },
  { name: 'Bricks', description: 'Clay bricks, fly ash bricks, AAC blocks' },
  { name: 'Sand', description: 'River sand, M-sand' },
  { name: 'Aggregate', description: 'Crushed stone aggregate of various sizes' },
  { name: 'Tiles', description: 'Floor and wall tiles' },
  { name: 'Pipes', description: 'PVC, CPVC and GI pipes and fittings' },
  { name: 'Hardware', description: 'Nails, fasteners, tools and general hardware' },
];

/**
 * Default expense categories seeded into a NEW TENANT at creation time
 * (see tenant.service.ts::createTenantWithOwner), marked isSystem so they
 * can't be accidentally deactivated (see
 * expenseCategory.service.ts::setExpenseCategoryStatus) — a tenant can
 * still add its own categories freely alongside these.
 */
export const DEFAULT_EXPENSE_CATEGORIES: Array<{ name: string; description?: string }> = [
  { name: 'Rent' },
  { name: 'Electricity' },
  { name: 'Internet' },
  { name: 'Transport' },
  { name: 'Salary' },
  { name: 'Maintenance' },
  { name: 'Office Supplies' },
  { name: 'Other' },
];

export const DEFAULT_UNITS: Array<{ name: string; symbol: string }> = [
  { name: 'Bag', symbol: 'bag' },
  { name: 'Kilogram', symbol: 'kg' },
  { name: 'Ton', symbol: 't' },
  { name: 'Piece', symbol: 'pc' },
  { name: 'Meter', symbol: 'm' },
  { name: 'Cubic Feet', symbol: 'cft' },
  { name: 'Cubic Meter', symbol: 'cum' },
  { name: 'Box', symbol: 'box' },
];
