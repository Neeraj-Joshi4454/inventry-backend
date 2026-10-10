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

async function createSale(owner: { accessToken: string }, body: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/v1/sales')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(body);
  if (res.status !== 201) {
    throw new Error(
      `Expected sale creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }
  return res.body.data as { _id: string; totalAmount: string };
}

describe('POST /api/v1/sales — payment fields', () => {
  it('a cash sale paid in full is recorded as PAID with zero due amount', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const sale = await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'CASH',
      paidAmount: 1000,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    expect(Number(sale.totalAmount)).toBeCloseTo(1000, 2);

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PAID');
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(1000, 2);
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(0, 2);
    expect(detail.body.data.payments).toHaveLength(1);
    expect(detail.body.data.payments[0].method).toBe('CASH');
    expect(Number(detail.body.data.payments[0].amount)).toBeCloseTo(1000, 2);
  });

  it('a partial payment at sale time is recorded as PARTIAL with the correct due amount', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const sale = await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'UPI',
      paidAmount: 400,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PARTIAL');
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(400, 2);
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(600, 2);
  });

  it('stores the transaction reference of an upfront UPI payment', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const sale = await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'UPI',
      paidAmount: 1000,
      paymentReference: ' UPI-4471-AXB ',
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PAID');
    expect(detail.body.data.payments[0].method).toBe('UPI');
    expect(detail.body.data.payments[0].referenceNumber).toBe('UPI-4471-AXB');
  });

  it('rejects money received with CREDIT as its payment mode (400), creating no sale', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        paymentMethod: 'CREDIT',
        paidAmount: 500,
        items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
      });
    expect(res.status).toBe(400);

    const list = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('a credit sale (no paidAmount) defaults to CREDIT status with the full amount outstanding', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const sale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('CREDIT');
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(0, 2);
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(1000, 2);
    expect(detail.body.data.payments).toHaveLength(0);
  });

  it('rejects a paidAmount greater than the sale total', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        paidAmount: 5000,
        items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
      });

    expect(res.status).toBe(400);
  });

  it('a sale created without any payment fields still works (backward compatible)', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        customerId: customer._id,
        items: [{ productId: product._id, quantity: 5, unitPrice: 100 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentStatus).toBe('CREDIT');
  });
});

describe('POST /api/v1/customer-payments', () => {
  it('records a payment against a credit sale, moving it to PARTIAL', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 300, method: 'CASH', notes: 'First installment' });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.amount)).toBeCloseTo(300, 2);

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PARTIAL');
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(300, 2);
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(700, 2);
  });

  it('supports multiple payments against one sale, eventually reaching PAID', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 400, method: 'CASH' })
      .expect(201);
    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 350, method: 'UPI' })
      .expect(201);
    const finalPayment = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 250, method: 'BANK_TRANSFER' });

    expect(finalPayment.status).toBe(201);

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PAID');
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(1000, 2);
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(0, 2);
    expect(detail.body.data.payments).toHaveLength(3);
  });

  it('fully paying a previously partial sale moves it to PAID', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'CASH',
      paidAmount: 600,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 400, method: 'CARD' });

    expect(res.status).toBe(201);

    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(detail.body.data.sale.paymentStatus).toBe('PAID');
    expect(Number(detail.body.data.sale.dueAmount)).toBeCloseTo(0, 2);
  });

  it('rejects a payment that exceeds the outstanding amount', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      paidAmount: 200,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 900, method: 'CASH' });

    expect(res.status).toBe(400);

    // Nothing changed on the sale.
    const detail = await request(app)
      .get(`/api/v1/sales/${sale._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(Number(detail.body.data.sale.paidAmount)).toBeCloseTo(200, 2);
  });

  it('rejects a zero or negative payment amount', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const zero = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 0, method: 'CASH' });
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: -50, method: 'CASH' });
    expect(negative.status).toBe(400);
  });

  it('rejects adding a payment to a fully paid sale', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'CASH',
      paidAmount: 1000,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 10, method: 'CASH' });

    expect(res.status).toBe(400);
  });

  it('rejects a payment for a sale belonging to another tenant (tenant isolation)', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const product = await createProductViaApi(app, ownerA.accessToken);
    const customer = await createCustomerViaApi(app, ownerA.accessToken);
    await stockProduct(ownerA, product._id, 100);
    const sale = await createSale(ownerA, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ saleId: sale._id, amount: 100, method: 'CASH' });

    expect(res.status).toBe(404);
  });

  it('does not touch inventory when recording a payment', async () => {
    const { owner } = await setupTenantOwner();
    const product = await createProductViaApi(app, owner.accessToken);
    const customer = await createCustomerViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);
    const sale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });

    const beforeInventory = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: sale._id, amount: 500, method: 'CASH' })
      .expect(201);

    const afterInventory = await request(app)
      .get(`/api/v1/inventory/${product._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(afterInventory.body.data.currentStock).toBe(beforeInventory.body.data.currentStock);

    const ledgerRes = await request(app)
      .get(`/api/v1/inventory/${product._id}/transactions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    // Only OPENING_STOCK + the original SALE — no transaction created by the payment.
    expect(ledgerRes.body.data.transactions).toHaveLength(2);
  });
});

