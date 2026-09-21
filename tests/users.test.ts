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

async function superAdmin() {
  const mobileNumber = nextMobileNumber();
  await createSuperAdminDirect(mobileNumber, 'SuperSecret123');
  return loginOrThrow(app, mobileNumber, 'SuperSecret123');
}

describe('POST /api/v1/users (Super Admin adds a teammate to an existing tenant)', () => {
  it('creates a SALES_PERSON user under an existing tenant', async () => {
    const admin = await superAdmin();
    const tenant = await createTenantWithOwnerViaApi(app, admin.accessToken);
    const salesMobile = nextMobileNumber();

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        tenantId: tenant.tenantId,
        name: 'Sales Guy',
        mobileNumber: salesMobile,
        password: 'SalesPass123',
        role: 'SALES_PERSON',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('SALES_PERSON');
    expect(res.body.data).not.toHaveProperty('passwordHash');

    const login = await loginOrThrow(app, salesMobile, 'SalesPass123');
    expect(login.user.role).toBe('SALES_PERSON');
    expect(login.user.tenantId).toBe(tenant.tenantId);
  });

  it('rejects attempting to assign the SUPER_ADMIN role through the API', async () => {
    const admin = await superAdmin();
    const tenant = await createTenantWithOwnerViaApi(app, admin.accessToken);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        tenantId: tenant.tenantId,
        name: 'Sneaky',
        mobileNumber: nextMobileNumber(),
        password: 'SneakyPass123',
        role: 'SUPER_ADMIN',
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate mobile numbers across the whole platform', async () => {
    const admin = await superAdmin();
    const tenant = await createTenantWithOwnerViaApi(app, admin.accessToken);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        tenantId: tenant.tenantId,
        name: 'Duplicate',
        mobileNumber: tenant.ownerMobileNumber, // already the owner's number
        password: 'AnotherPass123',
        role: 'MANAGER',
      });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/v1/users/:id and PATCH /api/v1/users/:id', () => {
  it('fetches and updates a user without ever exposing passwordHash', async () => {
    const admin = await superAdmin();
    const tenant = await createTenantWithOwnerViaApi(app, admin.accessToken);

    const meAsOwner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const ownerId = meAsOwner.user.id;

    const getRes = await request(app)
      .get(`/api/v1/users/${ownerId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).not.toHaveProperty('passwordHash');

    const patchRes = await request(app)
      .patch(`/api/v1/users/${ownerId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Renamed Owner' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.name).toBe('Renamed Owner');
  });
});
