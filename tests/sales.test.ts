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

describe('POST /api/v1/sales', () => {
  it('atomically decreases stock and records a SALE ledger entry with correct previous/resulting stock', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 700);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 420 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.saleNumber).toMatch(/^SL-\d{6}$/);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(42000, 2);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(600); // 700 - 100

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const saleTxn = ledgerRes.body.data.transactions.find(
      (t: { type: string }) => t.type === 'SALE'
    );
    expect(saleTxn).toBeDefined();
    expect(saleTxn.quantity).toBe(100);
    expect(saleTxn.previousStock).toBe(700);
    expect(saleTxn.resultingStock).toBe(600);
    expect(saleTxn.referenceType).toBe('SALE');
    expect(saleTxn.referenceId).toBe(res.body.data._id);
  });

  it('rejects the entire sale when requested quantity exceeds available stock, leaving everything unchanged', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 50);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 60, unitPrice: 10 }],
      });

    expect(res.status).toBe(409);

    // Nothing committed: no sale, no inventory change, no new ledger entry.
    const salesRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(salesRes.body.data).toHaveLength(0);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(50);

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(
      ledgerRes.body.data.transactions.filter((t: { type: string }) => t.type === 'SALE')
    ).toHaveLength(0);
  });

  it('never allows stock to go negative even when the item is one of several in the sale', async () => {
    const { owner } = await setupTenantOwner();
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, cement._id, 500);
    await stockProduct(owner, steel._id, 10); // not enough for the sale below

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [
          { productId: cement._id, quantity: 100, unitPrice: 420 },
          { productId: steel._id, quantity: 500, unitPrice: 75 },
        ],
      });

    expect(res.status).toBe(409);

    // Cement must be untouched even though it had enough stock — the whole
    // sale fails together.
    const cementInventory = await request(app)
      .get(`/api/v1/inventory/${cement._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(cementInventory.body.data.currentStock).toBe(500);

    const steelInventory = await request(app)
      .get(`/api/v1/inventory/${steel._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(steelInventory.body.data.currentStock).toBe(10);

    const salesRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(salesRes.body.data).toHaveLength(0);
  });

  it('supports multiple products in a single sale, each decreasing its own stock atomically', async () => {
    const { owner } = await setupTenantOwner();
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    const bricks = await createProductViaApi(app, owner.accessToken, { name: 'Bricks' });
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, cement._id, 500);
    await stockProduct(owner, steel._id, 1000);
    await stockProduct(owner, bricks._id, 5000);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [
          { productId: cement._id, quantity: 100, unitPrice: 420 },
          { productId: steel._id, quantity: 500, unitPrice: 75 },
          { productId: bricks._id, quantity: 1000, unitPrice: 9 },
        ],
      });

    expect(res.status).toBe(201);
    // subtotal = 100*420 + 500*75 + 1000*9 = 42000 + 37500 + 9000 = 88500
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(88500, 2);

    const [cementInv, steelInv, bricksInv] = await Promise.all(
      [cement, steel, bricks].map((p) =>
        request(app)
          .get(`/api/v1/inventory/${p._id}`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
      )
    );
    expect(cementInv.body.data.currentStock).toBe(400);
    expect(steelInv.body.data.currentStock).toBe(500);
    expect(bricksInv.body.data.currentStock).toBe(4000);
  });

  it('rejects a sale for an unknown customer', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: '65f000000000000000000000',
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });

    expect(res.status).toBe(404);
  });

  it('rejects a sale to a deactivated customer', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    await request(app)
      .patch(`/api/v1/customers/${customer._id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });

    expect(res.status).toBe(400);
  });

  it('rolls back the entire sale if one line item references an invalid product', async () => {
    const { owner } = await setupTenantOwner();
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Rollback Cement' });
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, cement._id, 500);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [
          { productId: cement._id, quantity: 100, unitPrice: 420 },
          { productId: '65f000000000000000000000', quantity: 10, unitPrice: 10 },
        ],
      });

    expect(res.status).toBe(404);

    const listRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listRes.body.data).toHaveLength(0);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${cement._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(500);
  });

  it('a Sales Person can create a sale but cannot create a purchase', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
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

    const saleRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });
    expect(saleRes.status).toBe(201);

    const purchaseRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({
        supplierId: '65f000000000000000000000',
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });
    expect(purchaseRes.status).toBe(403);
  });

  it('under concurrent sales for the same product, only one succeeds when combined demand exceeds stock', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          customerId: customer._id,
          items: [{ productId: product._id, quantity: 80, unitPrice: 10 }],
        }),
      request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          customerId: customer._id,
          items: [{ productId: product._id, quantity: 50, unitPrice: 10 }],
        }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one of the two concurrent sales succeeds (80 + 50 > 100); the
    // other is rejected as insufficient stock. Never both, never neither.
    expect(statuses).toEqual([201, 409]);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const successfulSale = resA.status === 201 ? resA : resB;
    const soldQuantity = successfulSale.status === 201 ? (resA.status === 201 ? 80 : 50) : 0;
    expect(inventoryRes.body.data.currentStock).toBe(100 - soldQuantity);

    const salesRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(salesRes.body.data).toHaveLength(1);
  });

  it('GET /api/v1/sales/:id returns the sale with populated customer, items, and creator', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken, 'Detail Test Customer');
    await stockProduct(owner, product._id, 100);

    const createRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 50 }],
        notes: 'Handle with care',
      });
    const saleId = createRes.body.data._id as string;

    const res = await request(app)
      .get(`/api/v1/sales/${saleId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sale._id).toBe(saleId);
    expect(res.body.data.sale.customerId.name).toBe('Detail Test Customer');
    expect(res.body.data.sale.createdBy.name).toBeDefined();
    expect(res.body.data.sale.notes).toBe('Handle with care');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(10);
    expect(res.body.data.items[0].productId.name).toBeDefined();
  });

  it('GET /api/v1/sales supports search by sale number and filtering by customer', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customerA = await createCustomerViaApi(app, owner.accessToken, 'Customer A');
    const customerB = await createCustomerViaApi(app, owner.accessToken, 'Customer B');
    await stockProduct(owner, product._id, 1000);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customerA._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);

    const byCustomer = await request(app)
      .get(`/api/v1/sales?customerId=${customerA._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byCustomer.body.data).toHaveLength(1);
    expect(byCustomer.body.data[0].customerId.name).toBe('Customer A');

    const bySearch = await request(app)
      .get(`/api/v1/sales?search=${byCustomer.body.data[0].saleNumber}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(bySearch.body.data).toHaveLength(1);
  });
});

