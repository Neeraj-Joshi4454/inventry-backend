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

async function getRentCategoryId(owner: { accessToken: string }) {
  const res = await request(app)
    .get('/api/v1/expense-categories')
    .set('Authorization', `Bearer ${owner.accessToken}`);
  const rent = res.body.data.find((c: { name: string }) => c.name === 'Rent');
  return rent._id as string;
}

describe('GET /api/v1/expense-categories', () => {
  it('every new tenant gets the default system category set', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(
      ['Electricity', 'Internet', 'Maintenance', 'Office Supplies', 'Other', 'Rent', 'Salary', 'Transport'].sort()
    );
    expect(res.body.data.every((c: { isSystem: boolean }) => c.isSystem)).toBe(true);
  });

  it('creates a custom category', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Marketing', description: 'Ads and promotions' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Marketing');
    expect(res.body.data.isSystem).toBe(false);
  });

  it('rejects a duplicate category name', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Rent' });
    expect(res.status).toBe(409);
  });

  it('cannot deactivate a system category', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const res = await request(app)
      .patch(`/api/v1/expense-categories/${categoryId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('cannot rename a system category, but can edit its description', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const renameRes = await request(app)
      .patch(`/api/v1/expense-categories/${categoryId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Not Rent' });
    expect(renameRes.status).toBe(400);

    const descRes = await request(app)
      .patch(`/api/v1/expense-categories/${categoryId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ description: 'Monthly shop rent' });
    expect(descRes.status).toBe(200);
    expect(descRes.body.data.description).toBe('Monthly shop rent');
  });

  it('a custom category can be deactivated and no longer used for new expenses', async () => {
    const { owner } = await setupTenantOwner();
    const created = await request(app)
      .post('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Travel' })
      .expect(201);
    const categoryId = created.body.data._id as string;

    await request(app)
      .patch(`/api/v1/expense-categories/${categoryId}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    const expenseRes = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Cab fare',
        categoryId,
        amount: 500,
        expenseDate: new Date().toISOString(),
        paymentMethod: 'CASH',
      });
    expect(expenseRes.status).toBe(400);
  });
});

