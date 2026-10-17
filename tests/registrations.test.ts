import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { User } from '../src/models/user.model';
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

let mobileCounter = 9300000000;
function registration(overrides: Record<string, unknown> = {}) {
  mobileCounter += 1;
  return {
    businessName: 'Verma Tiles',
    ownerName: 'Anil Verma',
    mobileNumber: String(mobileCounter),
    email: 'anil@verma.example',
    password: 'StrongPass99',
    ...overrides,
  };
}

const submit = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/registrations').send(body);

const login = (mobileNumber: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ mobileNumber, password });

async function superAdminToken() {
  const mobile = nextMobileNumber();
  await createSuperAdminDirect(mobile, 'SuperSecret123');
  return (await loginOrThrow(app, mobile, 'SuperSecret123')).accessToken;
}

describe('self-service registration', () => {
  it('stores a pending request without creating any account', async () => {
    const body = registration();
    const res = await submit(body);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(await User.exists({ mobileNumber: body.mobileNumber })).toBeNull();
  });

  it('rejects duplicates, taken numbers and weak passwords', async () => {
    const body = registration();
    expect((await submit(body)).status).toBe(201);
    expect((await submit(body)).status).toBe(409);

    const token = await superAdminToken();
    const tenant = await createTenantWithOwnerViaApi(app, token);
    expect((await submit(registration({ mobileNumber: tenant.ownerMobileNumber }))).status).toBe(
      409
    );

    expect((await submit(registration({ password: 'password' }))).status).toBe(400);
    expect((await submit(registration({ businessName: '' }))).status).toBe(400);
  });

  it('tells the applicant their request is pending only with the right password', async () => {
    const body = registration();
    await submit(body);

    const pending = await login(body.mobileNumber, body.password);
    expect(pending.status).toBe(403);
    expect(pending.body.message).toMatch(/waiting for approval/i);

    const wrongPassword = await login(body.mobileNumber, 'NotTheirPass1');
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.message).not.toMatch(/approval/i);
  });

  it('approval creates the business and owner, who can then sign in with their own password', async () => {
    const token = await superAdminToken();
    const body = registration();
    const { _id: id } = (await submit(body)).body.data;

    const count = await request(app)
      .get('/api/v1/registrations/pending-count')
      .set('Authorization', `Bearer ${token}`);
    expect(count.body.data.count).toBe(1);

    const approve = await request(app)
      .post(`/api/v1/registrations/${id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);
    expect(approve.body.data.request.status).toBe('APPROVED');
    expect(approve.body.data.request.passwordHash).toBeUndefined();
    expect(approve.body.data.tenant.businessName).toBe('Verma Tiles');

    const owner = await User.findOne({ mobileNumber: body.mobileNumber });
    expect(owner?.role).toBe('OWNER');
    expect(owner?.mustChangePassword).toBe(false);
    expect((await login(body.mobileNumber, body.password)).status).toBe(200);

    const again = await request(app)
      .post(`/api/v1/registrations/${id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(400);
  });

  it('rejection shows the reason at login and allows registering again', async () => {
    const token = await superAdminToken();
    const body = registration();
    const { _id: id } = (await submit(body)).body.data;

    const reject = await request(app)
      .post(`/api/v1/registrations/${id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'GST number missing' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');

    const res = await login(body.mobileNumber, body.password);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('GST number missing');

    const list = await request(app)
      .get('/api/v1/registrations?status=REJECTED')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);

    expect((await submit(body)).status).toBe(201);
  });

  it('reviewing is Super Admin only', async () => {
    const token = await superAdminToken();
    const tenant = await createTenantWithOwnerViaApi(app, token);
    const owner = await loginOrThrow(app, tenant.ownerMobileNumber, tenant.ownerPassword);
    const { _id: id } = (await submit(registration())).body.data;

    expect((await request(app).get('/api/v1/registrations')).status).toBe(401);
    const asOwner = await request(app)
      .post(`/api/v1/registrations/${id}/approve`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asOwner.status).toBe(403);
  });
});
