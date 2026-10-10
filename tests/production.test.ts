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

describe('Low stock / out of stock notifications', () => {
  it('creates a LOW_STOCK alert once stock drops to the threshold, and OUT_OF_STOCK at zero', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken, { lowStockThreshold: 5 });
    await stockProduct(owner, product._id, 10);

    // Sell down to 5 (== threshold) -> LOW_STOCK.
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 5, unitPrice: 10 }],
      })
      .expect(201);

    const afterLow = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(afterLow.body.data.unreadCount).toBe(1);
    expect(afterLow.body.data.notifications[0].type).toBe('LOW_STOCK');

    // Sell the rest -> OUT_OF_STOCK, and the LOW_STOCK alert is resolved.
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 5, unitPrice: 10 }],
      })
      .expect(201);

    const afterOut = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const unread = afterOut.body.data.notifications.filter((n: { isRead: boolean }) => !n.isRead);
    expect(unread).toHaveLength(1);
    expect(unread[0].type).toBe('OUT_OF_STOCK');
  });

  it('does not create duplicate unread alerts for the same product', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken, { lowStockThreshold: 100 });
    await stockProduct(owner, product._id, 100);

    // Two sales, both leaving stock under the threshold.
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 10 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('resolves the alert once stock recovers above the threshold', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Restock Supplier' })
      .expect(201);
    const product = await createProductViaApi(app, owner.accessToken, { lowStockThreshold: 5 });
    await stockProduct(owner, product._id, 3); // already below threshold at creation

    const before = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(before.body.data.unreadCount).toBe(1);

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier.body.data._id,
        items: [{ productId: product._id, quantity: 50, unitPrice: 10 }],
      })
      .expect(201);

    const after = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it('marks a single notification and all notifications as read, tenant-isolated', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, ownerA.accessToken);
    const product = await createProductViaApi(app, ownerA.accessToken, { lowStockThreshold: 5 });
    await stockProduct(ownerA, product._id, 5);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 1, unitPrice: 10 }],
      })
      .expect(201);

    const listA = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    const notificationId = listA.body.data.notifications[0]._id as string;

    // Tenant B never sees Tenant A's notification, even by id.
    const readAsB = await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(readAsB.status).toBe(200); // updateOne on a non-matching filter is a no-op, not an error
    const listBUnaffected = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listBUnaffected.body.data.unreadCount).toBe(1);

    await request(app)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    const listAAfter = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listAAfter.body.data.unreadCount).toBe(0);
  });
});

