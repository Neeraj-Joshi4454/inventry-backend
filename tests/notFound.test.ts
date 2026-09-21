import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('404 handling', () => {
  const app = createApp();

  it('returns the standard error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: expect.stringContaining('Route not found'),
      errors: [],
    });
  });
});
