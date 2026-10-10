import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
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

async function getCategoryAndUnit(owner: { accessToken: string }) {
  const [categoriesRes, unitsRes] = await Promise.all([
    request(app).get('/api/v1/categories').set('Authorization', `Bearer ${owner.accessToken}`),
    request(app).get('/api/v1/units').set('Authorization', `Bearer ${owner.accessToken}`),
  ]);
  return {
    categoryId: categoriesRes.body.data[0]._id as string,
    unitId: unitsRes.body.data[0]._id as string,
  };
}

describe('POST /api/v1/products', () => {
  it('creates a product with a zero-stock Inventory record and no inventory transaction', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'OPC 53 Cement',
        sku: 'CEM-OPC-53',
        categoryId,
        unitId,
        lowStockThreshold: 100,
        purchasePrice: 380,
        sellingPrice: 420,
        description: 'OPC 53 grade cement',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('OPC 53 Cement');
    expect(res.body.data.sku).toBe('CEM-OPC-53');
    // tenantId must never be accepted from the client and must never leak
    // a different tenant's id back either — implicitly covered by the
    // tenant-isolation test below, but the create response itself should
    // reflect the caller's own tenant.
    const productId = res.body.data._id as string;

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.status).toBe(200);
    expect(inventoryRes.body.data.currentStock).toBe(0);
    expect(inventoryRes.body.data.status).toBe('OUT_OF_STOCK');

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${productId}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ledgerRes.body.data.transactions).toHaveLength(0);

    const listRes = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const row = listRes.body.data.find((r: { name: string }) => r.name === 'OPC 53 Cement');
    expect(row).toBeDefined();
    expect(row.currentStock).toBe(0);
    expect(row.status).toBe('OUT_OF_STOCK');
  });

  it('SKU is case-insensitive-unique and stored uppercase', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement', sku: 'cem-001', categoryId, unitId, lowStockThreshold: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('CEM-001');
  });

  it('rejects a duplicate SKU within the same tenant with a clear message', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);

    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement A', sku: 'CEM-DUP', categoryId, unitId, lowStockThreshold: 10 })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement B', sku: 'CEM-DUP', categoryId, unitId, lowStockThreshold: 10 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Product SKU already exists.');
    // Never leak the raw Mongo error shape.
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|duplicate key/i);
  });

  it('rejects an invalid category', async () => {
    const { owner } = await setupTenantOwner();
    const { unitId } = await getCategoryAndUnit(owner);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Cement',
        sku: 'CEM-BADCAT',
        categoryId: '65f000000000000000000000',
        unitId,
        lowStockThreshold: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/i);
  });

  it('rejects an invalid unit', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId } = await getCategoryAndUnit(owner);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Cement',
        sku: 'CEM-BADUNIT',
        categoryId,
        unitId: '65f000000000000000000000',
        lowStockThreshold: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unit/i);
  });

  it('rejects missing required fields', async () => {
    const { owner } = await setupTenantOwner();

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement' });

    expect(res.status).toBe(400);
  });

  it('a Sales Person cannot create a product (403)', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const { categoryId, unitId } = await getCategoryAndUnit(owner);

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
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ name: 'Cement', sku: 'CEM-SP', categoryId, unitId, lowStockThreshold: 10 });

    expect(res.status).toBe(403);
  });

  it('rejects a spoofed tenantId in the request body — product is created under the caller tenant', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const { categoryId, unitId } = await getCategoryAndUnit(ownerA);

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        name: 'Cement',
        sku: 'CEM-SPOOF',
        categoryId,
        unitId,
        lowStockThreshold: 10,
        tenantId: tenantB.tenantId,
      });

    expect(res.status).toBe(201);
    expect(String(res.body.data.tenantId)).toBe(tenantA.tenantId);
    expect(String(res.body.data.tenantId)).not.toBe(tenantB.tenantId);
  });
});

