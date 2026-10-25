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

describe('GET /api/v1/reports/dashboard', () => {
  it('returns all zeros for a brand-new tenant with no data', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalProducts).toBe(0);
    expect(res.body.data.totalStockQuantity).toBe(0);
    expect(res.body.data.totalStockValue).toBe(0);
    expect(res.body.data.lowStockProducts).toBe(0);
    expect(res.body.data.outOfStockProducts).toBe(0);
    expect(res.body.data.todaysSales.amount).toBe(0);
    expect(res.body.data.todaysPurchases.amount).toBe(0);
  });

  it('reflects products, stock value, low/out-of-stock counts, and today activity', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);

    // In stock, healthy.
    const healthy = await createProductViaApi(app, owner.accessToken, {
      name: 'Healthy Stock',
      lowStockThreshold: 50,
      purchasePrice: 100,
    });
    await stockProduct(owner, healthy._id, 500); // value = 500*100 = 50000

    // Low stock.
    const low = await createProductViaApi(app, owner.accessToken, {
      name: 'Low Stock',
      lowStockThreshold: 50,
      purchasePrice: 10,
    });
    await stockProduct(owner, low._id, 20); // value = 20*10 = 200

    // Never stocked -> out of stock, contributes 0 value.
    await createProductViaApi(app, owner.accessToken, {
      name: 'Never Stocked',
      purchasePrice: 999,
    });

    // Today's sale and purchase.
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: healthy._id, quantity: 10, unitPrice: 150 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: low._id, quantity: 5, unitPrice: 10 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalProducts).toBe(3);
    // 500 + 20 - (10 sold) + (5 purchased) = 515
    expect(res.body.data.totalStockQuantity).toBe(515);
    expect(res.body.data.lowStockProducts).toBe(1);
    expect(res.body.data.outOfStockProducts).toBe(1);
    expect(res.body.data.todaysSales.count).toBe(1);
    expect(res.body.data.todaysSales.amount).toBe(1500);
    // The two zero-priced stocking purchases above count too — purchases are
    // now the only way stock enters inventory.
    expect(res.body.data.todaysPurchases.count).toBe(3);
    expect(res.body.data.todaysPurchases.amount).toBe(50);
  });

  it('a Sales Person cannot access the dashboard report (403)', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);

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
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/reports/sales', () => {
  it('returns an empty report with zeroed summary when there are no sales', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/reports/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sales).toHaveLength(0);
    expect(res.body.data.summary.totalSales).toBe(0);
    expect(res.body.data.summary.netSales).toBe(0);
  });

  it('computes summary totals and supports customer/product/date filters', async () => {
    const { owner } = await setupTenantOwner();
    const customerA = await createCustomerViaApi(app, owner.accessToken, 'Customer A');
    const customerB = await createCustomerViaApi(app, owner.accessToken, 'Customer B');
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const steel = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    await stockProduct(owner, cement._id, 1000);
    await stockProduct(owner, steel._id, 1000);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customerA._id,
        discountAmount: 50,
        items: [{ productId: cement._id, quantity: 100, unitPrice: 420, taxRate: 10 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: steel._id, quantity: 50, unitPrice: 75 }],
      })
      .expect(201);

    const allRes = await request(app)
      .get('/api/v1/reports/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(allRes.body.data.summary.totalSales).toBe(2);
    expect(allRes.body.data.summary.totalQuantitySold).toBe(150);
    // sale 1: 100*420=42000 subtotal; GST is charged on the post-discount
    // taxable value (see taxCalculation.service.ts), so taxable=42000-50=
    // 41950, tax=10% of 41950=4195, total=46145.
    // sale 2: 50*75=3750
    expect(allRes.body.data.summary.netSales).toBeCloseTo(46145 + 3750, 2);
    expect(allRes.body.data.summary.totalDiscount).toBeCloseTo(50, 2);
    expect(allRes.body.data.summary.totalTax).toBeCloseTo(4195, 2);

    const byCustomer = await request(app)
      .get(`/api/v1/reports/sales?customerId=${customerA._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byCustomer.body.data.summary.totalSales).toBe(1);
    expect(byCustomer.body.data.sales[0].customer.name).toBe('Customer A');

    const byProduct = await request(app)
      .get(`/api/v1/reports/sales?productId=${steel._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(byProduct.body.data.summary.totalSales).toBe(1);
    expect(byProduct.body.data.summary.totalQuantitySold).toBe(50);

    const futureOnly = await request(app)
      .get('/api/v1/reports/sales?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(futureOnly.body.data.sales).toHaveLength(0);
    expect(futureOnly.body.data.summary.totalSales).toBe(0);
  });

  it('rejects a malformed customerId filter with a clean 400', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/reports/sales?customerId=not-an-id')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/reports/purchases', () => {
  it('computes summary totals and supports supplier/product/date filters', async () => {
    const { owner } = await setupTenantOwner();
    const supplierA = await createSupplierViaApi(app, owner.accessToken, 'Supplier A');
    const supplierB = await createSupplierViaApi(app, owner.accessToken, 'Supplier B');
    const cement = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplierA._id,
        items: [{ productId: cement._id, quantity: 200, unitPrice: 380, taxRate: 5 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplierB._id,
        items: [{ productId: cement._id, quantity: 100, unitPrice: 380 }],
      })
      .expect(201);

    const allRes = await request(app)
      .get('/api/v1/reports/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(allRes.body.data.summary.totalPurchases).toBe(2);
    expect(allRes.body.data.summary.totalQuantityPurchased).toBe(300);
    // 200*380=76000 + 5% tax=3800 -> 79800; 100*380=38000 -> total 117800
    expect(allRes.body.data.summary.netPurchaseAmount).toBeCloseTo(117800, 2);

    const bySupplier = await request(app)
      .get(`/api/v1/reports/purchases?supplierId=${supplierB._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(bySupplier.body.data.summary.totalPurchases).toBe(1);
    expect(bySupplier.body.data.purchases[0].supplier.name).toBe('Supplier B');
  });
});

describe('GET /api/v1/reports/stock', () => {
  it('classifies low/out-of-stock and filters by status, with correct summary totals', async () => {
    const { owner } = await setupTenantOwner();
    const healthy = await createProductViaApi(app, owner.accessToken, {
      name: 'Healthy',
      lowStockThreshold: 50,
      purchasePrice: 10,
    });
    await stockProduct(owner, healthy._id, 200);
    const low = await createProductViaApi(app, owner.accessToken, {
      name: 'Low',
      lowStockThreshold: 50,
      purchasePrice: 20,
    });
    await stockProduct(owner, low._id, 10);
    await createProductViaApi(app, owner.accessToken, { name: 'Never Stocked', purchasePrice: 5 });

    const allRes = await request(app)
      .get('/api/v1/reports/stock')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(allRes.body.data.summary.totalProducts).toBe(3);
    expect(allRes.body.data.summary.totalStockQuantity).toBe(210);
    expect(allRes.body.data.summary.totalStockValue).toBeCloseTo(200 * 10 + 10 * 20, 2);

    const lowRes = await request(app)
      .get('/api/v1/reports/stock?status=LOW_STOCK')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(lowRes.body.data.items).toHaveLength(1);
    expect(lowRes.body.data.items[0].name).toBe('Low');

    const outRes = await request(app)
      .get('/api/v1/reports/stock?status=OUT_OF_STOCK')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(outRes.body.data.items).toHaveLength(1);
    expect(outRes.body.data.items[0].name).toBe('Never Stocked');
    expect(outRes.body.data.items[0].currentStock).toBe(0);
    expect(outRes.body.data.items[0].stockValue).toBe(0);
  });
});

describe('GET /api/v1/reports/inventory-ledger', () => {
  it('reports IN/OUT quantities, running stock, and resolved reference numbers', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });

    const purchaseRes = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 700, unitPrice: 380 }],
      })
      .expect(201);
    const saleRes = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 420 }],
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/reports/inventory-ledger?productId=${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.summary.totalIn).toBe(700); // 700 purchase
    expect(res.body.data.summary.totalOut).toBe(100); // 100 sale

    const saleTxn = res.body.data.transactions.find((t: { type: string }) => t.type === 'SALE');
    expect(saleTxn.inQuantity).toBe(0);
    expect(saleTxn.outQuantity).toBe(100);
    expect(saleTxn.previousStock).toBe(700);
    expect(saleTxn.resultingStock).toBe(600);
    expect(saleTxn.reference.number).toBe(saleRes.body.data.saleNumber);
    expect(saleTxn.createdBy.name).toBeDefined();

    const purchaseTxn = res.body.data.transactions.find(
      (t: { type: string }) => t.type === 'PURCHASE'
    );
    expect(purchaseTxn.reference.number).toBe(purchaseRes.body.data.purchaseNumber);

    const typeFiltered = await request(app)
      .get(`/api/v1/reports/inventory-ledger?productId=${product._id}&type=SALE`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(typeFiltered.body.data.transactions).toHaveLength(1);
  });

  it('returns an empty ledger report for a tenant with no transactions', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/reports/inventory-ledger')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(0);
    expect(res.body.data.summary.totalIn).toBe(0);
    expect(res.body.data.summary.totalOut).toBe(0);
  });
});

describe('GET /api/v1/reports/profit', () => {
  it('computes revenue, COGS, gross profit, and margin from actual sale/purchase data', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken, {
      name: 'Cement',
      purchasePrice: 300,
    });
    await stockProduct(owner, product._id, 500);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 420 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.salesRevenue).toBe(42000); // 100*420
    expect(res.body.data.costOfGoodsSold).toBe(30000); // 100*300
    expect(res.body.data.grossProfit).toBe(12000);
    expect(res.body.data.grossMarginPercent).toBeCloseTo((12000 / 42000) * 100, 2);
  });

  it('deducts what the sold units actually cost to purchase (100 bricks: bought ₹10, sold ₹15)', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    // purchasePrice left at its ₹0 default — the cost must come from the purchase.
    const product = await createProductViaApi(app, owner.accessToken, { name: 'Brick' });

    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        supplierId: supplier._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 10, taxRate: 0 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 15, taxRate: 0 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.data).toMatchObject({
      salesRevenue: 1500,
      costOfGoodsSold: 1000,
      grossProfit: 500,
      netProfit: 500,
    });
  });

  it('uses the weighted-average purchase cost when a product was bought at different prices', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const supplier = await createSupplierViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);

    for (const unitPrice of [10, 14]) {
      await request(app)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          supplierId: supplier._id,
          items: [{ productId: product._id, quantity: 100, unitPrice, taxRate: 0 }],
        })
        .expect(201);
    }
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 50, unitPrice: 20, taxRate: 0 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.data.costOfGoodsSold).toBe(600); // 50 × avg ₹12
    expect(res.body.data.grossProfit).toBe(400);
  });

  it('returns zeros (not NaN/Infinity) when there is no sales revenue', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.salesRevenue).toBe(0);
    expect(res.body.data.costOfGoodsSold).toBe(0);
    expect(res.body.data.grossProfit).toBe(0);
    expect(res.body.data.grossMarginPercent).toBe(0);
  });

  it('excludes sales outside the given date range', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken, { purchasePrice: 300 });
    await stockProduct(owner, product._id, 500);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 100, unitPrice: 420 }],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/profit?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.data.salesRevenue).toBe(0);
    expect(res.body.data.costOfGoodsSold).toBe(0);
  });
});

describe('reports: pagination', () => {
  it('paginates sales report results', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 10000);

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          customerId: customer._id,
          items: [{ productId: product._id, quantity: 1, unitPrice: 10 }],
        })
        .expect(201);
    }

    const page1 = await request(app)
      .get('/api/v1/reports/sales?page=1&limit=2')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page1.body.data.sales).toHaveLength(2);
    expect(page1.body.data.meta.total).toBe(5);
    expect(page1.body.data.meta.totalPages).toBe(3);
    // Summary reflects the whole filtered set, not just the current page.
    expect(page1.body.data.summary.totalSales).toBe(5);

    const page3 = await request(app)
      .get('/api/v1/reports/sales?page=3&limit=2')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page3.body.data.sales).toHaveLength(1);
  });
});

describe('tenant isolation for reports', () => {
  it('Tenant A never sees Tenant B data in any report', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const customerB = await createCustomerViaApi(app, ownerB.accessToken, 'Tenant B Customer');
    const supplierB = await createSupplierViaApi(app, ownerB.accessToken, 'Tenant B Supplier');
    const productB = await createProductViaApi(app, ownerB.accessToken, {
      name: 'Tenant B Product',
      purchasePrice: 50,
    });
    await stockProduct(ownerB, productB._id, 1000);
    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        customerId: customerB._id,
        items: [{ productId: productB._id, quantity: 100, unitPrice: 90 }],
      })
      .expect(201);
    await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({
        supplierId: supplierB._id,
        items: [{ productId: productB._id, quantity: 50, unitPrice: 50 }],
      })
      .expect(201);

    // Tenant A's dashboard must be entirely zeroed despite Tenant B's activity.
    const dashboardA = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(dashboardA.body.data.totalProducts).toBe(0);
    expect(dashboardA.body.data.todaysSales.amount).toBe(0);
    expect(dashboardA.body.data.todaysPurchases.amount).toBe(0);

    const salesA = await request(app)
      .get('/api/v1/reports/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(salesA.body.data.sales).toHaveLength(0);
    expect(salesA.body.data.summary.totalSales).toBe(0);

    const purchasesA = await request(app)
      .get('/api/v1/reports/purchases')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(purchasesA.body.data.purchases).toHaveLength(0);

    const stockA = await request(app)
      .get('/api/v1/reports/stock')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(stockA.body.data.items).toHaveLength(0);

    const ledgerA = await request(app)
      .get('/api/v1/reports/inventory-ledger')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(ledgerA.body.data.transactions).toHaveLength(0);

    const profitA = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(profitA.body.data.salesRevenue).toBe(0);

    // And Tenant A cannot use Tenant B's ids as filters to fish for data either.
    const filteredByOtherTenantProduct = await request(app)
      .get(`/api/v1/reports/sales?productId=${productB._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(filteredByOtherTenantProduct.body.data.sales).toHaveLength(0);
  });
});
