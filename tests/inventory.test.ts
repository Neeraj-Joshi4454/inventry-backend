import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createProductViaApi,
  createSuperAdminDirect,
  createSupplierViaApi,
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

describe('POST /api/v1/inventory/opening-stock', () => {
  it('creates inventory and an OPENING_STOCK ledger entry with correct previous/resulting stock', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: 500 });

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.currentStock).toBe(500);
    expect(res.body.data.transaction.type).toBe('OPENING_STOCK');
    expect(res.body.data.transaction.previousStock).toBe(0);
    expect(res.body.data.transaction.resultingStock).toBe(500);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.status).toBe(200);
    expect(inventoryRes.body.data.currentStock).toBe(500);
    expect(inventoryRes.body.data.status).toBe('IN_STOCK');
  });

  it('rejects setting opening stock twice for the same product', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);

    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: 500 })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: 100 });

    expect(res.status).toBe(409);

    // Confirm the second attempt left the first value untouched (no partial double-apply).
    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(500);
  });

  it('rejects zero or negative opening stock quantity', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);

    const zeroRes = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: 0 });
    expect(zeroRes.status).toBe(400);

    const negativeRes = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: -5 });
    expect(negativeRes.status).toBe(400);
  });

  it('rejects an unknown/invalid product id', async () => {
    const { owner } = await setupTenantOwner();

    const res = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: '65f000000000000000000000', quantity: 100 });

    expect(res.status).toBe(404);
  });

  it('a Sales Person cannot set opening stock (403, not 401)', async () => {
    // Sales Person is excluded from opening-stock writes — creating
    // business users requires SUPER_ADMIN (POST /api/v1/users), not the
    // tenant owner, so a fresh Super Admin session is needed here.
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const product = await createProductViaApi(app, owner.accessToken);

    const salesMobile = nextMobileNumber();
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({
        tenantId: tenant.tenantId,
        name: 'Sales Person',
        mobileNumber: salesMobile,
        password: 'SalesPass123',
        role: 'SALES_PERSON',
      })
      .expect(201);
    const salesPerson = await loginOrThrow(app, salesMobile, 'SalesPass123');

    const res = await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ productId: product._id, quantity: 100 });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/inventory', () => {
  it('shows a product with no stock movement yet as OUT_OF_STOCK / 0', async () => {
    const { owner } = await setupTenantOwner();
    await createProductViaApi(app, owner.accessToken, { name: 'Never Stocked Product' });

    const res = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { name: string }) => r.name === 'Never Stocked Product');
    expect(row).toBeDefined();
    expect(row.currentStock).toBe(0);
    expect(row.status).toBe('OUT_OF_STOCK');
  });

  it('classifies LOW_STOCK vs IN_STOCK correctly against lowStockThreshold', async () => {
    const { owner } = await setupTenantOwner();
    const lowProduct = await createProductViaApi(app, owner.accessToken, {
      name: 'Low Stock Product',
      lowStockThreshold: 50,
    });
    const healthyProduct = await createProductViaApi(app, owner.accessToken, {
      name: 'Healthy Stock Product',
      lowStockThreshold: 50,
    });

    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: lowProduct._id, quantity: 20 });
    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: healthyProduct._id, quantity: 200 });

    const res = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const low = res.body.data.find((r: { name: string }) => r.name === 'Low Stock Product');
    const healthy = res.body.data.find((r: { name: string }) => r.name === 'Healthy Stock Product');
    expect(low.status).toBe('LOW_STOCK');
    expect(healthy.status).toBe('IN_STOCK');
  });

  it('filters by status', async () => {
    const { owner } = await setupTenantOwner();
    await createProductViaApi(app, owner.accessToken, { name: 'Untouched Product' });

    const res = await request(app)
      .get('/api/v1/inventory?status=OUT_OF_STOCK')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((r: { status: string }) => r.status === 'OUT_OF_STOCK')).toBe(true);
  });

  it('searches by product name', async () => {
    const { owner } = await setupTenantOwner();
    await createProductViaApi(app, owner.accessToken, { name: 'Zzzyx Cement Bags' });
    await createProductViaApi(app, owner.accessToken, { name: 'Totally Different Item' });

    const res = await request(app)
      .get('/api/v1/inventory?search=Zzzyx')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Zzzyx Cement Bags');
  });
});

