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

async function setupSalesPerson() {
  const superAdminMobile = nextMobileNumber();
  await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
  const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
  const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
  const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);

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
  return { owner, salesPerson, tenant };
}

describe('POST /api/v1/suppliers', () => {
  it('creates a supplier with all fields', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'ACME Building Materials',
        contactPerson: 'Raj Kumar',
        mobileNumber: '9123456789',
        email: 'raj@acme.example',
        address: { city: 'Mumbai', state: 'Maharashtra' },
        gstNumber: '27ABCDE1234F1Z5',
        notes: 'Prefers advance payment',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('ACME Building Materials');
    expect(res.body.data.contactPerson).toBe('Raj Kumar');
    expect(res.body.data.isActive).toBe(true);
  });

  it('rejects a supplier with no name', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ contactPerson: 'No Name Here' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid email', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Bad Email Supplier', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('a Sales Person cannot create or list suppliers (403)', async () => {
    const { salesPerson } = await setupSalesPerson();
    const createRes = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ name: 'Sneaky Supplier' });
    expect(createRes.status).toBe(403);

    const listRes = await request(app)
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`);
    expect(listRes.status).toBe(403);
  });
});

describe('PATCH /api/v1/suppliers/:id', () => {
  it('updates supplier fields', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken, 'Original Name');

    const res = await request(app)
      .patch(`/api/v1/suppliers/${supplier._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed Supplier', contactPerson: 'New Contact' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Supplier');
    expect(res.body.data.contactPerson).toBe('New Contact');
  });

  it('rejects an unknown supplier id', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .patch('/api/v1/suppliers/65f000000000000000000000')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/suppliers/:id/status', () => {
  it('deactivates and reactivates a supplier', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    const deactivateRes = await request(app)
      .patch(`/api/v1/suppliers/${supplier._id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.data.isActive).toBe(false);

    // Deactivated suppliers no longer appear in the default (active-only) list.
    const activeListRes = await request(app)
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(
      activeListRes.body.data.find((s: { _id: string }) => s._id === supplier._id)
    ).toBeUndefined();

    // But they do appear with status=all or status=inactive.
    const allListRes = await request(app)
      .get('/api/v1/suppliers?status=all')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(allListRes.body.data.find((s: { _id: string }) => s._id === supplier._id)).toBeDefined();

    const reactivateRes = await request(app)
      .patch(`/api/v1/suppliers/${supplier._id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: true });
    expect(reactivateRes.body.data.isActive).toBe(true);
  });

  it('an inactive supplier cannot be used for a new purchase', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);

    await request(app)
      .patch(`/api/v1/suppliers/${supplier._id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/suppliers search and pagination', () => {
  it('searches suppliers by name', async () => {
    const { owner } = await setupTenantOwner();
    await createSupplierViaApi(app, owner.accessToken, 'Zzzyx Cement Traders');
    await createSupplierViaApi(app, owner.accessToken, 'Totally Different Co');

    const res = await request(app)
      .get('/api/v1/suppliers?search=Zzzyx')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Zzzyx Cement Traders');
  });

  it('paginates suppliers', async () => {
    const { owner } = await setupTenantOwner();
    for (let i = 0; i < 5; i += 1) {
      await createSupplierViaApi(app, owner.accessToken, `Supplier ${i}`);
    }
    const res = await request(app)
      .get('/api/v1/suppliers?page=1&limit=2')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(5);
    expect(res.body.meta.totalPages).toBe(3);
  });
});

describe('tenant isolation for suppliers', () => {
  it('Tenant A cannot see, edit, or deactivate Tenant B suppliers', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const supplierB = await createSupplierViaApi(app, ownerB.accessToken, 'Tenant B Supplier');

    const getRes = await request(app)
      .get(`/api/v1/suppliers/${supplierB._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(getRes.status).toBe(404);

    const editRes = await request(app)
      .patch(`/api/v1/suppliers/${supplierB._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Hijacked' });
    expect(editRes.status).toBe(404);

    const statusRes = await request(app)
      .patch(`/api/v1/suppliers/${supplierB._id}/status`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ isActive: false });
    expect(statusRes.status).toBe(404);

    const listRes = await request(app)
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(
      listRes.body.data.find((s: { name: string }) => s.name === 'Tenant B Supplier')
    ).toBeUndefined();

    const historyRes = await request(app)
      .get(`/api/v1/suppliers/${supplierB._id}/purchases`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(historyRes.status).toBe(404);
  });
});

describe('GET /api/v1/suppliers/:id/purchases', () => {
  it('computes purchase history summary and outstanding amount correctly', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        invoiceNumber: 'INV-001',
        items: [{ productId: cement._id, quantity: 200, unitPrice: 380 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: steel._id, quantity: 100, unitPrice: 75 }],
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/suppliers/${supplier._id}/purchases`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalPurchases).toBe(2);
    expect(res.body.data.summary.totalQuantityPurchased).toBe(300);
    // 200*380=76000 + 100*75=7500 = 83500
    expect(res.body.data.summary.totalAmount).toBeCloseTo(83500, 2);
    // Nothing paid yet — fully outstanding.
    expect(res.body.data.summary.outstandingAmount).toBeCloseTo(83500, 2);
    expect(res.body.data.purchases).toHaveLength(2);
    expect(res.body.data.purchases[0].createdBy.name).toBeDefined();

    const invoiceOne = res.body.data.purchases.find(
      (p: { invoiceNumber?: string }) => p.invoiceNumber === 'INV-001'
    );
    expect(invoiceOne).toBeDefined();
  });

  it('filters purchase history by date range', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);

    const futureOnly = await request(app)
      .get(`/api/v1/suppliers/${supplier._id}/purchases?fromDate=2099-01-01`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(futureOnly.body.data.purchases).toHaveLength(0);
    expect(futureOnly.body.data.summary.totalPurchases).toBe(0);
  });

  it('returns a zeroed summary for a supplier with no purchases yet', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/suppliers/${supplier._id}/purchases`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalPurchases).toBe(0);
    expect(res.body.data.summary.totalAmount).toBe(0);
    expect(res.body.data.summary.outstandingAmount).toBe(0);
  });
});

describe('Purchase enhancements: invoice number, notes, and inventory impact', () => {
  it('stores and returns invoiceNumber and notes', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);

    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        invoiceNumber: 'SUP-INV-42',
        notes: 'Delivered by truck, minor packaging damage',
        items: [{ productId: product._id, quantity: 50, unitPrice: 100 }],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.invoiceNumber).toBe('SUP-INV-42');
    expect(createRes.body.data.notes).toBe('Delivered by truck, minor packaging damage');

    const detailRes = await request(app)
      .get(`/api/v1/purchases/${createRes.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detailRes.body.data.purchase.invoiceNumber).toBe('SUP-INV-42');
    expect(detailRes.body.data.purchase.createdBy.name).toBeDefined();
  });

  it('creating a purchase without an invoice number still works (backward compatible)', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceNumber).toBeUndefined();
  });

  it('purchase details include inventory impact (previous/resulting stock) per item', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });

    await stockViaPurchase(app, owner.accessToken, cement._id, 500);

    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [
          { productId: cement._id, quantity: 200, unitPrice: 380 },
          { productId: steel._id, quantity: 100, unitPrice: 75 },
        ],
      })
      .expect(201);

    const detailRes = await request(app)
      .get(`/api/v1/purchases/${createRes.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const cementItem = detailRes.body.data.items.find(
      (i: { productId: { name: string } }) => i.productId.name === 'Cement'
    );
    expect(cementItem.inventoryImpact.previousStock).toBe(500);
    expect(cementItem.inventoryImpact.resultingStock).toBe(700);

    const steelItem = detailRes.body.data.items.find(
      (i: { productId: { name: string } }) => i.productId.name === 'Steel'
    );
    expect(steelItem.inventoryImpact.previousStock).toBe(0);
    expect(steelItem.inventoryImpact.resultingStock).toBe(100);
  });

  it('multiple purchase items all increase inventory and produce correct ledger entries', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    const bricks = await createProductViaApi(app, owner.accessToken, { name: 'Bricks' });

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [
          { productId: cement._id, quantity: 100, unitPrice: 380, taxRate: 5 },
          { productId: steel._id, quantity: 50, unitPrice: 75 },
          { productId: bricks._id, quantity: 1000, unitPrice: 9 },
        ],
      });
    expect(res.status).toBe(201);
    // subtotal = 38000 + 3750 + 9000 = 50750; tax = 5% of 38000 = 1900
    expect(Number(res.body.data.subTotal)).toBeCloseTo(50750, 2);
    expect(Number(res.body.data.taxAmount)).toBeCloseTo(1900, 2);
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(52650, 2);

    for (const [product, expectedStock] of [
      [cement, 100],
      [steel, 50],
      [bricks, 1000],
    ] as const) {
      const inventoryRes = await request(app)
        .get(`/api/v1/inventory/${product._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(inventoryRes.body.data.currentStock).toBe(expectedStock);
    }
  });
});
