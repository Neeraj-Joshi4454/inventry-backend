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
  await request(app)
    .post('/api/v1/inventory/opening-stock')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ productId, quantity })
    .expect(201);
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
      .send({ productId: product._id, type: 'OUT', quantity: 20, reason: 'Physical count mismatch' });

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

describe('POST /api/v1/sales/:id/returns', () => {
  async function createSaleOf(
    owner: { accessToken: string },
    productId: string,
    customerId: string,
    quantity: number
  ) {
    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId, items: [{ productId, quantity, unitPrice: 420 }] })
      .expect(201);
    const detail = await request(app)
      .get(`/api/v1/sales/${res.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    return { saleId: res.body.data._id as string, saleItemId: detail.body.data.items[0]._id as string };
  }

  it('increases stock and records a SALE_RETURN transaction referencing the sale return', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 700);
    const { saleId, saleItemId } = await createSaleOf(owner, product._id, customer._id, 100);

    expect(await currentStock(owner, product._id)).toBe(600);

    const res = await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 20 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.returnNumber).toMatch(/^SR-\d{6}$/);
    expect(await currentStock(owner, product._id)).toBe(620);

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const returnTxn = ledgerRes.body.data.transactions.find(
      (t: { type: string }) => t.type === 'SALE_RETURN'
    );
    expect(returnTxn).toBeDefined();
    expect(returnTxn.quantity).toBe(20);
    expect(returnTxn.previousStock).toBe(600);
    expect(returnTxn.resultingStock).toBe(620);
    expect(returnTxn.referenceType).toBe('SALE_RETURN');
    expect(returnTxn.referenceId).toBe(res.body.data._id);
  });

  it('tracks original/returned/remaining quantity and rejects returns beyond what remains', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 700);
    const { saleId, saleItemId } = await createSaleOf(owner, product._id, customer._id, 100);

    await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 30 }] })
      .expect(201);

    const detail = await request(app)
      .get(`/api/v1/sales/${saleId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const item = detail.body.data.items[0];
    expect(item.quantity).toBe(100);
    expect(item.returnedQuantity).toBe(30);
    expect(item.remainingReturnable).toBe(70);

    // Attempting to return 80 more (only 70 remaining) must be rejected,
    // and must leave inventory/returns completely unchanged.
    const excessive = await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 80 }] });
    expect(excessive.status).toBe(400);
    expect(await currentStock(owner, product._id)).toBe(630); // 700 - 100 + 30, unchanged by the rejection

    // But returning exactly the remaining 70 must succeed.
    const finalReturn = await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 70 }] });
    expect(finalReturn.status).toBe(201);
    expect(await currentStock(owner, product._id)).toBe(700);
  });

  it('rejects a return referencing a sale item that does not belong to the sale', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 700);
    const { saleId } = await createSaleOf(owner, product._id, customer._id, 100);

    const res = await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId: '65f000000000000000000000', quantity: 10 }] });

    expect(res.status).toBe(404);
    expect(await currentStock(owner, product._id)).toBe(600); // unchanged
  });

  it('rejects a return for an unknown sale', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/sales/65f000000000000000000000/returns')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId: '65f000000000000000000001', quantity: 10 }] });

    expect(res.status).toBe(404);
  });

  it('GET /api/v1/sales/:id/returns lists returns for that sale', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 700);
    const { saleId, saleItemId } = await createSaleOf(owner, product._id, customer._id, 100);

    await request(app)
      .post(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ saleItemId, quantity: 20 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/sales/${saleId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].items).toHaveLength(1);
    expect(res.body.data[0].items[0].quantity).toBe(20);
  });
});