describe('Business Settings', () => {
  it('an Owner can view and update their own business settings', async () => {
    const { owner } = await setupTenantOwner();

    const getRes = await request(app)
      .get('/api/v1/business-settings')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.invoicePrefix).toBe('INV');

    const updateRes = await request(app)
      .patch('/api/v1/business-settings')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        businessName: 'Updated Business Name',
        gstNumber: '29ABCDE1234F1Z5',
        address: { state: 'Karnataka', city: 'Bengaluru' },
        invoicePrefix: 'SHOP',
        invoiceFooterNote: 'Thank you for your business!',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.businessName).toBe('Updated Business Name');
    expect(updateRes.body.data.invoicePrefix).toBe('SHOP');
    expect(updateRes.body.data.address.state).toBe('Karnataka');
  });

  it('a Sales Person cannot view or update business settings', async () => {
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
      .get('/api/v1/business-settings')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`);
    expect(res.status).toBe(403);
    void owner;
  });

  it('tenant isolation: updating business settings never leaks across tenants', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();

    await request(app)
      .patch('/api/v1/business-settings')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ businessName: 'Tenant A Name' })
      .expect(200);

    const settingsB = await request(app)
      .get('/api/v1/business-settings')
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(settingsB.body.data.businessName).not.toBe('Tenant A Name');
  });
});

describe('CSV exports', () => {
  it('exports sales as CSV with a header row and tenant-isolated data', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const customerA = await createCustomerViaApi(app, ownerA.accessToken, 'Export Customer A');
    const productA = await createProductViaApi(app, ownerA.accessToken);
    await stockProduct(ownerA, productA._id, 100);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        customerId: customerA._id,
        items: [{ productId: productA._id, quantity: 1, unitPrice: 500 }],
      })
      .expect(201);

    const customerB = await createCustomerViaApi(app, ownerB.accessToken, 'Export Customer B');
    const productB = await createProductViaApi(app, ownerB.accessToken);
    await stockProduct(ownerB, productB._id, 100);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: productB._id, quantity: 1, unitPrice: 999 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/exports/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('Sale Number');
    expect(lines).toHaveLength(2); // header + tenant A's one sale
    expect(res.text).toContain('Export Customer A');
    expect(res.text).not.toContain('Export Customer B');
  });

  it('exports respect a date-range filter', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 1, unitPrice: 100 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/exports/sales?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(1); // header only
  });

  it('exports purchases, inventory, customers, and suppliers as CSV', async () => {
    const { owner } = await setupTenantOwner();
    const supplier = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'CSV Supplier' })
      .expect(201);
    const product = await createProductViaApi(app, owner.accessToken, { name: 'CSV Product' });
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier.body.data._id,
        items: [{ productId: product._id, quantity: 10, unitPrice: 50 }],
      })
      .expect(201);
    await createCustomerViaApi(app, owner.accessToken, 'CSV Customer');

    const [purchasesCsv, inventoryCsv, customersCsv, suppliersCsv] = await Promise.all([
      request(app)
        .get('/api/v1/exports/purchases')
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .get('/api/v1/exports/inventory')
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .get('/api/v1/exports/customers')
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app)
        .get('/api/v1/exports/suppliers')
        .set('Authorization', `Bearer ${owner.accessToken}`),
    ]);

    expect(purchasesCsv.text).toContain('CSV Supplier');
    expect(inventoryCsv.text).toContain('CSV Product');
    expect(customersCsv.text).toContain('CSV Customer');
    expect(suppliersCsv.text).toContain('CSV Supplier');
  });

  it('a Sales Person cannot export sales data (403)', async () => {
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
      .get('/api/v1/exports/sales')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`);
    expect(res.status).toBe(403);
    void owner;
  });
});

describe('Tenant-scoped audit log', () => {
  it('an Owner sees only their own tenant audit log entries', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    await createProductViaApi(app, ownerA.accessToken, { name: 'Audit Product A' });
    await createProductViaApi(app, ownerB.accessToken, { name: 'Audit Product B' });

    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const entry of res.body.data) {
      expect(entry.tenantId).toBe(ownerA.user.tenantId);
    }
  });

  it('a tenantId query param is ignored for a non-SUPER_ADMIN caller', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB, tenant: tenantB } = await setupTenantOwner();
    await createProductViaApi(app, ownerB.accessToken, { name: 'Should Not Leak' });

    const res = await request(app)
      .get(`/api/v1/audit-logs?tenantId=${tenantB.tenantId}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(res.status).toBe(200);
    const leaked = res.body.data.some(
      (entry: { changes?: { after?: { name?: string } } }) =>
        entry.changes?.after?.name === 'Should Not Leak'
    );
    expect(leaked).toBe(false);
  });

  it('a Sales Person cannot view the audit log (403)', async () => {
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
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`);
    expect(res.status).toBe(403);
    void owner;
  });
});

describe('Purchases list filtering (previously unfiltered)', () => {
  it('filters purchases by date range and supplier', async () => {
    const { owner } = await setupTenantOwner();
    const supplierA = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Filter Supplier A' })
      .expect(201);
    const supplierB = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Filter Supplier B' })
      .expect(201);
    const product = await createProductViaApi(app, owner.accessToken);

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplierA.body.data._id,
        items: [{ productId: product._id, quantity: 1, unitPrice: 100 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplierB.body.data._id,
        items: [{ productId: product._id, quantity: 1, unitPrice: 100 }],
      })
      .expect(201);

    const bySupplier = await request(app)
      .get(`/api/v1/purchases?supplierId=${supplierA.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(bySupplier.body.data).toHaveLength(1);

    const futureOnly = await request(app)
      .get('/api/v1/purchases?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(futureOnly.body.data).toHaveLength(0);
  });
});