describe('GET /api/v1/customer-payments', () => {
  it('lists payments with date and method filtering, tenant-isolated', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const productA = await createProductViaApi(app, ownerA.accessToken);
    const customerA = await createCustomerViaApi(app, ownerA.accessToken);
    await stockProduct(ownerA, productA._id, 100);
    const saleA = await createSale(ownerA, {
      customerId: customerA._id,
      items: [{ productId: productA._id, quantity: 10, unitPrice: 100 }],
    });

    const productB = await createProductViaApi(app, ownerB.accessToken);
    const customerB = await createCustomerViaApi(app, ownerB.accessToken);
    await stockProduct(ownerB, productB._id, 100);
    const saleB = await createSale(ownerB, {
      customerId: customerB._id,
      items: [{ productId: productB._id, quantity: 10, unitPrice: 100 }],
    });

    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ saleId: saleA._id, amount: 200, method: 'CASH' })
      .expect(201);
    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ saleId: saleA._id, amount: 100, method: 'UPI' })
      .expect(201);
    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ saleId: saleB._id, amount: 500, method: 'CASH' })
      .expect(201);

    const listA = await request(app)
      .get('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listA.body.data).toHaveLength(2);

    const methodFiltered = await request(app)
      .get('/api/v1/customer-payments?method=UPI')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(methodFiltered.body.data).toHaveLength(1);
    expect(methodFiltered.body.data[0].method).toBe('UPI');

    const futureOnly = await request(app)
      .get('/api/v1/customer-payments?fromDate=2099-01-01')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(futureOnly.body.data).toHaveLength(0);
  });

  it('a payment detail lookup for another tenant returns 404', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const product = await createProductViaApi(app, ownerA.accessToken);
    const customer = await createCustomerViaApi(app, ownerA.accessToken);
    await stockProduct(ownerA, product._id, 100);
    const sale = await createSale(ownerA, {
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 10, unitPrice: 100 }],
    });
    const payment = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ saleId: sale._id, amount: 200, method: 'CASH' })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/customer-payments/${payment.body.data._id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/customers/:id/sales — sales history & outstanding', () => {
  it('computes total sales, paid, outstanding, last sale/payment, and unpaid/partial count', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);
    const productA = await createProductViaApi(app, owner.accessToken, { name: 'Cement' });
    const productB = await createProductViaApi(app, owner.accessToken, { name: 'Steel' });
    await stockProduct(owner, productA._id, 100);
    await stockProduct(owner, productB._id, 100);

    // Fully paid.
    await createSale(owner, {
      customerId: customer._id,
      paymentMethod: 'CASH',
      paidAmount: 1000,
      items: [{ productId: productA._id, quantity: 10, unitPrice: 100 }],
    });
    // Credit (unpaid).
    const creditSale = await createSale(owner, {
      customerId: customer._id,
      items: [{ productId: productB._id, quantity: 5, unitPrice: 100 }],
    });

    await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saleId: creditSale._id, amount: 200, method: 'UPI' })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/customers/${customer._id}/sales`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalSales).toBe(2);
    // 1000 (paid sale) + 500 (credit sale) = 1500
    expect(res.body.data.summary.totalAmount).toBeCloseTo(1500, 2);
    // 1000 + 200 = 1200
    expect(res.body.data.summary.totalPaid).toBeCloseTo(1200, 2);
    // 500 - 200 = 300
    expect(res.body.data.summary.totalOutstanding).toBeCloseTo(300, 2);
    expect(res.body.data.summary.unpaidOrPartialCount).toBe(1);
    expect(res.body.data.summary.lastPaymentDate).toBeDefined();
    expect(res.body.data.summary.lastSaleDate).toBeDefined();
    expect(res.body.data.sales).toHaveLength(2);
  });

  it('returns a zeroed summary for a customer with no sales yet', async () => {
    const { owner } = await setupTenantOwner();
    const customer = await createCustomerViaApi(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/customers/${customer._id}/sales`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalSales).toBe(0);
    expect(res.body.data.summary.totalOutstanding).toBe(0);
    expect(res.body.data.sales).toHaveLength(0);
  });

  it('tenant isolation: cannot view another tenant customer sales history', async () => {
    const { owner: ownerA } = await setupTenantOwner();
    const { owner: ownerB } = await setupTenantOwner();
    const customerA = await createCustomerViaApi(app, ownerA.accessToken);

    const res = await request(app)
      .get(`/api/v1/customers/${customerA._id}/sales`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/reports/outstanding-customers', () => {
  it('lists only customers with an outstanding balance, sorted by outstanding amount', async () => {
    const { owner } = await setupTenantOwner();
    const customerFull = await createCustomerViaApi(app, owner.accessToken, 'Paid In Full');
    const customerOwing = await createCustomerViaApi(app, owner.accessToken, 'Still Owes');
    const product = await createProductViaApi(app, owner.accessToken);
    await stockProduct(owner, product._id, 100);

    await createSale(owner, {
      customerId: customerFull._id,
      paymentMethod: 'CASH',
      paidAmount: 500,
      items: [{ productId: product._id, quantity: 5, unitPrice: 100 }],
    });
    await createSale(owner, {
      customerId: customerOwing._id,
      items: [{ productId: product._id, quantity: 5, unitPrice: 100 }],
    });

    const res = await request(app)
      .get('/api/v1/reports/outstanding-customers')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].customer.name).toBe('Still Owes');
    expect(Number(res.body.data.items[0].outstandingAmount)).toBeCloseTo(500, 2);
    expect(res.body.data.summary.totalOutstandingCustomers).toBe(1);
  });
});
