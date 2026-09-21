import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('centralized error handling', () => {
  const app = createApp();

  it('returns a clean 401 envelope for a protected route with no auth header, never a stack trace', async () => {
    // authenticate() throws UnauthorizedError before any DB query runs, so
    // this exercises the full error middleware without needing a live MongoDB.
    const res = await request(app).get('/api/v1/tenants');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: expect.any(String),
      errors: [],
    });
    expect(res.body.message).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack frame leaked
    expect(res.body).not.toHaveProperty('stack');
  });

  it('returns 401 for an invalid bearer token rather than an unhandled error', async () => {
    const res = await request(app)
      .get('/api/v1/tenants')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('placeholder (not-yet-implemented) modules still enforce authentication', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