describe('POST /api/v1/purchases/:id/returns', () => {
  async function createPurchaseOf(
    owner: { accessToken: string },
    productId: string,
    supplierId: string,
    quantity: number
  ) {
    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ supplierId, items: [{ productId, quantity, unitPrice: 380 }] })
      .expect(201);
    const detail = await request(app)
      .get(`/api/v1/purchases/${res.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    return {
      purchaseId: res.body.data._id as string,
      purchaseItemId: detail.body.data.items[0]._id as string,
    };
  }

  it('decreases stock and records a PURCHASE_RETURN transaction referencing the purchase return', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const { purchaseId, purchaseItemId } = await createPurchaseOf(
      owner,
      product._id,
      supplier._id,
      200
    );

    expect(await currentStock(owner, product._id)).toBe(200);

    const res = await request(app)
      .post(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ purchaseItemId, quantity: 50 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.returnNumber).toMatch(/^PR-\d{6}$/);
    expect(await currentStock(owner, product._id)).toBe(150);

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const returnTxn = ledgerRes.body.data.transactions.find(
      (t: { type: string }) => t.type === 'PURCHASE_RETURN'
    );
    expect(returnTxn).toBeDefined();
    expect(returnTxn.quantity).toBe(50);
    expect(returnTxn.previousStock).toBe(200);
    expect(returnTxn.resultingStock).toBe(150);
    expect(returnTxn.referenceType).toBe('PURCHASE_RETURN');
    expect(returnTxn.referenceId).toBe(res.body.data._id);
  });

  it('rejects returning more than was originally purchased', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const { purchaseId, purchaseItemId } = await createPurchaseOf(
      owner,
      product._id,
      supplier._id,
      200
    );

    const res = await request(app)
      .post(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ purchaseItemId, quantity: 250 }] });

    expect(res.status).toBe(400);
    expect(await currentStock(owner, product._id)).toBe(200);
  });

  it('rejects a purchase return when current stock is insufficient (already resold)', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const { purchaseId, purchaseItemId } = await createPurchaseOf(
      owner,
      product._id,
      supplier._id,
      200
    );

    // Sell 180 of the 200 purchased, leaving only 20 in stock.
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customer._id, items: [{ productId: product._id, quantity: 180, unitPrice: 420 }] })
      .expect(201);
    expect(await currentStock(owner, product._id)).toBe(20);

    // The return of 50 is valid against the original purchase (well under
    // 200) but there isn't enough physical stock left to return it.
    const res = await request(app)
      .post(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ purchaseItemId, quantity: 50 }] });

    expect(res.status).toBe(409);
    expect(await currentStock(owner, product._id)).toBe(20); // unchanged

    // Nothing should have been committed — no PurchaseReturn record either.
    const returnsRes = await request(app)
      .get(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(returnsRes.body.data).toHaveLength(0);
  });

  it('GET /api/v1/purchases/:id/returns lists returns for that purchase', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const { purchaseId, purchaseItemId } = await createPurchaseOf(
      owner,
      product._id,
      supplier._id,
      200
    );

    await request(app)
      .post(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ purchaseItemId, quantity: 50 }] })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/purchases/${purchaseId}/returns`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].items[0].quantity).toBe(50);
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
  it('Tenant A cannot see or act on Tenant B sale returns / purchase returns / adjustments', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const productB = await createProductViaApi(app, ownerB.accessToken, { name: 'Tenant B Product' });
    const customerB = await createCustomerViaApi(app, ownerB.accessToken);
    const supplierB = await createSupplierViaApi(app, ownerB.accessToken);
    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ productId: productB._id, quantity: 500 })
      .expect(201);

    const saleB = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ customerId: customerB._id, items: [{ productId: productB._id, quantity: 50, unitPrice: 10 }] })
      .expect(201);
    const purchaseB = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ supplierId: supplierB._id, items: [{ productId: productB._id, quantity: 50, unitPrice: 10 }] })
      .expect(201);

    // Owner A cannot adjust Tenant B's product.
    const adjustRes = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ productId: productB._id, type: 'IN', quantity: 5, reason: 'test' });
    expect(adjustRes.status).toBe(404);

    // Owner A cannot return items on Tenant B's sale or purchase.
    const saleReturnRes = await request(app)
      .post(`/api/v1/sales/${saleB.body.data._id}/returns`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ items: [{ saleItemId: '65f000000000000000000000', quantity: 1 }] });
    expect(saleReturnRes.status).toBe(404);

    const purchaseReturnRes = await request(app)
      .post(`/api/v1/purchases/${purchaseB.body.data._id}/returns`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ items: [{ purchaseItemId: '65f000000000000000000000', quantity: 1 }] });
    expect(purchaseReturnRes.status).toBe(404);

    // Owner A cannot list Tenant B's returns either.
    const listSaleReturnsRes = await request(app)
      .get(`/api/v1/sales/${saleB.body.data._id}/returns`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listSaleReturnsRes.status).toBe(404);

    const listPurchaseReturnsRes = await request(app)
      .get(`/api/v1/purchases/${purchaseB.body.data._id}/returns`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listPurchaseReturnsRes.status).toBe(404);

    // Tenant B's product must be untouched by any of Owner A's attempts.
    expect(await currentStock(ownerB, productB._id)).toBe(500); // 500 opening - 50 sold + 50 purchased
  });
});
