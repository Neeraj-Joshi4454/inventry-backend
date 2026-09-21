import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createSuperAdminDirect,
  createTenantWithOwnerViaApi,
  loginOrThrow,
  nextMobileNumber,
} from './helpers/factories';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

async function setupTenantOwner() {
  const superAdminMobile = nextMobileNumber();
  await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
  const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
  const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
  const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
  return { superAdmin, tenant, owner };
}

async function configureTax(
  owner: { accessToken: string },
  body: Record<string, unknown>
) {
  const res = await request(app)
    .patch('/api/v1/taxes')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(body);
  if (res.status !== 200) {
    throw new Error(`Expected tax config update to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function createProduct(
  owner: { accessToken: string },
  overrides: Record<string, unknown> = {}
) {
  const [categoriesRes, unitsRes] = await Promise.all([
    request(app).get('/api/v1/categories').set('Authorization', `Bearer ${owner.accessToken}`),
    request(app).get('/api/v1/units').set('Authorization', `Bearer ${owner.accessToken}`),
  ]);
  const unique = Math.random().toString(36).slice(2, 8).toUpperCase();
  const res = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      name: overrides.name ?? `Product ${unique}`,
      sku: overrides.sku ?? `SKU-${unique}`,
      categoryId: categoriesRes.body.data[0]._id,
      unitId: unitsRes.body.data[0]._id,
      purchasePrice: overrides.purchasePrice ?? 100,
      sellingPrice: overrides.sellingPrice ?? 120,
      lowStockThreshold: overrides.lowStockThreshold ?? 10,
      taxRate: overrides.taxRate ?? 0,
      isPriceInclusive: overrides.isPriceInclusive ?? false,
    });
  if (res.status !== 201) {
    throw new Error(`Expected product creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { _id: string; name: string };
}

async function createCustomer(owner: { accessToken: string }, state?: string) {
  const unique = Math.random().toString(36).slice(2, 8);
  const res = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ name: `Customer ${unique}`, address: state ? { state } : undefined });
  if (res.status !== 201) {
    throw new Error(`Expected customer creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { _id: string; name: string };
}

async function createSupplier(owner: { accessToken: string }, state?: string) {
  const unique = Math.random().toString(36).slice(2, 8);
  const res = await request(app)
    .post('/api/v1/suppliers')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ name: `Supplier ${unique}`, address: state ? { state } : undefined });
  if (res.status !== 201) {
    throw new Error(`Expected supplier creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { _id: string; name: string };
}

async function stockProduct(owner: { accessToken: string }, productId: string, quantity: number) {
  await request(app)
    .post('/api/v1/inventory/opening-stock')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ productId, quantity })
    .expect(201);
}

describe('GET/PATCH /api/v1/taxes', () => {
  it('a new tenant has GST enabled by default with a zero rate (backward compatible)', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/taxes')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.gstEnabled).toBe(true);
    expect(res.body.data.defaultTaxRate).toBe(0);
  });

  it('updates GST settings and rejects an invalid GSTIN', async () => {
    const { owner } = await setupTenantOwner();

    const bad = await request(app)
      .patch('/api/v1/taxes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ gstin: 'NOT-A-GSTIN' });
    expect(bad.status).toBe(400);

    const good = await configureTax(owner, {
      gstEnabled: true,
      gstin: '29ABCDE1234F1Z5',
      state: 'Karnataka',
      defaultTaxRate: 18,
      taxType: 'CGST_SGST',
    });
    expect(good.gstin).toBe('29ABCDE1234F1Z5');
    expect(good.state).toBe('Karnataka');
    expect(good.defaultTaxRate).toBe(18);
  });

  it('rejects enabling GST without a GSTIN', async () => {
    const { owner } = await setupTenantOwner();
    // Start from a config with no gstin (default seed has none unless the
    // tenant profile supplied one), then try to (re)enable GST explicitly.
    await request(app)
      .patch('/api/v1/taxes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ gstEnabled: false })
      .expect(200);

    const res = await request(app)
      .patch('/api/v1/taxes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ gstEnabled: true });
    expect(res.status).toBe(400);
  });

  it('a Sales Person cannot update tax configuration (403)', async () => {
    const { owner, superAdmin, tenant } = await setupTenantOwner();
    const salesMobile = nextMobileNumber();
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({
        tenantId: tenant.tenantId,
        name: 'Sales Guy',
        mobileNumber: salesMobile,
        password: 'SalesPass123',
        role: 'SALES_PERSON',
      })
      .expect(201);
    const salesPerson = await loginOrThrow(app, salesMobile, 'SalesPass123');

    const res = await request(app)
      .patch('/api/v1/taxes')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ defaultTaxRate: 18 });
    expect(res.status).toBe(403);
    void owner;
  });

  it('tax configuration is isolated per tenant', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();

    await configureTax(ownerA, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', defaultTaxRate: 18 });

    const configB = await request(app)
      .get('/api/v1/taxes')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(configB.body.data.defaultTaxRate).toBe(0);
    expect(configB.body.data.gstin).toBeFalsy();
  });
});