describe('tenant isolation for sales/customers', () => {
  it('Tenant A cannot see Tenant B customers or sales', async () => {
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
    const customerB = await createCustomerViaApi(app, ownerB.accessToken, 'Tenant B Customer');
    await stockProduct(ownerB, productB._id, 100);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: productB._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);

    const customersRes = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(
      customersRes.body.data.find((c: { name: string }) => c.name === 'Tenant B Customer')
    ).toBeUndefined();

    const salesRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(salesRes.body.data).toHaveLength(0);

    const customerDirectRes = await request(app)
      .get(`/api/v1/customers/${customerB._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(customerDirectRes.status).toBe(404);
  });
});

describe('customer management', () => {
  it('creates, lists, searches, retrieves, updates, and deactivates a customer', async () => {
    const { owner } = await setupTenantOwner();

    const createRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Zzzyx Traders',
        mobileNumber: '9123456780',
        email: 'traders@example.com',
        gstNumber: '29ABCDE1234F1Z5',
        notes: 'Prefers cash on delivery',
      });
    expect(createRes.status).toBe(201);
    const customerId = createRes.body.data._id as string;

    const listRes = await request(app)
      .get('/api/v1/customers?search=Zzzyx')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]._id).toBe(customerId);

    const getRes = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getRes.body.data.email).toBe('traders@example.com');

    const updateRes = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ address: { city: 'Mumbai' } });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.address.city).toBe('Mumbai');
    // Fields not included in a partial update must remain untouched.
    expect(updateRes.body.data.name).toBe('Zzzyx Traders');

    const deactivateRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.data.isActive).toBe(false);
  });

  it('rejects an unknown customer id with 404', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/customers/65f000000000000000000000')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(404);
  });
});
