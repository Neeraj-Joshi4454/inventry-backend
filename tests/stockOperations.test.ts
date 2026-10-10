import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createCustomerViaApi,
  createProductViaApi,
  createSuperAdminDirect,
  createSupplierViaApi,
  createTenantWithOwnerViaApi,
  loginOrThrow,
  nextMobileNumber,
  stockViaPurchase,
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

async function stockProduct(owner: { accessToken: string }, productId: string, quantity: number) {
  await stockViaPurchase(app, owner.accessToken, productId, quantity);
}

async function currentStock(owner: { accessToken: string }, productId: string) {
  const res = await request(app)
    .get(`/api/v1/inventory/${productId}`)
    .set('Authorization', `Bearer ${owner.accessToken}`);
  return res.body.data.currentStock as number;
}

describe('POST /api/v1/inventory/adjustments', () => {
  it('applies a positive (IN) adjustment and records STOCK_ADJUSTMENT_IN', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, type: 'IN', quantity: 5, reason: 'Excess stock discovered' });

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.currentStock).toBe(105);
    expect(res.body.data.transaction.type).toBe('STOCK_ADJUSTMENT_IN');
    expect(res.body.data.transaction.previousStock).toBe(100);
    expect(res.body.data.transaction.resultingStock).toBe(105);
    expect(res.body.data.transaction.reason).toBe('Excess stock discovered');

    expect(await currentStock(owner, product._id)).toBe(105);
  });

  it('applies a negative (OUT) adjustment and records STOCK_ADJUSTMENT_OUT', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, type: 'OUT', quantity: 2, reason: 'Damaged material' });

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.currentStock).toBe(98);
    expect(res.body.data.transaction.type).toBe('STOCK_ADJUSTMENT_OUT');
    expect(res.body.data.transaction.previousStock).toBe(100);
    expect(res.body.data.transaction.resultingStock).toBe(98);

    expect(await currentStock(owner, product._id)).toBe(98);
  });

  it('rejects a zero quantity adjustment', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, type: 'OUT', quantity: 0, reason: 'Miscount' });

    expect(res.status).toBe(400);
    expect(await currentStock(owner, product._id)).toBe(100);
  });

  it('rejects a negative quantity adjustment', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, type: 'OUT', quantity: -5, reason: 'Miscount' });

    expect(res.status).toBe(400);
  });

  it('rejects an OUT adjustment that would take stock negative, leaving inventory unchanged', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 10);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        productId: product._id,
        type: 'OUT',
        quantity: 20,
        reason: 'Physical count mismatch',
      });

    expect(res.status).toBe(409);
    expect(await currentStock(owner, product._id)).toBe(10);
  });

  it('requires a reason', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: product._id, type: 'IN', quantity: 5 });

    expect(res.status).toBe(400);
  });

  it('rejects an adjustment for an unknown product', async () => {
    const { owner } = await setupTenantOwner();

    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        productId: '65f000000000000000000000',
        type: 'IN',
        quantity: 5,
        reason: 'Excess stock discovered',
      });

    expect(res.status).toBe(404);
  });

  it('a Sales Person cannot create a stock adjustment', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

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
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ productId: product._id, type: 'IN', quantity: 5, reason: 'Excess stock discovered' });

    expect(res.status).toBe(403);
  });
});

describe('returns are not offered', () => {
  it('sale and purchase return endpoints no longer exist (404) and stock is unchanged', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);
    const purchase = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 5, unitPrice: 10 }],
      })
      .expect(201);

    for (const path of [
      `/api/v1/sales/${sale.body.data._id}/returns`,
      `/api/v1/purchases/${purchase.body.data._id}/returns`,
    ]) {
      await request(app)
        .post(path)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ items: [{ saleItemId: '65f000000000000000000000', quantity: 1 }] })
        .expect(404);
      await request(app).get(path).set('Authorization', `Bearer ${owner.accessToken}`).expect(404);
    }

    expect(await currentStock(owner, product._id)).toBe(95); // 100 - 10 sold + 5 purchased
  });
});

describe('concurrency: stock adjustment racing a sale', () => {
  it('only one of a concurrent OUT-adjustment and a sale succeeds when combined demand exceeds stock', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const [adjustmentRes, saleRes] = await Promise.all([
      request(app)
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ productId: product._id, type: 'OUT', quantity: 60, reason: 'Damaged material' }),
      request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          customerId: customer._id,
          items: [{ productId: product._id, quantity: 60, unitPrice: 10 }],
        }),
    ]);

    const statuses = [adjustmentRes.status, saleRes.status].sort();
    // 60 + 60 > 100 — exactly one of the two concurrent stock-decreasing
    // operations succeeds; the other is rejected as insufficient stock.
    expect(statuses).toEqual([201, 409]);
    expect(await currentStock(owner, product._id)).toBe(40);
  });
});

describe('tenant isolation for stock operations', () => {
  it('Tenant A cannot act on Tenant B stock adjustments', async () => {
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
    const customerB = await createCustomerViaApi(app, ownerB.accessToken);
    const supplierB = await createSupplierViaApi(app, ownerB.accessToken);
    await stockViaPurchase(app, ownerB.accessToken, productB._id, 500);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: productB._id, quantity: 50, unitPrice: 10 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        supplierId: supplierB._id,
        items: [{ productId: productB._id, quantity: 50, unitPrice: 10 }],
      })
      .expect(201);

    // Owner A cannot adjust Tenant B's product.
    const adjustRes = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ productId: productB._id, type: 'IN', quantity: 5, reason: 'test' });
    expect(adjustRes.status).toBe(404);

    // Tenant B's product must be untouched by any of Owner A's attempts.
    expect(await currentStock(ownerB, productB._id)).toBe(500); // 500 opening - 50 sold + 50 purchased
  });
});