describe('Sales tax calculation', () => {
  it('GST disabled forces zero tax even with a nonzero product/line rate', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: false });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    expect(Number(res.body.data.taxAmount)).toBe(0);
    expect(Number(res.body.data.cgstAmount)).toBe(0);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(1000, 2);
    expect(res.body.data.taxType).toBe('NO_TAX');
  });

  it.each([0, 5, 12, 18, 28])('computes tax correctly at the %i%% GST slab', async (rate) => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: rate });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    const expectedTax = 1000 * (rate / 100);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(expectedTax, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(1000 + expectedTax, 2);
  });

  it('applies CGST + SGST when customer state matches the business state', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    expect(res.body.data.taxType).toBe('CGST_SGST');
    expect(Number(res.body.data.cgstAmount)).toBeCloseTo(90, 2);
    expect(Number(res.body.data.sgstAmount)).toBeCloseTo(90, 2);
    expect(Number(res.body.data.igstAmount)).toBe(0);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(180, 2);
  });

  it('applies IGST when customer state differs from the business state', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Maharashtra');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    expect(res.body.data.taxType).toBe('IGST');
    expect(Number(res.body.data.cgstAmount)).toBe(0);
    expect(Number(res.body.data.sgstAmount)).toBe(0);
    expect(Number(res.body.data.igstAmount)).toBeCloseTo(180, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(180, 2);
  });

  it('tax-exclusive pricing: unitPrice is the base, tax is added on top', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18, isPriceInclusive: false });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 1, unitPrice: 100 }] })
      .expect(201);

    expect(Number(res.body.data.subTotal)).toBeCloseTo(100, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(18, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(118, 2);
  });

  it('tax-inclusive pricing: unitPrice already contains tax, base is backed out', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18, isPriceInclusive: true });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 1, unitPrice: 118 }] })
      .expect(201);

    // 118 inclusive of 18% => base 100, tax 18.
    expect(Number(res.body.data.subTotal)).toBeCloseTo(100, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(18, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(118, 2);
  });

  it('discounts are applied before tax is computed', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 10 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        discountAmount: 100,
        items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
      })
      .expect(201);

    // subtotal 1000, discount 100 -> taxable 900, tax 10% = 90, total 990.
    expect(Number(res.body.data.subTotal)).toBeCloseTo(1000, 2);
    expect(Number(res.body.data.taxableAmount)).toBeCloseTo(900, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(90, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(990, 2);
  });

  it('a line-level taxRate override wins over the product default', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 5 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 100, taxRate: 28 }],
      })
      .expect(201);

    expect(Number(res.body.data.taxAmount)).toBeCloseTo(280, 2);
  });

  it('rounding: CGST and SGST always sum exactly to the total tax even with odd amounts', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 1000);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 3, unitPrice: 33.33 }],
      })
      .expect(201);

    const cgst = Number(res.body.data.cgstAmount);
    const sgst = Number(res.body.data.sgstAmount);
    const taxAmount = Number(res.body.data.taxAmount);
    expect(cgst + sgst).toBeCloseTo(taxAmount, 2);
    expect(Number(res.body.data.taxableAmount) + taxAmount).toBeCloseTo(
      Number(res.body.data.totalAmount),
      2
    );
  });
});