describe('POST /api/v1/expenses', () => {
  it('creates an expense with all fields', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Shop Rent - September',
        categoryId,
        amount: 15000,
        expenseDate: '2026-09-01T00:00:00.000Z',
        paymentMethod: 'BANK_TRANSFER',
        referenceNumber: 'TXN-9981',
        notes: 'Paid to landlord',
        attachmentUrl: 'https://example.com/receipt.pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Shop Rent - September');
    expect(Number(res.body.data.amount)).toBeCloseTo(15000, 2);
    expect(res.body.data.paymentMethod).toBe('BANK_TRANSFER');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.createdBy).toBeDefined();
  });

  it('rejects a zero or negative amount', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const zero = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Bad expense', categoryId, amount: 0, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' });
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Bad expense', categoryId, amount: -10, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' });
    expect(negative.status).toBe(400);
  });

  it('rejects an invalid expense date', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Bad date', categoryId, amount: 100, expenseDate: 'not-a-date', paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid payment method', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Bad method',
        categoryId,
        amount: 100,
        expenseDate: new Date().toISOString(),
        paymentMethod: 'CHEQUE',
      });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown category id', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'No category',
        categoryId: '65f000000000000000000000',
        amount: 100,
        expenseDate: new Date().toISOString(),
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(404);
  });

  it('a Sales Person cannot create an expense (403)', async () => {
    const { owner, superAdmin, tenant } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);
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
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${salesPerson.accessToken}`)
      .send({ title: 'Rent', categoryId, amount: 100, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('does not create or modify any inventory record', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const before = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Rent', categoryId, amount: 100, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' })
      .expect(201);

    const after = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(after.body.data).toEqual(before.body.data);
  });
});

describe('PATCH /api/v1/expenses/:id', () => {
  it('edits an expense and records updatedBy', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const created = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Rent', categoryId, amount: 15000, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' })
      .expect(201);

    const res = await request(app)
      .patch(`/api/v1/expenses/${created.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ amount: 16000, notes: 'Rent increased' });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.amount)).toBeCloseTo(16000, 2);
    expect(res.body.data.notes).toBe('Rent increased');
    expect(res.body.data.updatedBy).toBeDefined();
  });

  it('cancelling an expense excludes it from totals but keeps the record', async () => {
    const { owner } = await setupTenantOwner();
    const categoryId = await getRentCategoryId(owner);

    const created = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Rent', categoryId, amount: 5000, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/expenses/${created.body.data._id}/status`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    const summary = await request(app)
      .get('/api/v1/expenses/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(summary.body.data.totalExpenses.amount).toBe(0);

    // Still fetchable directly — never physically deleted.
    const getRes = await request(app)
      .get(`/api/v1/expenses/${created.body.data._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.status).toBe('CANCELLED');
  });
});

describe('GET /api/v1/expenses filters and pagination', () => {
  async function seedExpenses(owner: { accessToken: string }) {
    const categories = await request(app)
      .get('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const rent = categories.body.data.find((c: { name: string }) => c.name === 'Rent')._id;
    const electricity = categories.body.data.find((c: { name: string }) => c.name === 'Electricity')._id;

    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'September Rent',
        categoryId: rent,
        amount: 15000,
        expenseDate: '2026-09-01T00:00:00.000Z',
        paymentMethod: 'BANK_TRANSFER',
      })
      .expect(201);
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'September Power Bill',
        categoryId: electricity,
        amount: 2500,
        expenseDate: '2026-09-05T00:00:00.000Z',
        paymentMethod: 'UPI',
      })
      .expect(201);
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'August Rent',
        categoryId: rent,
        amount: 15000,
        expenseDate: '2026-08-01T00:00:00.000Z',
        paymentMethod: 'CASH',
      })
      .expect(201);

    return { rent, electricity };
  }

  it('filters by category', async () => {
    const { owner } = await setupTenantOwner();
    const { rent } = await seedExpenses(owner);

    const res = await request(app)
      .get(`/api/v1/expenses?categoryId=${rent}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by payment method', async () => {
    const { owner } = await setupTenantOwner();
    await seedExpenses(owner);

    const res = await request(app)
      .get('/api/v1/expenses?paymentMethod=UPI')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('September Power Bill');
  });

  it('filters by date range', async () => {
    const { owner } = await setupTenantOwner();
    await seedExpenses(owner);

    const res = await request(app)
      .get('/api/v1/expenses?fromDate=2026-09-01&toDate=2026-09-30')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(2);
  });

  it('searches by title', async () => {
    const { owner } = await setupTenantOwner();
    await seedExpenses(owner);

    const res = await request(app)
      .get('/api/v1/expenses?search=Power')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(1);
  });

  it('paginates results', async () => {
    const { owner } = await setupTenantOwner();
    await seedExpenses(owner);

    const res = await request(app)
      .get('/api/v1/expenses?page=1&limit=2')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.meta.totalPages).toBe(2);
  });
});

describe('GET /api/v1/expenses/summary', () => {
  it('computes today, this-month, total, category and payment-method breakdowns', async () => {
    const { owner } = await setupTenantOwner();
    const categories = await request(app)
      .get('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const rent = categories.body.data.find((c: { name: string }) => c.name === 'Rent')._id;

    const today = new Date().toISOString();
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Today Rent', categoryId: rent, amount: 1000, expenseDate: today, paymentMethod: 'CASH' })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/expenses/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.todayExpenses.amount).toBeCloseTo(1000, 2);
    expect(res.body.data.thisMonthExpenses.amount).toBeCloseTo(1000, 2);
    expect(res.body.data.totalExpenses.amount).toBeCloseTo(1000, 2);
    expect(res.body.data.expensesByCategory).toHaveLength(1);
    expect(res.body.data.expensesByCategory[0].categoryName).toBe('Rent');
    expect(res.body.data.expensesByPaymentMethod).toHaveLength(1);
    expect(res.body.data.expensesByPaymentMethod[0].paymentMethod).toBe('CASH');
    expect(res.body.data.previousMonthComparison).toBeDefined();
  });

  it('returns zeroed summary for a tenant with no expenses', async () => {
    const { owner } = await setupTenantOwner();
    const res = await request(app)
      .get('/api/v1/expenses/summary')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.body.data.todayExpenses.amount).toBe(0);
    expect(res.body.data.totalExpenses.count).toBe(0);
    expect(res.body.data.expensesByCategory).toHaveLength(0);
  });
});

