import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createCustomerViaApi,
  createProductViaApi,
  createSuperAdminDirect,
  createTenantWithOwnerViaApi,
  loginOrThrow,
  nextMobileNumber,
  stockViaPurchase,
} from './helpers/factories';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

/**
 * Two businesses: A has one product stocked to 20 then 15 sold for ₹1,500
 * (leaving 5, under its threshold of 10 → LOW_STOCK); B has one product
 * that has never been stocked (OUT_OF_STOCK).
 */
async function seedPlatform() {
  const superAdminMobile = nextMobileNumber();
  await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
  const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

  const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
    businessName: 'Tenant A Co',
  });
  const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
    businessName: 'Tenant B Co',
  });
  const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
  const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

  const productA = await createProductViaApi(app, ownerA.accessToken, { lowStockThreshold: 10 });
  await stockViaPurchase(app, ownerA.accessToken, productA._id, 20);
  const customer = await createCustomerViaApi(app, ownerA.accessToken, 'Ravi');
  const saleRes = await request(app)
    .post('/api/v1/sales')
    .set('Authorization', `Bearer ${ownerA.accessToken}`)
    .send({
      customerId: customer._id,
      items: [{ productId: productA._id, quantity: 15, unitPrice: 100, taxRate: 0 }],
    });
  expect(saleRes.status).toBe(201);

  await createProductViaApi(app, ownerB.accessToken);

  return { superAdmin, ownerA, tenantA, tenantB };
}

function get(path: string, token: string) {
  return request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${token}`);
}

describe('super admin cross-tenant views', () => {
  it('overview totals and alerts span every business', async () => {
    const { superAdmin } = await seedPlatform();
    const res = await get('/overview', superAdmin.accessToken);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.stock.products).toBe(2);
    expect(data.stock.lowStock).toBe(1);
    expect(data.stock.outOfStock).toBe(1);
    expect(data.sales).toEqual({ count: 1, amount: 1500, due: 1500 });
    expect(data.purchases.count).toBe(1);
    expect(data.recentSales[0].businessName).toBe('Tenant A Co');
    expect(data.recentSales[0].customerName).toBe('Ravi');
    expect(data.recentSales[0].totalAmount).toBe(1500);
    expect(data.lowStock.map((p: { status: string }) => p.status)).toEqual([
      'OUT_OF_STOCK',
      'LOW_STOCK',
    ]);
  });

  it('lists filter by business and status', async () => {
    const { superAdmin, tenantA, tenantB } = await seedPlatform();
    const token = superAdmin.accessToken;

    const allSales = await get('/sales', token);
    expect(allSales.body.meta.total).toBe(1);
    const bSales = await get(`/sales?tenantId=${tenantB.tenantId}`, token);
    expect(bSales.body.meta.total).toBe(0);

    const aProducts = await get(`/products?tenantId=${tenantA.tenantId}`, token);
    expect(aProducts.body.data).toHaveLength(1);
    expect(aProducts.body.data[0].businessName).toBe('Tenant A Co');
    expect(aProducts.body.data[0].currentStock).toBe(5);
    expect(typeof aProducts.body.data[0].sellingPrice).toBe('number');

    const low = await get('/inventory?status=LOW_STOCK', token);
    expect(low.body.data).toHaveLength(1);
    expect(low.body.data[0].stockValue).toBe(500);

    const purchases = await get(`/purchases?tenantId=${tenantA.tenantId}`, token);
    expect(purchases.body.data[0].supplierName).toBeTruthy();
  });

  it('business stats and report break down per business', async () => {
    const { superAdmin, tenantA } = await seedPlatform();
    const token = superAdmin.accessToken;

    const stats = await get(`/tenants/${tenantA.tenantId}/stats`, token);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toMatchObject({
      customers: 1,
      suppliers: 1,
      sales: { count: 1, amount: 1500 },
      stock: { products: 1, stockQuantity: 5 },
    });

    const report = await get('/reports', token);
    expect(report.status).toBe(200);
    expect(report.body.data.businesses).toHaveLength(2);
    expect(report.body.data.businesses[0].businessName).toBe('Tenant A Co');
    expect(report.body.data.totals.sales.amount).toBe(1500);
    expect(report.body.data.monthly).toHaveLength(1);

    const future = await get('/reports?fromDate=2999-01-01', token);
    expect(future.body.data.totals.sales.count).toBe(0);
  });

  it('is closed to business users and rejects malformed ids', async () => {
    const { superAdmin, ownerA } = await seedPlatform();

    expect((await get('/overview', ownerA.accessToken)).status).toBe(403);
    expect((await get('/sales', ownerA.accessToken)).status).toBe(403);
    expect((await get('/sales?tenantId=not-an-id', superAdmin.accessToken)).status).toBe(400);
    expect(
      (await get('/tenants/aaaaaaaaaaaaaaaaaaaaaaaa/stats', superAdmin.accessToken)).status
    ).toBe(404);
  });
});
