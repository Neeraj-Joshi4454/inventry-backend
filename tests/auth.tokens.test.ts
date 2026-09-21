import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/db';
import { createSuperAdminDirect, loginOrThrow, nextMobileNumber } from './helpers/factories';
import { env } from '../src/config/env';

const app = createApp();

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

async function createLoggedInSuperAdmin() {
  const mobileNumber = nextMobileNumber();
  await createSuperAdminDirect(mobileNumber, 'SuperSecret123');
  return loginOrThrow(app, mobileNumber, 'SuperSecret123');
}

describe('access token validation', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed/invalid access token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer garbage.token.here');
    expect(res.status).toBe(401);
  });

  it('rejects an expired access token', async () => {
    const { user } = await createLoggedInSuperAdmin();
    const expiredToken = jwt.sign(
      { sub: user.id, tenantId: null, role: 'SUPER_ADMIN', type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 } // already expired
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign(
      { sub: 'x', tenantId: null, role: 'SUPER_ADMIN', type: 'access' },
      'not-the-real-secret-at-all',
      { expiresIn: '15m' }
    );
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid access token and returns safe user info via /auth/me', async () => {
    const { accessToken, user } = await createLoggedInSuperAdmin();
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
    expect(res.body.data.role).toBe('SUPER_ADMIN');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken/);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rejects an invalid/malformed refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('rejects a well-formed but nonexistent session id', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: '65f000000000000000000000:fakevalidator' });
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token: the new token works, and a fresh rotation chain keeps working', async () => {
    const { refreshToken: firstToken } = await createLoggedInSuperAdmin();

    const firstRotate = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstToken });
    expect(firstRotate.status).toBe(200);
    const secondToken = firstRotate.body.data.refreshToken as string;
    expect(secondToken).not.toBe(firstToken);

    // Rotating again from the newly-issued token (normal chained use, no
    // reuse of a stale token) must keep succeeding.
    const secondRotate = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondToken });
    expect(secondRotate.status).toBe(200);
    const thirdToken = secondRotate.body.data.refreshToken as string;
    expect(thirdToken).not.toBe(secondToken);
  });

  it('rejects reuse of a token that has already been rotated past', async () => {
    const { refreshToken: firstToken } = await createLoggedInSuperAdmin();
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: firstToken }).expect(200);

    // firstToken is now revoked (rotated away) — presenting it again must fail.
    // Checked last since (by design) this also revokes the whole session
    // family — see the dedicated reuse-detection test below.
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstToken });
    expect(reuseRes.status).toBe(401);
  });

  it('detects reuse of an already-rotated refresh token and revokes the whole session family', async () => {
    const { refreshToken: originalToken } = await createLoggedInSuperAdmin();

    // Legitimate rotation.
    const firstRotate = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalToken });
    const rotatedToken = firstRotate.body.data.refreshToken as string;

    // Attacker (or a bug) replays the now-revoked original token.
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalToken });
    expect(reuseRes.status).toBe(401);

    // Reuse detection should have revoked the legitimately-rotated token too.
    const followUp = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedToken });
    expect(followUp.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session so the refresh token can no longer be used', async () => {
    const { refreshToken } = await createLoggedInSuperAdmin();

    const logoutRes = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
