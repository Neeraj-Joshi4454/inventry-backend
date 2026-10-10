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

async function createSale(
  accessToken: string,
  _tenantId: string,
  overrides: Record<string, unknown> = {}
) {
  const product = await createProductViaApi(app, accessToken);
  const customer = await createCustomerViaApi(app, accessToken);
  await stockViaPurchase(app, accessToken, product._id, 10);

  return request(app)
    .post('/api/v1/sales')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      customerId: customer._id,
      items: [{ productId: product._id, quantity: 1, unitPrice: 100 }],
      ...overrides,
    });
}

/**
 * The "important security test" from the auth/authorization spec: two
 * fully independent tenants, each with data, cross-tenant access attempted
 * from a business user (must fail every time) and from Super Admin (must
 * succeed — Super Admin is not tenant-restricted).
 */
describe('tenant isolation', () => {
  it('Owner A cannot read a Sale belonging to Tenant B, and vice versa', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Tenant A Co',
    });
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Tenant B Co',
    });

    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);
    const ownerB = await loginOrThrow(app, tenantB.ownerMobileNumber, tenantB.ownerPassword);

    const saleAResponse = await createSale(ownerA.accessToken, tenantA.tenantId);
    const saleBResponse = await createSale(ownerB.accessToken, tenantB.tenantId);
    expect(saleAResponse.status).toBe(201);
    expect(saleBResponse.status).toBe(201);
    const saleAId = saleAResponse.body.data._id as string;
    const saleBId = saleBResponse.body.data._id as string;

    // Owner A attempting to read Tenant B's sale by a known, valid ObjectId.
    const crossReadRes = await request(app)
      .get(`/api/v1/sales/${saleBId}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(crossReadRes.status).toBe(404);
    // Must never reveal that the resource exists under another tenant.
    expect(crossReadRes.body.message.toLowerCase()).not.toContain('tenant');
    expect(crossReadRes.body.message.toLowerCase()).not.toContain('belongs');

    // And symmetrically the other direction.
    const crossReadReverseRes = await request(app)
      .get(`/api/v1/sales/${saleAId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(crossReadReverseRes.status).toBe(404);

    // Owner A's own sale is readable, and Owner A's list never contains Tenant B's data.
    const ownReadRes = await request(app)
      .get(`/api/v1/sales/${saleAId}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(ownReadRes.status).toBe(200);

    const listRes = await request(app)
      .get('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.data.map((s: { _id: string }) => s._id);
    expect(ids).toContain(saleAId);
    expect(ids).not.toContain(saleBId);
  });

  it("a spoofed tenantId in the request body is ignored — the sale is always created under the caller's own tenant", async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Tenant Spoof A',
    });
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Tenant Spoof B',
    });
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);

    const res = await createSale(ownerA.accessToken, tenantA.tenantId, {
      tenantId: tenantB.tenantId,
    });
    expect(res.status).toBe(201);
    expect(String(res.body.data.tenantId)).not.toBe(tenantB.tenantId);
    expect(String(res.body.data.tenantId)).toBe(tenantA.tenantId);
  });

  it('business users cannot access the Super-Admin-only users/tenants management APIs at all', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);

    const usersRes = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(usersRes.status).toBe(403);

    const tenantsRes = await request(app)
      .get('/api/v1/tenants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(tenantsRes.status).toBe(403);
  });

  it('Super Admin CAN access data across both tenants', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Cross Visible A',
    });
    const tenantB = await createTenantWithOwnerViaApi(app, superAdmin.accessToken, {
      businessName: 'Cross Visible B',
    });

    const listRes = await request(app)
      .get('/api/v1/tenants')
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);
    expect(listRes.status).toBe(200);
    const businessNames = listRes.body.data.map((t: { businessName: string }) => t.businessName);
    expect(businessNames).toContain('Cross Visible A');
    expect(businessNames).toContain('Cross Visible B');

    const usersInA = await request(app)
      .get(`/api/v1/users?tenantId=${tenantA.tenantId}`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);
    expect(usersInA.status).toBe(200);
    expect(
      usersInA.body.data.every((u: { tenantId: string }) => String(u.tenantId) === tenantA.tenantId)
    ).toBe(true);

    const usersInB = await request(app)
      .get(`/api/v1/users?tenantId=${tenantB.tenantId}`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);
    expect(usersInB.status).toBe(200);
    expect(usersInB.body.data.length).toBeGreaterThan(0);
  });

  it('a suspended user immediately loses API access even with a still-valid access token', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');
    const tenantA = await createTenantWithOwnerViaApi(app, superAdmin.accessToken);
    const ownerA = await loginOrThrow(app, tenantA.ownerMobileNumber, tenantA.ownerPassword);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    const ownerId = meRes.body.data.id as string;

    await request(app)
      .patch(`/api/v1/users/${ownerId}/status`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    // The OLD access token is still cryptographically valid and unexpired,
    // but the live status recheck in authenticate() must still reject it.
    const stillUsingOldToken = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(stillUsingOldToken.status).toBe(401);
  });
});