describe('PATCH /api/v1/products/:id', () => {
  it('updates product fields', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);
    const createRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement', sku: 'CEM-EDIT', categoryId, unitId, lowStockThreshold: 10 })
      .expect(201);
    const productId = createRes.body.data._id as string;

    const res = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'OPC 53 Cement', sellingPrice: 450, lowStockThreshold: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('OPC 53 Cement');
    expect(Number(res.body.data.sellingPrice)).toBe(450);
    expect(res.body.data.lowStockThreshold).toBe(50);
    // SKU untouched by a partial update that didn't include it.
    expect(res.body.data.sku).toBe('CEM-EDIT');
  });

  it('editing a product never changes its current stock', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);
    const createRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Cement', sku: 'CEM-STOCKCHECK', categoryId, unitId, lowStockThreshold: 10 })
      .expect(201);
    const productId = createRes.body.data._id as string;

    await stockViaPurchase(app, owner.accessToken, productId, 500);

    await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed Cement' })
      .expect(200);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${productId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inventoryRes.body.data.currentStock).toBe(500);
  });

  it('rejects renaming SKU to one already used by another product', async () => {
    const { owner } = await setupTenantOwner();
    const { categoryId, unitId } = await getCategoryAndUnit(owner);
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Product A', sku: 'SKU-A', categoryId, unitId, lowStockThreshold: 10 })
      .expect(201);
    const productB = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Product B', sku: 'SKU-B', categoryId, unitId, lowStockThreshold: 10 })
      .expect(201);

    const res = await request(app)
      .patch(`/api/v1/products/${productB.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ sku: 'SKU-A' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Product SKU already exists.');
  });

  it('rejects an unknown product id', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .patch('/api/v1/products/65f000000000000000000000')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('tenant isolation for products/categories/units', () => {
  it('Tenant A cannot update or see Tenant B products, and cannot use Tenant B category/unit ids', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const { categoryId: categoryB, unitId: unitB } = await getCategoryAndUnit(ownerB);
    const productB = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        name: 'Tenant B Product',
        sku: 'TB-001',
        categoryId: categoryB,
        unitId: unitB,
        lowStockThreshold: 10,
      })
      .expect(201);

    // Owner A cannot create a product using Tenant B's category/unit ids.
    const crossTenantCreate = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        name: 'Sneaky',
        sku: 'SNEAKY-1',
        categoryId: categoryB,
        unitId: unitB,
        lowStockThreshold: 10,
      });
    expect(crossTenantCreate.status).toBe(400);

    // Owner A cannot edit Tenant B's product.
    const crossTenantEdit = await request(app)
      .patch(`/api/v1/products/${productB.body.data._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Hijacked' });
    expect(crossTenantEdit.status).toBe(404);

    // Owner A cannot see Tenant B's product in listings.
    const listRes = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(
      listRes.body.data.find((p: { name: string }) => p.name === 'Tenant B Product')
    ).toBeUndefined();
  });
});

describe('category and unit create endpoints', () => {
  it('creates a category and it is immediately usable to create a product', async () => {
    const { owner } = await setupTenantOwner();
    const { unitId } = await getCategoryAndUnit(owner);

    const categoryRes = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Plumbing' });
    expect(categoryRes.status).toBe(201);
    expect(categoryRes.body.data.name).toBe('Plumbing');

    const productRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'PVC Pipe',
        sku: 'PVC-1',
        categoryId: categoryRes.body.data._id,
        unitId,
        lowStockThreshold: 5,
      });
    expect(productRes.status).toBe(201);
  });

  it('rejects a duplicate category name within the tenant', async () => {
    const { owner } = await setupTenantOwner();
    await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Plumbing' })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Plumbing' });
    expect(res.status).toBe(409);
  });

  it('creates a unit', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/units')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Litre', symbol: 'ltr' });
    expect(res.status).toBe(201);
    expect(res.body.data.symbol).toBe('ltr');
  });
});

describe('DELETE /api/v1/categories/:id and /api/v1/units/:id', () => {
  for (const kind of ['categories', 'units'] as const) {
    it(`deletes an unused ${kind} entry so it leaves the list and its name can be reused`, async () => {
      const { owner } = await setupTenantOwner();
      const body =
        kind === 'categories' ? { name: 'Temp Entry' } : { name: 'Temp Entry', symbol: 'tmp' };
      const created = await request(app)
        .post(`/api/v1/${kind}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(body)
        .expect(201);

      await request(app)
        .delete(`/api/v1/${kind}/${created.body.data._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      const list = await request(app)
        .get(`/api/v1/${kind}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(list.body.data.some((e: { name: string }) => e.name === 'Temp Entry')).toBe(false);

      await request(app)
        .post(`/api/v1/${kind}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(body)
        .expect(201);
    });

    it(`refuses to delete a ${kind} entry that a product still uses (409)`, async () => {
      const { owner } = await setupTenantOwner();
      // createProductViaApi uses the first entry of each list.
      await createProductViaApi(app, owner.accessToken);
      const list = await request(app)
        .get(`/api/v1/${kind}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      const res = await request(app)
        .delete(`/api/v1/${kind}/${list.body.data[0]._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/1 product uses/);
    });

    it(`cannot delete another tenant's ${kind} entry (404)`, async () => {
      const { owner: ownerA } = await setupTenantOwner();
      const { owner: ownerB } = await setupTenantOwner();
      const listB = await request(app)
        .get(`/api/v1/${kind}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);

      await request(app)
        .delete(`/api/v1/${kind}/${listB.body.data[0]._id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(404);
    });
  }
});
