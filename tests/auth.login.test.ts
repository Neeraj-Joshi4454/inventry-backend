import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import {
  createSuperAdminDirect,
  createTenantWithOwnerViaApi,
  login,
  loginOrThrow,
  nextMobileNumber,
} from './helpers/factories';
import { User } from '../src/models/user.model';
import { AccountStatus } from '../src/types/enums';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

describe('POST /api/v1/auth/login', () => {
  it('logs in a Super Admin successfully', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'SuperSecret123');

    const res = await login(app, mobileNumber, 'SuperSecret123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data!;
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toEqual(expect.any(String));
    expect(data.user.role).toBe('SUPER_ADMIN');
    expect(data.user.tenantId).toBeNull();
    // Never leak sensitive fields.
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('logs in an Owner successfully', async () => {
    const superAdminMobile = nextMobileNumber();
    await createSuperAdminDirect(superAdminMobile, 'SuperSecret123');
    const superAdmin = await loginOrThrow(app, superAdminMobile, 'SuperSecret123');

    const { ownerMobileNumber, ownerPassword } = await createTenantWithOwnerViaApi(
      app,
      superAdmin.accessToken
    );

    const res = await login(app, ownerMobileNumber, ownerPassword);

    expect(res.status).toBe(200);
    expect(res.body.data!.user.role).toBe('OWNER');
    expect(res.body.data!.user.tenantId).toEqual(expect.any(String));
  });

  it('rejects an invalid password with a generic message', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'SuperSecret123');

    const res = await login(app, mobileNumber, 'WrongPassword1');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid mobile number or password');
  });

  it('rejects a nonexistent mobile number with the SAME generic message (no user enumeration)', async () => {
    const res = await login(app, nextMobileNumber(), 'WhateverPassword1');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid mobile number or password');
  });

  it('rejects login for an INACTIVE user', async () => {
    const mobileNumber = nextMobileNumber();
    const user = await createSuperAdminDirect(mobileNumber, 'SuperSecret123');
    user.status = AccountStatus.INACTIVE;
    await user.save();

    const res = await login(app, mobileNumber, 'SuperSecret123');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('rejects login for a SUSPENDED user', async () => {
    const mobileNumber = nextMobileNumber();
    const user = await createSuperAdminDirect(mobileNumber, 'SuperSecret123');
    user.status = AccountStatus.SUSPENDED;
    await user.save();

    const res = await login(app, mobileNumber, 'SuperSecret123');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('normalizes mobile number formats to the same canonical account', async () => {
    const canonical = nextMobileNumber();
    await createSuperAdminDirect(canonical, 'SuperSecret123');

    // Login using the +91-prefixed form of the same number.
    const res = await login(app, `+91${canonical}`, 'SuperSecret123');

    expect(res.status).toBe(200);
  });

  it('enforces the stricter per-mobile login rate limit after repeated failures', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'SuperSecret123');

    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await login(app, mobileNumber, 'WrongPassword1');
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('user account created via User model directly (sanity)', () => {
  it('never stores a plaintext password', async () => {
    const mobileNumber = nextMobileNumber();
    await createSuperAdminDirect(mobileNumber, 'SuperSecret123');

    const stored = await User.findOne({ mobileNumber }).select('+passwordHash');
    expect(stored!.passwordHash).not.toBe('SuperSecret123');
    expect(stored!.passwordHash.length).toBeGreaterThan(20);
  });
});
