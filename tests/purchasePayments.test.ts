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
