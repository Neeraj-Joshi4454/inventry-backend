import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import { createSuperAdminDirect, loginOrThrow, nextMobileNumber } from './helpers/factories';
import { Tenant } from '../src/models/tenant.model';
import { User } from '../src/models/user.model';
import { Category } from '../src/models/category.model';
import { Unit } from '../src/models/unit.model';
import { DEFAULT_CATEGORIES, DEFAULT_UNITS } from '../src/constants/seedData';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

async function superAdminToken() {
  const mobileNumber = nextMobileNumber();
  await createSuperAdminDirect(mobileNumber, 'SuperSecret123');
  return (await loginOrThrow(app, mobileNumber, 'SuperSecret123')).accessToken;
}

describe('POST /api/v1/tenants (createTenantWithOwner)', () => {
  it('atomically creates the tenant, its OWNER user, and default categories/units', async () => {
    const token = await superAdminToken();
    const ownerMobileNumber = nextMobileNumber();

    const res = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Atomic Test Co',
        ownerName: 'Owner Name',
        businessMobileNumber: nextMobileNumber(),
        adminUser: {
          name: 'Owner Name',
          mobileNumber: ownerMobileNumber,
          password: 'OwnerPass123',
        },
      });

    expect(res.status).toBe(201);
    const tenantId = res.body.data.tenant._id;

    const owner = await User.findOne({ mobileNumber: ownerMobileNumber });
    expect(owner).not.toBeNull();
    expect(owner!.role).toBe('OWNER');
    expect(String(owner!.tenantId)).toBe(tenantId);

    const categoryCount = await Category.countDocuments({ tenantId });
    const unitCount = await Unit.countDocuments({ tenantId });
    expect(categoryCount).toBe(DEFAULT_CATEGORIES.length);
    expect(unitCount).toBe(DEFAULT_UNITS.length);
  });

  it('rolls back the entire transaction if the owner mobile number is already taken', async () => {
    const token = await superAdminToken();
    const duplicateMobile = nextMobileNumber();

    // First tenant succeeds and legitimately owns this mobile number.
    await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'First Legit Co',
        ownerName: 'Owner One',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'Owner One', mobileNumber: duplicateMobile, password: 'OwnerPass123' },
      })
      .expect(201);

    const failingBusinessName = 'Should Not Exist Co';

    const res = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: failingBusinessName,
        ownerName: 'Owner Two',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'Owner Two', mobileNumber: duplicateMobile, password: 'OwnerPass123' },
      });

    expect(res.status).toBe(409);

    // No orphan tenant, and no leftover categories/units for it either.
    const orphanTenant = await Tenant.findOne({ businessName: failingBusinessName });
    expect(orphanTenant).toBeNull();

    const onlyOneUserWithThatMobile = await User.countDocuments({ mobileNumber: duplicateMobile });
    expect(onlyOneUserWithThatMobile).toBe(1);
  });

  it('rejects tenant creation from a non-Super-Admin caller', async () => {
    const token = await superAdminToken();
    // Create a real tenant/owner, then try to use the OWNER's own token to create another tenant.
    const ownerMobileNumber = nextMobileNumber();
    await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Owner Attempt Co',
        ownerName: 'Owner',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'Owner', mobileNumber: ownerMobileNumber, password: 'OwnerPass123' },
      })
      .expect(201);

    const owner = await loginOrThrow(app, ownerMobileNumber, 'OwnerPass123');

    const res = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        businessName: 'Should Not Be Created',
        ownerName: 'X',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'X', mobileNumber: nextMobileNumber(), password: 'OwnerPass123' },
      });

    // Authenticated but lacking permission — must be 403, never 401.
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/tenants/:tenantId (business detail edit)', () => {
  it('updates business fields without touching status or the owner user', async () => {
    const token = await superAdminToken();
    const ownerMobileNumber = nextMobileNumber();

    const createRes = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Before Edit Co',
        ownerName: 'Owner Name',
        businessMobileNumber: nextMobileNumber(),
        adminUser: {
          name: 'Owner Name',
          mobileNumber: ownerMobileNumber,
          password: 'OwnerPass123',
        },
      });
    const tenantId = createRes.body.data.tenant._id as string;

    const editRes = await request(app)
      .patch(`/api/v1/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'After Edit Co', email: 'contact@afteredit.example' });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.businessName).toBe('After Edit Co');
    expect(editRes.body.data.email).toBe('contact@afteredit.example');
    expect(editRes.body.data.status).toBe('ACTIVE'); // untouched

    const owner = await User.findOne({ mobileNumber: ownerMobileNumber });
    expect(owner!.name).toBe('Owner Name'); // untouched — /users manages the owner record
  });

  it('rejects an empty update body', async () => {
    const token = await superAdminToken();
    const createRes = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Empty Edit Co',
        ownerName: 'Owner',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'Owner', mobileNumber: nextMobileNumber(), password: 'OwnerPass123' },
      });
    const tenantId = createRes.body.data.tenant._id as string;

    const res = await request(app)
      .patch(`/api/v1/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('query validation actually mutates req.query (regression)', () => {
  // Express 5's req.query is a getter that re-parses req.url fresh on every
  // access rather than caching — mutating the object a read of it returns
  // (Object.assign/delete) silently discards the mutation on the next read.
  // This regression-tests that validate({query}) genuinely applies Zod
  // defaults/coercion for every later reader in the request, not just
  // "validates without throwing".
  it('returns pagination meta with numeric page/limit, not strings', async () => {
    const token = await superAdminToken();
    const res = await request(app)
      .get('/api/v1/tenants?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(typeof res.body.meta.page).toBe('number');
    expect(res.body.meta.limit).toBe(10);
    expect(typeof res.body.meta.limit).toBe('number');
  });

  it('applies the default limit when the client omits it entirely', async () => {
    const token = await superAdminToken();
    const res = await request(app).get('/api/v1/tenants').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(20); // DEFAULT_LIMIT in utils/pagination.ts
  });
});

describe('GET /api/v1/tenants — search, status filter, sort', () => {
  async function createTenant(token: string, businessName: string, status?: string) {
    const res = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName,
        ownerName: 'Owner',
        businessMobileNumber: nextMobileNumber(),
        adminUser: { name: 'Owner', mobileNumber: nextMobileNumber(), password: 'OwnerPass123' },
      })
      .expect(201);
    const tenantId = res.body.data.tenant._id as string;
    if (status) {
      await request(app)
        .patch(`/api/v1/tenants/${tenantId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status });
    }
    return tenantId;
  }

  it('filters by status using a server-computed total (not a frontend count)', async () => {
    const token = await superAdminToken();
    await createTenant(token, 'Active Filter Co');
    await createTenant(token, 'Suspended Filter Co', 'SUSPENDED');

    const activeRes = await request(app)
      .get('/api/v1/tenants?status=ACTIVE&limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.meta.total).toBe(1);

    const suspendedRes = await request(app)
      .get('/api/v1/tenants?status=SUSPENDED&limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(suspendedRes.status).toBe(200);
    expect(suspendedRes.body.meta.total).toBe(1);
  });

  it('searches by business name', async () => {
    const token = await superAdminToken();
    await createTenant(token, 'Zzzyx Cement Traders');
    await createTenant(token, 'Totally Different Name Co');

    const res = await request(app)
      .get('/api/v1/tenants?search=Zzzyx')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].businessName).toBe('Zzzyx Cement Traders');
  });

  it('sorts by businessName ascending', async () => {
    const token = await superAdminToken();
    await createTenant(token, 'Bravo Co');
    await createTenant(token, 'Alpha Co');

    const res = await request(app)
      .get('/api/v1/tenants?sortBy=businessName&sortOrder=asc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((t: { businessName: string }) => t.businessName);
    expect(names.indexOf('Alpha Co')).toBeLessThan(names.indexOf('Bravo Co'));
  });
});