describe('POST /api/v1/purchases', () => {
  it('atomically increases stock for every line item and records PURCHASE ledger entries', async () => {
    const { owner } = await setupTenantOwner();
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [
          { productId: cement._id, quantity: 200, unitPrice: 380 },
          { productId: steel._id, quantity: 500, unitPrice: 75 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.purchaseNumber).toMatch(/^PO-\d{6}$/);
    // subtotal = 200*380 + 500*75 = 76000 + 37500 = 113500
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(113500, 2);

    const cementInventory = await request(app)
      .get(`/api/v1/inventory/${cement._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const steelInventory = await request(app)
      .get(`/api/v1/inventory/${steel._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(cementInventory.body.data.currentStock).toBe(200);
    expect(steelInventory.body.data.currentStock).toBe(500);

    const cementLedger = await request(app)
      .get(`/api/v1/inventory/${cement._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(cementLedger.body.data.transactions).toHaveLength(1);
    expect(cementLedger.body.data.transactions[0].type).toBe('PURCHASE');
    expect(cementLedger.body.data.transactions[0].previousStock).toBe(0);
    expect(cementLedger.body.data.transactions[0].resultingStock).toBe(200);
  });

  it('adds purchased quantity on top of existing stock (previousStock + quantity = resultingStock)', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, quantity: 500 });

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 200, unitPrice: 380 }],
      });

    expect(res.status).toBe(201);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(700); // 500 + 200
  });

  it('rolls back the entire purchase if one line item references an invalid product', async () => {
    const { owner } = await setupTenantOwner();
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Rollback Cement' });
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [
          { productId: cement._id, quantity: 200, unitPrice: 380 },
          { productId: '65f000000000000000000000', quantity: 10, unitPrice: 10 },
        ],
      });

    expect(res.status).toBe(404);

    // Nothing should have been committed — not the purchase, not the stock increase.
    const listRes = await request(app)
      .get('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listRes.body.data).toHaveLength(0);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${cement._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(0);
  });

  it('rejects a purchase from an unknown supplier', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: '65f000000000000000000000',
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });

    expect(res.status).toBe(404);
  });

  it('GET /api/v1/purchases/:id returns the purchase with its line items populated', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 50 }],
      });
    const purchaseId = createRes.body.data._id as string;

    const res = await request(app)
      .get(`/api/v1/purchases/${purchaseId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.purchase._id).toBe(purchaseId);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(10);
  });
});

describe('tenant isolation for inventory/products/purchases', () => {
  it('Tenant A cannot see Tenant B products, inventory, or purchases', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const productB = await createProductViaApi(app, ownerB.accessToken, {
      name: 'Tenant B Product',
    });
    const supplierB = await createSupplierViaApi(app, ownerB.accessToken);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        supplierId: supplierB._id,
        items: [{ productId: productB._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);

    // Owner A must not see Tenant B's product in their product/inventory lists.
    const productsRes = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(
      productsRes.body.data.find((p: { name: string }) => p.name === 'Tenant B Product')
    ).toBeUndefined();

    const inventoryRes = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(
      inventoryRes.body.data.find((p: { name: string }) => p.name === 'Tenant B Product')
    ).toBeUndefined();

    // Owner A must not be able to reach Tenant B's product directly by id either.
    const directRes = await request(app)
      .get(`/api/v1/inventory/${productB._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(directRes.status).toBe(404);

    const purchasesRes = await request(app)
      .get('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(purchasesRes.body.data).toHaveLength(0);
  });
});
