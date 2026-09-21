import type { Types } from 'mongoose';
import { toCsv } from '../../utils/csv';
import { listSales } from '../sales/sale.service';
import { listPurchases } from '../purchases/purchase.service';
import { listInventory } from '../inventory/inventory.query.service';
import { listCustomers } from '../customers/customer.service';
import { listSuppliers } from '../suppliers/supplier.service';
import type { ListSalesQuery } from '../sales/sale.validators';
import type { ListPurchasesQuery } from '../purchases/purchase.validators';
import type { ListInventoryQuery } from '../inventory/inventory.validators';
import type { ListCustomersQuery } from '../customers/customer.validators';
import type { ListSuppliersQuery } from '../suppliers/supplier.validators';

// A CSV export is "give me everything matching this filter", not one
// screen-page of it — reuses each module's own tenant-scoped list()
// function (so filtering/tenant-isolation logic is never duplicated) with
// a page size large enough to cover any realistic SMB dataset in one call.
const EXPORT_ROW_CAP = 20_000;
const EXPORT_PAGINATION = { page: 1, limit: EXPORT_ROW_CAP, skip: 0 };

function num(value: unknown): string {
  if (value === null || value === undefined) return '';
  return Number(value).toString();
}

export async function exportSalesCsv(tenantId: Types.ObjectId, query: Partial<ListSalesQuery>) {
  const { sales } = await listSales(tenantId, query, EXPORT_PAGINATION);
  const headers = [
    'Sale Number',
    'Sale Date',
    'Customer',
    'Subtotal',
    'Discount',
    'Taxable Amount',
    'CGST',
    'SGST',
    'IGST',
    'Total Tax',
    'Grand Total',
    'Paid',
    'Outstanding',
    'Payment Status',
    'Created By',
  ];
  const rows = sales.map((sale) => {
    const s = sale.toJSON() as unknown as Record<string, unknown>;
    const customer = s.customerId as { name?: string } | null;
    const createdBy = s.createdBy as { name?: string } | null;
    return [
      s.saleNumber as string,
      new Date(s.saleDate as string).toISOString().slice(0, 10),
      customer?.name ?? '',
      num(s.subTotal),
      num(s.discountAmount),
      num(s.taxableAmount),
      num(s.cgstAmount),
      num(s.sgstAmount),
      num(s.igstAmount),
      num(s.taxAmount),
      num(s.totalAmount),
      num(s.paidAmount),
      num(s.dueAmount),
      s.paymentStatus as string,
      createdBy?.name ?? '',
    ];
  });
  return toCsv(headers, rows);
}

export async function exportPurchasesCsv(
  tenantId: Types.ObjectId,
  query: Partial<ListPurchasesQuery>
) {
  const { purchases } = await listPurchases(tenantId, query, EXPORT_PAGINATION);
  const headers = [
    'Purchase Number',
    'Invoice Number',
    'Purchase Date',
    'Supplier',
    'Subtotal',
    'Discount',
    'Taxable Amount',
    'CGST',
    'SGST',
    'IGST',
    'Total Tax',
    'Grand Total',
    'Paid',
    'Outstanding',
    'Payment Status',
    'Created By',
  ];
  const rows = purchases.map((purchase) => {
    const p = purchase.toJSON() as unknown as Record<string, unknown>;
    const supplier = p.supplierId as { name?: string } | null;
    const createdBy = p.createdBy as { name?: string } | null;
    return [
      p.purchaseNumber as string,
      (p.invoiceNumber as string) ?? '',
      new Date(p.purchaseDate as string).toISOString().slice(0, 10),
      supplier?.name ?? '',
      num(p.subTotal),
      num(p.discountAmount),
      num(p.taxableAmount),
      num(p.cgstAmount),
      num(p.sgstAmount),
      num(p.igstAmount),
      num(p.taxAmount),
      num(p.totalAmount),
      num(p.paidAmount),
      num(p.dueAmount),
      p.paymentStatus as string,
      createdBy?.name ?? '',
    ];
  });
  return toCsv(headers, rows);
}

export async function exportInventoryCsv(
  tenantId: Types.ObjectId,
  query: Partial<ListInventoryQuery>
) {
  const { items } = await listInventory(tenantId, query, EXPORT_PAGINATION);
  const headers = [
    'Product',
    'SKU',
    'Category',
    'Unit',
    'Current Stock',
    'Low Stock Threshold',
    'Status',
  ];
  const rows = items.map((item: Record<string, unknown>) => [
    item.name as string,
    item.sku as string,
    (item.category as { name?: string } | null)?.name ?? '',
    (item.unit as { symbol?: string } | null)?.symbol ?? '',
    num(item.currentStock),
    num(item.lowStockThreshold),
    item.status as string,
  ]);
  return toCsv(headers, rows);
}

export async function exportCustomersCsv(
  tenantId: Types.ObjectId,
  query: Partial<ListCustomersQuery>
) {
  const { customers } = await listCustomers(tenantId, query, EXPORT_PAGINATION);
  const headers = ['Name', 'Mobile', 'Email', 'GST Number', 'City', 'State', 'Active'];
  const rows = customers.map((customer) => {
    const c = customer.toJSON() as unknown as Record<string, unknown>;
    const address = c.address as { city?: string; state?: string } | undefined;
    return [
      c.name as string,
      (c.mobileNumber as string) ?? '',
      (c.email as string) ?? '',
      (c.gstNumber as string) ?? '',
      address?.city ?? '',
      address?.state ?? '',
      c.isActive ? 'Yes' : 'No',
    ];
  });
  return toCsv(headers, rows);
}

export async function exportSuppliersCsv(
  tenantId: Types.ObjectId,
  query: Partial<ListSuppliersQuery>
) {
  const { suppliers } = await listSuppliers(tenantId, query, EXPORT_PAGINATION);
  const headers = [
    'Name',
    'Contact Person',
    'Mobile',
    'Email',
    'GST Number',
    'City',
    'State',
    'Active',
  ];
  const rows = suppliers.map((supplier) => {
    const s = supplier.toJSON() as unknown as Record<string, unknown>;
    const address = s.address as { city?: string; state?: string } | undefined;
    return [
      s.name as string,
      (s.contactPerson as string) ?? '',
      (s.mobileNumber as string) ?? '',
      (s.email as string) ?? '',
      (s.gstNumber as string) ?? '',
      address?.city ?? '',
      address?.state ?? '',
      s.isActive ? 'Yes' : 'No',
    ];
  });
  return toCsv(headers, rows);
}