describe('GET /api/v1/reports/expenses', () => {
  it('computes total and category breakdown with date filtering', async () => {
    const { owner } = await setupTenantOwner();
    const categories = await request(app)
      .get('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const rent = categories.body.data.find((c: { name: string }) => c.name === 'Rent')._id;
    const electricity = categories.body.data.find((c: { name: string }) => c.name === 'Electricity')._id;

    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Rent',
        categoryId: rent,
        amount: 10000,
        expenseDate: '2026-09-01T00:00:00.000Z',
        paymentMethod: 'CASH',
      })
      .expect(201);
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Power',
        categoryId: electricity,
        amount: 2000,
        expenseDate: '2026-09-02T00:00:00.000Z',
        paymentMethod: 'UPI',
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/expenses?fromDate=2026-09-01&toDate=2026-09-30')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalExpenses).toBe(2);
    expect(res.body.data.summary.totalAmount).toBeCloseTo(12000, 2);
    expect(res.body.data.categoryBreakdown).toHaveLength(2);
    expect(res.body.data.expenses).toHaveLength(2);

    const outsideRange = await request(app)
      .get('/api/v1/reports/expenses?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(outsideRange.body.data.summary.totalExpenses).toBe(0);
  });
});

describe('GET /api/v1/reports/profit — operating expenses and net profit', () => {
  it('subtracts operating expenses from gross profit without changing sales/COGS figures', async () => {
    const { owner } = await setupTenantOwner();
    const customerRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Profit Test Customer' })
      .expect(201);
    const categoriesRes = await request(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const unitsRes = await request(app)
      .get('/api/v1/units')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const productRes = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Cement',
        sku: 'CEM-PROFIT-1',
        categoryId: categoriesRes.body.data[0]._id,
        unitId: unitsRes.body.data[0]._id,
        purchasePrice: 300,
        sellingPrice: 420,
        lowStockThreshold: 10,
      })
      .expect(201);

    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ productId: productRes.body.data._id, quantity: 500 })
      .expect(201);

    await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customerRes.body.data._id,
        items: [{ productId: productRes.body.data._id, quantity: 100, unitPrice: 420 }],
      })
      .expect(201);

    const expenseCategories = await request(app)
      .get('/api/v1/expense-categories')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const rent = expenseCategories.body.data.find((c: { name: string }) => c.name === 'Rent')._id;
    await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Rent', categoryId: rent, amount: 2000, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    // Unchanged sales/purchase calculations.
    expect(res.body.data.salesRevenue).toBe(42000);
    expect(res.body.data.costOfGoodsSold).toBe(30000);
    expect(res.body.data.grossProfit).toBe(12000);
    // New fields.
    expect(res.body.data.operatingExpenses).toBe(2000);
    expect(res.body.data.netProfit).toBe(10000);
  });
});

describe('tenant isolation for expenses', () => {
  it('Tenant A cannot see, edit, or fetch Tenant B expenses/categories', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();

    const categoryId = await getRentCategoryId(ownerB);
    const expense = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ title: 'B Rent', categoryId, amount: 1000, expenseDate: new Date().toISOString(), paymentMethod: 'CASH' })
      .expect(201);

    const getRes = await request(app)
      .get(`/api/v1/expenses/${expense.body.data._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(getRes.status).toBe(404);

    const editRes = await request(app)
      .patch(`/api/v1/expenses/${expense.body.data._id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ amount: 1 });
    expect(editRes.status).toBe(404);

    const listRes = await request(app)
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listRes.body.data).toHaveLength(0);

    // Tenant A cannot even reference Tenant B's category to create an expense.
    const createRes = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        title: 'Cross-tenant',
        categoryId,
        amount: 100,
        expenseDate: new Date().toISOString(),
        paymentMethod: 'CASH',
      });
    expect(createRes.status).toBe(404);

    const summaryA = await request(app)
      .get('/api/v1/expenses/summary')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(summaryA.body.data.totalExpenses.amount).toBe(0);
  });
});
