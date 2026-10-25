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

async function setup() {
  const superAdminMobile = nextMobileNumber();
  await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
  const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
  const tenant = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
  const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
  const product = await createProductViaApi(app, owner.accessToken);
  const supplier = await createSupplierViaApi(app, owner.accessToken);
  return { token: owner.accessToken, productId: product._id, supplierId: supplier._id };
}

/** ₹1,000 purchase: 10 × ₹100, no GST. */
function purchase(ctx: Awaited<ReturnType<typeof setup>>, payment: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/purchases')
    .set('Authorization', `Bearer ${ctx.token}`)
    .send({
      supplierId: ctx.supplierId,
      items: [{ productId: ctx.productId, quantity: 10, unitPrice: 100, taxRate: 0 }],
      ...payment,
    });
}

describe('POST /api/v1/purchases payment', () => {
  it('stays UNPAID when no payment is sent (backward compatible)', async () => {
    const res = await purchase(await setup());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ paidAmount: 0, dueAmount: 1000, paymentStatus: 'UNPAID' });
  });

  it('records a direct purchase paid in full by UPI with its reference', async () => {
    const res = await purchase(await setup(), {
      paidAmount: 1000,
      paymentMethod: 'UPI',
      paymentReference: 'UPI123',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      paidAmount: 1000,
      dueAmount: 0,
      paymentStatus: 'PAID',
      paymentMethod: 'UPI',
      paymentReference: 'UPI123',
    });
  });

  it('records a credit purchase with an advance as PARTIAL', async () => {
    const res = await purchase(await setup(), { paidAmount: 300, paymentMethod: 'BANK_TRANSFER' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ paidAmount: 300, dueAmount: 700, paymentStatus: 'PARTIAL' });
  });

  it('rejects paying more than the total, or "paying" by credit', async () => {
    const ctx = await setup();
    const over = await purchase(ctx, { paidAmount: 1500, paymentMethod: 'CASH' });
    expect(over.status).toBe(400);
    const credit = await purchase(ctx, { paidAmount: 100, paymentMethod: 'CREDIT' });
    expect(credit.status).toBe(400);
  });
});

describe('POST /api/v1/supplier-payments', () => {
  function pay(ctx: Awaited<ReturnType<typeof setup>>, body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/supplier-payments')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send(body);
  }

  function detail(ctx: Awaited<ReturnType<typeof setup>>, purchaseId: string) {
    return request(app)
      .get(`/api/v1/purchases/${purchaseId}`)
      .set('Authorization', `Bearer ${ctx.token}`);
  }

  it('settles a credit purchase in instalments and keeps the history', async () => {
    const ctx = await setup();
    const created = await purchase(ctx, { paidAmount: 300, paymentMethod: 'BANK_TRANSFER' });
    const purchaseId = created.body.data._id as string;

    const first = await pay(ctx, { purchaseId, amount: 200, method: 'UPI', referenceNumber: 'U1' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ amount: 200, method: 'UPI', referenceNumber: 'U1' });

    let res = await detail(ctx, purchaseId);
    expect(res.body.data.purchase).toMatchObject({
      paidAmount: 500,
      dueAmount: 500,
      paymentStatus: 'PARTIAL',
    });

    expect((await pay(ctx, { purchaseId, amount: 500, method: 'CASH' })).status).toBe(201);
    res = await detail(ctx, purchaseId);
    expect(res.body.data.purchase).toMatchObject({
      paidAmount: 1000,
      dueAmount: 0,
      paymentStatus: 'PAID',
    });
    // Initial advance + two later payments.
    expect(res.body.data.payments).toHaveLength(3);
    expect(
      res.body.data.payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
    ).toBe(1000);
  });

  it('rejects overpaying, paying a settled purchase, or paying by credit', async () => {
    const ctx = await setup();
    const unpaid = await purchase(ctx);
    const unpaidId = unpaid.body.data._id as string;
    expect((await pay(ctx, { purchaseId: unpaidId, amount: 1500, method: 'CASH' })).status).toBe(
      400
    );
    expect((await pay(ctx, { purchaseId: unpaidId, amount: 100, method: 'CREDIT' })).status).toBe(
      400
    );

    const paid = await purchase(ctx, { paidAmount: 1000, paymentMethod: 'CASH' });
    const paidId = paid.body.data._id as string;
    expect((await pay(ctx, { purchaseId: paidId, amount: 1, method: 'CASH' })).status).toBe(400);
  });
});