describe('Purchase tax calculation', () => {
  it('applies IGST when the supplier state differs from the business state', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 12 });
    const supplier = await createSupplier(owner, 'Tamil Nadu');

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ supplierId: supplier._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    expect(res.body.data.taxType).toBe('IGST');
    expect(Number(res.body.data.igstAmount)).toBeCloseTo(120, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(1120, 2);
  });

  it('stores discountAmount on the purchase (previously silently dropped)', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 10 });
    const supplier = await createSupplier(owner, 'Karnataka');

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        discountAmount: 100,
        items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
      })
      .expect(201);

    expect(Number(res.body.data.discountAmount)).toBeCloseTo(100, 2);
    expect(Number(res.body.data.taxableAmount)).toBeCloseTo(900, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(90, 2);

    const detail = await request(app)
      .get(`/api/v1/purchases/${res.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(Number(detail.body.data.purchase.discountAmount)).toBeCloseTo(100, 2);
  });
});

describe('Sale returns reverse tax correctly', () => {
  it('reverses tax proportionally for a partial return', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    const saleDetail = await request(app)
      .get(`/api/v1/sales/${sale.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const saleItemId = saleDetail.body.data.items[0]._id as string;

    // Return 4 of the 10 units (40%).
    const returnRes = await request(app)
      .post(`/api/v1/sales/${sale.body.data._id}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 4 }] });

    expect(returnRes.status).toBe(201);
    // Original: taxable 1000, tax 180 (90 cgst + 90 sgst). 40% reversed:
    // taxable 400, cgst 36, sgst 36, tax 72, total 472.
    expect(Number(returnRes.body.data.taxableAmount)).toBeCloseTo(400, 2);
    expect(Number(returnRes.body.data.cgstAmount)).toBeCloseTo(36, 2);
    expect(Number(returnRes.body.data.sgstAmount)).toBeCloseTo(36, 2);
    expect(Number(returnRes.body.data.taxAmount)).toBeCloseTo(72, 2);
    expect(Number(returnRes.body.data.totalAmount)).toBeCloseTo(472, 2);
    expect(returnRes.body.data.taxType).toBe('CGST_SGST');
  });

  it('does not create a duplicate inventory transaction or duplicate sale on return', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);
    const saleDetail = await request(app)
      .get(`/api/v1/sales/${sale.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const saleItemId = saleDetail.body.data.items[0]._id as string;

    await request(app)
      .post(`/api/v1/sales/${sale.body.data._id}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 4 }] })
      .expect(201);

    const salesList = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(salesList.body.data).toHaveLength(1);

    const ledger = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    // OPENING_STOCK, SALE, SALE_RETURN — exactly one of each, no duplicates.
    expect(ledger.body.data.transactions).toHaveLength(3);
    expect(ledger.body.data.transactions.filter((t: { type: string }) => t.type === 'SALE_RETURN')).toHaveLength(1);
  });
});

describe('Purchase returns reverse tax correctly', () => {
  it('reverses tax proportionally for a partial return', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 12 });
    const supplier = await createSupplier(owner, 'Karnataka');

    const purchase = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ supplierId: supplier._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    const purchaseDetail = await request(app)
      .get(`/api/v1/purchases/${purchase.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const purchaseItemId = purchaseDetail.body.data.items[0]._id as string;

    const returnRes = await request(app)
      .post(`/api/v1/purchases/${purchase.body.data._id}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ purchaseItemId, quantity: 5 }] });

    expect(returnRes.status).toBe(201);
    // Original: taxable 1000, tax 120 (60 cgst + 60 sgst). 50% reversed.
    expect(Number(returnRes.body.data.taxableAmount)).toBeCloseTo(500, 2);
    expect(Number(returnRes.body.data.taxAmount)).toBeCloseTo(60, 2);
    expect(Number(returnRes.body.data.totalAmount)).toBeCloseTo(560, 2);
  });
});

describe('Historical transactions are unaffected by later tax setting changes', () => {
  it('a sale keeps its original tax amounts after the tax config changes', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka', defaultTaxRate: 18 });
    const product = await createProduct(owner, { taxRate: 18 });
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    // Now change the tax config drastically: disable GST entirely, and
    // change the business state (which would flip CGST/SGST to IGST for
    // this same customer if it were re-evaluated).
    await configureTax(owner, { gstEnabled: false, state: 'Maharashtra' });

    const detail = await request(app)
      .get(`/api/v1/sales/${sale.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(detail.body.data.sale.taxType).toBe('CGST_SGST');
    expect(Number(detail.body.data.sale.cgstAmount)).toBeCloseTo(90, 2);
    expect(Number(detail.body.data.sale.sgstAmount)).toBeCloseTo(90, 2);
    expect(Number(detail.body.data.sale.taxAmount)).toBeCloseTo(180, 2);
    expect(Number(detail.body.data.sale.totalAmount)).toBeCloseTo(1180, 2);
  });
});

describe('GET /api/v1/sales/:id/invoice', () => {
  it('exposes the data an invoice needs, with HSN and the full tax breakdown', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    await request(app)
      .patch(`/api/v1/products/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ hsnCode: '2523' })
      .expect(200);
    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 10, unitPrice: 100 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/sales/${sale.body.data._id}/invoice`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.business.gstin).toBe('29ABCDE1234F1Z5');
    expect(res.body.data.customer.name).toBeDefined();
    expect(res.body.data.invoiceNumber).toBe(sale.body.data.saleNumber);
    expect(res.body.data.items[0].hsnCode).toBe('2523');
    expect(Number(res.body.data.items[0].taxableValue)).toBeCloseTo(1000, 2);
    expect(Number(res.body.data.items[0].cgst)).toBeCloseTo(90, 2);
    expect(Number(res.body.data.grandTotal)).toBeCloseTo(1180, 2);
  });

  it('tenant isolation: cannot fetch another tenant sale invoice', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const product = await createProduct(ownerA);
    const customer = await createCustomer(ownerA);
    await stockProduct(ownerA, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 1, unitPrice: 100 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/sales/${sale.body.data._id}/invoice`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/purchases/:id/invoice', () => {
  it('exposes the data a purchase bill needs, with HSN, supplier bill number, and the full tax breakdown', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const product = await createProduct(owner, { taxRate: 18 });
    await request(app)
      .patch(`/api/v1/products/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ hsnCode: '2523' })
      .expect(200);
    const supplier = await createSupplier(owner, 'Karnataka');

    const purchase = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        invoiceNumber: 'SUP-BILL-42',
        items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/purchases/${purchase.body.data._id}/invoice`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.business.gstin).toBe('29ABCDE1234F1Z5');
    expect(res.body.data.supplier.name).toBeDefined();
    expect(res.body.data.invoiceNumber).toBe(purchase.body.data.purchaseNumber);
    expect(res.body.data.supplierInvoiceNumber).toBe('SUP-BILL-42');
    expect(res.body.data.items[0].hsnCode).toBe('2523');
    expect(Number(res.body.data.items[0].taxableValue)).toBeCloseTo(1000, 2);
    expect(Number(res.body.data.items[0].cgst)).toBeCloseTo(90, 2);
    expect(Number(res.body.data.grandTotal)).toBeCloseTo(1180, 2);
  });

  it('works without a supplier bill number (backward compatible)', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProduct(owner);
    const supplier = await createSupplier(owner);

    const purchase = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ supplierId: supplier._id, items: [{ productId: product._id, quantity: 1, unitPrice: 50 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/purchases/${purchase.body.data._id}/invoice`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.supplierInvoiceNumber).toBeNull();
  });

  it('tenant isolation: cannot fetch another tenant purchase invoice', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const product = await createProduct(ownerA);
    const supplier = await createSupplier(ownerA);

    const purchase = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ supplierId: supplier._id, items: [{ productId: product._id, quantity: 1, unitPrice: 100 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/purchases/${purchase.body.data._id}/invoice`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Existing products without tax fields continue working', () => {
  it('a product created before tax fields existed defaults to zero tax', async () => {
    const { owner } = await setupTenantOwner();
    await configureTax(owner, { gstEnabled: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    // Simulate a pre-existing product by not sending taxRate/isPriceInclusive at all.
    const [categoriesRes, unitsRes] = await Promise.all([
      request(app).get('/api/v1/categories').set('Authorization', `Bearer ${owner.accessToken}`),
      request(app).get('/api/v1/units').set('Authorization', `Bearer ${owner.accessToken}`),
    ]);
    const productRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Legacy Product',
        sku: 'LEGACY-1',
        categoryId: categoriesRes.body.data[0]._id,
        unitId: unitsRes.body.data[0]._id,
        purchasePrice: 100,
        sellingPrice: 120,
        lowStockThreshold: 5,
      })
      .expect(201);
    expect(productRes.body.data.taxRate).toBe(0);
    expect(productRes.body.data.isPriceInclusive).toBe(false);

    const customer = await createCustomer(owner, 'Karnataka');
    await stockProduct(owner, productRes.body.data._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: productRes.body.data._id, quantity: 5, unitPrice: 120 }],
      })
      .expect(201);

    expect(Number(sale.body.data.taxAmount)).toBe(0);
    expect(Number(sale.body.data.totalAmount)).toBeCloseTo(600, 2);
  });
});
