import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createSuperAdminDirect,
  createTenantWithOwnerViaApi,
  login,
  loginOrThrow,
  nextMobileNumber,
} from './helpers/factories';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

describe('POST /api/v1/auth/change-password', () => {
  it("changes the caller's own password and revokes existing sessions", async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'OldPassword1');
    const { accessToken, refreshToken } = await loginOrThrow(app, mobileNumber, 'OldPassword1');

    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword2' });
    expect(changeRes.status).toBe(200);

    // Old refresh token must be revoked as a side effect.
    const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshRes.status).toBe(401);

    // Old password no longer works; new one does.
    const oldLogin = await login(app, mobileNumber, 'OldPassword1');
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(app, mobileNumber, 'NewPassword2');
    expect(newLogin.status).toBe(200);
  });

  it('rejects an incorrect current password', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'OldPassword1');
    const { accessToken } = await loginOrThrow(app, mobileNumber, 'OldPassword1');

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongCurrent1', newPassword: 'NewPassword2' });

    expect(res.status).toBe(400);
  });

  it('rejects a new password that fails the password policy', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'OldPassword1');
    const { accessToken } = await loginOrThrow(app, mobileNumber, 'OldPassword1');

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPassword1', newPassword: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/users/:id/reset-password (Super Admin)', () => {
  it("resets a user's password, revokes their sessions, and never returns the password", async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const { ownerMobileNumber, ownerPassword } = await createTenantWithOwnerViaApi(
      app,
      superAdmin.accessToken
    );
    const owner = await loginOrThrow(app, ownerMobileNumber, ownerPassword);

    // Find the owner's user id via /auth/me.
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const ownerId = meRes.body.data.id as string;

    const resetRes = await request(app)
      .post(`/api/v1/users/${ownerId}/reset-password`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ newPassword: 'BrandNewPass1' });

    expect(resetRes.status).toBe(200);
    expect(JSON.stringify(resetRes.body)).not.toMatch(/BrandNewPass1/);

    // Old session revoked.
    const refreshAfterReset = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: owner.refreshToken });
    expect(refreshAfterReset.status).toBe(401);

    // Old password no longer works; new one does.
    const oldLogin = await login(app, ownerMobileNumber, ownerPassword);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(app, ownerMobileNumber, 'BrandNewPass1');
    expect(newLogin.status).toBe(200);
  });

  it("a non-Super-Admin cannot reset another user's password", async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const { ownerMobileNumber, ownerPassword } = await createTenantWithOwnerViaApi(
      app,
      superAdmin.accessToken
    );
    const owner = await loginOrThrow(app, ownerMobileNumber, ownerPassword);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const ownerId = meRes.body.data.id as string;

    const res = await request(app)
      .post(`/api/v1/users/${ownerId}/reset-password`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ newPassword: 'ShouldNotWork1' });

    expect(res.status).toBe(403);
  });
});
